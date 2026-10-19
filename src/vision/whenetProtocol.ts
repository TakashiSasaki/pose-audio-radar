import type { HeadPose } from './whenetMath';
export type InferencePhase = 'capturing' | 'detecting-head' | 'estimating-pose';
export type WhenetRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'frame'; id: number; pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };
export type WhenetResponse =
  | { type: 'ready' }
  | { type: 'progress'; id: number; phase: Exclude<InferencePhase, 'capturing'> }
  | { type: 'result'; id: number; pose: HeadPose | null; elapsedMs: number }
  | { type: 'error'; message: string };
