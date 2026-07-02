import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { GazePoint } from "./GazeProvider.js";

/** Dimensions and position of the face bounding box relative to the head bone. */
export interface BoundingBoxConfig {
  width: number;
  height: number;
  depth: number;
  /** Extra screen-space padding in pixels. */
  padding: number;
  /** Offset relative to head bone origin. */
  position: { x: number; y: number; z: number };
}

/** Fallback defaults when no VRM bones are available (metres). */
const FALLBACK_CONFIG: BoundingBoxConfig = {
  width: 0.16,
  height: 0.07,
  depth: 0.18,
  padding: 15,
  position: { x: 0, y: 0.055, z: 0.015 },
};

/**
 * Derives the face bounding box from the VRM model's eye and head bones.
 *
 * Uses leftEye + rightEye world positions relative to the head bone to
 * determine width, height, and center offset. Falls back to hardcoded
 * defaults when eye bones are not available.
 */
function configFromVRM(vrm: VRM): BoundingBoxConfig {
  const h = vrm.humanoid;
  if (!h) return { ...FALLBACK_CONFIG };

  const headNode = h.getNormalizedBoneNode("head");
  const leftEyeNode = h.getNormalizedBoneNode("leftEye");
  const rightEyeNode = h.getNormalizedBoneNode("rightEye");

  if (!headNode || !leftEyeNode || !rightEyeNode) {
    console.warn("[IntersectionEngine] Eye bones not found, using fallback bbox");
    return { ...FALLBACK_CONFIG };
  }

  vrm.scene.updateMatrixWorld(true);

  const leftEyeWorld = leftEyeNode.getWorldPosition(new THREE.Vector3());
  const rightEyeWorld = rightEyeNode.getWorldPosition(new THREE.Vector3());

  // Eye positions in head-local space
  const headInv = new THREE.Matrix4().copy(headNode.matrixWorld).invert();
  const leftLocal = leftEyeWorld.clone().applyMatrix4(headInv);
  const rightLocal = rightEyeWorld.clone().applyMatrix4(headInv);

  const eyeCenterLocal = leftLocal.clone().add(rightLocal).multiplyScalar(0.5);
  const eyeSeparation = leftLocal.distanceTo(rightLocal);

  // Face proportions derived from eye geometry:
  // - Width: ~4.5x eye separation (full face width)
  // - Height: ~2x eye separation (forehead to chin)
  // - Depth: ~4x eye separation (face has depth)
  const width = eyeSeparation * 4.5;
  const height = eyeSeparation * 2.0;
  const depth = eyeSeparation * 4.0;

  // Center the box on the eye midpoint
  const position = {
    x: eyeCenterLocal.x,
    y: eyeCenterLocal.y,
    z: eyeCenterLocal.z,
  };

  console.debug(
    `[IntersectionEngine] VRM bbox: eyeSep=${eyeSeparation.toFixed(4)}m, ` +
    `w=${width.toFixed(4)} h=${height.toFixed(4)} d=${depth.toFixed(4)}, ` +
    `offset=(${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`,
  );

  return { width, height, depth, padding: 35, position };
}

/**
 * Tests whether a gaze point intersects the projected face bounding box
 * of a VRM avatar's head bone.
 *
 * Stateless per frame — call {@link test} from any animation loop.
 */
export class IntersectionEngine {
  private readonly config: BoundingBoxConfig;

  // Pre-allocated vectors to avoid GC pressure in hot loop
  private readonly corners: THREE.Vector3[] = Array.from(
    { length: 8 },
    () => new THREE.Vector3(),
  );
  private readonly projected = new THREE.Vector3();

  constructor(config?: Partial<BoundingBoxConfig>) {
    this.config = { ...FALLBACK_CONFIG, ...config };
  }

  /** Create an IntersectionEngine with config derived from a VRM model. */
  static fromVRM(vrm: VRM): IntersectionEngine {
    return new IntersectionEngine(configFromVRM(vrm));
  }

  /**
   * Returns `true` when the normalised gaze point [0,1] falls inside the
   * screen-projected face bounding box (plus padding).
   */
  test(
    gaze: GazePoint,
    headBone: THREE.Object3D,
    camera: THREE.Camera,
    canvasWidth: number,
    canvasHeight: number,
  ): boolean {
    const { width, height, depth, padding, position } = this.config;
    const hw = width / 2;
    const hh = height / 2;
    const hd = depth / 2;

    // Build 8 corners of the bounding box in head-local space
    let idx = 0;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          this.corners[idx++].set(
            sx * hw + position.x,
            sy * hh + position.y,
            sz * hd + position.z,
          );
        }
      }
    }

    // Project each corner to normalised [0,1] screen coords and accumulate AABB
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const corner of this.corners) {
      this.projected.copy(corner).applyMatrix4(headBone.matrixWorld);
      this.projected.project(camera);

      // NDC (-1..1) → normalised (0..1), y-flipped
      const nx = (this.projected.x + 1) / 2;
      const ny = (1 - this.projected.y) / 2;

      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      if (ny < minY) minY = ny;
      if (ny > maxY) maxY = ny;
    }

    // Apply padding converted to normalised units
    const padX = padding / canvasWidth;
    const padY = padding / canvasHeight;
    minX -= padX;
    minY -= padY;
    maxX += padX;
    maxY += padY;

    return gaze.x >= minX && gaze.x <= maxX && gaze.y >= minY && gaze.y <= maxY;
  }
}
