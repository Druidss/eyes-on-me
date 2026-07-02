/**
 * ChatVRM-derived avatar behaviour runtime.
 *
 * Central owner for blink, expression/emote, and lip sync.
 * Coordinates the ported ChatVRM controllers against a VRM instance.
 *
 * Boundaries:
 * - ViewerCore remains scene/render/camera owner and calls update/postUpdate
 * - AvatarLoader remains model/mixer owner (idle animation, vrm.update)
 * - ConversationStepController remains orchestrator (state, connect/disconnect)
 * - RealtimeClient remains WebRTC/session owner
 * - This runtime does NOT own the scene, renderer, camera, or AnimationMixer
 */

import type { VRM, VRMExpressionPresetName } from "@pixiv/three-vrm";
import { EmoteController } from "./emoteController.js";
import { LipSync } from "./lipSync.js";
import { VRMLookAtSmoother } from "./VRMLookAtSmoother.js";

export class ChatVrmAvatarRuntime {
  private readonly _vrm: VRM;
  private readonly _emoteController: EmoteController;

  // Lip sync audio graph
  private _lipSync: LipSync | null = null;
  private _audioCtx: AudioContext | null = null;
  private _audioSource: MediaStreamAudioSourceNode | null = null;
  private _audioElementSource: MediaElementAudioSourceNode | null = null;

  // Default face: subtle expression so the avatar doesn't look dead
  private static readonly DEFAULT_EXPRESSION = "relaxed";
  private static readonly DEFAULT_WEIGHT = 0.3;

  // Emote tracking (for default face modulation)
  private _hasActiveEmote = false;

  constructor(vrm: VRM) {
    this._vrm = vrm;
    this._emoteController = new EmoteController(vrm);
  }

  get vrm(): VRM {
    return this._vrm;
  }

  // -- Expression / Emote --

  public playEmotion(preset: VRMExpressionPresetName): void {
    this._hasActiveEmote = preset !== "neutral";
    this._emoteController.playEmotion(preset);
  }

  /** Set a temporary emote by name. */
  public setEmote(name: string): void {
    this._hasActiveEmote = true;
    this._emoteController.playEmotion(name as VRMExpressionPresetName);
  }

  /** Clear any active emote, return to neutral + default face. */
  public clearEmote(): void {
    this._hasActiveEmote = false;
    this._emoteController.playEmotion("neutral");
  }

  // -- Lip Sync --

  /**
   * Connect a WebRTC MediaStream for amplitude-based lip sync.
   * Creates an AudioContext + analyser graph. The analyser is NOT
   * connected to AudioContext.destination, so no duplicate audio.
   * Idempotent: detaches any previous lip sync first.
   */
  public attachLipSyncStream(stream: MediaStream): void {
    this.detachLipSync();

    try {
      this._audioCtx = new AudioContext();
      this._lipSync = new LipSync(this._audioCtx);
      this._audioSource = this._audioCtx.createMediaStreamSource(stream);
      this._audioSource.connect(this._lipSync.analyser);

      if (this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
    } catch (e) {
      console.warn("[ChatVrmAvatarRuntime] Lip sync setup failed:", e);
      this.detachLipSync();
    }
  }

  /**
   * Connect an HTMLAudioElement for amplitude-based lip sync.
   * Creates an AudioContext + analyser graph. The source is connected to
   * destination so that the sound remains audible.
   */
  public attachLipSyncAudio(audio: HTMLAudioElement): void {
    this.detachLipSync();

    try {
      this._audioCtx = new AudioContext();
      this._lipSync = new LipSync(this._audioCtx);
      this._audioElementSource = this._audioCtx.createMediaElementSource(audio);
      this._audioElementSource.connect(this._lipSync.analyser);
      this._audioElementSource.connect(this._audioCtx.destination);

      if (this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
    } catch (e) {
      console.warn("[ChatVrmAvatarRuntime] Audio element lip sync setup failed:", e);
      this.detachLipSync();
    }
  }

  /** Disconnect all lip sync audio nodes. Idempotent. */
  public detachLipSync(): void {
    if (this._audioSource) {
      try {
        this._audioSource.disconnect();
      } catch {
        /* already disconnected */
      }
      this._audioSource = null;
    }
    if (this._audioElementSource) {
      try {
        this._audioElementSource.disconnect();
      } catch {
        /* already disconnected */
      }
      this._audioElementSource = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
    }
    this._lipSync = null;
  }

  // -- Per-frame update --

  /**
   * Call once per frame, BEFORE vrm.update().
   *
   * Drives auto-blink, expression, lip sync → aa, and default face.
   */
  public update(delta: number): void {
    // Lip sync: sample volume and store for emote controller to apply.
    // Must run BEFORE emoteController.update() because lipSync() clears
    // the old value — update() then reads and applies the new one.
    if (this._lipSync) {
      const result = this._lipSync.update();
      this._emoteController.lipSync("aa", result.volume);
    }

    // Emote controller: auto-blink + emotion expression + lip sync application
    this._emoteController.update(delta);

    // Default face: subtle "relaxed" for natural appearance
    if (this._vrm.expressionManager) {
      this._vrm.expressionManager.setValue(
        ChatVrmAvatarRuntime.DEFAULT_EXPRESSION,
        this._hasActiveEmote ? 0 : ChatVrmAvatarRuntime.DEFAULT_WEIGHT,
      );
    }
  }

  /**
   * Call once per frame, AFTER render.
   *
   * Reverts VRMLookAtSmoother head bone rotation so the next
   * frame starts from a clean bone state.
   */
  public postUpdate(): void {
    const lookAt = this._vrm.lookAt;
    if (lookAt instanceof VRMLookAtSmoother) {
      lookAt.revertFirstPersonBoneQuat();
    }
  }

  // -- Cleanup --

  public dispose(): void {
    this.detachLipSync();

    // Reset expression state
    if (this._vrm.expressionManager) {
      this._vrm.expressionManager.setValue(
        ChatVrmAvatarRuntime.DEFAULT_EXPRESSION,
        0,
      );
      this._vrm.expressionManager.setValue("blink", 0);
      this._vrm.expressionManager.setValue("aa", 0);
    }
  }
}
