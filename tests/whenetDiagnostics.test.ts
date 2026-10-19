import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceBenchmark, completeTimings, emptyDiagnostics, recordSample, summarize, HISTORY_LIMIT,
  type Benchmark, type FrameSample, type WorkerTimings } from '../src/vision/whenetDiagnostics';

const worker: WorkerTimings = { frameUploadMs: 2, headPreprocessMs: 3, headInferenceMs: 100,
  headPostprocessMs: 4, posePreprocessMs: 5, poseInferenceMs: 800, posePostprocessMs: 6, workerOtherMs: 10 };
const workerTotal = Object.values(worker).reduce<number>((sum, n) => sum + (n ?? 0), 0);
function sample(id: number, total = 1000, detected = true): FrameSample {
  return { id, completedAt: '2026-10-19T00:00:00Z', detected, cameraLive: true, hiddenDuringFrame: false,
    maxAnimationGapMs: 16, sourceSize: [640, 480], inputSize: [640, 480],
    timings: completeTimings(10, total, workerTotal, detected ? worker : { ...worker, posePreprocessMs: null, poseInferenceMs: null, posePostprocessMs: null }) };
}
function benchmark(): Benchmark { return { run: 1, startup: null, afterId: 1, target: 2, status: 'running', warmup: null, samples: [] }; }

test('frame breakdown conserves elapsed time and attributes delayed delivery outside model execution', () => {
  const result = completeTimings(10, 3000, workerTotal, worker);
  assert.equal(result.deliveryMs, 2060);
  assert.equal(result.poseInferenceMs, 800);
  const sum = Object.entries(result).filter(([key]) => key !== 'totalMs').reduce((n, [, value]) => n + (value ?? 0), 0);
  assert.equal(sum, result.totalMs);
  assert.equal(completeTimings(1, 0.99, 0, worker).deliveryMs, 0); // clock precision must not yield a negative wait
});

test('skipped pose inference is excluded instead of diluting averages with zero', () => {
  const samples = [sample(1), sample(2, 500, false), sample(3, 2000)];
  assert.deepEqual(summarize(samples, 'poseInferenceMs'), { count: 2, mean: 800, median: 800, max: 800 });
  assert.deepEqual(summarize(samples, 'totalMs'), { count: 3, mean: 3500 / 3, median: 1000, max: 2000 });
  assert.equal(summarize([samples[1]], 'poseInferenceMs'), null);
  assert.equal(summarize([], 'totalMs'), null);
});

test('history is bounded while the initial sample remains available separately', () => {
  let d = emptyDiagnostics(1);
  for (let id = 1; id <= HISTORY_LIMIT + 10; id++) d = recordSample(d, sample(id));
  assert.equal(d.samples.length, HISTORY_LIMIT);
  assert.equal(d.samples[0].id, 11);
  assert.equal(d.firstSample?.id, 1);
  assert.equal(d.completedCount, 70);
});

test('benchmark excludes the in-flight result and one warm-up, consumes once, then freezes at target', () => {
  let d = recordSample(emptyDiagnostics(1), sample(1));
  let b = advanceBenchmark(benchmark(), d, true);
  assert.equal(b.warmup, null);
  d = recordSample(d, sample(2, 10000));
  b = advanceBenchmark(b, d, true);
  assert.equal(b.warmup?.id, 2); assert.equal(b.samples.length, 0);
  assert.equal(advanceBenchmark(b, d, true), b);
  for (let id = 3; id <= 5; id++) d = recordSample(d, sample(id));
  b = advanceBenchmark(b, d, true);
  assert.deepEqual(b.samples.map(s => s.id), [3, 4]); assert.equal(b.status, 'completed');
  assert.equal(summarize(b.samples, 'totalMs')?.mean, 1000);
  assert.equal(advanceBenchmark(b, d, false), b);
});

test('stop and a new camera run interrupt a benchmark without mixing runs', () => {
  let d = emptyDiagnostics(1);
  d = recordSample(recordSample(d, sample(2)), sample(3));
  const b = advanceBenchmark(benchmark(), d, true);
  assert.equal(b.samples.length, 1);
  const stopped = advanceBenchmark(b, d, false);
  assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.samples.length, 1);
  const restarted = advanceBenchmark(b, recordSample(emptyDiagnostics(2), sample(4)), true);
  assert.equal(restarted.status, 'interrupted'); assert.deepEqual(restarted.samples.map(s => s.id), [3]);
});
