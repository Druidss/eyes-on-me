import * as THREE from "three";
import { AvatarLoader } from "./AvatarLoader.js";
import { IdleMotionController } from "./IdleMotionController.js";
import { ChatVrmAvatarRuntime } from "./chatvrm/ChatVrmAvatarRuntime.js";

/**
 * Manages the Three.js scene, camera, renderer, and render loop
 * for displaying a VRM avatar.
 */
export class ViewerCore {
  private readonly scene: THREE.Scene;
  private readonly clock: THREE.Clock;
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private lookAtObj: THREE.Object3D | null = null;
  private avatarLoader: AvatarLoader | null = null;
  private idleMotion: IdleMotionController | null = null;
  private runtime: ChatVrmAvatarRuntime | null = null;
  private animationFrameId: number | null = null;
  private _isReady = false;

  constructor() {
    this.scene = new THREE.Scene();

    // Lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight.position.set(1.0, 1.0, 1.0).normalize();
    this.scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    this.clock = new THREE.Clock();
  }

  get isReady(): boolean {
    return this._isReady;
  }

  /** The active camera (null before setup). */
  get activeCamera(): THREE.PerspectiveCamera | null {
    return this.camera;
  }

  /** The Object3D that VRM lookAt tracks. Child of camera. */
  get lookAtTarget(): THREE.Object3D | null {
    return this.lookAtObj;
  }

  /**
   * Sets up the renderer on the given canvas element.
   * Call once after the canvas is attached to the DOM.
   */
  setup(canvas: HTMLCanvasElement): void {
    const parent = canvas.parentElement;
    const width = parent?.clientWidth ?? canvas.width;
    const height = parent?.clientHeight ?? canvas.height;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera = new THREE.PerspectiveCamera(20.0, width / height, 0.1, 20.0);
    this.camera.position.set(0, 1.5, 2.15);

    // Dedicated lookAt target — child of camera so offsets are camera-local
    this.lookAtObj = new THREE.Object3D();
    this.camera.add(this.lookAtObj);

    window.addEventListener("resize", this.handleResize);

    this._isReady = true;
    this.clock.start();
    this.renderLoop();
  }

  /**
   * Loads and displays a VRM avatar from the given URL.
   * Replaces any previously loaded avatar.
   */
  async loadAvatar(url: string): Promise<void> {
    if (!this.camera) {
      throw new Error("Call setup() before loadAvatar()");
    }

    // Unload previous
    if (this.avatarLoader) {
      this.unloadAvatar();
    }

    this.avatarLoader = new AvatarLoader(this.lookAtObj!);
    const vrm = await this.avatarLoader.load(url);

    // Disable frustum culling for VRM
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    this.scene.add(vrm.scene);
    this.idleMotion = new IdleMotionController(vrm);
    this.runtime = new ChatVrmAvatarRuntime(vrm);
    this.resetCamera();
  }

  /** Removes the current avatar from the scene. */
  unloadAvatar(): void {
    this.runtime?.dispose();
    this.runtime = null;

    this.idleMotion?.dispose();
    this.idleMotion = null;

    if (this.avatarLoader?.vrm) {
      this.scene.remove(this.avatarLoader.vrm.scene);
      this.avatarLoader.dispose();
    }
    this.avatarLoader = null;
  }

  /** The currently loaded AvatarLoader instance (if any). */
  get avatar(): AvatarLoader | null {
    return this.avatarLoader;
  }

  /** Set a temporary emote expression on the avatar. No-op without avatar. */
  setEmote(name: string): void {
    this.runtime?.setEmote(name);
  }

  /** Clear any active emote, return to default expression. */
  clearEmote(): void {
    this.runtime?.clearEmote();
  }

  /** Load an image as the Three.js scene background. */
  setBackground(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          this.scene.background = texture;
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  /** Connect a WebRTC MediaStream for lip sync. No-op without avatar. */
  attachLipSyncStream(stream: MediaStream): void {
    this.runtime?.attachLipSyncStream(stream);
  }

  /** Disconnect lip sync audio. Idempotent. */
  detachLipSync(): void {
    this.runtime?.detachLipSync();
  }

  /** Tears down the viewer: stops loop, disposes renderer/avatar. */
  destroy(): void {
    window.removeEventListener("resize", this.handleResize);

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.unloadAvatar();
    this.renderer?.dispose();
    this.renderer = null;
    this.lookAtObj = null;
    this.camera = null;
    this._isReady = false;
  }

  // --- Internal ---

  private renderLoop = (): void => {
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
    const delta = this.clock.getDelta();

    // ChatVRM runtime: blink, expression, lip sync (before vrm.update)
    this.runtime?.update(delta);
    // AvatarLoader: mixer (idle animation) + vrm.update (applies expressions + lookAt)
    this.avatarLoader?.update(delta);
    // Arm rest pose (after vrm.update resets raw bones)
    this.idleMotion?.postUpdate();

    if (this.renderer && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }

    // Revert VRMLookAtSmoother head bone rotation after render
    this.runtime?.postUpdate();
  };

  private handleResize = (): void => {
    if (!this.renderer || !this.camera) return;
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private resetCamera(): void {
    const headNode = this.avatarLoader?.vrm?.humanoid?.getNormalizedBoneNode("head");
    if (headNode && this.camera) {
      const headPos = headNode.getWorldPosition(new THREE.Vector3());
      this.camera.position.set(this.camera.position.x, headPos.y, this.camera.position.z);
    }
  }
}
