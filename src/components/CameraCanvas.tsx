import React, { useEffect, useRef } from 'react';
import type { PoseFrameData } from '../vision/poseTracker';

interface CameraCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  frameData: PoseFrameData | null;
  mirrorMode: boolean;
  isCameraActive: boolean;
  onToggleCamera: () => void;
  facingMode: 'user' | 'environment';
  canToggleCamera?: boolean;
  hasFrontCamera?: boolean;
  className?: string;
}

export const CameraCanvas: React.FC<CameraCanvasProps> = ({
  videoRef,
  frameData,
  mirrorMode,
  isCameraActive,
  onToggleCamera,
  facingMode,
  canToggleCamera = true,
  hasFrontCamera = true,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let animId: number;

    const draw = () => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
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

      // Draw video frame if active
      if (isCameraActive && video && video.readyState >= 2) {
        ctx.save();
        if (mirrorMode) {
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();
      } else {
        // Placeholder background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#64748b';
        ctx.font = '13px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('カメラが停止中または待機中', width / 2, height / 2);
      }

      // Draw Pose Landmarks Overlay
      if (frameData && frameData.hasPose && frameData.landmarks) {
        const lm = frameData.landmarks;

        const getPt = (index: number) => {
          const pt = lm[index];
          if (!pt) return null;
          let px = pt.x * width;
          if (mirrorMode) {
            px = (1 - pt.x) * width;
          }
          const py = pt.y * height;
          return { x: px, y: py, vis: pt.visibility ?? 1 };
        };

        const nose = getPt(0);
        const leftEar = getPt(7);
        const rightEar = getPt(8);
        const leftShoulder = getPt(11);
        const rightShoulder = getPt(12);

        // Draw Shoulder Line
        if (leftShoulder && rightShoulder) {
          ctx.beginPath();
          ctx.moveTo(leftShoulder.x, leftShoulder.y);
          ctx.lineTo(rightShoulder.x, rightShoulder.y);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.stroke();

          // Midpoint of shoulders
          const midX = (leftShoulder.x + rightShoulder.x) / 2;
          const midY = (leftShoulder.y + rightShoulder.y) / 2;

          // Normal vector perpendicular to shoulders
          const dx = rightShoulder.x - leftShoulder.x;
          const dy = rightShoulder.y - leftShoulder.y;
          const len = Math.hypot(dx, dy) || 1;
          // Normal pointing front
          const nx = -dy / len;
          const ny = dx / len;
          const normalLen = 50;

          ctx.beginPath();
          ctx.moveTo(midX, midY);
          ctx.lineTo(midX + nx * normalLen, midY + ny * normalLen);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Arrowhead
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(midX + nx * normalLen, midY + ny * normalLen, 4, 0, Math.PI * 2);
          ctx.fill();
        }

        // Draw Head / Ear connections
        if (leftEar && rightEar) {
          ctx.beginPath();
          ctx.moveTo(leftEar.x, leftEar.y);
          ctx.lineTo(rightEar.x, rightEar.y);
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (nose && leftEar && rightEar) {
          const earMidX = (leftEar.x + rightEar.x) / 2;
          const earMidY = (leftEar.y + rightEar.y) / 2;

          ctx.beginPath();
          ctx.moveTo(earMidX, earMidY);
          ctx.lineTo(nose.x, nose.y);
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Keypoints nodes
        const points = [
          { p: nose, label: '0: 鼻', color: '#f43f5e' },
          { p: leftEar, label: '7: 左耳', color: '#38bdf8' },
          { p: rightEar, label: '8: 右耳', color: '#38bdf8' },
          { p: leftShoulder, label: '11: 左肩', color: '#22c55e' },
          { p: rightShoulder, label: '12: 右肩', color: '#22c55e' },
        ];

        points.forEach(({ p, label, color }) => {
          if (!p) return;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = '10px ui-sans-serif, system-ui';
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, p.x + 8, p.y - 4);
        });
      }

      ctx.restore();
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [videoRef, frameData, mirrorMode, isCameraActive]);

  return (
    <div className={`relative flex flex-col bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl ${className}`}>
      <div className="w-full flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              frameData?.hasPose ? 'bg-emerald-500' : isCameraActive ? 'bg-amber-500' : 'bg-rose-500'
            }`}
          />
          <span className="text-xs font-semibold text-slate-300 tracking-wider">CAMERA / POSE SKELETON</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCamera}
            disabled={!canToggleCamera || (facingMode === 'user' && !hasFrontCamera)}
            className={`text-xs px-2.5 py-1 rounded border transition ${
              !canToggleCamera || (facingMode === 'user' && !hasFrontCamera)
                ? 'bg-slate-900/60 text-slate-500 border-slate-800 cursor-not-allowed opacity-60'
                : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 border-slate-700 cursor-pointer'
            }`}
            title={
              !canToggleCamera || (facingMode === 'user' && !hasFrontCamera)
                ? 'インカメラが無いか、切替可能なカメラが存在しません'
                : 'カメラの向き（前面・背面）を切り替えます'
            }
          >
            {facingMode === 'user' ? 'インカメラ' : 'アウトカメラ'}
            {(!canToggleCamera || (facingMode === 'user' && !hasFrontCamera)) && (
              <span className="text-[10px] text-slate-500 ml-1">（固定）</span>
            )}
          </button>
        </div>
      </div>

      <div className="relative w-full aspect-4/3 rounded-lg overflow-hidden bg-black flex items-center justify-center">
        {/* Hidden video element used for streaming frames to Canvas & MediaPipe */}
        <video ref={videoRef} playsInline muted className="hidden" />
        <canvas ref={canvasRef} className="w-full h-full object-cover block" />

        {/* Video HUD badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
          <div className="bg-slate-950/80 backdrop-blur px-2 py-0.5 rounded text-[11px] font-mono text-slate-300 border border-slate-800">
            FPS: {frameData?.fps ?? 0}
          </div>
          {frameData?.hasPose && (
            <div className="bg-slate-950/80 backdrop-blur px-2 py-0.5 rounded text-[11px] font-mono text-emerald-400 border border-slate-800">
              CONF: {(frameData.confidence * 100).toFixed(0)}%
            </div>
          )}
        </div>

        {mirrorMode && (
          <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur px-2 py-0.5 rounded text-[10px] font-mono text-sky-400 border border-slate-800 pointer-events-none">
            MIRROR ON
          </div>
        )}
      </div>

      <div className="w-full mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
        <span>骨格検出: 鼻(0) · 両耳(7,8) · 両肩(11,12)</span>
        <span className="font-mono text-slate-400 text-[11px]">
          {facingMode === 'user' ? '前面カメラ入力' : '背面カメラ入力'}
        </span>
      </div>
    </div>
  );
};
