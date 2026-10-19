import type { HeadPose } from './whenetMath';
export type WhenetRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'frame'; id: number; bitmap: ImageBitmap };
export type WhenetResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; pose: HeadPose | null; elapsedMs: number }
  | { type: 'error'; message: string };
