/**
 * VRMLookAtSmoother — ported from pixiv/ChatVRM.
 *
 * Extends VRMLookAt with:
 * - Smooth damped tracking toward a userTarget
 * - Head rotation blending (eyes + head)
 * - Caller-driven saccade profiles (one per FSM state)
 *
 * Saccade offsets are applied AFTER the head bone slerp, so they
 * affect only the eyes — the head follows the smooth-damped
 * direction only.
 *
 * The renderer is FSM-agnostic: it accepts a SaccadeProfile via
 * setProfile() and applies it. The caller maps FSM states to
 * profiles (see SACCADE_PROFILES).
 *
 * Adapted for three 0.183 / @pixiv/three-vrm 3.5.x.
 * Original: src/lib/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmoother.ts
 */

import * as THREE from "three";
import {
  VRMHumanoid,
  VRMLookAt,
  VRMLookAtApplier,
} from "@pixiv/three-vrm";

/* ── Saccade profile type + defaults ───────────────────────────── */

export interface SaccadeProfile {
  /** Minimum seconds between saccade triggers. */
  readonly minInterval: number;
  /** Per-frame probability of firing a saccade. */
  readonly probability: number;
  /** Minimum horizontal offset in degrees. 0 = can look at center. */
  readonly yawMin: number;
  /** Maximum horizontal offset in degrees. */
  readonly yawMax: number;
  /** Minimum vertical offset in degrees. 0 = can look at center. */
  readonly pitchMin: number;
  /** Maximum vertical offset in degrees. */
  readonly pitchMax: number;
  /** Exponential damping coefficient for smooth tracking. */
  readonly smoothFactor: number;
  /** Max angle (degrees) before clamping to animation direction. */
  readonly userLimitAngle: number;
}

/**
 * Default saccade profiles keyed by GazeState.
 *
 * baseline          – relaxed, eyes roam freely
 * gazeaware_pending – transitional, slightly tighter
 * gazeaware         – focused mutual gaze
 * gaze_break        – forced aversion, min offset ensures eyes leave center
 */
export const SACCADE_PROFILES = {
  baseline: {
    minInterval: 0.6, probability: 0.06,
    yawMin: 0, yawMax: 20, pitchMin: 0, pitchMax: 13,
    smoothFactor: 4.0, userLimitAngle: 40.0,
  },
  gazeaware_pending: {
    minInterval: 0.8, probability: 0.05,
    yawMin: 0, yawMax: 16, pitchMin: 0, pitchMax: 10,
    smoothFactor: 5.0, userLimitAngle: 30.0,
  },
  gazeaware: {
    minInterval: 1.0, probability: 0.04,
    yawMin: 0, yawMax: 8, pitchMin: 0, pitchMax: 5,
    smoothFactor: 6.0, userLimitAngle: 20.0,
  },
  gaze_break: {
    minInterval: 0.6, probability: 0.06,
    yawMin: 9, yawMax: 22, pitchMin: 6, pitchMax: 14,
    smoothFactor: 4.0, userLimitAngle: 40.0,
  },
} as const satisfies Record<string, SaccadeProfile>;

const _v3A = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _eulerA = new THREE.Euler();

export class VRMLookAtSmoother extends VRMLookAt {
  /** Exponential smoothing factor for damped tracking. */
  public smoothFactor: number = SACCADE_PROFILES.baseline.smoothFactor;

  /** Maximum angle (degrees) to track the user target. */
  public userLimitAngle: number = SACCADE_PROFILES.baseline.userLimitAngle;

  /**
   * User-facing lookAt target.
   * The inherited `target` is reserved for animation-driven lookAt.
   */
  public userTarget?: THREE.Object3D | null;

  /** Set false to disable saccade jitter. */
  public enableSaccade: boolean;

  private _activeProfile: SaccadeProfile = SACCADE_PROFILES.baseline;
  private _justChangedGazeState = false;
  private _saccadeYaw = 0.0;
  private _saccadePitch = 0.0;
  private _saccadeTimer = 0.0;
  private _yawDamped = 0.0;
  private _pitchDamped = 0.0;
  private _appliedYaw = 0.0;
  private _appliedPitch = 0.0;
  private _tempFirstPersonBoneQuat = new THREE.Quaternion();

  public constructor(humanoid: VRMHumanoid, applier: VRMLookAtApplier) {
    super(humanoid, applier);
    this.enableSaccade = true;
  }

  /** Final yaw (degrees) last sent to the applier, including saccade offsets. */
  get appliedYaw(): number {
    return this._appliedYaw;
  }

  /** Final pitch (degrees) last sent to the applier, including saccade offsets. */
  get appliedPitch(): number {
    return this._appliedPitch;
  }

  /**
   * Apply a new saccade profile.
   *
   * No-op if the same profile instance is already active (reference
   * equality — works because callers use the frozen SACCADE_PROFILES
   * constants). Resets saccade offsets and suppresses the next trigger
   * to prevent a visual pop on transitions.
   */
  public setProfile(profile: SaccadeProfile): void {
    if (this._activeProfile === profile) return;
    this._activeProfile = profile;
    this.smoothFactor = profile.smoothFactor;
    this.userLimitAngle = profile.userLimitAngle;

    // Clean transition: zero current offset and suppress next trigger
    this._saccadeYaw = 0;
    this._saccadePitch = 0;
    this._saccadeTimer = 0;
    this._justChangedGazeState = true;
  }

  public override update(delta: number): void {
    if (this.target && this.autoUpdate) {
      // Animation-driven yaw/pitch
      this.lookAt(this.target.getWorldPosition(_v3A));

      const yawAnimation = this._yaw;
      const pitchAnimation = this._pitch;

      let yawFrame = yawAnimation;
      let pitchFrame = pitchAnimation;

      // User-facing tracking
      if (this.userTarget) {
        this.lookAt(this.userTarget.getWorldPosition(_v3A));

        // Clamp to user limit
        if (
          this.userLimitAngle < Math.abs(this._yaw) ||
          this.userLimitAngle < Math.abs(this._pitch)
        ) {
          this._yaw = yawAnimation;
          this._pitch = pitchAnimation;
        }

        // Exponential smoothing
        const k = 1.0 - Math.exp(-this.smoothFactor * delta);
        this._yawDamped += (this._yaw - this._yawDamped) * k;
        this._pitchDamped += (this._pitch - this._pitchDamped) * k;

        // Blend animation and user-facing directions
        const userRatio =
          1.0 -
          THREE.MathUtils.smoothstep(
            Math.sqrt(
              yawAnimation * yawAnimation + pitchAnimation * pitchAnimation,
            ),
            30.0,
            90.0,
          );

        yawFrame = THREE.MathUtils.lerp(
          yawAnimation,
          0.6 * this._yawDamped,
          userRatio,
        );
        pitchFrame = THREE.MathUtils.lerp(
          pitchAnimation,
          0.6 * this._pitchDamped,
          userRatio,
        );

        // Head rotation blend
        _eulerA.set(
          -this._pitchDamped * THREE.MathUtils.DEG2RAD,
          this._yawDamped * THREE.MathUtils.DEG2RAD,
          0.0,
          VRMLookAt.EULER_ORDER,
        );
        _quatA.setFromEuler(_eulerA);

        const head = this.humanoid.getRawBoneNode("head");
        if (head) {
          this._tempFirstPersonBoneQuat.copy(head.quaternion);
          head.quaternion.slerp(_quatA, 0.4);
          head.updateMatrixWorld();
        }
      }

      if (this.enableSaccade) {
        const p = this._activeProfile;

        this._saccadeTimer += delta;

        if (this._justChangedGazeState) {
          // Suppress first saccade after state change to avoid pop
          this._justChangedGazeState = false;
        } else if (
          this._saccadeTimer > p.minInterval &&
          Math.random() < p.probability
        ) {
          const yawSign = Math.random() < 0.5 ? -1 : 1;
          const pitchSign = Math.random() < 0.5 ? -1 : 1;
          this._saccadeYaw =
            yawSign * (p.yawMin + Math.random() * (p.yawMax - p.yawMin));
          this._saccadePitch =
            pitchSign * (p.pitchMin + Math.random() * (p.pitchMax - p.pitchMin));
          this._saccadeTimer = 0.0;
        }

        yawFrame += this._saccadeYaw;
        pitchFrame += this._saccadePitch;
      }

      this._appliedYaw = yawFrame;
      this._appliedPitch = pitchFrame;
      this.applier.applyYawPitch(yawFrame, pitchFrame);

      this._needsUpdate = false;
    }

    // Fallback: no target-driven control
    if (this._needsUpdate) {
      this._needsUpdate = false;
      this.applier.applyYawPitch(this._yaw, this._pitch);
    }
  }

  /** Call after render to revert head rotation applied in update(). */
  public revertFirstPersonBoneQuat(): void {
    if (this.autoUpdate && this.userTarget) {
      // Must restore to the RAW bone — same as the capture source in
      // update(). In three-vrm 3.x normalized and raw are separate
      // hierarchies; writing a raw quaternion back to the normalized
      // bone causes the humanoid mapping to be applied repeatedly,
      // accumulating rotation frame-over-frame.
      const head = this.humanoid.getRawBoneNode("head");
      if (head) {
        head.quaternion.copy(this._tempFirstPersonBoneQuat);
      }
    }
  }
}
