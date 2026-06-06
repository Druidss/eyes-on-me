import type {
  GazeZoneSnapshot,
  SpyZoneId,
  SuspicionSnapshot,
  SuspicionState,
} from "./types.js";

export interface SuspicionThresholds {
  relaxed_max: number;
  neutral_max: number;
  alert_max: number;
  suspicious_max: number;
}

export interface SuspicionMetricOptions {
  initialValue?: number;
  minValue?: number;
  maxValue?: number;
  evidenceDwellGainPerSecond?: number;
  evidenceFixationGain?: number;
  officerFaceDecayPerSecond?: number;
  backgroundDecayPerSecond?: number;
  thresholds?: Partial<SuspicionThresholds>;
}

export interface SuspicionMetricInput {
  zoneSnapshot: GazeZoneSnapshot;
  nowMs: number;
  suspicionMultiplier?: number;
}

const DEFAULT_THRESHOLDS: SuspicionThresholds = {
  relaxed_max: 20,
  neutral_max: 45,
  alert_max: 65,
  suspicious_max: 85,
};

export class SuspicionMetric {
  private readonly initialValue: number;
  private readonly minValue: number;
  private readonly maxValue: number;
  private readonly evidenceDwellGainPerSecond: number;
  private readonly evidenceFixationGain: number;
  private readonly officerFaceDecayPerSecond: number;
  private readonly backgroundDecayPerSecond: number;
  private readonly thresholds: SuspicionThresholds;

  private value: number;
  private state: SuspicionState;
  private lastUpdateAtMs: number | null = null;
  private processedFixationCounts = new Map<SpyZoneId, number>();

  constructor(options: SuspicionMetricOptions = {}) {
    this.minValue = options.minValue ?? 0;
    this.maxValue = options.maxValue ?? 100;
    this.evidenceDwellGainPerSecond = options.evidenceDwellGainPerSecond ?? 18;
    this.evidenceFixationGain = options.evidenceFixationGain ?? 8;
    this.officerFaceDecayPerSecond = options.officerFaceDecayPerSecond ?? 10;
    this.backgroundDecayPerSecond = options.backgroundDecayPerSecond ?? 4;
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...options.thresholds,
    };

    this.initialValue = this.clamp(options.initialValue ?? 30);
    this.value = this.initialValue;
    this.state = this.resolveState(this.value);
  }

  reset(nowMs?: number): void {
    this.value = this.initialValue;
    this.state = this.resolveState(this.value);
    this.lastUpdateAtMs = nowMs ?? null;
    this.processedFixationCounts.clear();
  }

  update(input: SuspicionMetricInput): SuspicionSnapshot {
    const dtMs = this.lastUpdateAtMs === null
      ? 0
      : Math.max(0, input.nowMs - this.lastUpdateAtMs);
    this.lastUpdateAtMs = input.nowMs;

    const zone = input.zoneSnapshot.active_zone;
    const fixationCounts = input.zoneSnapshot.fixation.per_zone_counts;
    const multiplier = Math.max(0, input.suspicionMultiplier ?? 1);

    let nextValue = this.value;

    if (zone.kind === "evidence") {
      nextValue += (dtMs / 1000) * this.evidenceDwellGainPerSecond * multiplier;

      const currentZoneFixations = fixationCounts[zone.id] ?? 0;
      const processedFixations = this.processedFixationCounts.get(zone.id) ?? 0;
      const fixationDelta = Math.max(0, currentZoneFixations - processedFixations);

      if (fixationDelta > 0) {
        nextValue += fixationDelta * this.evidenceFixationGain * multiplier;
        this.processedFixationCounts.set(zone.id, currentZoneFixations);
      }
    } else if (zone.kind === "officer_face") {
      nextValue -= (dtMs / 1000) * this.officerFaceDecayPerSecond;
    } else {
      nextValue -= (dtMs / 1000) * this.backgroundDecayPerSecond;
    }

    nextValue = this.clamp(nextValue);
    const nextState = this.resolveState(nextValue);
    const changed = nextState !== this.state;

    this.value = nextValue;
    this.state = nextState;

    return {
      value: this.value,
      state: this.state,
      changed,
    };
  }

  get snapshot(): SuspicionSnapshot {
    return {
      value: this.value,
      state: this.state,
      changed: false,
    };
  }

  private clamp(value: number): number {
    return Math.min(this.maxValue, Math.max(this.minValue, value));
  }

  private resolveState(value: number): SuspicionState {
    if (value < this.thresholds.relaxed_max) return "relaxed";
    if (value < this.thresholds.neutral_max) return "neutral";
    if (value < this.thresholds.alert_max) return "alert";
    if (value < this.thresholds.suspicious_max) return "suspicious";
    return "confrontational";
  }
}
