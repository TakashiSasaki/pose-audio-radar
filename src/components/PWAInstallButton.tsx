import React, { useState } from 'react';
import { Download, Share2, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed standalone PWA, hide the button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg bg-sky-950/80 hover:bg-sky-900 border border-sky-500/30 text-sky-300 text-xs font-semibold shadow-sm transition hover:text-white"
        title="ホーム画面に追加してアプリとして利用"
      >
        <Download className="w-3.5 h-3.5 text-sky-400" />
        <span className="hidden sm:inline">アプリをインストール</span>
        <span className="sm:hidden">インストール</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 text-xs font-semibold shadow-sm transition hover:text-white"
          title="ホーム画面に追加（iOS Safari）"
        >
          <Smartphone className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden sm:inline">ホーム画面に追加</span>
          <span className="sm:hidden">追加</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl text-slate-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2 font-bold text-white text-sm">
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  <span>iOSでホーム画面に追加</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  aria-label="閉じる"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-300">
                <div className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold shrink-0 text-[11px]">
                    1
                  </span>
                  <span>
                    Safari 画面下部（iPad は上部）の共有ボタン <Share2 className="inline w-3.5 h-3.5 text-sky-400 mx-0.5" /> をタップします。
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold shrink-0 text-[11px]">
                    2
                  </span>
                  <span>
                    メニューをスクロールし、<strong>「ホーム画面に追加」</strong> を選択します。
                  </span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-bold shrink-0 text-[11px]">
                    3
                  </span>
                  <span>右上の「追加」をタップすると、フルスクリーンで起動できるようになります。</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-6 w-full rounded-xl bg-slate-800 hover:bg-slate-700 py-2.5 text-xs font-semibold text-slate-200 transition"
              >
                閉じる
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
