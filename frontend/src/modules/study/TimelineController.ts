import type { TimelineAction, TimelineCue } from "../../shared/types.js";

export type { TimelineAction, TimelineCue };

/**
 * Handles a single TimelineAction. Receives the action payload and the
 * cue it belongs to (for logging/context). Handlers are looked up by
 * `action.type` in an ActionRegistry.
 */
export type TimelineActionHandler = (
  action: TimelineAction,
  cue: TimelineCue,
) => void;

/** Maps action type string → handler. "play_audio" is provided by default. */
export type TimelineActionRegistry = Record<string, TimelineActionHandler>;

export interface TimelineControllerOptions {
  /** Cues to schedule, typically `step.timeline`. */
  cues: TimelineCue[];
  /** Action handlers keyed by `action.type`. */
  actions: TimelineActionRegistry;
  /**
   * Called whenever a cue fires, after its actions have been dispatched.
   * Intended for telemetry — keeps TimelineController decoupled from
   * any specific reporter implementation.
   */
  onCueFired?: (cue: TimelineCue, elapsedSeconds: number) => void;
  /**
   * Called once if a cue's action has a `type` with no registered
   * handler. Default: console.warn.
   */
  onUnhandledAction?: (action: TimelineAction, cue: TimelineCue) => void;
}

/**
 * Fires configured actions at fixed offsets (`at_seconds`) within a
 * conversation step's lifetime.
 *
 * Pure time-driven: TimelineController does not look at gaze, suspicion,
 * or any other runtime state — it only cares about elapsed seconds since
 * `start()` was called. This keeps it decoupled from
 * GazeAwarenessMachine / SuspicionMetric, which are driven by their own
 * triggers (intersection state, dwell time) on a different clock.
 *
 * Caller is responsible for calling `tick(elapsedSeconds)` once per
 * timer heartbeat (e.g. from ConversationStepController's existing
 * 1-second timer interval) — TimelineController does not own its own
 * setInterval, to avoid two independent clocks drifting apart.
 */
export class TimelineController {
  private readonly cues: readonly TimelineCue[];
  private readonly actions: TimelineActionRegistry;
  private readonly onCueFired?: (cue: TimelineCue, elapsedSeconds: number) => void;
  private readonly onUnhandledAction?: (action: TimelineAction, cue: TimelineCue) => void;

  /** Cue ids that have already fired this run. Prevents double-firing. */
  private firedCueIds = new Set<string>();

  constructor(options: TimelineControllerOptions) {
    // Sort ascending so tick() can short-circuit cleanly if needed later;
    // also makes firing order deterministic and matches author intent
    // (cues are usually authored in chronological order anyway).
    this.cues = [...options.cues].sort((a, b) => a.at_seconds - b.at_seconds);
    this.actions = options.actions;
    this.onCueFired = options.onCueFired;
    this.onUnhandledAction = options.onUnhandledAction;
  }

  /** Reset fired-cue tracking. Call when restarting a step. */
  reset(): void {
    this.firedCueIds.clear();
  }

  /**
   * Advance the timeline to `elapsedSeconds`. Fires every cue whose
   * `at_seconds <= elapsedSeconds` that hasn't fired yet.
   *
   * Idempotent per cue: each cue fires exactly once per reset() cycle,
   * even if tick() is called multiple times with the same or a later
   * elapsed value (e.g. due to setInterval jitter).
   */
  tick(elapsedSeconds: number): void {
    for (const cue of this.cues) {
      if (cue.at_seconds > elapsedSeconds) continue;
      if (this.firedCueIds.has(cue.id)) continue;

      this.firedCueIds.add(cue.id);
      this.fireCue(cue, elapsedSeconds);
    }
  }

  private fireCue(cue: TimelineCue, elapsedSeconds: number): void {
    for (const action of cue.actions) {
      const handler = this.actions[action.type];
      if (!handler) {
        if (this.onUnhandledAction) {
          this.onUnhandledAction(action, cue);
        } else {
          console.warn(
            `[TimelineController] No handler registered for action type "${action.type}" (cue "${cue.id}")`,
          );
        }
        continue;
      }
      handler(action, cue);
    }
    this.onCueFired?.(cue, elapsedSeconds);
  }
}
