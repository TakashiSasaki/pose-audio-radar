import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { PoseTracker, type TrackingMode } from '../src/vision/poseTracker';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {} } });
});
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function stream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return { track, media: { getTracks: () => [track] } as unknown as MediaStream };
}
function video(play = async () => {}) {
  return { srcObject: null, readyState: 2, setAttribute() {}, play } as unknown as HTMLVideoElement;
}
function acquire(getUserMedia: () => Promise<MediaStream>) {
  Object.assign(navigator.mediaDevices, { getUserMedia });
}

test('stopping a pending acquisition discards its late stream', async () => {
  const request = deferred<MediaStream>();
  acquire(() => request.promise);
  const tracker = new PoseTracker();
  const element = video();
  const starting = tracker.startCamera(element);
  tracker.stopCamera();
  const late = stream();
  request.resolve(late.media);
  assert.equal(await starting, false);
  assert.equal(late.track.stopped, true);
  assert.equal(element.srcObject, null);
});

test('an older acquisition cannot replace the new camera', async () => {
  const first = deferred<MediaStream>();
  const second = deferred<MediaStream>();
  let calls = 0;
  acquire(() => (++calls === 1 ? first.promise : second.promise));
  const tracker = new PoseTracker();
  const element = video();
  const oldStart = tracker.startCamera(element);
  const newStart = tracker.startCamera(element, 'environment');
  const oldStream = stream();
  const newStream = stream();
  second.resolve(newStream.media);
  assert.equal(await newStart, true);
  first.resolve(oldStream.media);
  assert.equal(await oldStart, false);
  assert.equal(oldStream.track.stopped, true);
  assert.equal(newStream.track.stopped, false);
  assert.equal(element.srcObject, newStream.media);
  tracker.stopCamera();
  assert.equal(newStream.track.stopped, true);
});

test('playback failure releases the acquired camera', async () => {
  const acquired = stream();
  acquire(async () => acquired.media);
  const element = video(async () => { throw new Error('play failed'); });
  await assert.rejects(new PoseTracker().startCamera(element), /play failed/);
  assert.equal(acquired.track.stopped, true);
  assert.equal(element.srcObject, null);
});

test('a stale playback rejection leaves a newer camera attached', async () => {
  const firstPlay = deferred<void>();
  const oldStream = stream();
  const newStream = stream();
  let calls = 0;
  acquire(async () => (++calls === 1 ? oldStream.media : newStream.media));
  let plays = 0;
  const element = video(() => (++plays === 1 ? firstPlay.promise : Promise.resolve()));
  const tracker = new PoseTracker();
  const first = tracker.startCamera(element);
  await Promise.resolve();
  assert.equal(await tracker.startCamera(element, 'environment'), true);
  firstPlay.reject(new Error('old playback interrupted'));
  assert.equal(await first, false);
  assert.equal(element.srcObject, newStream.media);
  assert.equal(newStream.track.stopped, false);
  tracker.stopCamera();
});

test('destroy cancels a pending acquisition and prevents future acquisition', async () => {
  const request = deferred<MediaStream>();
  acquire(() => request.promise);
  const tracker = new PoseTracker();
  const element = video();
  const starting = tracker.startCamera(element);
  tracker.destroy();
  const late = stream();
  request.resolve(late.media);
  assert.equal(await starting, false);
  assert.equal(late.track.stopped, true);
  assert.equal(await tracker.startCamera(element), false);
});

function landmarks(imageSpan = .28) {
  const image = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  image[7].x = .55; image[8].x = .45;
  image[11].x += imageSpan / 2; image[12].x -= imageSpan / 2;
  const world = image.map(point => ({ ...point }));
  world[11] = { x: .14, y: 0, z: -.14, visibility: 1 };
  world[12] = { x: -.14, y: 0, z: .14, visibility: 1 };
  world[0].z = -.1;
  return { landmarks: [image], worldLandmarks: [world] };
}
function detectionTracker(mode: TrackingMode = 'shoulder') {
  const tracker = new PoseTracker();
  let detection = landmarks();
  // Substitute model output to exercise geometry and confidence without a camera/GPU.
  Object.assign(tracker, { videoElement: video(), poseLandmarker: { detectForVideo: () => detection } });
  tracker.updateConfig({ trackingMode: mode });
  return { tracker, detect(next: ReturnType<typeof landmarks>, timestamp: number) {
    detection = next;
    return tracker.processFrame(timestamp);
  } };
}

test('shoulder angle is invariant to image scale in shoulder and hybrid modes', () => {
  for (const mode of ['shoulder', 'hybrid'] as const) {
    const { detect } = detectionTracker(mode);
    const near = detect(landmarks(.28), 100);
    const far = detect(landmarks(.14), 200);
    assert.equal(near.hasPose, true);
    assert.equal(near.shoulderAngleDeg, 45);
    assert.equal(far.shoulderAngleDeg, near.shoulderAngleDeg);
    assert.equal(far.coords.azimuthDeg, near.coords.azimuthDeg);
  }
});

test('image translation uses the front-facing listener’s left/right in every reference mode', () => {
  for (const mode of ['head', 'shoulder', 'hybrid'] as const) {
    for (const centerX of [.25, .75]) {
      for (const mirrorMode of [false, true]) {
        const { tracker, detect } = detectionTracker(mode);
        tracker.updateConfig({ mirrorMode });
        const translated = landmarks();
        for (const point of translated.landmarks[0]) point.x += centerX - .5;
        // The head and shoulders face the camera; translation must not change orientation.
        translated.worldLandmarks[0][11].z = 0;
        translated.worldLandmarks[0][12].z = 0;
        const frame = detect(translated, 100);
        const expectedAzimuth = (centerX === .25 ? -15 : 15) * (mirrorMode ? -1 : 1);
        assert.equal(frame.hasPose, true);
        assert.equal(frame.headAngleDeg, 0);
        assert.equal(frame.shoulderAngleDeg, 0);
        assert.ok(Math.abs(frame.coords.azimuthDeg - expectedAzimuth) < 1e-6);
      }
    }
  }
});

test('low head visibility rejects tracking and preserves the last position', () => {
  const { detect } = detectionTracker('head');
  const good = detect(landmarks(), 100);
  const hidden = landmarks();
  hidden.landmarks[0][7].visibility = .01;
  hidden.worldLandmarks[0][0].x = 100;
  const lost = detect(hidden, 200);
  assert.equal(lost.hasPose, false);
  assert.deepEqual(lost.coords, good.coords);
});

test('shoulder mode works with an occluded face, but hybrid requires both', () => {
  const hidden = landmarks();
  for (const index of [0, 7, 8]) {
    hidden.landmarks[0][index].visibility = .01;
    hidden.worldLandmarks[0][index].x = NaN;
  }
  const { detect } = detectionTracker();
  const frame = detect(hidden, 100);
  assert.equal(frame.hasPose, true);
  assert.equal(frame.coords.azimuthDeg, 45);
  assert(Number.isFinite(frame.coords.elevationDeg));
  assert.equal(detectionTracker('hybrid').detect(hidden, 100).hasPose, false);
});

test('head mode only needs shoulders when distance is dynamic', () => {
  const { tracker, detect } = detectionTracker('head');
  const hidden = landmarks();
  hidden.worldLandmarks[0][11].visibility = .01;
  assert.equal(detect(hidden, 100).hasPose, true);
  tracker.updateConfig({ distanceMode: 'dynamic' });
  assert.equal(detect(hidden, 200).hasPose, false);
});

test('nonfinite required coordinates and missing landmarks are rejected', () => {
  const { detect } = detectionTracker();
  const invalid = landmarks();
  invalid.worldLandmarks[0][11].z = NaN;
  assert.equal(detect(invalid, 100).hasPose, false);
  invalid.worldLandmarks[0] = [];
  assert.equal(detect(invalid, 200).hasPose, false);
});
