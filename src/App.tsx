/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Volume2,
  VolumeX,
  Camera,
  Play,
  Square,
  Compass,
  Headphones,
  Sliders,
  HelpCircle,
  Info,
  RefreshCw,
} from 'lucide-react';

import {
  SpatialAudioEngine,
  initializeAudioOutput,
  type SoundType,
  type PanningMode,
  type ChannelTestMode,
  type SweepVolumeProfile,
} from './audio/spatialAudio';
import {
  PoseTracker,
  type TrackingMode,
  type DistanceMode,
  type PoseFrameData,
} from './vision/poseTracker';
import type { BackendPreference } from './vision/whenetBackend';
import { WhenetTracker } from './vision/whenetTracker';
import { RadarCanvas } from './components/RadarCanvas';
import { CameraCanvas } from './components/CameraCanvas';

const SETTINGS_STORAGE_KEY = 'spatial_radar_controls_settings_v1';

interface StoredSettings {
  trackingModel?: 'mediapipe' | 'whenet';
  whenetBackend?: BackendPreference;
  panningMode?: PanningMode;
  soundType?: SoundType;
  trackingMode?: TrackingMode;
  distanceMode?: DistanceMode;
  mirrorMode?: boolean;
  bpm?: number;
  volume?: number;
  smoothingAlpha?: number;
  cameraFacing?: 'user' | 'environment';
  selectedOutputDeviceId?: string;
  channelMode?: ChannelTestMode;
  isSweepEnabled?: boolean;
  sweepVolumeProfile?: SweepVolumeProfile;
  sweepDurationMs?: number;
}

function loadInitialSettings(): StoredSettings {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredSettings;
  } catch (e) {
    console.warn('Failed to load settings from localStorage:', e);
    return {};
  }
}

export default function App() {
  const initialSettings = useRef(loadInitialSettings()).current;

  // Engines
  const audioRef = useRef<SpatialAudioEngine | null>(null);
  const trackerRef = useRef<PoseTracker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraOperationRef = useRef(0);

  // States
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(false);
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Settings with Browser LocalStorage persistence
  const [panningMode, setPanningMode] = useState<PanningMode>(
    initialSettings.panningMode && (initialSettings.panningMode === 'HRTF' || initialSettings.panningMode === 'equalpower')
      ? initialSettings.panningMode
      : 'HRTF'
  );
  const [soundType, setSoundType] = useState<SoundType>(initialSettings.soundType ?? 'pulsed_noise');
  const [trackingModel, setTrackingModel] = useState<'mediapipe' | 'whenet'>(initialSettings.trackingModel === 'whenet' ? 'whenet' : 'mediapipe');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(initialSettings.trackingMode ?? 'head');
  const [distanceMode, setDistanceMode] = useState<DistanceMode>(initialSettings.distanceMode ?? 'fixed');
  const [whenetBackend, setWhenetBackend] = useState<BackendPreference>(initialSettings.whenetBackend === 'wasm' ? 'wasm' : 'auto');
  const effectiveTrackingMode = trackingModel === 'whenet' ? 'head' : trackingMode;
  const effectiveDistanceMode = trackingModel === 'whenet' ? 'fixed' : distanceMode;
  const [mirrorMode, setMirrorMode] = useState<boolean>(initialSettings.mirrorMode ?? false);
  const [bpm, setBpm] = useState<number>(initialSettings.bpm ?? 120);
  const [volume, setVolume] = useState<number>(initialSettings.volume ?? 0.7);
  const [smoothingAlpha, setSmoothingAlpha] = useState<number>(initialSettings.smoothingAlpha ?? 1.0);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>(initialSettings.cameraFacing ?? 'user');
  const [isSweepEnabled, setIsSweepEnabled] = useState<boolean>(initialSettings.isSweepEnabled ?? false);
  const [sweepVolumeProfile, setSweepVolumeProfile] = useState<SweepVolumeProfile>(
    initialSettings.sweepVolumeProfile ?? 'swell'
  );
  const [sweepDurationMs, setSweepDurationMs] = useState<number>(initialSettings.sweepDurationMs ?? 150);
  const isSweepActive = isSweepEnabled && soundType === 'pulsed_noise';

  // Camera Device States
  const [hasFrontCamera, setHasFrontCamera] = useState<boolean>(true);
  const [canToggleCamera, setCanToggleCamera] = useState<boolean>(true);

  // Channel Test & Audio Device States
  const [channelMode, setChannelMode] = useState<ChannelTestMode>(initialSettings.channelMode ?? 'stereo');
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState<string>(
    initialSettings.selectedOutputDeviceId ?? 'default'
  );
  const [isSinkIdSupported, setIsSinkIdSupported] = useState<boolean>(true);
  const [isTestingChannel, setIsTestingChannel] = useState<'left' | 'right' | null>(null);
  const [deviceStatusMsg, setDeviceStatusMsg] = useState<string | null>(null);
  const [isRefreshingDevices, setIsRefreshingDevices] = useState<boolean>(false);

  // Runtime Tracking Data
  const [frameData, setFrameData] = useState<PoseFrameData | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(true);
  const [mobileTab, setMobileTab] = useState<'radar' | 'camera' | 'controls' | 'guide'>('radar');

  // Save Settings to LocalStorage whenever any setting is adjusted
  useEffect(() => {
    try {
      const dataToSave: StoredSettings = {
        panningMode,
        trackingModel,
        whenetBackend,
        soundType,
        trackingMode,
        distanceMode,
        mirrorMode,
        bpm,
        volume,
        smoothingAlpha,
        cameraFacing,
        selectedOutputDeviceId,
        channelMode,
        isSweepEnabled,
        sweepVolumeProfile,
        sweepDurationMs,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(dataToSave));
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }, [
    trackingModel,
    whenetBackend,
    panningMode,
    soundType,
    trackingMode,
    distanceMode,
    mirrorMode,
    bpm,
    volume,
    smoothingAlpha,
    cameraFacing,
    selectedOutputDeviceId,
    channelMode,
    isSweepEnabled,
    sweepVolumeProfile,
    sweepDurationMs,
  ]);

  // Initialize Engines on mount
  useEffect(() => {
    audioRef.current = new SpatialAudioEngine();

    return () => {
      cameraOperationRef.current++;
      if (audioRef.current) audioRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    const tracker = trackingModel === 'whenet' ? new WhenetTracker(whenetBackend) : new PoseTracker();
    trackerRef.current = tracker;
    setFrameData(null);
    setErrorMsg(null);
    return () => { cameraOperationRef.current++; tracker.destroy(); };
  }, [trackingModel, whenetBackend]);

  // Sync Audio Settings
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setPanningMode(panningMode);
    }
  }, [panningMode]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setSweepEnabled(isSweepActive);
    }
  }, [isSweepActive]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setSweepVolumeProfile(sweepVolumeProfile);
    }
  }, [sweepVolumeProfile]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setSweepDurationMs(sweepDurationMs);
    }
  }, [sweepDurationMs]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setSoundType(soundType);
    }
  }, [soundType]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setBpm(bpm);
    }
  }, [bpm]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setVolume(volume);
    }
  }, [volume]);

  // Sync Channel Test Mode
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.setChannelMode(channelMode);
    }
  }, [channelMode]);

  // Audio Device Enumeration & Refresh
  const refreshAudioDevices = useCallback(async (requestPermission: boolean = false) => {
    if (!audioRef.current) return;
    setIsRefreshingDevices(true);
    try {
      let devices: MediaDeviceInfo[] = [];
      if (requestPermission) {
        devices = await audioRef.current.requestAudioDeviceAccess();
      } else {
        devices = await audioRef.current.getAudioOutputDevices();
      }
      setAudioOutputDevices(devices);
      setIsSinkIdSupported(audioRef.current.isSetSinkIdSupported());
    } catch (err) {
      console.warn('Failed to enumerate audio devices:', err);
    } finally {
      setIsRefreshingDevices(false);
    }
  }, []);

  const refreshVideoDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');

      if (videoInputs.length === 0) {
        setHasFrontCamera(false);
        setCanToggleCamera(false);
      } else if (videoInputs.length === 1) {
        setCanToggleCamera(false);
        const label = videoInputs[0].label.toLowerCase();
        if (/back|rear|environment|外|アウト/.test(label)) {
          setHasFrontCamera(false);
        } else {
          setHasFrontCamera(true);
        }
      } else {
        setCanToggleCamera(true);
        const hasFront = videoInputs.some((d) => {
          const l = d.label.toLowerCase();
          return /front|user|facetime|selfie|前|イン/.test(l) || !/back|rear|environment|外|アウト/.test(l);
        });
        setHasFrontCamera(hasFront);
      }
    } catch (err) {
      console.warn('Failed to enumerate video devices:', err);
    }
  }, []);

  // Listen for audio & video device changes
  useEffect(() => {
    refreshAudioDevices(false);
    refreshVideoDevices();
    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      const handler = () => {
        refreshAudioDevices(false);
        refreshVideoDevices();
      };
      navigator.mediaDevices.addEventListener('devicechange', handler);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', handler);
      };
    }
  }, [refreshAudioDevices, refreshVideoDevices]);

  // Select Audio Output Device (Headset vs Headphones)
  const handleSelectOutputDevice = async (deviceId: string) => {
    if (audioRef.current) {
      const success = await audioRef.current.setAudioOutputDevice(deviceId);
      setSelectedOutputDeviceId(audioRef.current.getCurrentSinkId());
      if (success) {
        const dev = audioOutputDevices.find((d) => d.deviceId === deviceId);
        setDeviceStatusMsg(`出力先を変更: ${dev?.label || (deviceId === 'default' ? '既定のデバイス' : deviceId)}`);
      } else {
        setDeviceStatusMsg('出力先の変更に失敗しました（ブラウザが対応していないか拒否されました）');
      }
      setTimeout(() => setDeviceStatusMsg(null), 5000);
    }
  };

  // Restore the saved output before any playback, including isolated test tones.
  const initializeAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) throw new Error('音声システムが準備できていません');
    const success = await initializeAudioOutput(audio, selectedOutputDeviceId);
    if (!success) {
      setSelectedOutputDeviceId(audio.getCurrentSinkId());
      setDeviceStatusMsg('保存した出力先を使用できないため、現在の出力先に戻しました');
    }
    return audio;
  }, [selectedOutputDeviceId]);

  // Play Test Chirp Tone (Immediate left/right check)
  const handlePlayTestTone = async (channel: 'left' | 'right') => {
    setIsTestingChannel(channel);
    try {
      if (audioRef.current) {
        const audio = await initializeAudio();
        await audio.playTestTone(channel);
      }
    } catch (err) {
      console.error('Failed to play test tone:', err);
    } finally {
      setTimeout(() => setIsTestingChannel(null), 400);
    }
  };

  // Sync Tracker Config
  useEffect(() => {
    if (trackerRef.current) {
      trackerRef.current.updateConfig({
        trackingMode: effectiveTrackingMode,
        distanceMode: effectiveDistanceMode,
        mirrorMode,
        smoothingAlpha,
      });
    }
  }, [trackingModel, whenetBackend, effectiveTrackingMode, effectiveDistanceMode, mirrorMode, smoothingAlpha]);

  // Main Processing Loop
  useEffect(() => {
    let animId: number;

    const loop = (timestamp: number) => {
      if (isRunning && trackerRef.current && audioRef.current) {
        const data = trackerRef.current.processFrame(timestamp);
        if (data.errorMessage) {
          cameraOperationRef.current++;
          trackerRef.current.stopCamera();
          audioRef.current.stop();
          setIsRunning(false);
          setFrameData(data);
          setErrorMsg(`頭部推定に失敗しました: ${data.errorMessage}`);
          return;
        }
        setFrameData(data);

        // Update Spatial Audio
        audioRef.current.updatePosition(data.coords);
        audioRef.current.setTrackingLost(!data.hasPose);
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isRunning]);

  // Toggle Start / Stop
  const handleToggleRunning = useCallback(async () => {
    const operation = ++cameraOperationRef.current;
    if (isRunning) {
      // Stop
      if (trackerRef.current) trackerRef.current.stopCamera();
      if (audioRef.current) audioRef.current.stop();
      setIsRunning(false);
      setIsSwitchingCamera(false);
      setFrameData(previous => previous?.diagnostics ? { ...previous, hasPose: false, headBox: undefined } : null);
    } else {
      setFrameData(null);
      // Start
      setErrorMsg(null);
      setIsInitializing(true);
      try {
        if (!audioRef.current || !trackerRef.current || !videoRef.current) {
          throw new Error('システムが準備できていません');
        }

        // 1. Audio init (requires user gesture)
        await initializeAudio();
        if (operation !== cameraOperationRef.current) return;

        // 2. Selected tracking model init
        if (!trackerRef.current.getIsReady()) {
          await trackerRef.current.initModel();
        }
        if (operation !== cameraOperationRef.current) return;

        // 3. Start Camera
        const started = await trackerRef.current.startCamera(videoRef.current, cameraFacing);
        if (!started || operation !== cameraOperationRef.current) return;

        // 4. Start sound synthesis
        audioRef.current.setTrackingLost(true);
        audioRef.current.start();
        setIsRunning(true);
      } catch (err: unknown) {
        if (operation !== cameraOperationRef.current) return;
        trackerRef.current?.stopCamera();
        audioRef.current?.stop();
        setIsRunning(false);
        setFrameData(null);
        const message = err instanceof Error ? err.message : String(err);
        console.error('Initialization error:', err);
        setErrorMsg(`起動に失敗しました: ${message}。通信状況・カメラの許可を確認して再試行してください。`);
      } finally {
        if (operation === cameraOperationRef.current) setIsInitializing(false);
      }
    }
  }, [isRunning, cameraFacing, initializeAudio]);

  // Switch Camera
  const handleToggleCameraFacing = useCallback(async () => {
    if (isInitializing || isSwitchingCamera) return;
    const nextFacing = cameraFacing === 'user' ? 'environment' : 'user';
    if (isRunning && trackerRef.current && videoRef.current) {
      const operation = ++cameraOperationRef.current;
      setIsSwitchingCamera(true);
      setErrorMsg(null);
      try {
        const started = await trackerRef.current.startCamera(videoRef.current, nextFacing);
        if (started && operation === cameraOperationRef.current) setCameraFacing(nextFacing);
      } catch (err) {
        if (operation !== cameraOperationRef.current) return;
        trackerRef.current.stopCamera();
        audioRef.current?.stop();
        setIsRunning(false);
        setFrameData(null);
        setErrorMsg('カメラの切り替えに失敗しました。カメラを再起動してください。');
        console.error('Failed to switch camera:', err);
      } finally {
        if (operation === cameraOperationRef.current) setIsSwitchingCamera(false);
      }
    } else {
      setCameraFacing(nextFacing);
    }
  }, [cameraFacing, isRunning, isInitializing, isSwitchingCamera]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Banner / Navigation */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-sky-500/20 shrink-0">
              <Compass className="w-4 h-4 sm:w-5 sm:h-5 text-white animate-spin-slow" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xs sm:text-base lg:text-lg font-bold tracking-tight text-white leading-tight">
                  3D Pose Audio Radar
                </h1>
                <span className="hidden sm:inline-block text-[11px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  {trackingModel === 'whenet' ? 'WHENet' : 'MediaPipe'} × HRTF
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleToggleRunning}
              disabled={isInitializing}
              className={`px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg font-semibold text-xs sm:text-sm shadow-lg transition flex items-center gap-1.5 sm:gap-2 ${
                isRunning
                  ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-rose-950/50'
                  : 'bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-sky-950/50'
              } disabled:opacity-50`}
            >
              {isInitializing ? (
                <>
                  <div className="w-3.5 h-3.5 sm:w-4 sm:h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>初期化中...</span>
                </>
              ) : isRunning ? (
                <>
                  <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white" />
                  <span>停止する</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-white" />
                  <span>カメラ起動 ＆ サウンド再生</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto w-full px-3 sm:px-6 py-2.5 sm:py-6 flex-1 flex flex-col gap-3 sm:gap-6">
        {/* Error Alert */}
        {errorMsg && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs sm:text-sm flex items-start gap-3">
            <Info className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-rose-200">処理を停止しました</div>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Mobile 4-Tab Switcher */}
        <div className="lg:hidden sticky top-[53px] z-20 bg-slate-950/90 backdrop-blur-md pb-0.5 -mt-2 -mb-4">
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl shadow-lg">
            <button
              type="button"
              onClick={() => setMobileTab('radar')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                mobileTab === 'radar'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-950'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">レーダー</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('camera')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                mobileTab === 'camera'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-950'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Camera className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">カメラ</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('controls')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                mobileTab === 'controls'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-950'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">設定</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('guide')}
              className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 py-2 px-1.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all ${
                mobileTab === 'guide'
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-950'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">ガイド</span>
            </button>
          </div>
        </div>

        {/* Visualizers (Tabs on Mobile, 2-Column on Desktop) */}
        <div className={`${mobileTab === 'radar' || mobileTab === 'camera' ? 'grid' : 'hidden lg:grid'} grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 items-start`}>
          {/* Radar Column (Only shown in Radar tab on mobile, always visible on desktop) */}
          <div className={`${mobileTab === 'radar' ? 'flex' : 'hidden lg:flex'} flex-col gap-2`}>
            {/* 360-Degree Clock Face Radar with Consolidated Numerical Telemetry */}
            <RadarCanvas
              coords={
                frameData?.coords ?? {
                  x: 0,
                  y: 0,
                  z: -2.5,
                  distance: 2.5,
                  azimuthDeg: 0,
                  elevationDeg: 0,
                }
              }
              hasPose={frameData?.hasPose ?? false}
              clockDirectionText={frameData?.clockDirectionText ?? '待機中'}
              clockHour={frameData?.clockHour ?? 12}
              panningMode={panningMode}
              onTogglePanningMode={() => setPanningMode(panningMode === 'HRTF' ? 'equalpower' : 'HRTF')}
              shoulderAngleDeg={trackingModel === 'whenet' ? null : frameData?.shoulderAngleDeg}
              headAngleDeg={frameData?.headAngleDeg}
              isSweepEnabled={isSweepActive}
            />
          </div>

          {/* Camera Feed & Skeletal Wireframe (Only shown in Camera tab on mobile, always visible on desktop) */}
          <CameraCanvas
            trackingModel={trackingModel}
            videoRef={videoRef}
            frameData={frameData}
            mirrorMode={mirrorMode}
            isCameraActive={isRunning}
            onToggleCamera={handleToggleCameraFacing}
            facingMode={cameraFacing}
            canToggleCamera={canToggleCamera}
            isBusy={isInitializing || isSwitchingCamera}
            hasFrontCamera={hasFrontCamera}
            className={mobileTab === 'camera' ? 'flex' : 'hidden lg:flex'}
          />
        </div>

        {/* Interactive Controls Panel */}
        <div className={`${mobileTab === 'controls' ? 'flex' : 'hidden lg:flex'} bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 shadow-xl flex-col gap-4`}>
          <div className="hidden lg:flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-400" />
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                コントロール ＆ パラメータ調整
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {isRunning && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE RUNNING
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 text-xs">
            {/* 1. Sound Type */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">テスト音源タイプ（Web Audio合成）</label>
              <select
                value={soundType}
                onChange={(e) => setSoundType(e.target.value as SoundType)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="pulsed_noise">1. 周期変調ホワイトノイズ [デフォルト]</option>
                <option value="clock">2. 機械式時計 (Tick-Tock)</option>
                <option value="footsteps">3. 足音 (Footsteps)</option>
              </select>
              <span className="text-[11px] text-slate-500">
                {soundType === 'pulsed_noise' && '全周波数帯域ノイズによる明瞭な耳介ノッチ知覚 [デフォルト]'}
                {soundType === 'clock' && '高域インパルス＋金属共鳴でHRTFの定位が正確に知覚されます'}
                {soundType === 'footsteps' && '低域ピッチ降下と摩擦音で床面・距離感を表現'}
              </span>
            </div>

            {/* 2. Dynamic Directional Audio Sweep */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">180°対角からの動的音響スウィープ</label>
              <button
                disabled={soundType !== 'pulsed_noise'}
                onClick={() => setIsSweepEnabled(!isSweepEnabled)}
                className="w-full py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg font-medium transition text-left px-3 flex items-center justify-between disabled:opacity-50"
              >
                <span>{isSweepActive ? '動的スウィープ提示：有効' : '固定位置提示（スウィープなし）'}</span>
                <span
                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                    isSweepActive ? 'bg-sky-500/20 text-sky-400' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isSweepActive ? 'ON' : 'OFF'}
                </span>
              </button>
              <span className="text-[11px] text-slate-500">
                周期変調ホワイトノイズで利用できます。時計・足音は短い音のため固定位置で提示します。
              </span>
            </div>

            {/* 2b. Sweep Volume Profile */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">スウィープ音量変化パターン</label>
              <select
                disabled={!isSweepActive}
                value={sweepVolumeProfile}
                onChange={(e) => setSweepVolumeProfile(e.target.value as SweepVolumeProfile)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50"
              >
                <option value="swell">1. 小 ➔ 大 ➔ 小（スウェル / 山型）[デフォルト]</option>
                <option value="crescendo">2. クレッシェンド（徐々に小 ➔ 大: 始点＝小、終点＝大）</option>
                <option value="decrescendo">3. デクレッシェンド（徐々に大 ➔ 小: 始点＝大、終点＝小）</option>
                <option value="standard">4. 標準パルス（アタック ➔ 減衰）</option>
              </select>
              <span className="text-[11px] text-slate-500">
                {sweepVolumeProfile === 'swell' && '始点(小) ➔ 移動中間(最大音量) ➔ 終点(小) [デフォルト]'}
                {sweepVolumeProfile === 'crescendo' && '始点(180度反対)は小さく、目的方向(終点)で最大音量'}
                {sweepVolumeProfile === 'decrescendo' && '始点(180度反対)で最大音量、目的方向(終点)に向けて減衰'}
                {sweepVolumeProfile === 'standard' && '発音直後にピークへ到達し余韻減衰（標準）'}
              </span>
            </div>

            {/* 2c. Sweep Duration */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-slate-400 font-medium">1回のスウィープ時間 (移動速度)</label>
                <span className="text-sky-400 font-mono font-bold text-xs">
                  {sweepDurationMs === 0 ? '自動 (BPM連動)' : `${sweepDurationMs} ms (${(sweepDurationMs / 1000).toFixed(2)}秒)`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="600"
                step="10"
                disabled={!isSweepActive}
                value={sweepDurationMs}
                onChange={(e) => setSweepDurationMs(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-1 mt-0.5">
                {[
                  { label: '自動', val: 0 },
                  { label: '50ms', val: 50 },
                  { label: '100ms', val: 100 },
                  { label: '150ms', val: 150 },
                  { label: '250ms', val: 250 },
                  { label: '400ms', val: 400 },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    disabled={!isSweepActive}
                    onClick={() => setSweepDurationMs(item.val)}
                    className={`px-1.5 py-0.5 text-[10px] rounded font-mono border transition ${
                      sweepDurationMs === item.val
                        ? 'bg-sky-500/20 border-sky-500 text-sky-300 font-bold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    } disabled:opacity-50`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-slate-500">
                1回の移動スウィープ（始点180°対角 ➔ 終点目的方向）にかける時間を指定（50ms〜600ms、またはBPM自動連動）
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="tracking-model" className="text-slate-400 font-medium">姿勢検出モデル</label>
              <select id="tracking-model" value={trackingModel}
                disabled={isRunning || isInitializing || isSwitchingCamera}
                onChange={(e) => setTrackingModel(e.target.value as 'mediapipe' | 'whenet')}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                <option value="mediapipe">MediaPipe（骨格検出）</option>
                <option value="whenet">WHENet（頭部専用・実験）</option>
              </select>
              <span className="text-[11px] text-slate-500">
                {trackingModel === 'whenet'
                  ? '頭部を自動検出し、最大の頭を追跡します。1人でお試しください。初回はモデル等を約50 MB読み込みます。頭部の向き・固定距離2.5mに対応。'
                  : '鼻・耳・肩の骨格から向きを推定します。'}
                モデルの切替は停止中に行えます。
              </span>
              {trackingModel === 'whenet' && <>
                <label htmlFor="whenet-backend" className="text-slate-400 text-xs mt-2">WHENet の実行方式</label>
                <select id="whenet-backend" value={whenetBackend}
                  disabled={isRunning || isInitializing || isSwitchingCamera}
                  onChange={e => setWhenetBackend(e.target.value as BackendPreference)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-xs disabled:opacity-50">
                  <option value="auto">GPU 優先（WebGPU／使えない場合は CPU）</option>
                  <option value="wasm">CPU 固定（比較用）</option>
                </select>
                <span className="text-[11px] text-slate-500">停止中に切り替えられます。カメラ欄に各モデルの実行方式を表示します。</span>
              </>}
            </div>

            {/* 3. Reference Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">角度算出の基準モード</label>
              <select
                value={effectiveTrackingMode}
                disabled={trackingModel === 'whenet'}
                onChange={(e) => setTrackingMode(e.target.value as TrackingMode)}
                className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="head">{trackingModel === 'whenet' ? '頭部の向き（WHENet）' : '顔（耳・鼻）のみ [デフォルト・高感度]'}</option>
                <option value="hybrid">肩＋耳の複合360度</option>
                <option value="shoulder">肩のみ (360度基準)</option>
              </select>
              <span className="text-[11px] text-slate-500">
                {effectiveTrackingMode === 'head' && (trackingModel === 'whenet' ? '頭部画像から左右・上下の向きと傾きを推定します' : '顔・首振りに鋭敏に反応し、最もダイレクトに向きが変化します')}
                {effectiveTrackingMode === 'hybrid' && '肩の360度安定性と頭部ひねりの追従性を両立'}
                {effectiveTrackingMode === 'shoulder' && '両肩の向きのみを360度方位角の基準にします'}
              </span>
            </div>

            {/* 4. Mirror Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">左右ミラー反転</label>
              <button
                onClick={() => setMirrorMode(!mirrorMode)}
                className="w-full py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg font-medium transition text-left px-3 flex items-center justify-between"
              >
                <span>{mirrorMode ? 'ミラー反転：有効' : '通常（非反転）'}</span>
                <span
                  className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                    mirrorMode ? 'bg-sky-500/20 text-sky-400' : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {mirrorMode ? 'ON' : 'OFF'}
                </span>
              </button>
              <span className="text-[11px] text-slate-500">
                自撮り手持ち移動や、固定カメラ前での回転に合わせて反転できます
              </span>
            </div>

            {/* 5. Tempo (BPM) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-400 font-medium">発音テンポ (BPM)</label>
                <span className="font-mono text-slate-300">{bpm} BPM</span>
              </div>
              <input
                type="range"
                min="40"
                max="240"
                step="5"
                value={bpm}
                onChange={(e) => setBpm(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>40 Slow</span>
                <span>120 デフォルト</span>
                <span>240 Fast</span>
              </div>
            </div>

            {/* 6. Smoothing Alpha (EMA) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-400 font-medium">スムージング強度 (EMA α)</label>
                <span className="font-mono text-slate-300">
                  {smoothingAlpha.toFixed(2)} {smoothingAlpha === 1.0 ? '(デフォルト・最速応答)' : smoothingAlpha >= 0.7 ? '(超高速)' : smoothingAlpha >= 0.45 ? '(標準)' : '(滑らか)'}
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={smoothingAlpha}
                onChange={(e) => setSmoothingAlpha(parseFloat(e.target.value))}
                className="w-full accent-sky-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>0.05 滑らか</span>
                <span>0.50 標準</span>
                <span>1.00 デフォルト (最速応答)</span>
              </div>
            </div>

            {/* 7. Master Volume */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-slate-400 font-medium">マスター音量</label>
                <span className="font-mono text-slate-300">{Math.round(volume * 100)}%</span>
              </div>
              <div className="flex items-center gap-2">
                {volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-slate-500" />
                ) : (
                  <Volume2 className="w-4 h-4 text-sky-400" />
                )}
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  className="w-full accent-sky-500"
                />
              </div>
            </div>

            {/* 8. Distance Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-400 font-medium">音源距離の算出モード</label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950 rounded-lg border border-slate-800">
                <button
                  onClick={() => setDistanceMode('fixed')}
                  className={`py-1.5 font-medium rounded transition text-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                    effectiveDistanceMode === 'fixed'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  固定 (2.5m)
                </button>
                <button
                  onClick={() => setDistanceMode('dynamic')}
                  disabled={trackingModel === 'whenet'}
                  className={`py-1.5 font-medium rounded transition text-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                    effectiveDistanceMode === 'dynamic'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  肩幅連動
                </button>
              </div>
              <span className="text-[11px] text-slate-500">
                固定モードは方向知覚に専念でき実験が最も安定します
              </span>
            </div>
          </div>

          {/* Audio Output Device & Stereo Headphone Channel Test Section (Requests 9 & 10) */}
          <div className="mt-2 pt-4 border-t border-slate-800 flex flex-col gap-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-sky-400" />
                <h3 className="font-semibold text-slate-200 text-xs sm:text-sm">
                  音声出力先（ヘッドセット/ヘッドフォン切替）＆ ステレオ個別テスト
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {isSinkIdSupported ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    ブラウザ出力先切替: 対応 (setSinkId)
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    ブラウザ直接切替: 非対応（OS設定連動）
                  </span>
                )}
              </div>
            </div>

            {/* Explanatory text specifically addressing Headset vs Headphones (Request 10) */}
            <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs text-slate-300 flex flex-col gap-1.5">
              <div className="font-semibold text-sky-300 flex items-center gap-1.5">
                <span>💡 ヘッドセットとヘッドフォンの出力先について</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Bluetooth機器等では、OS上で<strong className="text-slate-200">「ヘッドセット（通話用モノラル / Hands-Free）」</strong>と<strong className="text-slate-200">「ヘッドフォン（高音質ステレオ / Stereo）」</strong>の両方が認識されることがあります。
                通話用ヘッドセット側に出力されるとモノラル動作となり3D立体定位（HRTF）が崩れてしまいます。立体音響を体感するには、下のドロップダウンから必ず<strong className="text-emerald-300">「ヘッドフォン」</strong>側を選択してください。
              </p>
            </div>

            {/* Device Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
              <div className="sm:col-span-2 flex flex-col gap-1">
                <label className="text-[11px] font-medium text-slate-400">
                  出力オーディオデバイスの選択:
                </label>
                <select
                  value={selectedOutputDeviceId}
                  onChange={(e) => handleSelectOutputDevice(e.target.value)}
                  disabled={!isSinkIdSupported}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-500 disabled:opacity-50"
                >
                  <option value="default">既定のオーディオ出力 (System Default)</option>
                  {audioOutputDevices
                    .filter((d) => d.deviceId !== 'default')
                    .map((device, idx) => (
                      <option key={device.deviceId || idx} value={device.deviceId}>
                        {device.label || `オーディオ出力デバイス ${idx + 1}`}
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex flex-col gap-1 justify-end">
                <label className="text-[11px] font-medium text-slate-400 sm:invisible">更新:</label>
                <button
                  type="button"
                  onClick={() => refreshAudioDevices(true)}
                  disabled={isRefreshingDevices}
                  className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  title="デバイス名を最新取得（マイク権限を一時確認してデバイス名称をアンロックします）"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingDevices ? 'animate-spin text-sky-400' : 'text-slate-400'}`} />
                  <span>デバイス一覧を更新</span>
                </button>
              </div>
            </div>

            {deviceStatusMsg && (
              <div className="text-[11px] text-emerald-400 font-mono bg-emerald-950/40 border border-emerald-800/40 px-3 py-2 rounded-lg flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{deviceStatusMsg}</span>
              </div>
            )}

            {/* Stereo Headphone Verification */}
            <div className="pt-3 border-t border-slate-800 flex flex-col gap-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <span className="text-xs font-semibold text-slate-200">
                  ステレオ動作・左右（L / R）個別出力テスト
                </span>
                <span className="text-[11px] text-slate-500">
                  片耳ずつ正しく鳴るかテストして、ステレオ装着・定位を確認できます
                </span>
              </div>

              {/* Instant test tone triggers */}
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 flex flex-col gap-2">
                <span className="text-[11px] font-medium text-slate-400">
                  即時テスト音（チャイム発音）:
                </span>
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                  <button
                    type="button"
                    onClick={() => handlePlayTestTone('left')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-1.5 ${
                      isTestingChannel === 'left'
                        ? 'bg-sky-500 text-white border-sky-400 scale-[0.98]'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-200 border-slate-700'
                    }`}
                  >
                    <span>◀ 左(L)のみ鳴らす</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePlayTestTone('right')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border transition flex items-center justify-center gap-1.5 ${
                      isTestingChannel === 'right'
                        ? 'bg-sky-500 text-white border-sky-400 scale-[0.98]'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-200 border-slate-700'
                    }`}
                  >
                    <span>右(R)のみ鳴らす ▶</span>
                  </button>
                </div>
                <span className="text-[10px] text-slate-500">
                  カメラ起動前でもクリックするだけで左右の音をテストできます（追跡音は常に両耳ステレオ3D空間定位で出力されます）
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Usage Guide Accordion */}
        <div className={`${mobileTab === 'guide' ? 'block' : 'hidden lg:block'} bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl`}>
          <button
            onClick={() => setIsGuideOpen(!isGuideOpen)}
            className="hidden lg:flex w-full px-5 py-4 cursor-pointer font-semibold text-slate-200 items-center justify-between hover:bg-slate-800/50 transition text-left"
          >
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-sky-400" />
              <span>【実験・使用方法ガイド】取扱説明書</span>
            </div>
            <span className="text-xs text-sky-400">
              {isGuideOpen ? '折りたたむ ▲' : '詳細を展開 ▼'}
            </span>
          </button>

          {isGuideOpen && (
            <div className="p-3 sm:p-5 text-xs text-slate-300 space-y-4 border-t-0 lg:border-t border-slate-800/80 leading-relaxed">
              {/* Highlight Status Callout */}
              <div className="p-4 bg-sky-950/40 border border-sky-800/50 rounded-xl text-xs sm:text-sm text-sky-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
                <div className="flex items-center gap-3">
                  <Headphones className="w-5 h-5 text-sky-400 shrink-0" />
                  <span>
                    <strong>ステレオイヤホンまたはヘッドフォン</strong>を装着後、「カメラ起動 ＆ 音声再生」をクリックしてください。ジャイロなしでカメラ映像から向きを推定し、360度音像定位を行います。
                  </span>
                </div>
              </div>

              {trackingModel === 'whenet' && (
                <p className="p-3 bg-violet-950/30 rounded-lg border border-violet-800/50">
                  WHENet は頭部専用の実験モードです。紫色の枠が頭全体を囲む位置で、1人で試してください。
                  肩を映す必要はありません。距離は2.5m固定です。HEAD DET は頭部検出の信頼度で、角度の精度を表す値ではありません。
                  正面・左右・後ろ向きで音の方向を確かめてください。
                  <a href={`${import.meta.env.BASE_URL}licenses/whenet/NOTICE.txt`} target="_blank" rel="noreferrer" className="ml-1 text-sky-400 underline">モデルの出典・ライセンス</a>
                </p>
              )}

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="font-bold text-sky-400 mb-1 flex items-center gap-1.5">
                  <span>1. 準備</span>
                </div>
                <p>
                  必ず<strong className="text-white underline">ステレオイヤホンまたはヘッドフォン</strong>を装着してください。
                  スピーカーでは左右の耳への到達時間差（ITD）や頭部伝達関数（HRTF）による周波数特性変化が正しく耳に入らないため、定位が大幅に劣化します。
                  準備ができたら「カメラ起動 ＆ 音声再生」を押し、カメラのアクセスを許可します。
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="font-bold text-sky-400 mb-1 flex items-center gap-1.5">
                  <span>2. 実験パターンA：自分が回転して360度を確認する（最も安定した実験）</span>
                </div>
                <p>
                  スマートフォンやPCを机の上に固定し、カメラから1m〜1.5mほど離れて座る（または立つ）ことで、
                  <strong className="text-white">頭と両肩がカメラの画角に収まる</strong>ようにします。
                </p>
                <p className="mt-1">
                  目をつぶり、その場でゆっくり体を回転させます。
                  正面（12時）を向いているときは前から、右を向くと左耳（9時）から、
                  <strong className="text-amber-400">完全に背を向ける（後ろ向きになる）と真後ろ（6時）から</strong>
                  くぐもった音で聞こえることを確認してください。
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="font-bold text-sky-400 mb-1 flex items-center gap-1.5">
                  <span>3. 実験パターンB：目をつぶってスマホを手で動かす</span>
                </div>
                <p>
                  スマホのインカメラ（広角推奨）を自分の顔・胸元に向け、腕を伸ばしてカメラに自分の頭と肩が映るようにします。
                  そのままスマホを右（1時〜3時）や左（9時〜11時）、上や下へ動かすと、動かした手の位置から音が聞こえます。
                </p>
                <p className="mt-1 text-slate-400">
                  ※手で後ろ（4時〜8時）へ回す場合は、スマホのカメラレンズが自分の後頭部・背中を向くように手首を返して映し続ける必要があります。
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div className="font-bold text-sky-400 mb-1 flex items-center gap-1.5">
                  <span>4. HRTFの効果検証（比較実験）</span>
                </div>
                <p>
                  背中を向けて「6時（真後ろ）」に音源がある状態で、画面の「HRTF ⇔ equalpower」ボタンを切り替えてみてください。
                  <strong className="text-sky-300">
                    HRTFのときだけ高域が人間の頭部・耳介によって自然にフィルタリングされ、前後反転の混乱が解消され後方のリアルな空間定位が生じる
                  </strong>
                  ことを耳で実感できます。
                </p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/80 py-4 text-center text-xs text-slate-500">
        © 2026{' '}
        <a
          href="https://x.com/TakashiSasaki"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-sky-400 transition underline underline-offset-4 decoration-slate-700 hover:decoration-sky-400 font-medium"
        >
          @TakashiSasaki
        </a>
      </footer>
    </div>
  );
}
