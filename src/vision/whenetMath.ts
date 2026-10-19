import type { AudioCoordinates } from '../audio/spatialAudio';

export interface HeadBox { x: number; y: number; width: number; height: number; score: number }
export interface HeadPose { yaw: number; roll: number; pitch: number; box: HeadBox }
export const HEAD_WIDTH = 320;
export const HEAD_HEIGHT = 256;

// YOLOX post model: [batch, class, confidence, xmin, ymin, xmax, ymax].
// Class 1 is head (body=0, hand=2). Prefer the largest visible head.
export function selectHead(rows: ArrayLike<number>): HeadBox | null {
  let selected: HeadBox | null = null;
  for (let i = 0; i + 6 < rows.length; i += 7) {
    const row = Array.from({ length: 7 }, (_, j) => Number(rows[i + j]));
    if (!row.every(Number.isFinite) || row[0] !== 0 || row[1] !== 1 || row[2] < 0.5 || row[2] > 1) continue;
    const x = Math.max(0, Math.min(1, row[3] / HEAD_WIDTH));
    const y = Math.max(0, Math.min(1, row[4] / HEAD_HEIGHT));
    const width = Math.max(0, Math.min(1, row[5] / HEAD_WIDTH)) - x;
    const height = Math.max(0, Math.min(1, row[6] / HEAD_HEIGHT)) - y;
    if (width * HEAD_WIDTH < 4 || height * HEAD_HEIGHT < 4) continue;
    if (!selected || width * height > selected.width * selected.height) selected = { x, y, width, height, score: row[2] };
  }
  return selected;
}

// Official WHENet demo expands the detected head sequentially (20% x, 10% y).
export function expandHead(box: HeadBox): HeadBox {
  const x = Math.max(0, box.x - box.width * 0.2);
  const y = Math.max(0, box.y - box.height * 0.1);
  const right = Math.min(1, box.x + box.width + (box.x + box.width - x) * 0.2);
  const bottom = Math.min(1, box.y + box.height + (box.y + box.height - y) * 0.1);
  return { x, y, width: right - x, height: bottom - y, score: box.score };
}

// Models take raw float32 0..255, NCHW. YOLOX uses BGR; WHENet embeds RGB normalization.
export function rgbaToPlanar(rgba: Uint8ClampedArray, bgr: boolean): Float32Array {
  const count = rgba.length / 4;
  const data = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    data[i] = rgba[i * 4 + (bgr ? 2 : 0)];
    data[count + i] = rgba[i * 4 + 1];
    data[2 * count + i] = rgba[i * 4 + (bgr ? 0 : 2)];
  }
  return data;
}

export function readAngles(values: ArrayLike<number>): Pick<HeadPose, 'yaw' | 'roll' | 'pitch'> {
  // Verified against original WHENet.h5 dense weights; the converted tensor is yaw, roll, pitch.
  const [yaw, roll, pitch] = Array.from(values, Number);
  if (values.length !== 3 || ![yaw, roll, pitch].every(Number.isFinite) || Math.abs(yaw) > 180 || Math.abs(roll) > 100 || Math.abs(pitch) > 100) {
    throw new Error('WHENet が無効な角度を返しました');
  }
  return { yaw, roll, pitch };
}

// Invert the original WHENet draw_axis rotation to express camera position in head coordinates.
// Camera basis: image-right, image-down, toward camera. Audio: listener-right, up, back.
// Approximate 60° horizontal / 45° vertical camera FOV, same assumptions as the MediaPipe mode.
export function headToAudio(pose: HeadPose, distance: number, mirror: boolean): AudioCoordinates {
  const rad = Math.PI / 180;
  const y = -pose.yaw * rad, p = pose.pitch * rad, r = pose.roll * rad;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p), cr = Math.cos(r), sr = Math.sin(r);
  // Camera direction in the raw image basis. For a front-facing head, image-right
  // is listener-left; the x negation below converts that basis after inverse rotation.
  const vx = (0.5 - pose.box.x - pose.box.width / 2) * 2 * Math.tan(30 * rad);
  const vy = (0.5 - pose.box.y - pose.box.height / 2) * 2 * Math.tan(22.5 * rad);
  let x = -(cy * cr * vx + (cp * sr + cr * sp * sy) * vy + sp * sr - cp * cr * sy);
  const up = -(-cy * sr * vx + (cp * cr - sp * sy * sr) * vy + cr * sp + cp * sy * sr);
  const z = -(sy * vx - cy * sp * vy + cy * cp);
  if (mirror) x = -x;
  const scale = distance / Math.hypot(x, up, z);
  return coordinates(x * scale, up * scale, z * scale);
}

export function coordinates(x: number, y: number, z: number): AudioCoordinates {
  const distance = Math.hypot(x, y, z);
  return { x, y, z, distance, azimuthDeg: Math.atan2(x, -z) * 180 / Math.PI,
    elevationDeg: distance > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, y / distance))) * 180 / Math.PI : 0 };
}
