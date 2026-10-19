import { PoseTracker, type PoseFrameData, type PoseTrackerConfig } from './poseTracker';
import { coordinates, headToAudio } from './whenetMath';
import type { InferencePhase, WhenetRequest, WhenetResponse } from './whenetProtocol';

const STAGE_TIMEOUT_MS = 30_000;
const VIDEO_STALE_MS = 1000;
const phaseLabels: Record<InferencePhase, string> = {
  capturing: '映像の取り出し・受け渡し',
  'detecting-head': '頭部検出',
  'estimating-pose': 'WHENet の角度推定',
};

// Reuse the camera lifecycle from PoseTracker; never initialize its MediaPipe model.
export class WhenetTracker extends PoseTracker {
  private worker: Worker | null = null;
  private ready = false;
  private loading: Promise<void> | null = null;
  private rejectLoad: ((reason: Error) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private nextId = 0;
  private pending: { id: number; generation: number; capturedAt: number; phase: InferencePhase } | null = null;
  private lastVideoTime = -1;
  private lastObservedVideoTime = -1;
  private lastVideoAdvanceTime = 0;
  private lastCompletedTime: number | null = null;
  private lastInferenceMs = 0;
  private result: PoseFrameData = this.emptyFrame();
  private smoothed = coordinates(0, 0, -2.5);
  private disposed = false;
  private captureCanvas: HTMLCanvasElement | null = null;

  private emptyFrame(): PoseFrameData {
    return { hasPose: false, landmarks: null, worldLandmarks: null,
      coords: coordinates(0, 0, -2.5), clockDirectionText: '頭部未検出', clockHour: 12,
      confidence: 0, shoulderAngleDeg: 0, headAngleDeg: 0, offsetAngleDeg: 0, fps: 0,
      inference: { phase: 'waiting-frame', latencyMs: null } };
  }

  public override updateConfig(config: Partial<PoseTrackerConfig>): void {
    super.updateConfig({ ...config, trackingMode: 'head', distanceMode: 'fixed' });
  }
  public override getIsReady(): boolean { return this.ready; }
  public override getIsLoading(): boolean { return this.loading !== null; }

  public override initModel(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Tracker was destroyed'));
    if (this.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.result = this.emptyFrame();
    this.loading = new Promise<void>((resolve, reject) => {
      this.rejectLoad = reject;
      try {
        const worker = new Worker(new URL('./whenet.worker.ts', import.meta.url), { type: 'module' });
        this.worker = worker;
        worker.onerror = (event) => {
          if (this.worker === worker) this.fail(event.message || 'WHENet ワーカーを起動できませんでした');
        };
        worker.onmessage = (event: MessageEvent<WhenetResponse>) => {
          if (this.worker !== worker || this.disposed) return;
          const message = event.data;
          if (message.type === 'error') { this.fail(message.message); return; }
          if (message.type === 'ready') {
            this.clearTimer();
            this.ready = true;
            this.rejectLoad = null;
            resolve();
            return;
          }
          const pending = this.pending;
          if (!pending || pending.id !== message.id) return;
          if (message.type === 'progress') {
            if (pending.generation === this.generation) this.beginStage(message.phase);
            return;
          }
          this.clearTimer();
          this.pending = null;
          if (pending.generation !== this.generation) return;
          const now = performance.now();
          // Include capture, delivery, and inference in latency and first-result FPS.
          const latencyMs = Math.max(1, message.elapsedMs, now - pending.capturedAt);
          const fps = 1000 / Math.max(1, this.lastCompletedTime === null ? latencyMs : now - this.lastCompletedTime);
          this.lastCompletedTime = now;
          this.lastInferenceMs = latencyMs;
          if (!message.pose || now - this.lastVideoAdvanceTime > VIDEO_STALE_MS) {
            this.result = { ...this.emptyFrame(), coords: this.smoothed, fps,
              inference: { phase: now - this.lastVideoAdvanceTime > VIDEO_STALE_MS ? 'stale' : 'no-head', latencyMs } };
            return;
          }
          const config = this.getConfig();
          const target = headToAudio(message.pose, config.fixedDistance, config.mirrorMode);
          const a = Math.max(0.05, Math.min(1, config.smoothingAlpha));
          const blended = coordinates(a * target.x + (1 - a) * this.smoothed.x,
            a * target.y + (1 - a) * this.smoothed.y, a * target.z + (1 - a) * this.smoothed.z);
          // Keep the fixed radius even while smoothing; opposite vectors must not collapse to zero.
          const scale = config.fixedDistance / Math.max(1e-6, blended.distance);
          this.smoothed = blended.distance < 1e-6 ? target : coordinates(blended.x * scale, blended.y * scale, blended.z * scale);
          const azimuth = this.smoothed.azimuthDeg;
          const clockHour = Math.round(((azimuth + 360) % 360) / 30) % 12 || 12;
          this.result = { ...this.emptyFrame(), hasPose: true, coords: this.smoothed, headBox: message.pose.box,
            confidence: message.pose.box.score, headAngleDeg: -message.pose.yaw,
            clockHour, clockDirectionText: `${clockHour}時方向 / ${Math.round(azimuth)}°`, fps,
            inference: { phase: 'tracking', latencyMs } };
        };
        this.timer = setTimeout(() => this.fail('モデル読み込みがタイムアウトしました。通信状況を確認して再試行してください'), 60_000);
        this.send({ type: 'init', baseUrl: new URL((import.meta.env?.BASE_URL ?? '/'), document.baseURI).href });
      } catch (error) {
        this.fail(error instanceof Error ? error.message : String(error));
      }
    }).finally(() => { this.loading = null; });
    return this.loading;
  }

  private send(message: WhenetRequest, transfers: Transferable[] = []): void {
    this.worker?.postMessage(message, transfers);
  }
  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  private beginStage(phase: InferencePhase): void {
    if (!this.pending) return;
    this.pending.phase = phase;
    this.clearTimer();
    this.result = { ...this.result, inference: { phase, latencyMs: this.result.inference?.latencyMs ?? null } };
    this.timer = setTimeout(() => this.fail(`${phaseLabels[phase]}が30秒以内に完了しませんでした。再試行するか、MediaPipe に切り替えてください`), STAGE_TIMEOUT_MS);
  }
  private fail(message: string): void {
    this.clearTimer();
    this.ready = false;
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
    this.result = { ...this.emptyFrame(), errorMessage: message };
    this.rejectLoad?.(new Error(message));
    this.rejectLoad = null;
  }

  public override processFrame(timestamp: number): PoseFrameData {
    const video = this.videoElement;
    if (video && video.readyState >= 2 && video.currentTime !== this.lastObservedVideoTime) {
      this.lastObservedVideoTime = video.currentTime;
      this.lastVideoAdvanceTime = timestamp;
    }
    if (this.ready && video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && !this.pending && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const pending = { id: ++this.nextId, generation: this.generation, capturedAt: timestamp, phase: 'capturing' as const };
      this.pending = pending;
      this.beginStage('capturing');
      // One frame in flight, capped at 640 px. Transfer CPU pixels rather than a video texture.
      try {
        const canvas = this.captureCanvas ??= document.createElement('canvas');
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('映像を取り出すための Canvas を作成できませんでした');
        ctx.drawImage(video, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        this.send({ type: 'frame', id: pending.id, pixels, width, height }, [pixels.buffer]);
      } catch (error) {
        this.fail(`映像の取り出し・受け渡しに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // A slow but live pipeline remains usable. Expire stalled output after two observed cycles,
    // while independently detecting a frozen camera so it cannot keep an old head pose alive.
    const resultLifetime = Math.max(1000, Math.min(STAGE_TIMEOUT_MS, this.lastInferenceMs * 2));
    if (this.result.hasPose && (timestamp - this.lastVideoAdvanceTime > VIDEO_STALE_MS ||
        (this.lastCompletedTime !== null && timestamp - this.lastCompletedTime > resultLifetime))) {
      return { ...this.result, hasPose: false, headBox: undefined, confidence: 0, clockDirectionText: '頭部推定を待機中',
        inference: { phase: 'stale', latencyMs: this.lastInferenceMs } };
    }
    return this.result;
  }

  public override stopCamera(): void {
    super.stopCamera();
    this.generation++;
    this.lastVideoTime = -1;
    this.lastObservedVideoTime = -1;
    this.lastVideoAdvanceTime = 0;
    this.lastCompletedTime = null;
    this.lastInferenceMs = 0;
    this.smoothed = coordinates(0, 0, -this.getConfig().fixedDistance);
    this.result = this.emptyFrame();
    // An in-flight worker result is discarded by generation; it still releases the single-flight gate.
  }

  public override destroy(): void {
    this.disposed = true;
    super.destroy();
    this.fail('Tracker was destroyed');
    this.captureCanvas = null;
  }
}
