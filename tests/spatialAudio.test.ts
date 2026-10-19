import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { SpatialAudioEngine, initializeAudioOutput } from '../src/audio/spatialAudio';

class Param {
  value = 1;
  curves: Float32Array[] = [];
  setValueAtTime(value: number) { this.value = value; }
  setTargetAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.value = value; }
  exponentialRampToValueAtTime(value: number) { this.value = value; }
  cancelScheduledValues() { this.curves = []; }
  setValueCurveAtTime(curve: Float32Array) { this.curves.push(curve); }
}
class NodeMock {
  outputs: NodeMock[] = [];
  gain = new Param(); frequency = new Param(); Q = new Param();
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  buffer: { duration: number } | null = null;
  starts: number[][] = [];
  connect(target: NodeMock) { this.outputs.push(target); }
  disconnect(target: NodeMock) { this.outputs = this.outputs.filter(node => node !== target); }
  start(...args: number[]) { this.starts.push(args); }
  stop() {}
}
class ContextMock {
  static latest: ContextMock;
  state = 'running'; currentTime = 0; sampleRate = 16;
  destination = new NodeMock();
  gains: NodeMock[] = []; oscillators: NodeMock[] = []; sources: NodeMock[] = [];
  panner!: NodeMock; merger!: NodeMock;
  sink = 'default'; rejectSink = false;
  constructor() { ContextMock.latest = this; }
  createGain() { const node = new NodeMock(); this.gains.push(node); return node; }
  createBiquadFilter() { return new NodeMock(); }
  createPanner() { return this.panner = new NodeMock(); }
  createChannelSplitter() { return new NodeMock(); }
  createChannelMerger() { return this.merger = new NodeMock(); }
  createOscillator() { const node = new NodeMock(); this.oscillators.push(node); return node; }
  createBufferSource() { const node = new NodeMock(); this.sources.push(node); return node; }
  createBuffer(_channels: number, size: number) {
    return { duration: size / this.sampleRate, getChannelData: () => new Float32Array(size) };
  }
  async setSinkId(id: string) {
    if (this.rejectSink) throw new Error('device unavailable');
    this.sink = id;
  }
  createMediaStreamDestination() { return Object.assign(new NodeMock(), { stream: {} }); }
}
class AudioElementMock {
  static rejectPlay = false;
  srcObject: unknown; sink = 'default';
  async setSinkId(id: string) { this.sink = id; }
  async play() { if (AudioElementMock.rejectPlay) throw new Error('play denied'); }
  pause() {}
}
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: ContextMock } });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: undefined });
  AudioElementMock.rejectPlay = false;
});
afterEach(() => {
  for (const [name, descriptor] of [['window', originalWindow], ['Audio', originalAudio]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('initialization honors volume set before the first playback', async () => {
  for (const volume of [0, .2, 1]) {
    const audio = new SpatialAudioEngine();
    audio.setVolume(volume);
    await audio.init();
    assert.equal(ContextMock.latest.gains[0].gain.value, volume);
  }
});

test('both isolated test tones pass through the muted master gain', async () => {
  const audio = new SpatialAudioEngine();
  audio.setVolume(0);
  await audio.init();
  const context = ContextMock.latest;
  const master = context.gains[0];
  for (const channel of ['left', 'right'] as const) {
    await audio.playTestTone(channel);
    const envelope = context.oscillators.at(-1)!.outputs[0];
    assert.deepEqual(envelope.outputs, [context.merger]);
    assert.deepEqual(context.merger.outputs, [master]);
    assert.deepEqual(master.outputs, [context.destination]);
    assert.equal(master.gain.value, 0);
  }
});

test('a saved output is restored before playback and not redundantly reset', async () => {
  const audio = new SpatialAudioEngine();
  assert.equal(await initializeAudioOutput(audio, 'headphones'), true);
  assert.equal(ContextMock.latest.sink, 'headphones');
  assert.equal(audio.getCurrentSinkId(), 'headphones');
  ContextMock.latest.rejectSink = true;
  assert.equal(await initializeAudioOutput(audio, 'headphones'), true);
});

test('an unavailable saved device keeps the actual default output', async () => {
  const audio = new SpatialAudioEngine();
  await audio.init();
  ContextMock.latest.rejectSink = true;
  assert.equal(await initializeAudioOutput(audio, 'missing-headphones'), false);
  assert.equal(audio.getCurrentSinkId(), 'default');
});

test('fallback output also routes through master volume and switches the active element', async () => {
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: AudioElementMock });
  const audio = new SpatialAudioEngine();
  audio.setVolume(0);
  await audio.init();
  const context = ContextMock.latest;
  context.rejectSink = true;
  assert.equal(await audio.setAudioOutputDevice('headphones'), true);
  const master = context.gains[0];
  assert(!master.outputs.includes(context.destination));
  assert.equal(master.outputs.length, 1);
  assert.deepEqual(context.merger.outputs, [master]);
  assert.equal(master.gain.value, 0);
  assert.equal(await audio.setAudioOutputDevice('speakers'), true);
  assert.equal(audio.getCurrentSinkId(), 'speakers');
});

test('failed fallback playback preserves the default audio route', async () => {
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: AudioElementMock });
  AudioElementMock.rejectPlay = true;
  const audio = new SpatialAudioEngine();
  await audio.init();
  const context = ContextMock.latest;
  context.rejectSink = true;
  assert.equal(await audio.setAudioOutputDevice('headphones'), false);
  assert.deepEqual(context.gains[0].outputs, [context.destination]);
  assert.equal(audio.getCurrentSinkId(), 'default');
});

// Trigger a single beat without installing a real interval in the test process.
function beat(audio: SpatialAudioEngine) {
  (audio as unknown as { triggerSound(): void }).triggerSound();
}
test('clock and footstep sounds never start a sweep that outlasts them', async () => {
  const audio = new SpatialAudioEngine();
  await audio.init();
  audio.setSweepEnabled(true);
  for (const type of ['clock', 'footsteps'] as const) {
    audio.setSoundType(type);
    beat(audio);
    assert.equal(audio.getSweepEnabled(), false);
    assert.equal(ContextMock.latest.panner.positionX.curves.length, 0);
  }
  audio.setSoundType('pulsed_noise');
  beat(audio);
  assert.equal(audio.getSweepEnabled(), true);
  assert.equal(ContextMock.latest.panner.positionX.curves.length, 1);
});

test('disabling a sweep or selecting a short sound cancels its automation', async () => {
  const audio = new SpatialAudioEngine();
  await audio.init();
  audio.setSoundType('pulsed_noise');
  audio.setSweepEnabled(true);
  beat(audio);
  audio.setSweepEnabled(false);
  assert.equal(ContextMock.latest.panner.positionX.curves.length, 0);
  audio.setSweepEnabled(true);
  beat(audio);
  audio.setSoundType('clock');
  assert.equal(ContextMock.latest.panner.positionZ.curves.length, 0);
});

test('a long noise sweep always fits within the cached noise buffer', async () => {
  const audio = new SpatialAudioEngine();
  await audio.init();
  audio.setSoundType('pulsed_noise');
  audio.setSweepEnabled(true);
  audio.setSweepDurationMs(1000);
  beat(audio);
  const source = ContextMock.latest.sources.at(-1)!;
  const [, offset, duration] = source.starts[0];
  assert(offset + duration <= source.buffer!.duration);
});
