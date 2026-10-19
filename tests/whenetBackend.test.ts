import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FallbackModel, softwareAdapter, type ModelBackend, type ModelSession } from '../src/vision/whenetBackend';
const input = new Float32Array([1, 2, 3]);
const dims = [3];
const result = new Float32Array([4, 5, 6]);
function session(run: ModelSession['run'] = async () => result): ModelSession { return { run, release: async () => {} }; }

test('GPU preference uses a successful GPU model without creating a CPU session', async () => {
  const created: ModelBackend[] = [];
  const model = new FallbackModel(async backend => { created.push(backend); return session(); });
  await model.init(true, null);
  assert.equal(await model.run(input, dims), result);
  assert.deepEqual(created, ['webgpu']); assert.equal(model.status.provider, 'webgpu');
});

test('CPU-only and unavailable GPU paths never attempt GPU initialization', async () => {
  for (const reason of [null, 'No adapter']) {
    const created: ModelBackend[] = [];
    const model = new FallbackModel(async backend => { created.push(backend); return session(); });
    await model.init(false, reason); await model.run(input, dims);
    assert.deepEqual(created, ['wasm']); assert.equal(model.status.fallbackReason, reason);
  }
});

test('GPU creation or warm-up failure falls back for only that model', async () => {
  const bad = new FallbackModel(async backend => {
    if (backend === 'webgpu') throw new Error('shader failed');
    return session();
  });
  const good = new FallbackModel(async () => session());
  await bad.init(true, null); await good.init(true, null);
  assert.equal(bad.status.provider, 'wasm'); assert.match(bad.status.fallbackReason!, /shader failed/);
  assert.equal(good.status.provider, 'webgpu');
  assert.equal(await bad.run(input, dims), result);
});

test('runtime GPU failure releases its session and retries the same input once on CPU', async () => {
  const events: string[] = [];
  const model = new FallbackModel(async backend => {
    events.push(`create:${backend}`);
    if (backend === 'webgpu') return { run: async () => { throw new Error('device lost'); }, release: async () => { events.push('release'); } };
    return session(async (data, shape) => { assert.equal(data, input); assert.equal(shape, dims); events.push('run:wasm'); return result; });
  }, () => null, () => events.push('changed'));
  await model.init(true, null);
  assert.equal(await model.run(input, dims), result); await model.run(input, dims);
  assert.deepEqual(events, ['create:webgpu', 'release', 'create:wasm', 'changed', 'run:wasm', 'run:wasm']);
  assert.equal(model.status.provider, 'wasm'); assert.match(model.status.fallbackReason!, /device lost/);
});

test('device loss and non-finite GPU output trigger CPU recovery', async () => {
  for (const lost of [true, false]) {
    let changes = 0;
    const model = new FallbackModel(async backend => session(async () => backend === 'webgpu' ? new Float32Array([NaN]) : result),
      () => lost ? 'lost' : null, () => changes++);
    await model.init(true, null);
    assert.equal(await model.run(input, dims), result);
    assert.equal(changes, 1); assert.equal(model.status.provider, 'wasm');
  }
});

test('CPU errors propagate without retry loops', async () => {
  let created = 0, runs = 0;
  const model = new FallbackModel(async () => { created++; return session(async () => { runs++; throw new Error('cpu failed'); }); });
  await model.init(false, null);
  await assert.rejects(model.run(input, dims), /cpu failed/);
  assert.equal(created, 1); assert.equal(runs, 1);
});

test('software adapters are recognized independently of WebGPU API presence', () => {
  assert.equal(softwareAdapter({ isFallbackAdapter: true }), true);
  assert.equal(softwareAdapter({ architecture: 'swiftshader' }), true);
  assert.equal(softwareAdapter({}, true), true);
  assert.equal(softwareAdapter({ architecture: 'pascal', description: 'GTX 1060' }), false);
});
