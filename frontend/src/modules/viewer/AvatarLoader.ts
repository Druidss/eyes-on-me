import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMLookAtSmoother } from "./chatvrm/VRMLookAtSmoother.js";
import { VRMLookAtSmootherLoaderPlugin } from "./chatvrm/VRMLookAtSmootherLoaderPlugin.js";
import { loadVRMAnimation } from "./chatvrm/loadVRMAnimation.js";

/**
 * Loads and manages a single VRM avatar model.
 */
export class AvatarLoader {
  vrm: VRM | null = null;
  mixer: THREE.AnimationMixer | null = null;

  private readonly lookAtTarget: THREE.Object3D;
  private _disposed = false;
  private idleAction: THREE.AnimationAction | null = null;
  private angryClipPromise: Promise<THREE.AnimationClip | null> | null = null;
  private angryFinishedListener: ((e: { action: THREE.AnimationAction }) => void) | null = null;

  constructor(lookAtTarget: THREE.Object3D) {
    this.lookAtTarget = lookAtTarget;
  }

  /**
   * Loads a VRM file from the given URL.
   * Resolves when the model is ready for scene attachment.
   */
  async load(url: string): Promise<VRM> {
    // Pre-flight: detect missing files early (Vite returns index.html for 404s)
    const check = await fetch(url, { method: "HEAD" });
    if (
      !check.ok ||
      (check.headers.get("content-type") ?? "").includes("text/html")
    ) {
      throw new Error(
        `Avatar file not found: ${url} — place VRM files in frontend/public/avatars/`,
      );
    }

    const loader = new GLTFLoader();
    loader.register(
      (parser) =>
        new VRMLoaderPlugin(parser, {
          lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
        }),
    );

    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;

    if (!vrm) {
      throw new Error("Loaded GLTF does not contain VRM data");
    }

    vrm.scene.name = "VRMRoot";
    VRMUtils.rotateVRM0(vrm);

    this.mixer = new THREE.AnimationMixer(vrm.scene);

    // Configure lookAt target.
    // VRMLookAtSmoother uses `target` as the animation-driven direction
    // and `userTarget` for smooth damped user-facing tracking.
    // Both point to the same camera-child Object3D — the idle animation's
    // lookAt track (if any) is intentionally excluded from the clip so
    // it does not interfere with the gaze system.
    if (vrm.lookAt) {
      vrm.lookAt.target = this.lookAtTarget;
      if (vrm.lookAt instanceof VRMLookAtSmoother) {
        vrm.lookAt.userTarget = this.lookAtTarget;
      }
    }

    this.vrm = vrm;

    // Load VRMA idle animation (non-blocking — avatar is usable immediately)
    this.loadIdleAnimation().catch((e: unknown) => {
      console.warn("[AvatarLoader] Idle animation not available:", e);
    });

    return vrm;
  }

  /**
   * Loads idle_loop.vrma and plays it on the mixer in a loop.
   *
   * The clip is built from humanoid rotation tracks only
   * (via createHumanoidTracks, which excludes expression and lookAt
   * tracks by API design):
   * - lookAt tracks excluded (VRMLookAtSmoother owns head/eye direction)
   * - hips translation excluded (scale mismatch causes vertical drift)
   * - expression tracks excluded (ChatVrmAvatarRuntime is the sole
   *   owner of blink, default face, emote, and lip sync expressions)
   */
  private async loadIdleAnimation(): Promise<void> {
    if (!this.vrm || !this.mixer) return;

    const url = `${import.meta.env.BASE_URL}animations/idle_loop.vrma`;
    const vrmAnimation = await loadVRMAnimation(url);

    // Guard: avatar may have been disposed or replaced during fetch
    if (!vrmAnimation || this._disposed || !this.vrm || !this.mixer) return;

    const tracks = vrmAnimation
      .createHumanoidTracks(this.vrm)
      .filter((t) => !t.name.endsWith(".position"));

    if (tracks.length === 0) return;

    // Remove the t=0 rotational bias from every quaternion track so the
    // idle motion oscillates around the model's rest pose (identity),
    // not around an arbitrary offset baked into the VRMA file.
    // Critical for gaze studies: prevents a ~9° cumulative yaw offset
    // through the spine/neck chain that would skew perceived gaze direction.
    for (const track of tracks) {
      if (!track.name.endsWith(".quaternion")) continue;
      const v = track.values;
      if (v.length < 4) continue;
      // First keyframe quaternion = the bias to remove
      const bx = v[0], by = v[1], bz = v[2], bw = v[3];
      // Inverse (conjugate of unit quaternion)
      const ix = -bx, iy = -by, iz = -bz, iw = bw;
      // Premultiply every keyframe: q' = inv(bias) * q
      for (let i = 0; i < v.length; i += 4) {
        const qx = v[i], qy = v[i + 1], qz = v[i + 2], qw = v[i + 3];
        v[i]     = iw * qx + ix * qw + iy * qz - iz * qy;
        v[i + 1] = iw * qy - ix * qz + iy * qw + iz * qx;
        v[i + 2] = iw * qz + ix * qy - iy * qx + iz * qw;
        v[i + 3] = iw * qw - ix * qx - iy * qy - iz * qz;
      }
    }

    const clip = new THREE.AnimationClip(
      "idle_loop",
      vrmAnimation.duration,
      tracks,
    );
    const action = this.mixer.clipAction(clip);
    action.timeScale = 0.75;
    action.play();
    this.idleAction = action;
  }

  /**
   * Loads animations/angry.vrma (lazily, once) and returns the built clip.
   * Reuses createHumanoidTracks the same way as the idle clip, but does
   * NOT strip the t=0 rotational bias — that correction exists only to
   * stop yaw drift from accumulating across an infinitely looping idle
   * clip; a one-shot reaction should keep its authored starting pose.
   */
  private loadAngryClip(): Promise<THREE.AnimationClip | null> {
    if (!this.angryClipPromise) {
      this.angryClipPromise = (async () => {
        if (!this.vrm) return null;
        const url = `${import.meta.env.BASE_URL}animations/angry.vrma`;
        const vrmAnimation = await loadVRMAnimation(url);
        if (!vrmAnimation || this._disposed || !this.vrm) return null;

        const tracks = vrmAnimation
          .createHumanoidTracks(this.vrm)
          .filter((t) => !t.name.endsWith(".position"));
        if (tracks.length === 0) return null;

        return new THREE.AnimationClip("angry", vrmAnimation.duration, tracks);
      })();
    }
    return this.angryClipPromise;
  }

  /**
   * Plays the angry.vrma reaction once, crossfading out of the idle loop
   * and back into it when the reaction finishes. No-op if the clip fails
   * to load or the avatar has since been disposed/replaced.
   */
  async playAngryReaction(): Promise<void> {
    if (!this.mixer || !this.vrm) return;
    const clip = await this.loadAngryClip();
    if (!clip || this._disposed || !this.mixer) return;

    const mixer = this.mixer;
    const idleAction = this.idleAction;

    if (this.angryFinishedListener) {
      mixer.removeEventListener("finished", this.angryFinishedListener);
      this.angryFinishedListener = null;
    }

    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    action.play();

    if (idleAction) {
      idleAction.crossFadeTo(action, 0.25, false);
    }

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return;
      mixer.removeEventListener("finished", onFinished);
      this.angryFinishedListener = null;
      if (idleAction && !this._disposed) {
        action.crossFadeTo(idleAction, 0.4, false);
      }
    };
    this.angryFinishedListener = onFinished;
    mixer.addEventListener("finished", onFinished);
  }

  /** Disposes the currently loaded VRM and frees GPU resources. */
  dispose(): void {
    this._disposed = true;
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene);
      this.vrm = null;
    }
    this.mixer = null;
  }

  /** Per-frame update — call from the render loop. */
  update(delta: number): void {
    this.mixer?.update(delta);
    this.vrm?.update(delta);
  }
}
