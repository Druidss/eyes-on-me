import type { TimelineAction, TimelineActionHandler } from "../TimelineController.js";

/**
 * Single-slot audio player for timeline-triggered cues.
 *
 * Only one timeline-triggered clip plays at a time: starting a new one
 * stops whatever was playing before. This is intentionally separate
 * from any state-driven audio (e.g. SuspicionAudioController) — the two
 * are different trigger sources and are not coordinated here. If both
 * need to share one audio channel, that coordination belongs in
 * ConversationStepController, which owns both controllers.
 */
export class TimelineAudioPlayer {
  private currentAudio: HTMLAudioElement | null = null;

  constructor(private readonly resolveUrl: (src: string) => string = (src) => src) {}

  play(src: string, opts: { volume?: number; loop?: boolean } = {}): void {
    this.stop();

    const audio = new Audio(this.resolveUrl(src));
    audio.volume = opts.volume ?? 1;
    audio.loop = opts.loop ?? false;
    audio.play().catch((err: unknown) => {
      console.warn(`[TimelineAudioPlayer] play failed for "${src}":`, err);
    });
    this.currentAudio = audio;
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
  }

  dispose(): void {
    this.stop();
  }
}

/**
 * Builds a TimelineActionHandler for `type: "play_audio"`, bound to a
 * given TimelineAudioPlayer instance.
 *
 * Action shape expected: { type: "play_audio", src, volume?, loop? }.
 * Missing/invalid `src` logs a warning and is otherwise a no-op —
 * a malformed cue should not crash the conversation step.
 */
export function createPlayAudioActionHandler(
  player: TimelineAudioPlayer,
): TimelineActionHandler {
  return (action: TimelineAction) => {
    if (!action.src) {
      console.warn('[play_audio] action missing "src" — skipping', action);
      return;
    }
    player.play(action.src, {
      volume: action.volume,
      loop: action.loop,
    });
  };
}
