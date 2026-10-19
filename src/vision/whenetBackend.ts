export type BackendPreference = 'auto' | 'wasm';
export type ModelBackend = 'webgpu' | 'wasm';
export interface ModelSession {
  run(data: Float32Array, dims: number[]): Promise<Float32Array>;
  release(): Promise<void>;
}
export interface BackendStatus {
  provider: ModelBackend;
  fallbackReason: string | null;
  recoveryMs: number;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

// A model falls back at most once. CPU failures propagate rather than starting a retry loop.
export class FallbackModel {
  private session!: ModelSession;
  public status: BackendStatus = { provider: 'wasm', fallbackReason: null, recoveryMs: 0 };
  constructor(private create: (backend: ModelBackend) => Promise<ModelSession>,
    private gpuFailure: () => string | null = () => null,
    private onChange: () => void = () => {}) {}

  async init(useGpu: boolean, unavailableReason: string | null): Promise<void> {
    if (useGpu) {
      try {
        this.session = await this.create('webgpu');
        this.status = { provider: 'webgpu', fallbackReason: null, recoveryMs: 0 };
        return;
      } catch (error) { unavailableReason = `WebGPU 初期化・試行に失敗: ${message(error)}`; }
    }
    this.session = await this.create('wasm');
    this.status = { provider: 'wasm', fallbackReason: unavailableReason, recoveryMs: 0 };
  }

  async run(data: Float32Array, dims: number[]): Promise<Float32Array> {
    try {
      const lost = this.status.provider === 'webgpu' ? this.gpuFailure() : null;
      if (lost) throw new Error(lost);
      const result = await this.session.run(data, dims);
      if (this.status.provider === 'webgpu' && (this.gpuFailure() || !result.every(Number.isFinite))) throw new Error(this.gpuFailure() ?? 'GPU の結果が不正です');
      return result;
    } catch (error) {
      if (this.status.provider !== 'webgpu') throw error;
      const start = performance.now();
      try { await this.session.release(); } catch { /* Device loss can also prevent release. */ }
      this.session = await this.create('wasm');
      this.status = { provider: 'wasm', fallbackReason: `WebGPU 実行失敗のため CPU へ切替: ${message(error)}`,
        recoveryMs: performance.now() - start };
      this.onChange();
      return this.session.run(data, dims);
    }
  }
}

// API presence alone does not establish usable hardware. Skip known software adapters.
export function softwareAdapter(info: { isFallbackAdapter?: boolean; architecture?: string; description?: string }, legacyFallback?: boolean): boolean {
  return info.isFallbackAdapter === true || legacyFallback === true || /swiftshader|llvmpipe|software/i.test(`${info.architecture ?? ''} ${info.description ?? ''}`);
}
