import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

// Ensure public directory exists
fs.mkdirSync(publicDir, { recursive: true });

// 1. Standard SVG Icon (512x512)
const standardSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1329" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.25" />
      <stop offset="60%" stop-color="#0284c7" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#0369a1" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="sweepGrad" x1="50%" y1="50%" x2="90%" y2="20%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.6" />
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="cyanAccent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" rx="108" fill="url(#bgGrad)" />
  <rect width="510" height="510" x="1" y="1" rx="107" fill="none" stroke="#1e293b" stroke-width="2" />

  <!-- Radar Glow -->
  <circle cx="256" cy="256" r="220" fill="url(#radarGlow)" />

  <!-- Radar Grid Rings -->
  <circle cx="256" cy="256" r="210" fill="none" stroke="#1e293b" stroke-width="2.5" />
  <circle cx="256" cy="256" r="150" fill="none" stroke="#0369a1" stroke-width="2" stroke-dasharray="8 6" opacity="0.6" />
  <circle cx="256" cy="256" r="90" fill="none" stroke="#0ea5e9" stroke-width="2" opacity="0.4" />
  <circle cx="256" cy="256" r="30" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.8" />

  <!-- Crosshair axes -->
  <line x1="256" y1="36" x2="256" y2="476" stroke="#1e293b" stroke-width="2" stroke-dasharray="6 6" />
  <line x1="36" y1="256" x2="476" y2="256" stroke="#1e293b" stroke-width="2" stroke-dasharray="6 6" />

  <!-- Radar Sweep Cone -->
  <path d="M 256 256 L 380 90 A 210 210 0 0 0 256 46 Z" fill="url(#sweepGrad)" opacity="0.85" />

  <!-- HRTF Sound Wave Rings (Left & Right) -->
  <path d="M 170 200 A 70 70 0 0 0 170 312" fill="none" stroke="#38bdf8" stroke-width="4.5" stroke-linecap="round" />
  <path d="M 140 176 A 110 110 0 0 0 140 336" fill="none" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round" opacity="0.75" />
  <path d="M 342 200 A 70 70 0 0 1 342 312" fill="none" stroke="#38bdf8" stroke-width="4.5" stroke-linecap="round" />
  <path d="M 372 176 A 110 110 0 0 1 372 336" fill="none" stroke="#0284c7" stroke-width="3.5" stroke-linecap="round" opacity="0.75" />

  <!-- Headphone Band -->
  <path d="M 200 240 C 200 176, 312 176, 312 240" fill="none" stroke="#f8fafc" stroke-width="8" stroke-linecap="round" />

  <!-- Head / Center Listener Core -->
  <circle cx="256" cy="256" r="34" fill="#0f172a" stroke="#38bdf8" stroke-width="4" />
  <!-- Directional arrow on center core -->
  <polygon points="256,238 247,255 256,251 265,255" fill="#38bdf8" />

  <!-- Left Ear Cup -->
  <rect x="190" y="234" width="16" height="44" rx="8" fill="url(#cyanAccent)" />
  <!-- Right Ear Cup -->
  <rect x="306" y="234" width="16" height="44" rx="8" fill="url(#cyanAccent)" />

  <!-- Detected Camera Blip (Target) -->
  <circle cx="340" cy="130" r="10" fill="#38bdf8">
    <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
  </circle>
  <circle cx="340" cy="130" r="18" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.6" />
</svg>`;

// 2. Maskable SVG Icon (512x512) - strictly within central 80% safe zone
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="mBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1329" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <radialGradient id="mRadarGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.3" />
      <stop offset="60%" stop-color="#0284c7" stop-opacity="0.1" />
      <stop offset="100%" stop-color="#0369a1" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="mSweepGrad" x1="50%" y1="50%" x2="90%" y2="20%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.7" />
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0" />
    </linearGradient>
    <linearGradient id="mCyanAccent" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>

  <!-- Full-bleed background for maskable (no rounded corners, fills entire square) -->
  <rect width="512" height="512" fill="url(#mBgGrad)" />

  <!-- Elements scaled down ~80% to fit within safe zone (r=180 instead of r=220) -->
  <circle cx="256" cy="256" r="180" fill="url(#mRadarGlow)" />
  <circle cx="256" cy="256" r="170" fill="none" stroke="#1e293b" stroke-width="3" />
  <circle cx="256" cy="256" r="120" fill="none" stroke="#0369a1" stroke-width="2.5" stroke-dasharray="7 5" opacity="0.6" />
  <circle cx="256" cy="256" r="72" fill="none" stroke="#0ea5e9" stroke-width="2" opacity="0.5" />
  <circle cx="256" cy="256" r="26" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.8" />

  <!-- Crosshairs -->
  <line x1="256" y1="76" x2="256" y2="436" stroke="#1e293b" stroke-width="2" stroke-dasharray="5 5" />
  <line x1="76" y1="256" x2="436" y2="256" stroke="#1e293b" stroke-width="2" stroke-dasharray="5 5" />

  <!-- Sweep Cone -->
  <path d="M 256 256 L 360 125 A 170 170 0 0 0 256 86 Z" fill="url(#mSweepGrad)" opacity="0.85" />

  <!-- Sound Wave Rings -->
  <path d="M 185 210 A 55 55 0 0 0 185 302" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
  <path d="M 160 190 A 90 90 0 0 0 160 322" fill="none" stroke="#0284c7" stroke-width="3" stroke-linecap="round" opacity="0.75" />
  <path d="M 327 210 A 55 55 0 0 1 327 302" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
  <path d="M 352 190 A 90 90 0 0 1 352 322" fill="none" stroke="#0284c7" stroke-width="3" stroke-linecap="round" opacity="0.75" />

  <!-- Headphone Band -->
  <path d="M 210 242 C 210 190, 302 190, 302 242" fill="none" stroke="#f8fafc" stroke-width="7" stroke-linecap="round" />

  <!-- Center Listener Core -->
  <circle cx="256" cy="256" r="28" fill="#0f172a" stroke="#38bdf8" stroke-width="3.5" />
  <polygon points="256,242 249,255 256,252 263,255" fill="#38bdf8" />

  <!-- Ear Cups -->
  <rect x="202" y="238" width="14" height="36" rx="7" fill="url(#mCyanAccent)" />
  <rect x="296" y="238" width="14" height="36" rx="7" fill="url(#mCyanAccent)" />

  <!-- Target Blip -->
  <circle cx="328" cy="152" r="9" fill="#38bdf8" />
  <circle cx="328" cy="152" r="16" fill="none" stroke="#38bdf8" stroke-width="1.8" opacity="0.6" />
</svg>`;

// 3. OpenGraph / Twitter Card SVG (1200x630)
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="ogBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#020617" />
      <stop offset="50%" stop-color="#0b1329" />
      <stop offset="100%" stop-color="#020617" />
    </linearGradient>
    <radialGradient id="ogGlow" cx="28%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0284c7" stop-opacity="0.28" />
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="#38bdf8" />
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="100%" stop-color="#0284c7" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#ogBg)" />
  <rect width="1196" height="626" x="2" y="2" fill="none" stroke="#1e293b" stroke-width="2" />
  <circle cx="340" cy="315" r="320" fill="url(#ogGlow)" />

  <!-- Radar Circles on Left -->
  <g transform="translate(300, 315)">
    <circle cx="0" cy="0" r="220" fill="none" stroke="#1e293b" stroke-width="2.5" />
    <circle cx="0" cy="0" r="160" fill="none" stroke="#0284c7" stroke-width="2" stroke-dasharray="8 6" opacity="0.6" />
    <circle cx="0" cy="0" r="100" fill="none" stroke="#0ea5e9" stroke-width="2" opacity="0.4" />
    <circle cx="0" cy="0" r="40" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.8" />
    <line x1="0" y1="-230" x2="0" y2="230" stroke="#1e293b" stroke-width="2" stroke-dasharray="6 6" />
    <line x1="-230" y1="0" x2="230" y2="0" stroke="#1e293b" stroke-width="2" stroke-dasharray="6 6" />

    <!-- Sweep -->
    <path d="M 0 0 L 140 -170 A 220 220 0 0 0 0 -220 Z" fill="#38bdf8" opacity="0.25" />

    <!-- Sound waves -->
    <path d="M -80 -40 A 60 60 0 0 0 -80 40" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
    <path d="M -110 -60 A 90 90 0 0 0 -110 60" fill="none" stroke="#0284c7" stroke-width="3" stroke-linecap="round" opacity="0.7" />
    <path d="M 80 -40 A 60 60 0 0 1 80 40" fill="none" stroke="#38bdf8" stroke-width="4" stroke-linecap="round" />
    <path d="M 110 -60 A 90 90 0 0 1 110 60" fill="none" stroke="#0284c7" stroke-width="3" stroke-linecap="round" opacity="0.7" />

    <!-- Headphone & Head -->
    <path d="M -40 -10 C -40 -60, 40 -60, 40 -10" fill="none" stroke="#f8fafc" stroke-width="7" stroke-linecap="round" />
    <circle cx="0" cy="0" r="30" fill="#0f172a" stroke="#38bdf8" stroke-width="3.5" />
    <polygon points="0,-15 -8,2 0,-1 8,2" fill="#38bdf8" />
    <rect x="-48" y="-15" width="14" height="34" rx="7" fill="url(#accentGrad)" />
    <rect x="34" y="-15" width="14" height="34" rx="7" fill="url(#accentGrad)" />

    <!-- Target blip -->
    <circle cx="120" cy="-120" r="11" fill="#38bdf8" />
    <circle cx="120" cy="-120" r="20" fill="none" stroke="#38bdf8" stroke-width="2" opacity="0.6" />
  </g>

  <!-- Typography & Information on Right -->
  <g transform="translate(600, 140)">
    <!-- Badge -->
    <rect x="0" y="0" width="230" height="32" rx="16" fill="#0369a1" fill-opacity="0.25" stroke="#0284c7" stroke-width="1.5" />
    <text x="115" y="21" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#38bdf8" text-anchor="middle" letter-spacing="1">
      SPATIAL AUDIO RADAR
    </text>

    <!-- Main Title -->
    <text x="0" y="90" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="800" fill="url(#textGrad)" letter-spacing="-1">
      3D Pose Audio Radar
    </text>

    <!-- Subtitle -->
    <text x="0" y="140" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="500" fill="#94a3b8">
      音だけでカメラ位置を知覚する 360° 立体音響空間レーダー
    </text>

    <!-- Description -->
    <text x="0" y="190" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#64748b">
      MediaPipe Pose 3D骨格 ＆ WHENet頭部姿勢推定 × Web Audio HRTF
    </text>

    <!-- Feature Tags -->
    <g transform="translate(0, 240)">
      <!-- Tag 1 -->
      <rect x="0" y="0" width="165" height="38" rx="8" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />
      <text x="82" y="24" font-family="monospace" font-size="13" fill="#38bdf8" font-weight="600" text-anchor="middle">
        3D HRTF Panning
      </text>

      <!-- Tag 2 -->
      <rect x="177" y="0" width="170" height="38" rx="8" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />
      <text x="262" y="24" font-family="monospace" font-size="13" fill="#38bdf8" font-weight="600" text-anchor="middle">
        MediaPipe + WHENet
      </text>

      <!-- Tag 3 -->
      <rect x="359" y="0" width="150" height="38" rx="8" fill="#0f172a" stroke="#1e293b" stroke-width="1.5" />
      <text x="434" y="24" font-family="monospace" font-size="13" fill="#38bdf8" font-weight="600" text-anchor="middle">
        PWA Installable
      </text>
    </g>

    <!-- Bottom URL & Author Credit -->
    <g transform="translate(0, 340)">
      <text x="0" y="20" font-family="monospace" font-size="16" fill="#0284c7" font-weight="700">
        pose-audio-radar.moukaeritai.work
      </text>
      <text x="400" y="20" font-family="system-ui, -apple-system, sans-serif" font-size="15" fill="#64748b">
        by @TakashiSasaki
      </text>
    </g>
  </g>
</svg>`;

// Write SVGs to public directory
fs.writeFileSync(path.join(publicDir, 'icon.svg'), standardSvg);
fs.writeFileSync(path.join(publicDir, 'icon-maskable.svg'), maskableSvg);
fs.writeFileSync(path.join(publicDir, 'og-image.svg'), ogSvg);
console.log('Written SVG files: icon.svg, icon-maskable.svg, og-image.svg');

// Rasterize SVGs to required PNG resolutions
function rasterize(svgString, width, height, outputPath) {
  const resvg = new Resvg(svgString, {
    fitTo: {
      mode: 'width',
      value: width,
    },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync(outputPath, pngBuffer);
  console.log(`Rasterized: ${path.basename(outputPath)} (${width}x${height})`);
}

// 1. pwa-192x192.png
rasterize(standardSvg, 192, 192, path.join(publicDir, 'pwa-192x192.png'));

// 2. pwa-512x512.png
rasterize(standardSvg, 512, 512, path.join(publicDir, 'pwa-512x512.png'));

// 3. pwa-maskable-512x512.png
rasterize(maskableSvg, 512, 512, path.join(publicDir, 'pwa-maskable-512x512.png'));

// 4. apple-touch-icon.png (180x180)
rasterize(standardSvg, 180, 180, path.join(publicDir, 'apple-touch-icon.png'));

// 5. favicon.png (32x32)
rasterize(standardSvg, 32, 32, path.join(publicDir, 'favicon.png'));

// 6. og-image.png (1200x630)
rasterize(ogSvg, 1200, 630, path.join(publicDir, 'og-image.png'));

console.log('All icons and OG images successfully generated!');
