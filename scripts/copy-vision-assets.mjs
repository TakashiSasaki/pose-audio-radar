import { cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy WASM and its loaders from the exact installed JavaScript package.
const packageRoot = dirname(fileURLToPath(import.meta.resolve('@mediapipe/tasks-vision')));
const destination = fileURLToPath(new URL('../public/mediapipe/wasm/', import.meta.url));
mkdirSync(destination, { recursive: true });
cpSync(resolve(packageRoot, 'wasm'), destination, { recursive: true });
