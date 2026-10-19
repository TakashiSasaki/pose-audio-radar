import { PoseTracker, type PoseFrameData, type PoseTrackerConfig } from './poseTracker';
import { coordinates, headToAudio } from './whenetMath';
import type { WhenetRequest, WhenetResponse } from './whenetProtocol';

// Reuse the camera lifecycle from PoseTracker; never initialize its MediaPipe model.
export class WhenetTracker extends PoseTracker {
  private worker: Worker | null = null;
  private ready = false;
  private loading: Promise<void> | null = null;
  private rejectLoad: ((reason: Error) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private nextId = 0;
  private pending: { id: number; generation: number; capturedAt: number } | null = null;
  private lastVideoTime = -1;
  private lastResultTime = 0;
  private lastCompletedTime = 0;
  private result: PoseFrameData = this.emptyFrame();
  private smoothed = coordinates(0, 0, -2.5);
  private disposed = false;

  private emptyFrame(): PoseFrameData {
    return { hasPose: false, landmarks: null, worldLandmarks: null,
      coords: coordinates(0, 0, -2.5), clockDirectionText: '頭部未検出', clockHour: 12,
      confidence: 0, shoulderAngleDeg: 0, headAngleDeg: 0, offsetAngleDeg: 0, fps: 0 };
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
          this.clearTimer();
          this.pending = null;
          if (pending.generation !== this.generation) return;
          this.lastResultTime = pending.capturedAt;
          const now = performance.now();
          const fps = this.lastCompletedTime ? 1000 / (now - this.lastCompletedTime) : 1000 / Math.max(1, message.elapsedMs);
          this.lastCompletedTime = now;
          if (!message.pose || now - pending.capturedAt > 1000) {
            this.result = { ...this.emptyFrame(), coords: this.smoothed, fps: Math.round(fps) };
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
            clockHour, clockDirectionText: `${clockHour}時方向 / ${Math.round(azimuth)}°`, fps: Math.round(fps) };
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
    if (this.ready && video && video.readyState >= 2 && !this.pending && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      const pending = { id: ++this.nextId, generation: this.generation, capturedAt: timestamp };
      this.pending = pending;
      this.timer = setTimeout(() => this.fail('頭部推定がタイムアウトしました。停止して再試行してください'), 15_000);
      // Only one capture/inference may be in flight. Never build a camera-frame queue.
      void Promise.resolve().then(() => createImageBitmap(video)).then((bitmap) => {
        if (!this.worker || pending.generation !== this.generation || this.pending !== pending) {
          bitmap.close();
          if (this.pending === pending) { this.pending = null; this.clearTimer(); }
          return;
        }
        this.send({ type: 'frame', id: pending.id, bitmap }, [bitmap]);
      }).catch((error: unknown) => {
        if (this.pending !== pending) return;
        this.pending = null;
        this.clearTimer();
        if (pending.generation === this.generation) this.fail(error instanceof Error ? error.message : String(error));
      });
    }
    // Stop using stale directions when inference stalls or the video freezes.
    if (this.result.hasPose && timestamp - this.lastResultTime > 1000) {
      return { ...this.result, hasPose: false, headBox: undefined, confidence: 0, clockDirectionText: '頭部推定を待機中' };
    }
    return this.result;
  }

  public override stopCamera(): void {
    super.stopCamera();
    this.generation++;
    this.lastVideoTime = -1;
    this.lastResultTime = 0;
    this.lastCompletedTime = 0;
    this.smoothed = coordinates(0, 0, -this.getConfig().fixedDistance);
    this.result = this.emptyFrame();
    // An in-flight worker result is discarded by generation; it still releases the single-flight gate.
  }

  public override destroy(): void {
    this.disposed = true;
    super.destroy();
    this.fail('Tracker was destroyed');
  }
}
