import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { expandHead, headToAudio, readAngles, rgbaToPlanar, selectHead } from '../src/vision/whenetMath';
import { WhenetTracker } from '../src/vision/whenetTracker';
import type { WhenetRequest, WhenetResponse } from '../src/vision/whenetProtocol';

const startup = { detectorMs: 10, estimatorMs: 20, totalMs: 30, runtimeVersion: 'test', executionProvider: 'wasm' as const, numThreads: 1 as const };
const timings = { frameUploadMs: 1, headPreprocessMs: 1, headInferenceMs: 10, headPostprocessMs: 1,
  posePreprocessMs: 1, poseInferenceMs: 20, posePostprocessMs: 1, workerOtherMs: 0 };
const box = { x: 0.4, y: 0.4, width: 0.2, height: 0.2, score: 0.9 };
const pose = { yaw: 0, pitch: 0, roll: 0, box };
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }

test('YOLOX selects the largest valid head, ignoring bodies, hands and low scores', () => {
  const result = selectHead([
    0, 0, 0.99, 0, 0, 320, 256,
    0, 2, 0.99, 0, 0, 320, 256,
    0, 1, 0.49, 0, 0, 320, 256,
    0, 1, 0.99, 10, 10, 30, 30,
    0, 1, 0.8, -10, -10, 160, 128,
    0, 1, 0.9, 100, 100, 50, 50,
    0, 1, 0.9, NaN, 0, 320, 256,
  ]);
  assert.deepEqual(result, { x: 0, y: 0, width: 0.5, height: 0.5, score: 0.8 });
  assert.equal(selectHead([]), null);
  assert.equal(selectHead([0, 1, 0.4, 0, 0, 320, 256]), null);
});

test('head crops remain inside image bounds, including heads at an edge', () => {
  for (const original of [box, { ...box, x: 0, y: 0 }, { ...box, x: 0.8, y: 0.8 }]) {
    const crop = expandHead(original);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1 && crop.y + crop.height <= 1);
    assert.ok(crop.width >= original.width && crop.height >= original.height - 1e-12);
  }
});

test('model preprocessing preserves 0..255 and distinguishes BGR detector from RGB WHENet', () => {
  const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 0]);
  assert.deepEqual([...rgbaToPlanar(rgba, false)], [10, 40, 20, 50, 30, 60]);
  assert.deepEqual([...rgbaToPlanar(rgba, true)], [30, 60, 20, 50, 10, 40]);
  assert.deepEqual(readAngles([20, 5, -10]), { yaw: 20, roll: 5, pitch: -10 });
  for (const invalid of [[NaN, 0, 0], [181, 0, 0], [0, 0], [0, 101, 0]]) assert.throws(() => readAngles(invalid));
});

test('head rotation maps front, side, back, pitch and mirror into listener coordinates', () => {
  let c = headToAudio(pose, 2.5, false); near(c.x, 0); near(c.y, 0); near(c.z, -2.5);
  c = headToAudio({ ...pose, yaw: 90 }, 2.5, false); near(c.x, -2.5); near(c.z, 0);
  c = headToAudio({ ...pose, yaw: -90 }, 2.5, false); near(c.x, 2.5);
  c = headToAudio({ ...pose, yaw: 180 }, 2.5, false); near(c.z, 2.5);
  c = headToAudio({ ...pose, pitch: 30 }, 2.5, false); near(c.elevationDeg, -30);
  c = headToAudio({ ...pose, yaw: 90 }, 2.5, true); near(c.x, 2.5);
  c = headToAudio({ ...pose, yaw: 70, roll: 40, pitch: -20 }, 2.5, false); near(c.distance, 2.5);
});

test('off-center head projection recovers the camera on the listener’s actual side', () => {
  // Listener faces -Z. A parallel camera looking back at them has image-right = listener-left.
  // Project known camera positions into the raw, unmirrored image independently of headToAudio.
  const depth = 2.5;
  for (const cameraX of [-.5, .5]) {
    const centerX = .5 + cameraX / (2 * depth * Math.tan(Math.PI / 6));
    const translated = { ...pose, box: { ...box, x: centerX - box.width / 2 } };
    const expectedScale = depth / Math.hypot(cameraX, depth);
    const normal = headToAudio(translated, depth, false);
    near(normal.x, cameraX * expectedScale);
    near(normal.y, 0);
    near(normal.z, -depth * expectedScale);
    const mirrored = headToAudio(translated, depth, true);
    near(mirrored.x, -normal.x);
    near(mirrored.y, normal.y);
    near(mirrored.z, normal.z);
  }
});

class WorkerMock {
  static instances: WorkerMock[] = [];
  onmessage: ((event: { data: WhenetResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  messages: WhenetRequest[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  constructor() { WorkerMock.instances.push(this); }
  postMessage(message: WhenetRequest, transfers: Transferable[] = []) { this.messages.push(message); this.transfers.push(transfers); }
  terminate() { this.terminated = true; }
  emit(data: WhenetResponse) { this.onmessage?.({ data }); }
}
const originals = ['Worker', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
const trackers: WhenetTracker[] = [];
beforeEach(() => {
  mock.method(performance, 'now', () => 0);
  WorkerMock.instances = [];
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: WorkerMock });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    baseURI: 'https://example.test/app/',
    createElement: () => ({ width: 0, height: 0, getContext: () => ({
      drawImage() {},
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    }) }),
  } });
});
afterEach(() => {
  mock.restoreAll();
  for (const tracker of trackers.splice(0)) tracker.destroy();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function tracker() { const t = new WhenetTracker(); trackers.push(t); return t; }
async function ready() {
  const t = tracker(); const loading = t.initModel(); const w = WorkerMock.instances.at(-1)!;
  w.emit({ type: 'ready', startup }); await loading;
  const video = { readyState: 2, currentTime: 0, srcObject: null, videoWidth: 640, videoHeight: 480 };
  Object.assign(t, { videoElement: video });
  return { t, w, video };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function frame(w: WorkerMock) { return w.messages.filter(m => m.type === 'frame').at(-1)! as Extract<WhenetRequest, { type: 'frame' }>; }

test('WHENet enforces head-only fixed distance and shares concurrent model loads', async () => {
  const t = tracker();
  t.updateConfig({ trackingMode: 'shoulder', distanceMode: 'dynamic', fixedDistance: 3 });
  assert.equal(t.getConfig().trackingMode, 'head'); assert.equal(t.getConfig().distanceMode, 'fixed');
  const first = t.initModel(); assert.equal(t.initModel(), first);
  WorkerMock.instances[0].emit({ type: 'ready', startup }); await first;
  assert.equal(t.getIsReady(), true); assert.equal(t.getIsLoading(), false);
});

test('only one inference is in flight; no head and stale frames invalidate audio tracking', async () => {
  const { t, w, video } = await ready();
  t.processFrame(100); await flush();
  video.currentTime++; t.processFrame(200); await flush();
  assert.equal(w.messages.filter(m => m.type === 'frame').length, 1);
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 100 });
  let data = t.processFrame(300); assert.equal(data.hasPose, true); assert.deepEqual(data.headBox, box);
  await flush();
  w.emit({ type: 'result', timings, id: frame(w).id, pose: null, elapsedMs: 50 });
  assert.equal(t.processFrame(400).hasPose, false);
  video.currentTime++; t.processFrame(500); await flush();
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 100 });
  data = t.processFrame(1600); assert.equal(data.hasPose, false); assert.equal(data.headBox, undefined);
});

test('stop or camera switch discards a late worker result before accepting new frames', async () => {
  const { t, w, video } = await ready();
  t.processFrame(100); await flush(); const old = frame(w);
  t.stopCamera(); Object.assign(t, { videoElement: video });
  t.processFrame(200); await flush();
  assert.equal(w.messages.filter(m => m.type === 'frame').length, 1);
  w.emit({ type: 'result', timings, id: old.id, pose, elapsedMs: 100 });
  assert.equal(t.processFrame(300).hasPose, false); await flush();
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 100 });
  assert.equal(t.processFrame(400).hasPose, true);
});

test('camera capture caps resolution and transfers CPU pixels without an ImageBitmap', async () => {
  const { t, w, video } = await ready();
  video.videoWidth = 1920; video.videoHeight = 1080;
  t.processFrame(100);
  const request = frame(w);
  assert.equal(request.width, 640); assert.equal(request.height, 360);
  assert.ok(request.pixels instanceof Uint8ClampedArray);
  assert.equal(request.pixels.length, 640 * 360 * 4);
  assert.deepEqual(w.transfers.at(-1), [request.pixels.buffer]);
  assert.equal('bitmap' in request, false);
});

test('a failed pixel capture reports its stage and releases the worker', async () => {
  const { t, w } = await ready();
  mock.method(document, 'createElement', () => { throw new Error('readback failed'); });
  const result = t.processFrame(100);
  assert.match(result.errorMessage!, /映像の取り出し・受け渡し.*readback failed/);
  assert.equal(w.terminated, true);
});

test('initialization failure and inference failure terminate the worker and allow a clean retry', async () => {
  const t = tracker(); const first = t.initModel(); const w = WorkerMock.instances.at(-1)!;
  w.emit({ type: 'error', message: 'download failed' });
  await assert.rejects(first, /download failed/); assert.equal(w.terminated, true);
  const second = t.initModel(); const next = WorkerMock.instances.at(-1)!;
  next.emit({ type: 'ready', startup }); await second;
  next.emit({ type: 'error', message: 'inference failed' });
  assert.equal(t.processFrame(0).errorMessage, 'inference failed'); assert.equal(next.terminated, true);
});

test('destroy rejects a pending load and prevents another worker from being created', async () => {
  const t = tracker(); const promise = t.initModel(); t.destroy();
  await assert.rejects(promise, /destroyed/); await assert.rejects(t.initModel(), /destroyed/);
  assert.equal(WorkerMock.instances.length, 1); assert.equal(WorkerMock.instances[0].terminated, true);
});


test('smoothing preserves fixed distance even across a front-to-back reversal', async () => {
  const { t, w } = await ready();
  t.updateConfig({ smoothingAlpha: 0.5 });
  t.processFrame(100); await flush();
  w.emit({ type: 'result', timings, id: frame(w).id, pose: { ...pose, yaw: 180 }, elapsedMs: 100 });
  const data = t.processFrame(200);
  assert.equal(data.hasPose, true); near(data.coords.distance, 2.5);
  assert.ok(Object.values(data.coords).every(Number.isFinite));
});

test('late events from a terminated worker cannot break its replacement', async () => {
  const t = tracker(); const first = t.initModel(); const old = WorkerMock.instances.at(-1)!;
  old.emit({ type: 'error', message: 'failed' }); await assert.rejects(first);
  const second = t.initModel(); const next = WorkerMock.instances.at(-1)!;
  next.emit({ type: 'ready', startup }); await second;
  old.emit({ type: 'error', message: 'late error' }); old.onerror?.({ message: 'late crash' });
  assert.equal(t.getIsReady(), true); assert.equal(next.terminated, false);
});


test('a delayed result from a frozen camera is discarded without changing direction', async () => {
  const { t, w } = await ready();
  t.processFrame(100); await flush();
  mock.method(performance, 'now', () => 1200);
  w.emit({ type: 'result', timings, id: frame(w).id, pose: { ...pose, yaw: 90 }, elapsedMs: 1100 });
  const data = t.processFrame(1200);
  assert.equal(data.hasPose, false); near(data.coords.x, 0); near(data.coords.z, -2.5);
});


test('a live camera accepts slow results and holds them while the next inference runs', async () => {
  const { t, w, video } = await ready();
  let now = 100;
  mock.method(performance, 'now', () => now);
  t.processFrame(now);
  for (now = 600; now <= 2100; now += 500) {
    video.currentTime++;
    t.processFrame(now);
  }
  now = 2500;
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 2400 });
  let data = t.processFrame(now);
  assert.equal(data.hasPose, true); assert.deepEqual(data.headBox, box);
  near(data.fps, 1000 / 2400); assert.equal(data.inference?.latencyMs, 2400);
  for (now = 3000; now <= 4500; now += 500) {
    video.currentTime++;
    data = t.processFrame(now);
    assert.equal(data.hasPose, true);
  }
  now = 4900;
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 2400 });
  assert.equal(t.processFrame(now).hasPose, true);
  near(t.processFrame(now).fps, 1000 / 2400);
});

test('stalled output expires even while the camera keeps producing frames', async () => {
  const { t, w, video } = await ready();
  t.processFrame(100);
  mock.method(performance, 'now', () => 200);
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 100 });
  video.currentTime++;
  assert.equal(t.processFrame(300).hasPose, true);
  video.currentTime++;
  const stale = t.processFrame(1300);
  assert.equal(stale.hasPose, false); assert.equal(stale.headBox, undefined);
  assert.equal(stale.inference?.phase, 'stale');
});

for (const [phase, label] of [['capturing', '映像の取り出し・受け渡し'], ['detecting-head', '頭部検出'], ['estimating-pose', 'WHENet の角度推定']] as const) {
  test(`timeout identifies ${phase} and terminates the worker`, async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const { t, w } = await ready();
    t.processFrame(100);
    if (phase !== 'capturing') {
      context.mock.timers.tick(20_000);
      w.emit({ type: 'progress', id: frame(w).id, phase, timings });
    }
    assert.equal(t.processFrame(100).inference?.phase, phase);
    context.mock.timers.tick(29_999);
    assert.equal(w.terminated, false);
    context.mock.timers.tick(1);
    assert.match(t.processFrame(100).errorMessage!, new RegExp(label));
    assert.equal(w.terminated, true);
  });
}

test('diagnostics measure capture, model work and delivery separately and retain partial work on timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const { t, w, video } = await ready();
  let now = 100;
  mock.method(performance, 'now', () => now);
  mock.method(document, 'createElement', () => ({ width: 0, height: 0, getContext: () => ({
    drawImage() { now += 5; },
    getImageData() { now += 5; return { data: new Uint8ClampedArray(640 * 480 * 4) }; },
  }) }) as unknown as HTMLCanvasElement);
  t.processFrame(now);
  now = 900; video.currentTime++; t.processFrame(now);
  now = 1100;
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 35 });
  const result = t.processFrame(now).diagnostics!;
  const measured = result.samples[0];
  assert.equal(measured.timings.captureMs, 10);
  assert.equal(measured.timings.totalMs, 1000);
  assert.equal(measured.timings.deliveryMs, 955);
  assert.deepEqual(measured.sourceSize, [640, 480]);
  assert.equal(measured.timings.poseInferenceMs, 20);
  assert.equal(result.startup?.runtimeVersion, 'test');
  w.emit({ type: 'progress', id: frame(w).id, phase: 'estimating-pose', timings });
  context.mock.timers.tick(30_000);
  const failed = t.processFrame(now).diagnostics!;
  assert.equal(failed.failure?.phase, 'estimating-pose');
  assert.equal(failed.failure?.partial?.workerTimings.headInferenceMs, 10);
  assert.equal(failed.samples.length, 1);
  t.stopCamera();
  assert.equal(failed.samples.length, 1); // retained UI snapshot is immutable across restart
  assert.equal(t.processFrame(now).diagnostics?.samples.length, 0);
});

test('visibility changes are retained even when no animation callback runs while hidden', async () => {
  let onVisibility: (() => void) | undefined;
  Object.assign(document, { addEventListener: (_type: string, listener: () => void) => { onVisibility = listener; } });
  const { t, w, video } = await ready();
  let now = 100;
  mock.method(performance, 'now', () => now);
  t.processFrame(now);
  Object.assign(document, { visibilityState: 'hidden' }); onVisibility!();
  Object.assign(document, { visibilityState: 'visible' }); onVisibility!();
  now = 1000; video.currentTime++; t.processFrame(now);
  now = 1100;
  w.emit({ type: 'result', timings, id: frame(w).id, pose, elapsedMs: 35 });
  const sample = t.processFrame(now).diagnostics!.samples[0];
  assert.equal(sample.hiddenDuringFrame, true);
  assert.equal(sample.maxAnimationGapMs, 900);
});
