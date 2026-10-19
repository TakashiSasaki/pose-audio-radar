import { useEffect, useMemo, useState } from 'react';
import { advanceBenchmark, diagnosticReport, summarize, timingLabels,
  type Benchmark, type TimingKey, type WhenetDiagnostics } from '../vision/whenetDiagnostics';

const formatMs = (value: number | null | undefined) => value == null ? '—' : value.toFixed(1);
const phases = { capturing: '映像取得・転送', 'detecting-head': '頭部検出', 'estimating-pose': '角度推定' };
const keys = Object.keys(timingLabels) as TimingKey[];

export function WhenetDiagnosticsPanel({ diagnostics, active }: { diagnostics?: WhenetDiagnostics; active: boolean }) {
  const [target, setTarget] = useState(5);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
  const [now, setNow] = useState(0);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    if (diagnostics) setBenchmark(b => b ? advanceBenchmark(b, diagnostics, active) : null);
    else setBenchmark(b => b?.status === 'running' ? { ...b, status: 'interrupted' } : b);
  }, [diagnostics, active]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  const recent = useMemo(() => diagnostics?.samples.filter(s => s.id !== diagnostics.firstSample?.id) ?? [], [diagnostics?.samples, diagnostics?.firstSample]);
  const shownStartup = benchmark ? benchmark.startup : diagnostics?.startup;
  const samples = benchmark ? benchmark.samples : recent;
  const latest = benchmark ? samples.at(-1) : diagnostics?.samples.at(-1);
  const stats = useMemo(() => Object.fromEntries(keys.map(key => [key, summarize(samples, key)])) as Record<TimingKey, ReturnType<typeof summarize>>, [samples]);
  const largest = keys.filter(k => k !== 'totalMs' && stats[k]).sort((a, b) => stats[b]!.mean - stats[a]!.mean)[0];
  const noHead = samples.filter(s => !s.detected).length;
  const background = samples.filter(s => s.hiddenDuringFrame).length;
  const stale = samples.filter(s => !s.cameraLive).length;
  const pending = diagnostics?.pending;
  const start = () => {
    if (!diagnostics) return;
    // Ignore the already in-flight frame: every measured frame starts after the button press.
    setBenchmark({ run: diagnostics.run, startup: diagnostics.startup, afterId: pending?.id ?? diagnostics.samples.at(-1)?.id ?? 0,
      target, status: 'running', warmup: null, samples: [] });
  };
  const save = () => {
    if (!diagnostics) return;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(diagnosticReport(diagnostics, benchmark), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `whenet-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveError('');
    } catch (error) { setSaveError(`保存できませんでした: ${error instanceof Error ? error.message : String(error)}`); }
  };

  return <details className="mt-3 rounded-lg border border-slate-700 p-3 text-xs text-slate-300">
    <summary className="cursor-pointer font-semibold text-sky-300">開発者向け：WHENet 診断・ベンチマーク</summary>
    <div className="mt-3 space-y-3">
      <p>同じ姿勢・照明でタブを前面に保って計測してください。開始後の1回を慣らしとして除外し、その後の指定回数を集計します。推論設定は通常動作と同じです。</p>
      <div className="flex flex-wrap items-center gap-2">
        <label>計測回数 <select aria-label="ベンチマーク計測回数" className="bg-slate-800 rounded p-1" value={target} disabled={benchmark?.status === 'running'} onChange={e => setTarget(Number(e.target.value))}>
          {[5, 10, 20].map(n => <option key={n} value={n}>{n} 回</option>)}
        </select></label>
        <button type="button" className="rounded bg-sky-700 px-2 py-1 disabled:opacity-40" onClick={start} disabled={!active || !diagnostics || benchmark?.status === 'running'}>ベンチマーク開始</button>
        {benchmark?.status === 'running' && <button type="button" className="rounded bg-slate-700 px-2 py-1" onClick={() => setBenchmark(b => b ? { ...b, status: 'interrupted' } : b)}>計測を中断</button>}
        {benchmark && benchmark.status !== 'running' && <button type="button" className="rounded bg-slate-700 px-2 py-1" onClick={() => setBenchmark(null)}>通常の診断に戻る</button>}
        <button type="button" className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40" onClick={save} disabled={!diagnostics}>診断 JSON を保存</button>
      </div>
      <p role="status">{benchmark ? `ベンチマーク：${({ running: '計測中', completed: '完了', interrupted: '中断' })[benchmark.status]} — ${benchmark.samples.length} / ${benchmark.target} 回（慣らし ${benchmark.warmup ? '完了' : '待機中'}）`
        : `通常の診断：直近最大60回、開始後の初回を除外（集計 ${samples.length} 回）`}</p>
      {!active && <p>カメラを起動すると計測できます。停止・エラー後も取得済みの結果を保存できます。</p>}
      {active && pending && <p>現在：{phases[pending.phase]} ／ このフレーム開始から {(Math.max(0, now - pending.startedAt) / 1000).toFixed(1)} 秒</p>}
      {diagnostics?.failure && <p className="text-rose-300">停止時：{diagnostics.failure.message}（フレーム経過 {formatMs(diagnostics.failure.elapsedMs)} ms）</p>}
      <p>頭部未検出 {noHead} 回 ／ 背景タブ {background} 回 ／ 映像更新停止 {stale} 回</p>
      {(noHead > 0 || background > 0 || stale > 0) && <p className="text-amber-300">比較条件が揃っていません。未検出時は WHENet を実行せず、背景タブでは待機が増える場合があります。JSON の各フレームで確認できます。</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-right tabular-nums whitespace-nowrap">
          <caption className="text-left mb-2">処理時間（ms）— {benchmark ? 'ベンチマーク対象' : '通常の診断'}。— は未実行です。</caption>
          <thead><tr><th className="text-left p-1">工程</th><th className="p-1">直近</th><th className="p-1">平均</th><th className="p-1">中央値</th><th className="p-1">最大</th><th className="p-1">回数</th></tr></thead>
          <tbody>{keys.map(key => <tr key={key} className={key === largest ? 'text-amber-300' : key === 'totalMs' ? 'text-sky-300 border-t border-slate-700' : ''}>
            <th scope="row" className="text-left p-1 font-normal">{timingLabels[key]}</th>
            <td className="p-1">{formatMs(latest?.timings[key])}</td><td className="p-1">{formatMs(stats[key]?.mean)}</td>
            <td className="p-1">{formatMs(stats[key]?.median)}</td><td className="p-1">{formatMs(stats[key]?.max)}</td><td className="p-1">{stats[key]?.count ?? 0}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {largest && <p>平均時間が最大の工程：<strong className="text-amber-300">{timingLabels[largest]}</strong>。原因を断定する表示ではありません。</p>}
      <p>慣らし／初回：{formatMs((benchmark ? benchmark.warmup : diagnostics?.firstSample)?.timings.totalMs)} ms ／ 描画コールバックの最大間隔：{samples.length ? formatMs(Math.max(...samples.map(s => s.maxAnimationGapMs))) : '—'} ms</p>
      {shownStartup && <p>集計対象のモデル準備（取得＋初期化＋GPU 試行）：頭部検出 {formatMs(shownStartup.detectorMs)} ms ／ WHENet {formatMs(shownStartup.estimatorMs)} ms<br />
        ONNX Runtime {shownStartup.runtimeVersion} ／ CPU 部分は {shownStartup.numThreads} スレッド</p>}
      {shownStartup && <div className="space-y-1">
        <p>設定：{shownStartup.preference === 'auto' ? 'GPU 優先' : 'CPU 固定'}</p>
        {(['detector', 'estimator'] as const).map(key => {
          const backend = shownStartup!.backends[key];
          return <p key={key}>{key === 'detector' ? '頭部検出' : 'WHENet'}：{backend.provider === 'webgpu' ? 'WebGPU（未対応演算は CPU）' : 'CPU / WASM'}
            {backend.fallbackReason && <span className="block text-amber-300 break-words">CPU を使用する理由：{backend.fallbackReason}</span>}
            {backend.recoveryMs > 0 && <span className="block">CPU への切替処理：{formatMs(backend.recoveryMs)} ms</span>}
          </p>;
        })}
        {shownStartup.gpu && <p>GPU 情報：{Object.values(shownStartup.gpu).filter(Boolean).join(' / ') || 'ブラウザから提供されていません'}</p>}
        <p className="text-slate-400">実行途中で CPU に切り替わると、異なる条件を混ぜないようベンチマークを中断します。</p>
      </div>}
      {latest && <p>入力解像度：カメラ {latest.sourceSize.join('×')} → 転送 {latest.inputSize.join('×')} → 頭部検出 320×256 ／ WHENet 224×224</p>}
      <p className="text-slate-400">モデル実行はテンソルの作成・出力回収を含みます。「受け渡し・待機」は全体から取得と Worker 処理を引いた差分です。描画間隔は他の時間と重なるため合計には加えません。モデル準備と初回は通常の平均から分けています。</p>
      <p className="text-slate-400">JSON には計測値・ブラウザ情報・実行設定を保存します。映像・音声・頭部座標は含みません。</p>
      {saveError && <p role="alert" className="text-rose-300">{saveError}</p>}
    </div>
  </details>;
}
