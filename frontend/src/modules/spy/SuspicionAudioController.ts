import type { SuspicionState } from "./types.js";

/**
 * Maps each SuspicionState to an audio cue file.
 * `null` means "no cue for this state" (e.g. relaxed/neutral stay silent).
 *
 * Paths are placeholders — replace with real filenames once audio assets
 * are added under frontend/public/audio/spy/.
 */
export const SUSPICION_AUDIO_SRC: Record<SuspicionState, string | null> = {
  relaxed: null,
  neutral: null,
  alert: "audio/spy/alert.mp3",
  suspicious: "audio/spy/suspicious.mp3",
  confrontational: "audio/spy/confrontational.mp3",
};

export interface SuspicionAudioControllerOptions {
  /** Volume for played cues, 0–1. Default 0.8. */
  volume?: number;
  /** Override the default state → src mapping. */
  sources?: Partial<Record<SuspicionState, string | null>>;
  /** Resolve a relative src to a full URL (e.g. to prefix BASE_URL). */
  resolveUrl?: (src: string) => string;
}

/**
 * Single-slot audio player for suspicion-state cues.
 *
 * Only one cue plays at a time: starting a new cue stops and replaces
 * whatever was playing before. Designed to be driven from state
 * *transitions* (SuspicionSnapshot.changed), not every frame — calling
 * playForState() repeatedly with the same state is a no-op.
 */
export class SuspicionAudioController {
  private readonly sources: Record<SuspicionState, string | null>;
  private readonly volume: number;
  private readonly resolveUrl: (src: string) => string;

  private currentAudio: HTMLAudioElement | null = null;
  private currentState: SuspicionState | null = null;

  constructor(options: SuspicionAudioControllerOptions = {}) {
    this.sources = { ...SUSPICION_AUDIO_SRC, ...options.sources };
    this.volume = options.volume ?? 0.8;
    this.resolveUrl = options.resolveUrl ?? ((src) => src);
  }

  /**
   * Play the cue for `state`, replacing any cue currently playing.
   * No-op if `state` is already the active cue (avoids restart spam
   * when called every frame with an unchanged state).
   * If the state has no configured src, this stops playback (silence).
   */
  playForState(state: SuspicionState): void {
    if (this.currentState === state) return;

    this.stop();
    this.currentState = state;

    const src = this.sources[state];
    if (!src) return; // silent state — stop() above already cleared playback

    const audio = new Audio(this.resolveUrl(src));
    audio.volume = this.volume;
    audio.play().catch((err: unknown) => {
      console.warn(`[SuspicionAudioController] play failed for "${state}":`, err);
    });
    this.currentAudio = audio;
  }

  /** Stop and release any currently playing cue. Idempotent. */
  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    this.currentState = null;
  }

  /** Alias for stop(); call on controller teardown. */
  dispose(): void {
    this.stop();
  }
}
