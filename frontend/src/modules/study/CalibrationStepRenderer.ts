import type { FlowStep, RuntimeInfo } from "../../shared/types.js";
import type { GazeProvider } from "../gaze/GazeProvider.js";
import { MouseProvider } from "../gaze/MouseProvider.js";
import { BackendGazeProvider } from "../gaze/BackendGazeProvider.js";
import { apiBase } from "../../shared/apiBase.js";
import type { StepCallbacks } from "./stepRenderers.js";

/** Target positions (normalized [0,1] within the calibration area). */
const TARGETS = [
  { x: 0.5, y: 0.12 },  // top center
  { x: 0.12, y: 0.85 }, // bottom left
  { x: 0.88, y: 0.85 }, // bottom right
];

/** Normalized distance threshold for fixation detection. */
const FIXATION_THRESHOLD = 0.05;

/** Dwell time required to pass a point (ms). */
const FIXATION_DWELL_MS = 800;

interface PointState {
  x: number;
  y: number;
  passed: boolean;
  fixStartTime: number;
  el: HTMLElement;
  fillEl: HTMLElement;
}

/**
 * Renders a gaze verification step: shows 3 target points, a visible gaze
 * cursor, and detects fixation to verify that gaze tracking works before
 * the study begins.
 *
 * Returns a cleanup function that stops the gaze provider and animation loop.
 */
export function renderCalibrationStep(
  wrapper: HTMLElement,
  step: FlowStep,
  runtime: RuntimeInfo,
  callbacks: StepCallbacks,
): () => void {
  // --- Header ---
  const h = document.createElement("h2");
  h.textContent = step.title ?? "Gaze Verification";
  wrapper.appendChild(h);

  const desc = document.createElement("p");
  desc.textContent =
    "Please look at each highlighted target until it turns green. " +
    "This step checks whether gaze tracking is working well enough for the study.";
  wrapper.appendChild(desc);

  // --- Gaze source label ---
  const sourceEl = document.createElement("p");
  sourceEl.className = "calibration-source";
  wrapper.appendChild(sourceEl);

  // --- Verification area ---
  const area = document.createElement("div");
  area.className = "calibration-area";
  wrapper.appendChild(area);

  // Gaze cursor
  const cursor = document.createElement("div");
  cursor.className = "gaze-cursor";
  area.appendChild(cursor);

  // Status overlay for backend stale data
  const staleOverlay = document.createElement("div");
  staleOverlay.className = "calibration-stale";
  staleOverlay.textContent = "Waiting for eye tracker data\u2026";
  staleOverlay.style.display = "none";
  area.appendChild(staleOverlay);

  // Target points
  const points: PointState[] = TARGETS.map((t, i) => {
    const el = document.createElement("div");
    el.className = "calibration-point";
    if (i === 0) el.classList.add("active");
    el.style.left = `${t.x * 100}%`;
    el.style.top = `${t.y * 100}%`;

    const fill = document.createElement("div");
    fill.className = "calibration-point-fill";
    el.appendChild(fill);

    const num = document.createElement("span");
    num.className = "calibration-point-num";
    num.textContent = String(i + 1);
    el.appendChild(num);

    area.appendChild(el);

    return { x: t.x, y: t.y, passed: false, fixStartTime: 0, el, fillEl: fill };
  });

  // --- Progress ---
  const progressEl = document.createElement("p");
  progressEl.className = "calibration-progress";
  progressEl.textContent = "0 / 3 points verified";
  wrapper.appendChild(progressEl);

  // --- Success message (hidden) ---
  const successEl = document.createElement("p");
  successEl.className = "calibration-success";
  successEl.style.display = "none";
  wrapper.appendChild(successEl);

  // --- Continue button (disabled until done or skipped) ---
  const nextBtn = callbacks.createNextButton();
  nextBtn.disabled = true;
  wrapper.appendChild(nextBtn);

  // --- Skip link ---
  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "calibration-skip";
  skipBtn.textContent = "Skip verification";
  wrapper.appendChild(skipBtn);

  // --- State ---
  let currentIdx = 0;
  let animId: number | null = null;
  let done = false;

  // --- Gaze provider selection (with live data probe, same as ConversationStepController) ---
  let gazeProvider: GazeProvider;
  let gazeType: "mouse" | "backend";

  function initMouse(): void {
    gazeProvider = new MouseProvider(area);
    gazeType = "mouse";
    sourceEl.textContent = "Tracking source: Mouse (demo mode)";
    gazeProvider.start();
    animId = requestAnimationFrame(tick);
  }

  const caps = runtime.capabilities;
  if (caps.tobii_enabled && caps.tobii_connected) {
    // Probe for live gaze data before committing to backend provider
    (async () => {
      let useBackend = false;
      try {
        const res = await fetch(`${apiBase()}/api/gaze/latest`);
        if (res.ok) {
          const data = await res.json();
          if (data.valid) useBackend = true;
        }
      } catch { /* fall through to mouse */ }

      if (done) return; // step already left

      if (useBackend) {
        gazeProvider = new BackendGazeProvider(apiBase());
        gazeType = "backend";
        sourceEl.textContent = "Tracking source: Eye tracker";

        const hint = document.createElement("div");
        hint.className = "calibration-hint";
        hint.textContent =
          "Tip: If gaze tracking seems inaccurate, open the Tobii calibration " +
          "with Ctrl+Shift+Fn+F10, then retry verification.";
        area.appendChild(hint);

        gazeProvider.start();
        animId = requestAnimationFrame(tick);
      } else {
        console.warn("[calibration] Tobii enabled but no gaze data — falling back to mouse.");
        initMouse();
      }
    })();
  } else {
    initMouse();
  }

  const restart = (): void => {
    done = false;
    currentIdx = 0;
    cursor.style.display = "";
    successEl.style.display = "none";
    nextBtn.disabled = true;
    restartBtn.style.display = "none";
    skipBtn.style.display = "";
    progressEl.textContent = "0 / 3 points verified";

    for (const pt of points) {
      pt.passed = false;
      pt.fixStartTime = 0;
      pt.fillEl.style.transform = "scale(0)";
      pt.el.classList.remove("active", "passed", "skipped");
    }
    points[0].el.classList.add("active");

    animId = requestAnimationFrame(tick);
  };

  const finish = (skipped: boolean): void => {
    done = true;
    cursor.style.display = "none";
    successEl.textContent = skipped
      ? "Verification skipped. You can continue, but gaze-based behavior may be less reliable."
      : "Gaze verification complete. You can continue to the study.";
    successEl.style.display = "";
    nextBtn.disabled = false;
    skipBtn.style.display = "none";
    restartBtn.style.display = "";

    if (skipped) {
      for (const pt of points) {
        if (!pt.passed) pt.el.classList.add("skipped");
      }
    }
  };

  // --- Restart button (hidden until verification finishes) ---
  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "calibration-restart";
  restartBtn.textContent = "Restart verification";
  restartBtn.style.display = "none";
  restartBtn.addEventListener("click", restart);
  wrapper.appendChild(restartBtn);

  skipBtn.addEventListener("click", () => finish(true));

  // --- Verification loop ---
  function tick(): void {
    if (done) return;
    animId = requestAnimationFrame(tick);

    // Backend stale data check
    if (
      gazeType === "backend" &&
      gazeProvider instanceof BackendGazeProvider
    ) {
      if (!gazeProvider.lastValid) {
        staleOverlay.style.display = "";
        return;
      }
      staleOverlay.style.display = "none";
    }

    let gaze = gazeProvider.current;

    // Remap screen-normalised gaze [0,1] → container-relative [0,1].
    // Same formula as ConversationStepController: screen px → viewport px → container-relative.
    if (gazeType === "backend") {
      const rect = area.getBoundingClientRect();
      const cssX = gaze.x * screen.width;
      const cssY = gaze.y * screen.height;
      const borderW = (window.outerWidth - window.innerWidth) / 2;
      const chromeH = window.outerHeight - window.innerHeight - borderW;
      gaze = {
        x: (cssX - window.screenX - borderW - rect.left) / rect.width,
        y: (cssY - window.screenY - chromeH - rect.top) / rect.height,
      };
    }

    // Move cursor
    cursor.style.left = `${gaze.x * 100}%`;
    cursor.style.top = `${gaze.y * 100}%`;

    // Fixation check on current point
    if (currentIdx >= points.length) return;
    const pt = points[currentIdx];
    const dx = gaze.x - pt.x;
    const dy = gaze.y - pt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const now = performance.now();

    if (dist < FIXATION_THRESHOLD) {
      cursor.classList.add("intersecting");
      if (pt.fixStartTime === 0) pt.fixStartTime = now;
      const elapsed = now - pt.fixStartTime;
      const ratio = Math.min(elapsed / FIXATION_DWELL_MS, 1);
      pt.fillEl.style.transform = `scale(${ratio})`;

      if (elapsed >= FIXATION_DWELL_MS) {
        pt.passed = true;
        pt.el.classList.remove("active");
        pt.el.classList.add("passed");
        currentIdx++;

        const passedCount = points.filter((p) => p.passed).length;
        progressEl.textContent = `${passedCount} / 3 points verified`;

        if (currentIdx < points.length) {
          points[currentIdx].el.classList.add("active");
        } else {
          finish(false);
        }
      }
    } else {
      cursor.classList.remove("intersecting");
      pt.fixStartTime = 0;
      pt.fillEl.style.transform = "scale(0)";
    }
  }

  // --- Cleanup ---
  return () => {
    done = true;
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    gazeProvider?.stop();
  };
}
