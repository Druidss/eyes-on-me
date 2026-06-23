import type { GazeState } from "../gaze/GazeAwarenessMachine.js";
import type { ActiveSpyZone, RapportBand, RapportSnapshot } from "./types.js";

export interface RapportBandThresholds {
  strained_max: number;
  uneasy_max: number;
  neutral_max: number;
}

export interface RapportMetricOptions {
  initialValue?: number;
  minValue?: number;
  maxValue?: number;
  mutualGazeGainPerSecond?: number;
  pendingFaceGainPerSecond?: number;
  facePresenceGainPerSecond?: number;
  gazeBreakRespectGainPerSecond?: number;
  gazeBreakDecayPerSecond?: number;
  unreciprocatedFaceDecayPerSecond?: number;
  avoidanceDecayPerSecond?: number;
  thresholds?: Partial<RapportBandThresholds>;
  minSuspicionMultiplier?: number;
  maxSuspicionMultiplier?: number;
}

export interface RapportMetricInput {
  nowMs: number;
  gazeState?: GazeState | null;
  mutualGaze?: boolean;
  avatarEyeContact?: boolean;
  userFaceIntersection?: boolean;
  activeZone?: ActiveSpyZone | null;
}

const DEFAULT_THRESHOLDS: RapportBandThresholds = {
  strained_max: 25,
  uneasy_max: 45,
  neutral_max: 70,
};

export class RapportMetric {
  private readonly initialValue: number;
  private readonly minValue: number;
  private readonly maxValue: number;
  private readonly mutualGazeGainPerSecond: number;
  private readonly pendingFaceGainPerSecond: number;
  private readonly facePresenceGainPerSecond: number;
  private readonly gazeBreakRespectGainPerSecond: number;
  private readonly gazeBreakDecayPerSecond: number;
  private readonly unreciprocatedFaceDecayPerSecond: number;
  private readonly avoidanceDecayPerSecond: number;
  private readonly thresholds: RapportBandThresholds;
  private readonly minSuspicionMultiplier: number;
  private readonly maxSuspicionMultiplier: number;

  private value: number;
  private band: RapportBand;
  private sourceGazeState: GazeState;
  private lastUpdateAtMs: number | null = null;

  constructor(options: RapportMetricOptions = {}) {
    this.minValue = options.minValue ?? 0;
    this.maxValue = options.maxValue ?? 100;
    // mutual gaze +
    this.mutualGazeGainPerSecond = options.mutualGazeGainPerSecond ?? 6;
    // pending gaze +
    this.pendingFaceGainPerSecond = options.pendingFaceGainPerSecond ?? 3;
    // player looks at face but avatar isn't looking at player +
    this.facePresenceGainPerSecond = options.facePresenceGainPerSecond ?? 2;
    // player respects gaze break by looking away +
    this.gazeBreakRespectGainPerSecond = options.gazeBreakRespectGainPerSecond ?? 4;
    // gaze break -
    this.gazeBreakDecayPerSecond = options.gazeBreakDecayPerSecond ?? 7;
    // avatar looks at player but player isn't looking at avatar -
    this.unreciprocatedFaceDecayPerSecond = options.unreciprocatedFaceDecayPerSecond ?? 4;
    // general decay when not looking at avatar -
    this.avoidanceDecayPerSecond = options.avoidanceDecayPerSecond ?? 3;
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...options.thresholds,
    };
    this.minSuspicionMultiplier = options.minSuspicionMultiplier ?? 0.8;
    this.maxSuspicionMultiplier = options.maxSuspicionMultiplier ?? 1.2;

    this.initialValue = this.clamp(options.initialValue ?? 50);
    this.value = this.initialValue;
    this.band = this.resolveBand(this.value);
    this.sourceGazeState = "baseline";
  }

  reset(nowMs?: number): void {
    this.value = this.initialValue;
    this.band = this.resolveBand(this.value);
    this.sourceGazeState = "baseline";
    this.lastUpdateAtMs = nowMs ?? null;
  }

  update(input: RapportMetricInput): RapportSnapshot {
    const dtMs = this.lastUpdateAtMs === null
      ? 0
      : Math.max(0, input.nowMs - this.lastUpdateAtMs);
    this.lastUpdateAtMs = input.nowMs;

    const gazeState = input.gazeState ?? "baseline";
    const userFaceIntersection = this.resolveUserFaceIntersection(input);
    const avatarEyeContact = input.avatarEyeContact ?? false;
    const mutualGaze = input.mutualGaze ?? (avatarEyeContact && userFaceIntersection);

    let nextValue = this.value;

    if (gazeState === "gaze_break" && userFaceIntersection) {
      nextValue -= (dtMs / 1000) * this.gazeBreakDecayPerSecond;
    } else if (gazeState === "gaze_break") {
      nextValue += (dtMs / 1000) * this.gazeBreakRespectGainPerSecond;
    } else if (mutualGaze) {
      nextValue += (dtMs / 1000) * this.mutualGazeGainPerSecond;
    } else if (gazeState === "gazeaware_pending" && userFaceIntersection) {
      nextValue += (dtMs / 1000) * this.pendingFaceGainPerSecond;
    } else if (userFaceIntersection && !avatarEyeContact) {
      nextValue += (dtMs / 1000) * this.facePresenceGainPerSecond;
    } else if (avatarEyeContact && !userFaceIntersection) {
      nextValue -= (dtMs / 1000) * this.unreciprocatedFaceDecayPerSecond;
    } else {
      nextValue -= (dtMs / 1000) * this.avoidanceDecayPerSecond;
    }

    nextValue = this.clamp(nextValue);
    this.value = nextValue;
    this.band = this.resolveBand(nextValue);
    this.sourceGazeState = gazeState;

    return {
      value: this.value,
      band: this.band,
      suspicion_multiplier: this.resolveSuspicionMultiplier(this.value),
      source_gaze_state: this.sourceGazeState,
    };
  }

  get snapshot(): RapportSnapshot {
    return {
      value: this.value,
      band: this.band,
      suspicion_multiplier: this.resolveSuspicionMultiplier(this.value),
      source_gaze_state: this.sourceGazeState,
    };
  }

  private resolveUserFaceIntersection(input: RapportMetricInput): boolean {
    if (input.userFaceIntersection !== undefined) {
      return input.userFaceIntersection;
    }

    return input.activeZone?.kind === "officer_face";
  }

  private resolveSuspicionMultiplier(value: number): number {
    const normalized = (this.clamp(value) - this.minValue) / Math.max(1, this.maxValue - this.minValue);
    return this.maxSuspicionMultiplier
      - normalized * (this.maxSuspicionMultiplier - this.minSuspicionMultiplier);
  }

  private clamp(value: number): number {
    return Math.min(this.maxValue, Math.max(this.minValue, value));
  }

  private resolveBand(value: number): RapportBand {
    if (value < this.thresholds.strained_max) return "strained";
    if (value < this.thresholds.uneasy_max) return "uneasy";
    if (value < this.thresholds.neutral_max) return "neutral";
    return "comfortable";
  }
}
