import { BACKGROUND_ZONE, GAZE_ZONES } from "./gazeZones.js";
import type {
  ActiveSpyZone,
  FixationSnapshot,
  GazeZoneSnapshot,
  NormalizedPoint,
  RectGazeZone,
  SpyZoneId,
} from "./types.js";

// optional config object for the tracker options, currently only fixation threshold but can be extended in the future
export interface GazeZoneTrackerOptions {
  fixationThresholdMs?: number;
}

/**
 * Tracks which zone is currently active
 * Returns a snapshot object with active zone info and fixation info
 *
 * Priority order:
 * 1. officer face hit
 * 2. matching evidence zone
 * 3. background fallback
 */

export class GazeZoneTracker {
  // store evidence zones the tracker should check
  private readonly zones: RectGazeZone[];
  // store fixation threshold
  private readonly fixationThresholdMs: number;

  // store current active zone snapshot
  private activeZone: ActiveSpyZone = this.createActiveZone(BACKGROUND_ZONE, 0, false, null);
  // other fixation state fields
  private totalFixationCount = 0;
  private currentZoneFixationCount = 0;
  private currentZoneCounted = false;
  private lastFixationZoneId: SpyZoneId | null = null;
  private lastFixationAtMs: number | null = null;
  // fication count by zone
  private fixationCountsByZone = new Map<SpyZoneId, number>();




  // constructor
  // - takes zones from GAZE_ZONES
  // - options: if caller gives a threshold, use it, otherwise default to 120ms
  constructor(
    zones: RectGazeZone[] = GAZE_ZONES,
    options: GazeZoneTrackerOptions = {},
  ) {
    this.zones = zones;
    this.fixationThresholdMs = options.fixationThresholdMs ?? 120;
  }


  // function - reset tracker to initial state 
  reset(nowMs = 0): void {
    this.activeZone = this.createActiveZone(BACKGROUND_ZONE, nowMs, false, null);
    this.totalFixationCount = 0;
    this.currentZoneFixationCount = 0;
    this.currentZoneCounted = false;
    this.lastFixationZoneId = null;
    this.lastFixationAtMs = null;
    this.fixationCountsByZone.clear();
  }





  // Core function - update
  update(
    // current gaze point
    gazePoint: NormalizedPoint | null,
    nowMs: number,
    // officerFaceHit from intersectionEngine
    officerFaceHit: boolean,
  ): GazeZoneSnapshot {
    const nextZone = this.resolveZone(gazePoint, officerFaceHit, nowMs);
    const changed = nextZone.id !== this.activeZone.id;

    if (changed) {
      this.activeZone = {
        ...nextZone,
        changed: true,
      };
      this.currentZoneFixationCount = 0;
      this.currentZoneCounted = false;
    } else {
      this.activeZone = {
        ...this.activeZone,
        changed: false,
        // if not changed, update dwell and gaze point 
        dwell_ms: Math.max(0, nowMs - this.activeZone.entered_at_ms),
        gaze_point: gazePoint,
      };
    }

    // fixation counting logic
    if (!this.currentZoneCounted && this.activeZone.dwell_ms >= this.fixationThresholdMs) {
      this.currentZoneCounted = true;
      this.currentZoneFixationCount += 1;
      this.totalFixationCount += 1;
      this.lastFixationZoneId = this.activeZone.id;
      this.lastFixationAtMs = nowMs;
      this.fixationCountsByZone.set(
        this.activeZone.id,
        (this.fixationCountsByZone.get(this.activeZone.id) ?? 0) + 1,
      );
    }

    // return snapshot
    return {
      active_zone: this.activeZone,
      fixation: this.createFixationSnapshot(),
    };
  }





  // get snapshot without updating state
  get snapshot(): GazeZoneSnapshot {
    return {
      active_zone: this.activeZone,
      fixation: this.createFixationSnapshot(),
    };
  }






  // helper -> decide which zone is active
  private resolveZone(
    gazePoint: NormalizedPoint | null,
    officerFaceHit: boolean,
    nowMs: number,
  ): ActiveSpyZone {
    if (officerFaceHit) {
      return this.createOfficerFaceZone(nowMs, gazePoint);
    }

    if (!gazePoint) {
      return this.createActiveZone(BACKGROUND_ZONE, nowMs, true, null);
    }

    const matchingZone = this.zones.find((zone) => this.pointInRect(gazePoint, zone));
    return this.createActiveZone(matchingZone ?? BACKGROUND_ZONE, nowMs, true, gazePoint);
  }


  // helper -> check whether gaze point lies inside a zone rectangle
  private pointInRect(point: NormalizedPoint, zone: RectGazeZone): boolean {
    return (
      point.x >= zone.x
      && point.x <= zone.x + zone.width
      && point.y >= zone.y
      && point.y <= zone.y + zone.height
    );
  }

  
  // helper -> create a new ActiveSpyZone snapshot based on a given RectGazeZone and current timestamp
  private createActiveZone(
    zone: RectGazeZone,
    nowMs: number,
    changed: boolean,
    gazePoint: NormalizedPoint | null,
  ): ActiveSpyZone {
    return {
      id: zone.id,
      label: zone.label,
      kind: zone.kind,
      changed,
      dwell_ms: 0,
      entered_at_ms: nowMs,
      gaze_point: gazePoint,
    };
  }

  // helper -> create an ActiveSpyZone snapshot for the officer face hit case, since it doesn't have a corresponding RectGazeZone
  private createOfficerFaceZone(
    nowMs: number,
    gazePoint: NormalizedPoint | null,
  ): ActiveSpyZone {
    return {
      id: "officer_face",
      label: "Officer Face",
      kind: "officer_face",
      changed: true,
      dwell_ms: 0,
      entered_at_ms: nowMs,
      gaze_point: gazePoint,
    };
  }

  // helper -> create a FixationSnapshot based on current state
  private createFixationSnapshot(): FixationSnapshot {
    return {
      total_count: this.totalFixationCount,
      current_zone_id: this.activeZone.id,
      current_zone_fixation_count: this.currentZoneFixationCount,
      current_dwell_ms: this.activeZone.dwell_ms,
      current_counts_as_fixation: this.currentZoneCounted,
      last_fixation_zone_id: this.lastFixationZoneId,
      last_fixation_at_ms: this.lastFixationAtMs,
      per_zone_counts: Object.fromEntries(this.fixationCountsByZone),
    };
  }
}
