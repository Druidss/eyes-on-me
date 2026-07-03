import type { SuspicionState } from "./types.js";

export interface OverallSuspicionThresholds {
  relaxed_max: number;
  neutral_max: number;
  alert_max: number;
  suspicious_max: number;
}

export interface OverallSuspicionMetricOptions {
  initialValue?: number;
  minValue?: number;
  maxValue?: number;
  risePerSecond?: number;
  fallPerSecond?: number;
  thresholds?: Partial<OverallSuspicionThresholds>;
}

export interface OverallSuspicionMetricInput {
  momentaryValue: number;
  nowMs: number;
}

export interface OverallSuspicionSnapshot {
  value: number;
  state: SuspicionState;
  changed: boolean;
}

const DEFAULT_THRESHOLDS: OverallSuspicionThresholds = {
  relaxed_max: 20,
  neutral_max: 45,
  alert_max: 65,
  suspicious_max: 85,
};

export class OverallSuspicionMetric {
  private readonly initialValue: number;
  private readonly minValue: number;
  private readonly maxValue: number;
  private readonly risePerSecond: number;
  private readonly fallPerSecond: number;
  private readonly thresholds: OverallSuspicionThresholds;

  private value: number;
  private state: SuspicionState;
  private lastUpdateAtMs: number | null = null;

  constructor(options: OverallSuspicionMetricOptions = {}) {
    this.minValue = options.minValue ?? 0;
    this.maxValue = options.maxValue ?? 100;
    this.risePerSecond = options.risePerSecond ?? 1.4;
    this.fallPerSecond = options.fallPerSecond ?? 0.10;
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
  }

  update(input: OverallSuspicionMetricInput): OverallSuspicionSnapshot {
    const dtSeconds = this.lastUpdateAtMs === null
      ? 0
      : Math.max(0, input.nowMs - this.lastUpdateAtMs) / 1000;
    this.lastUpdateAtMs = input.nowMs;

    const target = this.clamp(input.momentaryValue);
    const delta = target - this.value;

    let nextValue = this.value;
    if (delta > 0) {
      nextValue += delta * this.risePerSecond * dtSeconds;
    } else if (delta < 0) {
      nextValue += delta * this.fallPerSecond * dtSeconds;
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

  get snapshot(): OverallSuspicionSnapshot {
    return {
      value: this.value,
      state: this.state,
      changed: false,
    };
  }

  isLowSuspicion(): boolean {
    return this.state === "relaxed" || this.state === "neutral";
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
