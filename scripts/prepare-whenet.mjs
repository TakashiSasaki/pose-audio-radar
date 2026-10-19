import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Pin both downloads and extracted bytes. Never deploy unverified model files.
const root = fileURLToPath(new URL('../public/whenet/', import.meta.url));
const poseUrl = 'https://github.com/PINTO0309/HeadPoseEstimation-WHENet-yolov4-onnx-openvino/releases/download/v1.0.4/whenet_1x3x224x224_prepost.onnx';
const poseHash = '28345f49bd38a3e74f5d6b028469fe27b6bf5b09405ffdfa0be4b28db6c2be0e';
const headUrl = 'https://s3.ap-northeast-2.wasabisys.com/pinto-model-zoo/426_YOLOX-Body-Head-Hand/resources_n.tar.gz';
const archiveHash = '04607eeaa3148ef82ccffd2b6fd9f7ef837467234600c06f3e65cf42bb6ae4f7';
const headHash = 'f995ac5315917f54654b4ca47f9e574be7bdb636775f289fb8b82c25be040233';
const headMember = 'yolox_n_body_head_hand_post_0461_0.4428_1x3x256x320.onnx';

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function valid(path, expected) {
  try { return await hash(path) === expected; } catch { return false; }
}
async function download(url, path, expected) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  if (!await valid(path, expected)) throw new Error(`SHA-256 mismatch: ${url}`);
}

await mkdir(root, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'pose-whenet-'));
try {
  if (!await valid(join(root, 'whenet.onnx'), poseHash)) {
    await download(poseUrl, join(temp, 'pose'), poseHash);
    await copyFile(join(temp, 'pose'), join(root, 'whenet.onnx'));
  }
  if (!await valid(join(root, 'head.onnx'), headHash)) {
    await download(headUrl, join(temp, 'heads.tar.gz'), archiveHash);
    // Extract only the named regular model into memory; no archive paths are written.
    const bytes = execFileSync('tar', ['-xOf', join(temp, 'heads.tar.gz'), headMember], { maxBuffer: 8 * 1024 * 1024 });
    if (createHash('sha256').update(bytes).digest('hex') !== headHash) throw new Error('Head model SHA-256 mismatch');
    await writeFile(join(root, 'head.onnx'), bytes);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
const ortDist = dirname(fileURLToPath(import.meta.resolve('onnxruntime-web/wasm')));
await mkdir(join(root, 'ort'), { recursive: true });
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(join(ortDist, file), join(root, 'ort', file));
}
console.log('WHENet, head detector, and matching ONNX Runtime WASM assets are ready.');
