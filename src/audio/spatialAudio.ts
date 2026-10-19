/**
 * Web Audio API HRTF 3D Spatial Audio Engine
 */

export type SoundType = 'clock' | 'footsteps' | 'pulsed_noise';
export type PanningMode = 'HRTF' | 'equalpower';
export type ChannelTestMode = 'stereo' | 'left' | 'right' | 'alternating';
export type SweepVolumeProfile = 'swell' | 'crescendo' | 'decrescendo' | 'standard';

export interface AudioCoordinates {
  x: number; // Right (+) / Left (-)
  y: number; // Up (+) / Down (-)
  z: number; // Forward (-) / Backward (+)
  distance: number;
  azimuthDeg: number;
  elevationDeg: number;
}

export class SpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private panner: PannerNode | null = null;
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;

  // Stereo channel routing & isolation for testing
  private channelSplitter: ChannelSplitterNode | null = null;
  private channelMerger: ChannelMergerNode | null = null;
  private leftGain: GainNode | null = null;
  private rightGain: GainNode | null = null;
  private channelMode: ChannelTestMode = 'stereo';
  private alternatingStep: number = 0;

  private isRunning: boolean = false;
  private soundType: SoundType = 'clock';
  private panningMode: PanningMode = 'HRTF';
  private bpm: number = 120;
  private volume: number = 0.7;
  private timerId: number | null = null;
  private clockStep: number = 0; // alternates tick / tock

  // White noise buffer cached for synthesis
  private noiseBuffer: AudioBuffer | null = null;

  // Track loss damping
  private isTrackingLost: boolean = false;

  // Dynamic 180-degree audio sweep settings
  private isSweepEnabled: boolean = false;
  private sweepVolumeProfile: SweepVolumeProfile = 'swell';
  private sweepDurationMs: number = 150; // 0 = Auto (linked to BPM), >0 = fixed duration in ms
  private sweepEndTime: number = 0;
  private currentTargetCoords: AudioCoordinates = {
    x: 0,
    y: 0,
    z: -2.5,
    distance: 2.5,
    azimuthDeg: 0,
    elevationDeg: 0,
  };

  constructor() {}

  public async init(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AudioContextClass();

    // Master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);

    // High shelf / low pass for subtle distance damping
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.setValueAtTime(18000, this.ctx.currentTime);

    // HRTF Panner Node
    this.panner = this.ctx.createPanner();
    this.panner.panningModel = this.panningMode;
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1.0;
    this.panner.maxDistance = 10000;
    this.panner.rolloffFactor = 1.0;
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 360;

    // Default position: Front 2.5m (x: 0, y: 0, z: -2.5)
    this.updatePosition({ x: 0, y: 0, z: -2.5, distance: 2.5, azimuthDeg: 0, elevationDeg: 0 });

    // Connect graph:
    // Panner -> Filter -> Splitter
    // Splitter ch0 (Left) -> leftGain -> Merger ch0
    // Splitter ch1 (Right) -> rightGain -> Merger ch1
    // Merger -> MasterGain -> Destination (including isolated test tones)
    this.channelSplitter = this.ctx.createChannelSplitter(2);
    this.channelMerger = this.ctx.createChannelMerger(2);
    this.leftGain = this.ctx.createGain();
    this.rightGain = this.ctx.createGain();

    this.panner.connect(this.filterNode);
    this.filterNode.connect(this.channelSplitter);

    this.channelSplitter.connect(this.leftGain, 0);
    this.channelSplitter.connect(this.rightGain, 1);

    this.leftGain.connect(this.channelMerger, 0, 0);
    this.rightGain.connect(this.channelMerger, 0, 1);

    this.channelMerger.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.updateChannelGains();

    // Create 2-second white noise buffer for bursts
    this.createNoiseBuffer();

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  // Output Sink ID & Device Routing
  private currentSinkId: string = 'default';
  private sinkAudioElement: HTMLAudioElement | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;

  public setChannelMode(mode: ChannelTestMode): void {
    this.channelMode = mode;
    this.updateChannelGains();
  }

  public getChannelMode(): ChannelTestMode {
    return this.channelMode;
  }

  private updateChannelGains(): void {
    if (!this.leftGain || !this.rightGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.channelMode === 'left') {
      this.leftGain.gain.setTargetAtTime(1.0, now, 0.01);
      this.rightGain.gain.setTargetAtTime(0.0, now, 0.01);
    } else if (this.channelMode === 'right') {
      this.leftGain.gain.setTargetAtTime(0.0, now, 0.01);
      this.rightGain.gain.setTargetAtTime(1.0, now, 0.01);
    } else if (this.channelMode === 'alternating') {
      const isLeft = this.alternatingStep % 2 === 0;
      this.leftGain.gain.setTargetAtTime(isLeft ? 1.0 : 0.0, now, 0.01);
      this.rightGain.gain.setTargetAtTime(isLeft ? 0.0 : 1.0, now, 0.01);
    } else {
      // stereo (normal)
      this.leftGain.gain.setTargetAtTime(1.0, now, 0.01);
      this.rightGain.gain.setTargetAtTime(1.0, now, 0.01);
    }
  }

  /**
   * Play an immediate isolated stereo test chirp in either the left or right ear.
   * Can be invoked even when the main camera/tracking sequencer is not running.
   */
  public async playTestTone(channel: 'left' | 'right'): Promise<void> {
    await this.init();
    if (!this.ctx || !this.channelMerger) return;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    // Distinct pitch: Left is 587Hz (D5), Right is 880Hz (A5)
    const baseFreq = channel === 'left' ? 587 : 880;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.12);

    env.gain.setValueAtTime(0.001, now);
    env.gain.linearRampToValueAtTime(0.5, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    // Route directly to channelMerger: 0 = Left ear, 1 = Right ear
    osc.connect(env);
    env.connect(this.channelMerger, 0, channel === 'left' ? 0 : 1);

    osc.start(now);
    osc.stop(now + 0.38);
  }

  private createNoiseBuffer(): void {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
  }

  public setSweepEnabled(enabled: boolean): void {
    this.isSweepEnabled = enabled;
    if (!this.getSweepEnabled()) this.cancelSweep();
  }

  public getSweepEnabled(): boolean {
    return this.isSweepEnabled && this.soundType === 'pulsed_noise';
  }

  public setSweepVolumeProfile(profile: SweepVolumeProfile): void {
    this.sweepVolumeProfile = profile;
  }

  public getSweepVolumeProfile(): SweepVolumeProfile {
    return this.sweepVolumeProfile;
  }

  public setSweepDurationMs(durationMs: number): void {
    // 0 = Auto, otherwise clamp between 30ms and 1000ms
    this.sweepDurationMs = durationMs <= 0 ? 0 : Math.max(30, Math.min(1000, durationMs));
  }

  public getSweepDurationMs(): number {
    return this.sweepDurationMs;
  }

  public getActualSweepDurationSec(): number {
    if (this.sweepDurationMs > 0) {
      return this.sweepDurationMs / 1000;
    }
    const beatInterval = 60 / this.bpm;
    return Math.min(0.25, Math.max(0.08, beatInterval * 0.65));
  }

  public setPanningMode(mode: PanningMode): void {
    this.panningMode = mode;
    if (this.panner) {
      this.panner.panningModel = mode;
    }
  }

  public getPanningMode(): PanningMode {
    return this.panningMode;
  }

  public setSoundType(type: SoundType): void {
    this.soundType = type;
    if (!this.getSweepEnabled()) this.cancelSweep();
  }

  public getSoundType(): SoundType {
    return this.soundType;
  }

  public setBpm(bpm: number): void {
    this.bpm = Math.max(30, Math.min(240, bpm));
    if (this.isRunning) {
      this.stopSequencer();
      this.startSequencer();
    }
  }

  public setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  public setTrackingLost(lost: boolean): void {
    this.isTrackingLost = lost;
    if (this.filterNode && this.ctx) {
      // Muffle high frequencies and lower cutoff when lost
      const targetFreq = lost ? 1200 : 18000;
      this.filterNode.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.15);
    }
  }

  public updatePosition(coords: AudioCoordinates): void {
    this.currentTargetCoords = coords;
    if (!this.panner || !this.ctx) return;

    // If dynamic 180-degree sweep is active and currently sweeping,
    // let the AudioParam ramp control the panner position uninterrupted.
    const now = this.ctx.currentTime;
    if (this.getSweepEnabled() && now < this.sweepEndTime) {
      return;
    }

    const { x, y, z } = coords;

    // Use AudioParam if available, fallback to setPosition
    if ('positionX' in this.panner) {
      this.panner.positionX.setTargetAtTime(x, now, 0.05);
      this.panner.positionY.setTargetAtTime(y, now, 0.05);
      this.panner.positionZ.setTargetAtTime(z, now, 0.05);
    } else {
      // Older Safari fallback
      (this.panner as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(x, y, z);
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startSequencer();
  }

  public stop(): void {
    this.isRunning = false;
    this.stopSequencer();
    this.cancelSweep();
  }

  private cancelSweep(): void {
    this.sweepEndTime = 0;
    if (!this.panner || !this.ctx || !('positionX' in this.panner)) return;
    const now = this.ctx.currentTime;
    this.panner.positionX.cancelScheduledValues(now);
    this.panner.positionY.cancelScheduledValues(now);
    this.panner.positionZ.cancelScheduledValues(now);
    this.updatePosition(this.currentTargetCoords);
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  private startSequencer(): void {
    this.stopSequencer();
    const intervalMs = (60 / this.bpm) * 1000;
    // Play immediately, then interval
    this.triggerSound();
    this.timerId = window.setInterval(() => {
      this.triggerSound();
    }, intervalMs);
  }

  private stopSequencer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private triggerSound(): void {
    if (!this.ctx || !this.panner || this.ctx.state !== 'running') return;

    if (this.channelMode === 'alternating') {
      this.alternatingStep++;
      this.updateChannelGains();
    }

    const now = this.ctx.currentTime;

    // 180-degree directional audio sweep execution
    if (this.getSweepEnabled() && 'positionX' in this.panner) {
      // Duration of directional sweep (e.g. custom duration in ms or auto linked to BPM)
      const sweepDuration = this.getActualSweepDurationSec();

      // 180 degree opposite coordinates on the horizontal plane: (-x, y, -z)
      const startX = -this.currentTargetCoords.x;
      const startY = this.currentTargetCoords.y;
      const startZ = -this.currentTargetCoords.z;

      const endX = this.currentTargetCoords.x;
      const endY = this.currentTargetCoords.y;
      const endZ = this.currentTargetCoords.z;

      this.sweepEndTime = now + sweepDuration;

      this.panner.positionX.cancelScheduledValues(now);
      this.panner.positionY.cancelScheduledValues(now);
      this.panner.positionZ.cancelScheduledValues(now);

      // S-curve Ease-In-Out speed profile (Slow -> Normal -> Slow)
      const samples = 64;
      const curveX = new Float32Array(samples);
      const curveY = new Float32Array(samples);
      const curveZ = new Float32Array(samples);

      for (let i = 0; i < samples; i++) {
        const u = i / (samples - 1);
        // Smoothstep easing: 3*u^2 - 2*u^3 (starts slow, accelerates, decelerates to slow)
        const ease = u * u * (3 - 2 * u);
        curveX[i] = startX + (endX - startX) * ease;
        curveY[i] = startY + (endY - startY) * ease;
        curveZ[i] = startZ + (endZ - startZ) * ease;
      }

      this.panner.positionX.setValueCurveAtTime(curveX, now, sweepDuration);
      this.panner.positionY.setValueCurveAtTime(curveY, now, sweepDuration);
      this.panner.positionZ.setValueCurveAtTime(curveZ, now, sweepDuration);
    }

    switch (this.soundType) {
      case 'clock':
        this.playMechanicalClock();
        break;
      case 'footsteps':
        this.playFootstep();
        break;
      case 'pulsed_noise':
        this.playPulsedNoise();
        break;
    }
  }

  /**
   * Enumerate system audio output devices (e.g. Headphones vs Headset)
   */
  public async getAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audiooutput');
    } catch (e) {
      console.warn('Failed to enumerate audio output devices:', e);
      return [];
    }
  }

  /**
   * Request microphone permission briefly if needed to reveal device labels (Headset vs Headphones),
   * then return all audio output devices.
   */
  public async requestAudioDeviceAccess(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices) return [];
    try {
      if (navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((track) => track.stop());
        } catch {
          // If rejected or unavailable, proceed with enumeration
        }
      }
    } catch {
      // Ignore
    }
    return this.getAudioOutputDevices();
  }

  /**
   * Switch the audio output sink destination (e.g. from Hands-Free Headset to Stereo Headphones).
   * Supported in modern Chromium (AudioContext.setSinkId) or fallback HTMLAudioElement.setSinkId.
   */
  public async setAudioOutputDevice(deviceId: string): Promise<boolean> {
    await this.init();
    if (!this.ctx) return false;

    // Once routed through an audio element, keep switching that active route.
    if (this.sinkAudioElement) {
      try {
        await this.sinkAudioElement.setSinkId(deviceId);
        this.currentSinkId = deviceId;
        return true;
      } catch (error) {
        console.warn('Audio output switch failed:', error);
        return false;
      }
    }

    // 1. Primary: AudioContext.prototype.setSinkId (Chrome 110+, Edge)
    if ('setSinkId' in this.ctx && typeof (this.ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId === 'function') {
      try {
        await (this.ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
        this.currentSinkId = deviceId;
        return true;
      } catch (err) {
        console.warn('AudioContext.setSinkId failed, attempting HTMLAudioElement fallback:', err);
      }
    }

    // 2. Secondary fallback: Route Web Audio to MediaStreamDestination -> HTMLAudioElement.setSinkId
    if (typeof Audio !== 'undefined' && 'setSinkId' in Audio.prototype && this.masterGain) {
      const destination = this.ctx.createMediaStreamDestination();
      const element = new Audio();
      try {
        element.srcObject = destination.stream;
        await element.setSinkId(deviceId);
        this.masterGain.connect(destination);
        await element.play();
        this.masterGain.disconnect(this.ctx.destination);
        this.streamDestination = destination;
        this.sinkAudioElement = element;
        this.currentSinkId = deviceId;
        return true;
      } catch (fallbackErr) {
        element.pause();
        element.srcObject = null;
        try {
          this.masterGain.disconnect(destination);
        } catch { /* Connection may not have been made yet. */ }
        console.error('HTMLAudioElement.setSinkId failed:', fallbackErr);
      }
    }

    return false;
  }

  public getCurrentSinkId(): string {
    return this.currentSinkId;
  }

  public isSetSinkIdSupported(): boolean {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const hasCtxSink = typeof AudioContextClass !== 'undefined' && 'setSinkId' in AudioContextClass.prototype;
    const hasAudioSink = typeof Audio !== 'undefined' && 'setSinkId' in Audio.prototype;
    return Boolean(hasCtxSink || hasAudioSink);
  }

  /**
   * Sound 1: Mechanical Clock (Tick-Tock)
   * Bandpass filtered short noise burst (18ms) + damped sine click (2kHz - 3kHz).
   * Tick: higher pitch (3.2kHz BP, 2.2kHz sine)
   * Tock: slightly lower pitch (2.4kHz BP, 1.8kHz sine)
   */
  private playMechanicalClock(): void {
    if (!this.ctx || !this.panner || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const isTick = this.clockStep % 2 === 0;
    this.clockStep++;

    const baseGain = this.isTrackingLost ? 0.35 : 0.85;

    // 1. Noise burst component (escapement wheel click)
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    const noiseOffset = Math.random() * 1.5;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(isTick ? 3200 : 2500, now);
    noiseFilter.Q.setValueAtTime(4.5, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(baseGain * 0.9, now + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018); // 18ms impulse

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.panner);

    // 2. High metallic chime resonance
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const sineFreq = isTick ? 2400 : 1900;
    osc.frequency.setValueAtTime(sineFreq, now);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0, now);
    oscGain.gain.linearRampToValueAtTime(baseGain * 0.4, now + 0.001);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);

    osc.connect(oscGain);
    oscGain.connect(this.panner);

    noiseSource.start(now, noiseOffset, 0.025);
    osc.start(now);
    osc.stop(now + 0.025);
  }

  /**
   * Sound 2: Footstep
   * Low pitch drop sine wave (130Hz -> 35Hz, 60ms) + floor friction bandpass noise (1.1kHz)
   */
  private playFootstep(): void {
    if (!this.ctx || !this.panner || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const isLeft = this.clockStep % 2 === 0;
    this.clockStep++;

    const baseGain = this.isTrackingLost ? 0.35 : 0.85;

    // 1. Low thud pitch drop
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const startFreq = isLeft ? 135 : 125;
    const endFreq = isLeft ? 36 : 32;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.06);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0, now);
    oscGain.gain.linearRampToValueAtTime(baseGain * 0.75, now + 0.005);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    osc.connect(oscGain);
    oscGain.connect(this.panner);

    // 2. Floor friction noise burst (1.1kHz bandpass)
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    const noiseOffset = Math.random() * 1.5;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(isLeft ? 1100 : 1050, now);
    noiseFilter.Q.setValueAtTime(2.0, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(baseGain * 0.45, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.panner);

    osc.start(now);
    osc.stop(now + 0.075);
    noiseSource.start(now, noiseOffset, 0.05);
  }

  /**
   * Sound 3: Pulsed White Noise
   * Amplitude-modulated broadband white noise burst (80ms attack/decay)
   */
  private playPulsedNoise(): void {
    if (!this.ctx || !this.panner || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    const baseGain = this.isTrackingLost ? 0.3 : 0.75;

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;

    // Subtle bandpass shaping to accentuate HRTF pinna filtering (800Hz - 8kHz)
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.Q.setValueAtTime(0.7, now);

    const gain = this.ctx.createGain();
    const duration = this.getSweepEnabled()
      ? this.getActualSweepDurationSec()
      : 0.08; // 80ms pulse or custom duration during 180-degree directional sweep

    if (this.getSweepEnabled() && this.sweepVolumeProfile === 'swell') {
      // 小 → 大 → 小（スウェル / 山型: 始点＝小、中間＝大、終点＝小）
      gain.gain.setValueAtTime(baseGain * 0.05, now);
      gain.gain.linearRampToValueAtTime(baseGain, now + duration * 0.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    } else if (this.getSweepEnabled() && this.sweepVolumeProfile === 'crescendo') {
      // クレッシェンド（徐々に小 → 大: 始点＝小、終点＝大）
      gain.gain.setValueAtTime(baseGain * 0.05, now);
      gain.gain.exponentialRampToValueAtTime(baseGain, now + duration * 0.88);
      gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    } else if (this.getSweepEnabled() && this.sweepVolumeProfile === 'decrescendo') {
      // デクレッシェンド（徐々に大 → 小: 始点＝大、終点＝小）
      gain.gain.setValueAtTime(baseGain, now);
      gain.gain.exponentialRampToValueAtTime(baseGain * 0.02, now + duration * 0.92);
      gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    } else {
      // 標準（アタック → 減衰パルス）
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(baseGain, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    }

    noiseSource.connect(filter);
    filter.connect(gain);
    gain.connect(this.panner);

    const noiseOffset = Math.random() * Math.max(0, this.noiseBuffer.duration - duration - 0.01);
    noiseSource.start(now, noiseOffset, duration + 0.01);
  }

  public destroy(): void {
    this.stop();
    if (this.sinkAudioElement) {
      try {
        this.sinkAudioElement.pause();
        this.sinkAudioElement.srcObject = null;
      } catch {}
      this.sinkAudioElement = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
  }
}

/** Apply a saved output before either tracking audio or test tones can play. */
export async function initializeAudioOutput(audio: SpatialAudioEngine, preferredSinkId: string): Promise<boolean> {
  await audio.init();
  return audio.getCurrentSinkId() === preferredSinkId || audio.setAudioOutputDevice(preferredSinkId);
}
