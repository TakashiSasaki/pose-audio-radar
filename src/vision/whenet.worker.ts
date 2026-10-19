import * as ort from 'onnxruntime-web/wasm';
import { expandHead, HEAD_HEIGHT, HEAD_WIDTH, readAngles, rgbaToPlanar, selectHead } from './whenetMath';
import type { WhenetRequest, WhenetResponse } from './whenetProtocol';

let detector: ort.InferenceSession;
let estimator: ort.InferenceSession;
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

self.onmessage = async (event: MessageEvent<WhenetRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      // Pages has no COOP/COEP headers. Run one WASM thread inside our own worker.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = `${request.baseUrl}whenet/ort/`;
      detector = await ort.InferenceSession.create(`${request.baseUrl}whenet/head.onnx`, { executionProviders: ['wasm'] });
      estimator = await ort.InferenceSession.create(`${request.baseUrl}whenet/whenet.onnx`, { executionProviders: ['wasm'] });
      send({ type: 'ready' });
      return;
    }
    const start = performance.now();
    const { pixels, width, height } = request;
    // CPU-backed pixels avoid transferring hardware-decoded video textures between threads.
    frameCanvas.width = width;
    frameCanvas.height = height;
    frameCtx.putImageData(new ImageData(pixels, width, height), 0, 0);
    send({ type: 'progress', id: request.id, phase: 'detecting-head' });
    headCtx.drawImage(frameCanvas, 0, 0, HEAD_WIDTH, HEAD_HEIGHT);
    const boxes = await infer(detector, rgbaToPlanar(headCtx.getImageData(0, 0, HEAD_WIDTH, HEAD_HEIGHT).data, true), [1, 3, HEAD_HEIGHT, HEAD_WIDTH]);
    const box = selectHead(boxes);
    let pose = null;
    if (box) {
      const crop = expandHead(box);
      send({ type: 'progress', id: request.id, phase: 'estimating-pose' });
      poseCtx.drawImage(frameCanvas, crop.x * width, crop.y * height, crop.width * width, crop.height * height, 0, 0, 224, 224);
      const angles = await infer(estimator, rgbaToPlanar(poseCtx.getImageData(0, 0, 224, 224).data, false), [1, 3, 224, 224]);
      pose = { ...readAngles(angles), box };
    }
    send({ type: 'result', id: request.id, pose, elapsedMs: performance.now() - start });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
