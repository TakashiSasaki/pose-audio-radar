/**
 * MediaPipe Pose 3D Skeletal Tracking & Geometric Orientation Solver
 */

import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { AudioCoordinates } from '../audio/spatialAudio';

export type TrackingMode = 'hybrid' | 'shoulder' | 'head';
export type DistanceMode = 'fixed' | 'dynamic';

export interface PoseFrameData {
  hasPose: boolean;
  headBox?: import('./whenetMath').HeadBox;
  errorMessage?: string;
  landmarks: { x: number; y: number; z: number; visibility?: number }[] | null;
  worldLandmarks: { x: number; y: number; z: number; visibility?: number }[] | null;
  coords: AudioCoordinates;
  clockDirectionText: string;
  clockHour: number;
  confidence: number;
  shoulderAngleDeg: number;
  headAngleDeg: number;
  offsetAngleDeg: number;
  fps: number;
}

export interface PoseTrackerConfig {
  trackingMode: TrackingMode;
  distanceMode: DistanceMode;
  fixedDistance: number; // meters (default 2.5)
  mirrorMode: boolean; // Invert horizontal axis
  smoothingAlpha: number; // 0.05 to 1.0 (default 1.0)
  cameraFacing: 'user' | 'environment';
}

export class PoseTracker {
  private poseLandmarker: PoseLandmarker | null = null;
  private isModelLoading: boolean = false;
  private isModelReady: boolean = false;
  protected videoElement: HTMLVideoElement | null = null;
  private mediaStream: MediaStream | null = null;
  private cameraRequestId = 0;
  private destroyed = false;

  // Smoothing state (Cartesian coordinates)
  private smoothedX: number = 0;
  private smoothedY: number = 0;
  private smoothedZ: number = -2.5;
  private smoothedR: number = 2.5;

  private lastFrameTime: number = 0;
  private currentFps: number = 0;
  private consecutiveLostFrames: number = 0;

  private config: PoseTrackerConfig = {
    trackingMode: 'head',
    distanceMode: 'fixed',
    fixedDistance: 2.5,
    mirrorMode: false,
    smoothingAlpha: 1.0,
    cameraFacing: 'user',
  };

  constructor() {}

  public async initModel(): Promise<void> {
    if (this.isModelReady || this.isModelLoading) return;
    this.isModelLoading = true;

    try {
      const vision = await FilesetResolver.forVisionTasks(
        `${import.meta.env.BASE_URL}mediapipe/wasm`
      );

      // Attempt with GPU delegate, fallback to CPU if GPU is unavailable
      try {
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      } catch (gpuError) {
        console.warn('GPU delegate failed for PoseLandmarker, falling back to CPU:', gpuError);
        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: 0.45,
          minPosePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
      }

      if (this.destroyed) {
        this.poseLandmarker.close();
        this.poseLandmarker = null;
        throw new DOMException('Tracker was destroyed', 'AbortError');
      }
      this.isModelReady = true;
    } finally {
      this.isModelLoading = false;
    }
  }

  public getIsReady(): boolean {
    return this.isModelReady;
  }

  public getIsLoading(): boolean {
    return this.isModelLoading;
  }

  public updateConfig(newConfig: Partial<PoseTrackerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  public getConfig(): PoseTrackerConfig {
    return this.config;
  }

  public async startCamera(video: HTMLVideoElement, facing: 'user' | 'environment' = 'user'): Promise<boolean> {
    this.stopCamera();
    if (this.destroyed) return false;
    const requestId = this.cameraRequestId;

    const constraints: MediaStreamConstraints = {
      video: {
        facingMode: facing,
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    };

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (requestId !== this.cameraRequestId) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.mediaStream = stream;
      this.videoElement = video;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      if (requestId !== this.cameraRequestId) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      this.config.cameraFacing = facing;
      return true;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (requestId !== this.cameraRequestId) return false;
      this.stopCamera();
      throw error;
    }
  }

  public stopCamera(): void {
    this.cameraRequestId++;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  }

  /**
   * Process a single video frame and calculate the 3D position of the camera relative to user
   */
  public processFrame(timestamp: number): PoseFrameData {
    // Calculate FPS
    if (this.lastFrameTime > 0) {
      const delta = (timestamp - this.lastFrameTime) / 1000;
      if (delta > 0) {
        const instantFps = 1 / delta;
        this.currentFps = 0.9 * this.currentFps + 0.1 * instantFps;
      }
    }
    this.lastFrameTime = timestamp;

    const fallbackResult: PoseFrameData = {
      hasPose: false,
      landmarks: null,
      worldLandmarks: null,
      coords: {
        x: this.smoothedX,
        y: this.smoothedY,
        z: this.smoothedZ,
        distance: this.smoothedR,
        azimuthDeg: (Math.atan2(this.smoothedX, -this.smoothedZ) * 180) / Math.PI,
        elevationDeg: (Math.asin(Math.max(-1, Math.min(1, this.smoothedY / this.smoothedR))) * 180) / Math.PI,
      },
      clockDirectionText: 'トラッキング未検出',
      clockHour: 12,
      confidence: 0,
      shoulderAngleDeg: 0,
      headAngleDeg: 0,
      offsetAngleDeg: 0,
      fps: Math.round(this.currentFps),
    };

    if (!this.poseLandmarker || !this.videoElement || this.videoElement.readyState < 2) {
      return fallbackResult;
    }

    let detection: PoseLandmarkerResult;
    try {
      detection = this.poseLandmarker.detectForVideo(this.videoElement, timestamp);
    } catch {
      return fallbackResult;
    }

    if (
      !detection.landmarks ||
      detection.landmarks.length === 0 ||
      !detection.worldLandmarks ||
      detection.worldLandmarks.length === 0
    ) {
      this.consecutiveLostFrames++;
      return fallbackResult;
    }

    this.consecutiveLostFrames = 0;
    const lm2d = detection.landmarks[0];
    const lm3d = detection.worldLandmarks[0];
    const headIndices = [0, 7, 8];
    const shoulderIndices = [11, 12];
    if (![...headIndices, ...shoulderIndices].every((index) => lm2d[index] && lm3d[index])) {
      return fallbackResult;
    }
    const isReliable = (indices: number[]) => indices.every((index) =>
      [lm2d[index], lm3d[index]].every((point) =>
        [point.x, point.y, point.z].every(Number.isFinite) && (point.visibility ?? 0) >= 0.5
      )
    );
    const hasReliableHead = isReliable(headIndices);
    const hasReliableShoulders = isReliable(shoulderIndices);
    const needsHead = this.config.trackingMode !== 'shoulder';
    const needsShoulders = this.config.trackingMode !== 'head' || this.config.distanceMode === 'dynamic';
    if ((needsHead && !hasReliableHead) || (needsShoulders && !hasReliableShoulders)) {
      return fallbackResult;
    }

    // Landmark references
    // 0: nose, 7: left_ear, 8: right_ear, 11: left_shoulder, 12: right_shoulder
    const nose = lm2d[0];
    const leftEar = lm2d[7];
    const rightEar = lm2d[8];
    const leftShoulder2D = lm2d[11];
    const rightShoulder2D = lm2d[12];

    const leftShoulder3D = lm3d[11];
    const rightShoulder3D = lm3d[12];
    const nose3D = lm3d[0];
    const leftEar3D = lm3d[7];
    const rightEar3D = lm3d[8];

    // Report the weakest required landmark rather than hiding it in an average.
    const requiredIndices = [...(needsHead ? headIndices : []), ...(needsShoulders ? shoulderIndices : [])];
    const confidence = Math.min(...requiredIndices.flatMap((index) => [lm2d[index].visibility ?? 0, lm3d[index].visibility ?? 0]));

    // 1. Calculate Shoulder 360-degree rotation angle psi_shoulder
    // Both components must be in the same world-coordinate units (meters).
    const deltaX_3d = leftShoulder3D.x - rightShoulder3D.x;

    // 3D worldLandmarks depth difference:
    // R_z - L_z
    const deltaZ_3d = rightShoulder3D.z - leftShoulder3D.z;

    const shoulderAngleRad = hasReliableShoulders ? Math.atan2(deltaZ_3d, deltaX_3d) : 0;

    // 2. Calculate Head 360-degree rotation angle psi_head
    // Ear midpoint
    const earMidX = (leftEar.x + rightEar.x) / 2;
    const earMidY = (leftEar.y + rightEar.y) / 2;

    const earMid3D_z = (leftEar3D.z + rightEar3D.z) / 2;
    const headDeltaZ_3d = earMid3D_z - nose3D.z; // Nose is in front of ears when facing camera => positive
    const headDeltaX_3d = nose3D.x - (leftEar3D.x + rightEar3D.x) / 2;

    // Head orientation angle
    const headAngleRad = hasReliableHead ? Math.atan2(headDeltaX_3d, headDeltaZ_3d) : 0;

    // 3. Choose base angle based on trackingMode
    let baseAngleRad = 0;
    if (this.config.trackingMode === 'shoulder') {
      baseAngleRad = shoulderAngleRad;
    } else if (this.config.trackingMode === 'head') {
      baseAngleRad = headAngleRad;
    } else {
      // Hybrid mode: Blend shoulder angle and head angle
      // Shoulders provide rock-solid 360° front/back stability; head provides subtle responsiveness
      // Circular interpolation for angles
      const diff = Math.atan2(Math.sin(headAngleRad - shoulderAngleRad), Math.cos(headAngleRad - shoulderAngleRad));
      baseAngleRad = shoulderAngleRad + diff * 0.35;
    }

    // 4. Horizontal FOV Translation Offset
    // When user's head moves horizontally in camera frame, camera is offset relative to user
    // FOVx is roughly 60 degrees (1.047 radians)
    const FOV_X = (60 * Math.PI) / 180;
    const headCenterX = hasReliableHead ? (nose.x + earMidX) / 2 : (leftShoulder2D.x + rightShoulder2D.x) / 2;
    // In the raw, unmirrored image, a front-facing head on image-left has the camera
    // on the listener's left. Convert image displacement to listener-relative azimuth.
    const offsetAngleRad = (headCenterX - 0.5) * FOV_X;

    // Combined Azimuth theta
    let totalAzimuthRad = baseAngleRad + offsetAngleRad;

    // Mirror mode inversion if requested
    if (this.config.mirrorMode) {
      totalAzimuthRad = -totalAzimuthRad;
    }

    // Normalize to [-PI, PI]
    totalAzimuthRad = Math.atan2(Math.sin(totalAzimuthRad), Math.cos(totalAzimuthRad));

    // 5. Elevation / Pitch angle phi
    // 2D vertical position (nose/ear center Y)
    const FOV_Y = (45 * Math.PI) / 180;
    const headCenterY = hasReliableHead ? (nose.y + earMidY) / 2 : (leftShoulder2D.y + rightShoulder2D.y) / 2;
    // When head is low in frame (headCenterY > 0.5), camera is positioned higher than user => positive elevation
    const cameraElevationFromY = (0.5 - headCenterY) * FOV_Y * -1;

    // Face tilt: nose vs ear midpoint Y (looking up vs down)
    const tiltPitch = hasReliableHead ? (earMidY - nose.y) * 0.5 : 0;

    let totalElevationRad = cameraElevationFromY + tiltPitch;
    // Clamp elevation between -60° and +60°
    const maxElevation = (60 * Math.PI) / 180;
    totalElevationRad = Math.max(-maxElevation, Math.min(maxElevation, totalElevationRad));

    // 6. Distance Calculation
    let distance = this.config.fixedDistance;
    if (this.config.distanceMode === 'dynamic') {
      // Estimate distance from 2D shoulder span
      const shoulderSpan2D = Math.hypot(leftShoulder2D.x - rightShoulder2D.x, leftShoulder2D.y - rightShoulder2D.y);
      if (shoulderSpan2D > 0.05) {
        // Typical adult shoulder width ~0.4m, focal length normalized ~0.8
        const estimatedDist = (0.4 * 0.8) / shoulderSpan2D;
        distance = Math.max(0.8, Math.min(5.0, estimatedDist));
      }
    }

    // 7. Map to Web Audio API Cartesian coordinate space:
    // Listener is at (0, 0, 0), facing -Z (Front), +X is Right, +Y is Up, +Z is Back
    const targetX = distance * Math.sin(totalAzimuthRad) * Math.cos(totalElevationRad);
    const targetY = distance * Math.sin(totalElevationRad);
    const targetZ = -distance * Math.cos(totalAzimuthRad) * Math.cos(totalElevationRad);

    // 8. 3D Cartesian Exponential Moving Average (EMA) Smoothing
    const alpha = this.config.smoothingAlpha;
    this.smoothedX = alpha * targetX + (1 - alpha) * this.smoothedX;
    this.smoothedY = alpha * targetY + (1 - alpha) * this.smoothedY;
    this.smoothedZ = alpha * targetZ + (1 - alpha) * this.smoothedZ;
    this.smoothedR = Math.hypot(this.smoothedX, this.smoothedY, this.smoothedZ);

    // Compute smoothed angles
    const smoothedAzimuthRad = Math.atan2(this.smoothedX, -this.smoothedZ);
    const smoothedElevationRad = Math.asin(Math.max(-1, Math.min(1, this.smoothedY / this.smoothedR)));

    const azimuthDeg = (smoothedAzimuthRad * 180) / Math.PI;
    const elevationDeg = (smoothedElevationRad * 180) / Math.PI;

    // 9. Format Clock Direction
    // Normalize deg to [0, 360) for clock indexing
    let clockAngle = azimuthDeg;
    if (clockAngle < 0) clockAngle += 360;

    // Clock hour 1 to 12
    let clockHour = Math.round(clockAngle / 30) % 12;
    if (clockHour === 0) clockHour = 12;

    const clockDirectionText = this.formatClockDirection(azimuthDeg, clockHour, elevationDeg);

    return {
      hasPose: true,
      landmarks: lm2d,
      worldLandmarks: lm3d,
      coords: {
        x: this.smoothedX,
        y: this.smoothedY,
        z: this.smoothedZ,
        distance: this.smoothedR,
        azimuthDeg,
        elevationDeg,
      },
      clockDirectionText,
      clockHour,
      confidence,
      shoulderAngleDeg: (shoulderAngleRad * 180) / Math.PI,
      headAngleDeg: (headAngleRad * 180) / Math.PI,
      offsetAngleDeg: (offsetAngleRad * 180) / Math.PI,
      fps: Math.round(this.currentFps),
    };
  }

  private formatClockDirection(azimuthDeg: number, hour: number, elevationDeg: number): string {
    const absAzimuth = Math.abs(azimuthDeg);
    let sector = '';

    if (absAzimuth <= 15) {
      sector = '正面';
    } else if (absAzimuth >= 165) {
      sector = '真後ろ';
    } else if (azimuthDeg > 0) {
      if (azimuthDeg < 75) sector = '右前方';
      else if (azimuthDeg <= 105) sector = '右真横';
      else sector = '右後方';
    } else {
      if (azimuthDeg > -75) sector = '左前方';
      else if (azimuthDeg >= -105) sector = '左真横';
      else sector = '左後方';
    }

    const elevText =
      Math.abs(elevationDeg) >= 12
        ? elevationDeg > 0
          ? ` (仰角 +${Math.round(elevationDeg)}°)`
          : ` (俯角 ${Math.round(elevationDeg)}°)`
        : '';

    return `${sector} ${hour}時方向 / ${Math.round(azimuthDeg)}°${elevText}`;
  }

  public destroy(): void {
    this.destroyed = true;
    this.isModelReady = false;
    this.stopCamera();
    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
    }
  }
}
