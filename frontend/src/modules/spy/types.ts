import type { GazeState } from "../gaze/GazeAwarenessMachine.js";



// shared types for spy module



export type SpyZoneKind = "officer_face" | "evidence" | "background";

export type SpyZoneId = string;

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface RectGazeZone {
  id: SpyZoneId;
  label: string;
  kind: SpyZoneKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActiveSpyZone {
  id: SpyZoneId;
  label: string;
  kind: SpyZoneKind;
  changed: boolean;
  dwell_ms: number;
  entered_at_ms: number;
  gaze_point: NormalizedPoint | null;
}

export interface FixationSnapshot {
  total_count: number;
  current_zone_id: SpyZoneId | null;
  current_zone_fixation_count: number;
  current_dwell_ms: number;
  current_counts_as_fixation: boolean;
  last_fixation_zone_id: SpyZoneId | null;
  last_fixation_at_ms: number | null;
  per_zone_counts: Partial<Record<SpyZoneId, number>>;
}

export interface GazeZoneSnapshot {
  active_zone: ActiveSpyZone;
  fixation: FixationSnapshot;
}

export type SuspicionState =
  | "relaxed"
  | "neutral"
  | "alert"
  | "suspicious"
  | "confrontational";

export interface SuspicionSnapshot {
  value: number;
  state: SuspicionState;
  changed: boolean;
}

export type RapportBand = "strained" | "uneasy" | "neutral" | "comfortable";

export interface RapportSnapshot {
  value: number;
  band: RapportBand;
  suspicion_multiplier: number;
  source_gaze_state: GazeState;
}
