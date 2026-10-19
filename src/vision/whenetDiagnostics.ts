import type { BackendPreference, BackendStatus } from './whenetBackend';
import type { InferencePhase } from './whenetProtocol';

// All durations are measured on their own thread. Never subtract window and worker clocks.
export const timingLabels = {
  captureMs: '映像の縮小・画素取得',
  frameUploadMs: 'Worker 内の画像復元',
  headPreprocessMs: '頭部検出の前処理',
  headInferenceMs: '頭部検出モデルの実行',
  headPostprocessMs: '頭部候補の選択',
  posePreprocessMs: 'WHENet の切り出し・前処理',
  poseInferenceMs: 'WHENet モデルの実行',
  posePostprocessMs: '角度の読み出し',
  workerOtherMs: 'Worker 内のその他',
  deliveryMs: '受け渡し・待機（差分）',
  totalMs: 'フレーム全体',
} as const;
export type TimingKey = keyof typeof timingLabels;
export type FrameTimings = Record<TimingKey, number | null>;
export type WorkerTimings = Pick<FrameTimings, 'frameUploadMs' | 'headPreprocessMs' | 'headInferenceMs' |
  'headPostprocessMs' | 'posePreprocessMs' | 'poseInferenceMs' | 'posePostprocessMs' | 'workerOtherMs'>;
export interface ModelStartup {
  detectorMs: number;
  estimatorMs: number;
  totalMs: number;
  runtimeVersion: string;
  preference: BackendPreference;
  backends: { detector: BackendStatus; estimator: BackendStatus };
  gpu: { vendor: string; architecture: string; description: string } | null;
  numThreads: 1;
}
export interface FrameSample {
  id: number;
  completedAt: string;
  detected: boolean;
  cameraLive: boolean;
  hiddenDuringFrame: boolean;
  maxAnimationGapMs: number;
  sourceSize: [number, number];
  inputSize: [number, number];
  timings: FrameTimings;
}
export interface PendingMeasurement {
  id: number;
  startedAt: number;
  phase: InferencePhase;
  captureMs: number;
  workerTimings: Partial<WorkerTimings>;
}
export interface WhenetDiagnostics {
  run: number;
  startup: ModelStartup | null;
  firstSample: FrameSample | null;
  samples: FrameSample[];
  completedCount: number;
  pending: PendingMeasurement | null;
  failure: { message: string; phase: InferencePhase | 'initializing'; elapsedMs: number; partial: PendingMeasurement | null } | null;
}
export const HISTORY_LIMIT = 60;
export function emptyDiagnostics(run = 0, startup: ModelStartup | null = null): WhenetDiagnostics {
  return { run, startup, firstSample: null, samples: [], completedCount: 0, pending: null, failure: null };
}
export function completeTimings(captureMs: number, totalMs: number, workerElapsedMs: number, timings: WorkerTimings): FrameTimings {
  return { ...timings, captureMs, totalMs, deliveryMs: Math.max(0, totalMs - captureMs - workerElapsedMs) };
}
export function recordSample(diagnostics: WhenetDiagnostics, sample: FrameSample): WhenetDiagnostics {
  return { ...diagnostics, firstSample: diagnostics.firstSample ?? sample,
    samples: [...diagnostics.samples, sample].slice(-HISTORY_LIMIT), completedCount: diagnostics.completedCount + 1, pending: null };
}
export function summarize(samples: FrameSample[], key: TimingKey) {
  const values = samples.map(s => s.timings[key]).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2, max: values.at(-1)! };
}
export interface Benchmark {
  run: number;
  startup: ModelStartup | null;
  afterId: number;
  target: number;
  status: 'running' | 'completed' | 'interrupted';
  warmup: FrameSample | null;
  samples: FrameSample[];
}
export function advanceBenchmark(benchmark: Benchmark, diagnostics: WhenetDiagnostics, active: boolean): Benchmark {
  if (benchmark.status !== 'running') return benchmark;
  if (diagnostics.run !== benchmark.run) return { ...benchmark, status: 'interrupted' };
  const incoming = diagnostics.samples.filter(s => s.id > benchmark.afterId);
  const warmup = benchmark.warmup ?? incoming[0] ?? null;
  const samples = [...benchmark.samples, ...incoming.filter(s => s.id !== warmup?.id)].slice(0, benchmark.target);
  const status = samples.length >= benchmark.target ? 'completed' : !active || diagnostics.failure ? 'interrupted' : 'running';
  if (!incoming.length && status === benchmark.status) return benchmark;
  return { ...benchmark, afterId: incoming.at(-1)?.id ?? benchmark.afterId, warmup, samples, status };
}
export function diagnosticReport(diagnostics: WhenetDiagnostics, benchmark: Benchmark | null) {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const samples = benchmark ? benchmark.samples : diagnostics.samples.filter(s => s.id !== diagnostics.firstSample?.id);
  return {
    schemaVersion: 2, exportedAt: new Date().toISOString(),
    environment: { userAgent: nav.userAgent, hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemoryGB: nav.deviceMemory ?? null, crossOriginIsolated: globalThis.crossOriginIsolated,
      webgpuApiAvailable: 'gpu' in nav, visibilityAtExport: document.visibilityState,
      appBundle: Array.from(document.scripts).find(s => s.type === 'module' && s.src)?.src.split('/').pop() ?? null },
    models: { detector: 'YOLOX Nano body/head/hand, 320x256 BGR', estimator: 'WHENet prepost, 224x224 RGB' },
    timingLabels, diagnostics, benchmark,
    summary: { source: benchmark ? 'benchmark' : 'recent-after-first',
      stages: Object.fromEntries((Object.keys(timingLabels) as TimingKey[]).map(key => [key, summarize(samples, key)])) },
    notes: ['Durations in milliseconds; wall-clock time, not CPU utilization.',
      'Model execution includes tensor creation, output copying and disposal.',
      'Delivery is total minus capture and worker elapsed; includes scheduling in both directions.',
      'Skipped WHENet stages are null, not zero. Benchmark excludes one warm-up frame.',
      'Startup includes fetching and session creation; it is separate from frame timings.',
      'Animation gaps overlap processing and are not additive stage times.',
      'WebGPU routes use CPU for unsupported operators; consult startup.backends for each model. recoveryMs is runtime CPU reinitialization time.'],
  };
}
