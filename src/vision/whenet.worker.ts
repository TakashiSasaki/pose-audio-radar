import * as ort from 'onnxruntime-web/webgpu';
import { expandHead, HEAD_HEIGHT, HEAD_WIDTH, readAngles, rgbaToPlanar, selectHead } from './whenetMath';
import { FallbackModel, softwareAdapter, type ModelBackend, type ModelSession } from './whenetBackend';
import type { ModelStartup, WorkerTimings } from './whenetDiagnostics';
import type { WhenetRequest, WhenetResponse } from './whenetProtocol';

let detector: FallbackModel;
let estimator: FallbackModel;
let startup: ModelStartup;
let gpuFailure: string | null = null;
let gpuDevice: GPUDevice | null = null;
let deviceInfo: ModelStartup['gpu'] = null;
const frameCanvas = new OffscreenCanvas(1, 1);
const frameCtx = frameCanvas.getContext('2d')!;
const headCanvas = new OffscreenCanvas(HEAD_WIDTH, HEAD_HEIGHT);
const poseCanvas = new OffscreenCanvas(224, 224);
const headCtx = headCanvas.getContext('2d', { willReadFrequently: true })!;
const poseCtx = poseCanvas.getContext('2d', { willReadFrequently: true })!;
const send = (message: WhenetResponse) => self.postMessage(message);

async function infer(session: ort.InferenceSession, data: Float32Array, dims: number[]): Promise<Float32Array> {
  const input = new ort.Tensor('float32', data, dims);
  let outputs: ort.InferenceSession.ReturnType | undefined;
  try {
    outputs = await session.run({ [session.inputNames[0]]: input });
    return Float32Array.from(outputs[session.outputNames[0]].data as Float32Array);
  } finally {
    input.dispose();
    if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
  }
}

async function createModel(url: string, dims: number[], provider: ModelBackend): Promise<ModelSession> {
  // Only name WebGPU here: initialization errors must reach our explicit CPU fallback.
  // ORT still assigns unsupported operators (e.g. NMS) to its CPU kernels.
  const session = await ort.InferenceSession.create(url, {
    executionProviders: provider === 'webgpu' ? [{ name: 'webgpu', device: gpuDevice! }] : ['wasm'],
  });
  try {
    if (provider === 'webgpu') {
      // Shader compilation and first-run failures happen after session creation on some GPUs.
      const probe = await infer(session, new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
      if (gpuFailure || !probe.every(Number.isFinite)) throw new Error(gpuFailure ?? 'GPU の試行結果が不正です');
    }
    return { run: (data, shape) => infer(session, data, shape), release: () => session.release() };
  } catch (error) {
    try { await session.release(); } catch { /* Preserve the original initialization error. */ }
    throw error;
  }
}

function backendChanged() {
  startup = { ...startup, backends: { detector: detector.status, estimator: estimator.status } };
  send({ type: 'backend', startup });
}

self.onmessage = async (event: MessageEvent<WhenetRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      // WASM also supplies the CPU kernels used by WebGPU for unsupported operators.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = `${request.baseUrl}whenet/ort/`;
      let useGpu = false;
      let unavailableReason: string | null = null;
      let gpuInfo: ModelStartup['gpu'] = null;
      const initStart = performance.now();
      if (request.backend !== 'wasm') {
        try {
          const gpu = navigator.gpu;
          if (!gpu) throw new Error('このブラウザでは WebGPU API を利用できません');
          const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
          if (!adapter) throw new Error('利用可能な GPU アダプターがありません');
          const info = adapter.info ?? {};
          gpuInfo = { vendor: info.vendor ?? '', architecture: info.architecture ?? '', description: info.description ?? '' };
          if (softwareAdapter(info, (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter)) throw new Error('ソフトウェア GPU のため CPU を使用します');
          // Pass an explicit device so ORT uses the high-performance adapter selected above.
          // Request only supported features/limits, including on GPUs without shader-f16.
          const limits = ['maxComputeWorkgroupStorageSize', 'maxComputeWorkgroupsPerDimension',
            'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeInvocationsPerWorkgroup',
            'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ'] as const;
          gpuDevice = await adapter.requestDevice({
            requiredLimits: Object.fromEntries(limits.map(key => [key, adapter.limits[key]])),
            requiredFeatures: (['shader-f16', 'subgroups'] as const).filter(feature => adapter.features.has(feature)),
          });
          const actual = gpuDevice.adapterInfo;
          if (actual) deviceInfo = { vendor: actual.vendor ?? '', architecture: actual.architecture ?? '', description: actual.description ?? '' };
          gpuDevice.lost.then(info => { gpuFailure = `GPU デバイスを利用できなくなりました: ${info.message}`; });
          gpuDevice.addEventListener('uncapturederror', event => { gpuFailure = `WebGPU エラー: ${event.error.message}`; });
          ort.env.webgpu.adapter = adapter;
          useGpu = true;
        } catch (error) { unavailableReason = error instanceof Error ? error.message : String(error); }
      }
      detector = new FallbackModel(provider => createModel(`${request.baseUrl}whenet/head.onnx`, [1, 3, HEAD_HEIGHT, HEAD_WIDTH], provider), () => gpuFailure, backendChanged);
      estimator = new FallbackModel(provider => createModel(`${request.baseUrl}whenet/whenet.onnx`, [1, 3, 224, 224], provider), () => gpuFailure, backendChanged);
      await detector.init(useGpu, unavailableReason);
      const detectorDone = performance.now();
      await estimator.init(useGpu && !gpuFailure, gpuFailure ?? unavailableReason);
      const initDone = performance.now();
      startup = { detectorMs: detectorDone - initStart, estimatorMs: initDone - detectorDone,
        totalMs: initDone - initStart, runtimeVersion: ort.env.versions.web ?? ort.env.versions.common,
        preference: request.backend, backends: { detector: detector.status, estimator: estimator.status }, gpu: deviceInfo ?? gpuInfo, numThreads: 1 };
      send({ type: 'ready', startup });
      return;
    }
    const start = performance.now();
    let mark = start;
    const timings: WorkerTimings = { frameUploadMs: 0, headPreprocessMs: 0, headInferenceMs: 0,
      headPostprocessMs: 0, posePreprocessMs: null, poseInferenceMs: null, posePostprocessMs: null, workerOtherMs: 0 };
    const measure = (key: keyof WorkerTimings) => { const now = performance.now(); timings[key] = now - mark; mark = now; };
    const { pixels, width, height } = request;
    // CPU-backed pixels avoid transferring hardware-decoded video textures between threads.
    frameCanvas.width = width;
    frameCanvas.height = height;
    frameCtx.putImageData(new ImageData(pixels, width, height), 0, 0);
    measure('frameUploadMs');
    send({ type: 'progress', id: request.id, phase: 'detecting-head', timings: { frameUploadMs: timings.frameUploadMs } });
    mark = performance.now();
    headCtx.drawImage(frameCanvas, 0, 0, HEAD_WIDTH, HEAD_HEIGHT);
    const headInput = rgbaToPlanar(headCtx.getImageData(0, 0, HEAD_WIDTH, HEAD_HEIGHT).data, true);
    measure('headPreprocessMs');
    const boxes = await detector.run(headInput, [1, 3, HEAD_HEIGHT, HEAD_WIDTH]);
    measure('headInferenceMs');
    const box = selectHead(boxes);
    measure('headPostprocessMs');
    let pose = null;
    if (box) {
      send({ type: 'progress', id: request.id, phase: 'estimating-pose', timings: { ...timings } });
      mark = performance.now();
      const crop = expandHead(box);
      poseCtx.drawImage(frameCanvas, crop.x * width, crop.y * height, crop.width * width, crop.height * height, 0, 0, 224, 224);
      const poseInput = rgbaToPlanar(poseCtx.getImageData(0, 0, 224, 224).data, false);
      measure('posePreprocessMs');
      const angles = await estimator.run(poseInput, [1, 3, 224, 224]);
      measure('poseInferenceMs');
      pose = { ...readAngles(angles), box };
      measure('posePostprocessMs');
    }
    const elapsedMs = performance.now() - start;
    timings.workerOtherMs = Math.max(0, elapsedMs - Object.values(timings).reduce<number>((sum, ms) => sum + (ms ?? 0), 0));
    send({ type: 'result', id: request.id, pose, elapsedMs, timings });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
