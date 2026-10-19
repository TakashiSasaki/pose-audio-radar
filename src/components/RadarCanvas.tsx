import React, { useEffect, useRef } from 'react';
import type { AudioCoordinates } from '../audio/spatialAudio';

interface RadarCanvasProps {
  coords: AudioCoordinates;
  hasPose: boolean;
  clockDirectionText?: string;
  clockHour: number;
  panningMode: 'HRTF' | 'equalpower';
  onTogglePanningMode?: () => void;
  className?: string;
  shoulderAngleDeg?: number | null;
  headAngleDeg?: number | null;
  isSweepEnabled?: boolean;
}

export const RadarCanvas: React.FC<RadarCanvasProps> = ({
  coords,
  hasPose,
  clockHour,
  panningMode,
  onTogglePanningMode,
  className = '',
  shoulderAngleDeg,
  headAngleDeg,
  isSweepEnabled = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pulsePhaseRef = useRef<number>(0);

  useEffect(() => {
    let animId: number;

    const render = () => {
      pulsePhaseRef.current = (pulsePhaseRef.current + 0.04) % (Math.PI * 2);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(width, height) * 0.42;

      // 1. Radar background dial
      const bgGrad = ctx.createRadialGradient(centerX, centerY, 10, centerX, centerY, maxRadius * 1.15);
      bgGrad.addColorStop(0, '#0f172a');
      bgGrad.addColorStop(0.8, '#090d16');
      bgGrad.addColorStop(1, '#030712');
      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, maxRadius * 1.12, 0, Math.PI * 2);
      ctx.fill();

      // Outer bezel ring
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 2. Concentric distance rings
      const rings = [0.25, 0.5, 0.75, 1.0];
      rings.forEach((ratio, index) => {
        ctx.beginPath();
        ctx.arc(centerX, centerY, maxRadius * ratio, 0, Math.PI * 2);
        ctx.strokeStyle = index === rings.length - 1 ? '#3b82f640' : '#1e293b';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // 3. 12-Hour Clock Markers & Numbers
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let h = 1; h <= 12; h++) {
        const angle = ((h * 30 - 90) * Math.PI) / 180;
        const tickInner = maxRadius * 0.98;
        const tickOuter = maxRadius * 1.05;
        const x1 = centerX + Math.cos(angle) * tickInner;
        const y1 = centerY + Math.sin(angle) * tickInner;
        const x2 = centerX + Math.cos(angle) * tickOuter;
        const y2 = centerY + Math.sin(angle) * tickOuter;

        const isMajor = h % 3 === 0;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = isMajor ? '#60a5fa' : '#475569';
        ctx.lineWidth = isMajor ? 2 : 1;
        ctx.stroke();

        // Numerals
        const numRadius = maxRadius * 0.86;
        const nx = centerX + Math.cos(angle) * numRadius;
        const ny = centerY + Math.sin(angle) * numRadius;

        const isCurrentHour = hasPose && clockHour === h;
        ctx.font = isCurrentHour ? 'bold 13px ui-sans-serif, system-ui' : '11px ui-sans-serif, system-ui';
        ctx.fillStyle = isCurrentHour ? '#38bdf8' : isMajor ? '#94a3b8' : '#64748b';
        ctx.fillText(h.toString(), nx, ny);
      }

      // Crosshairs
      ctx.strokeStyle = '#1e293b80';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX - maxRadius, centerY);
      ctx.lineTo(centerX + maxRadius, centerY);
      ctx.moveTo(centerX, centerY - maxRadius);
      ctx.lineTo(centerX, centerY + maxRadius);
      ctx.stroke();

      // Cardinal Labels
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillStyle = '#64748b';
      ctx.fillText('正面 (12時)', centerX, centerY - maxRadius * 1.18);
      ctx.fillText('真後ろ (6時)', centerX, centerY + maxRadius * 1.18);
      ctx.fillText('右 (3時)', centerX + maxRadius * 1.18, centerY);
      ctx.fillText('左 (9時)', centerX - maxRadius * 1.18, centerY);

      // 4. Center User Head & Shoulders (Facing 12 o'clock / Up)
      ctx.save();
      ctx.translate(centerX, centerY);

      // Shoulders line
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-18, 10);
      ctx.lineTo(18, 10);
      ctx.stroke();

      // Head circle
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Nose triangle pointing up (12 o'clock)
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(-4, -10);
      ctx.lineTo(0, -17);
      ctx.lineTo(4, -10);
      ctx.closePath();
      ctx.fill();

      // Left and right ears
      ctx.fillStyle = '#0369a1';
      ctx.beginPath();
      ctx.ellipse(-13, 0, 3, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(13, 0, 3, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 5. Sound Source (Camera) Plotting
      // coords.x: right (+), left (-)
      // coords.z: forward (-), backward (+)
      // Radar mapping:
      // In canvas, Up is negative Y (-z in audio), Down is positive Y (+z in audio)
      // Right is positive X, Left is negative X
      const normRadius = maxRadius * 0.72; // default scaled radius
      const sourceX = centerX + (coords.x / 2.5) * normRadius;
      const sourceY = centerY + (coords.z / 2.5) * normRadius;

      if (hasPose) {
        // 180° Directional Sweep Trajectory (if sweep mode is active)
        if (isSweepEnabled) {
          const oppX = centerX - (sourceX - centerX);
          const oppY = centerY - (sourceY - centerY);

          // Motion vector line from 180° opposite to target
          ctx.beginPath();
          ctx.moveTo(oppX, oppY);
          ctx.lineTo(sourceX, sourceY);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Opposite origin indicator dot
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(oppX, oppY, 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Animated particle sweeping along line from opposite to target
          const sweepProgress = (pulsePhaseRef.current / (Math.PI * 2));
          const particleX = oppX + (sourceX - oppX) * sweepProgress;
          const particleY = oppY + (sourceY - oppY) * sweepProgress;

          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(particleX, particleY, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Pulsing acoustic sound waves from camera towards center
        const pulse = Math.sin(pulsePhaseRef.current) * 0.5 + 0.5;
        const waveCount = 3;
        for (let w = 0; w < waveCount; w++) {
          const waveRadius = 14 + ((w * 12 + pulse * 18) % 36);
          const alpha = Math.max(0, 1 - waveRadius / 45);
          ctx.beginPath();
          ctx.arc(sourceX, sourceY, waveRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 0.6})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // Ray line connecting user center to camera
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(sourceX, sourceY);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Camera / Sound source glowing dot
        const dotGrad = ctx.createRadialGradient(sourceX, sourceY, 2, sourceX, sourceY, 12);
        dotGrad.addColorStop(0, '#f87171');
        dotGrad.addColorStop(0.5, '#ef4444');
        dotGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');

        ctx.fillStyle = dotGrad;
        ctx.beginPath();
        ctx.arc(sourceX, sourceY, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f87171';
        ctx.beginPath();
        ctx.arc(sourceX, sourceY, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Label above camera marker
        ctx.font = 'bold 11px ui-sans-serif, system-ui';
        ctx.fillStyle = '#fca5a5';
        ctx.textAlign = 'center';
        ctx.fillText('CAMERA', sourceX, sourceY - 14);
      } else {
        // Lost tracking indicator
        ctx.save();
        ctx.font = '12px ui-sans-serif, system-ui';
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'center';
        ctx.fillText('人物検出中 / 未検出', centerX, centerY + maxRadius * 0.55);
        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [coords, hasPose, clockHour, panningMode, isSweepEnabled]);

  return (
    <div className={`relative flex flex-col items-center bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl ${className}`}>
      <div className="w-full flex items-center justify-end lg:justify-between mb-2">
        <div className="hidden lg:flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-300 tracking-wider">360° SPATIAL RADAR</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <span className="text-[11px] text-slate-400 font-medium">音響:</span>
          {onTogglePanningMode ? (
            <button
              type="button"
              onClick={onTogglePanningMode}
              className="flex items-center bg-slate-950 border border-slate-700/80 rounded-lg p-0.5 text-[11px] font-mono shadow-sm transition hover:border-slate-500 cursor-pointer"
              title={`クリックして音響モデルを切り替え (現在: ${panningMode})`}
            >
              <span
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  panningMode === 'HRTF'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                HRTF
              </span>
              <span
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  panningMode === 'equalpower'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                equalpower
              </span>
            </button>
          ) : (
            <span
              className={`font-mono px-1.5 py-0.5 rounded text-[11px] ${
                panningMode === 'HRTF' ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30' : 'bg-slate-800 text-slate-300'
              }`}
            >
              {panningMode}
            </span>
          )}
        </div>
      </div>

      <div className="relative w-full max-w-[240px] xs:max-w-[260px] sm:max-w-[290px] lg:max-w-[320px] aspect-square flex items-center justify-center">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Consolidated Numerical Telemetry (Coordinates & Posture Angles) */}
      <div className="w-full mt-2 pt-2 border-t border-slate-800">
        <div className="grid grid-cols-4 gap-1 sm:gap-2 text-center select-none">
          <div className="bg-slate-950/70 p-1 sm:p-1.5 rounded-lg border border-slate-800/80 flex flex-col justify-center">
            <span className="text-[10px] text-slate-400 font-sans">方位 (水平)</span>
            <span className="text-xs sm:text-sm font-bold font-mono text-sky-400 leading-tight mt-0.5">
              {coords.azimuthDeg != null ? `${coords.azimuthDeg.toFixed(1)}°` : '--'}
            </span>
            <span className="text-[9px] font-mono text-slate-500 mt-0.5">X: {coords.x.toFixed(2)}m</span>
          </div>

          <div className="bg-slate-950/70 p-1 sm:p-1.5 rounded-lg border border-slate-800/80 flex flex-col justify-center">
            <span className="text-[10px] text-slate-400 font-sans">仰角 (上下)</span>
            <span className="text-xs sm:text-sm font-bold font-mono text-sky-400 leading-tight mt-0.5">
              {coords.elevationDeg != null ? `${coords.elevationDeg.toFixed(1)}°` : '--'}
            </span>
            <span className="text-[9px] font-mono text-slate-500 mt-0.5">Y: {coords.y.toFixed(2)}m</span>
          </div>

          <div className="bg-slate-950/70 p-1 sm:p-1.5 rounded-lg border border-slate-800/80 flex flex-col justify-center">
            <span className="text-[10px] text-slate-400 font-sans">体 (肩角度)</span>
            <span className="text-xs sm:text-sm font-bold font-mono text-emerald-400 leading-tight mt-0.5">
              {shoulderAngleDeg != null ? `${shoulderAngleDeg.toFixed(1)}°` : '--'}
            </span>
            <span className="text-[9px] font-mono text-slate-500 mt-0.5">Z: {coords.z.toFixed(2)}m</span>
          </div>

          <div className="bg-slate-950/70 p-1 sm:p-1.5 rounded-lg border border-slate-800/80 flex flex-col justify-center">
            <span className="text-[10px] text-slate-400 font-sans">顔 (頭部)</span>
            <span className="text-xs sm:text-sm font-bold font-mono text-emerald-400 leading-tight mt-0.5">
              {headAngleDeg != null ? `${headAngleDeg.toFixed(1)}°` : '--'}
            </span>
            <span className="text-[9px] font-mono text-slate-500 mt-0.5">距離: {coords.distance.toFixed(2)}m</span>
          </div>
        </div>
      </div>
    </div>
  );
};
