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

/** Loose threshold for "participant is looking at this target". */
const ACQUIRE_THRESHOLD = 0.12;

/** Short hold before the measurement window begins (ms). */
const SETTLE_MS = 300;

/** Fixed sampling window used for the accuracy measurement (ms). */
const MEASUREMENT_WINDOW_MS = 1000;

/** Maximum average deviation that still counts as a passed point. */
const PASS_THRESHOLD = 0.05;

/** Require a small minimum sample count so one lucky frame cannot pass. */
const MIN_SAMPLE_COUNT = 15;

interface PointState {
  x: number;
  y: number;
  passed: boolean;
  attempts: number;
  el: HTMLElement;
  fillEl: HTMLElement;
}

type MeasurementPhase = "acquire" | "settle" | "measure";

/**
 * Renders a gaze validation step: shows 3 target points, a visible gaze
 * cursor, and measures how accurately the participant can fixate each
 * highlighted point before the study begins.
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
  h.textContent = step.title ?? "Gaze Validation";
  wrapper.appendChild(h);

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

    return { x: t.x, y: t.y, passed: false, attempts: 0, el, fillEl: fill };
  });

  // --- Progress ---
  const progressEl = document.createElement("p");
  progressEl.className = "calibration-progress";
  progressEl.textContent = "0 / 3 points validated — Look at the highlighted point to start.";
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
  skipBtn.textContent = "Skip validation";
  wrapper.appendChild(skipBtn);

  // --- State ---
  let currentIdx = 0;
  let animId: number | null = null;
  let done = false;
  let phase: MeasurementPhase = "acquire";
  let attemptStartTime = 0;
  let phaseStartTime = 0;
  let sampleCount = 0;
  let sampleSumX = 0;
  let sampleSumY = 0;

  // --- Gaze provider selection (with live data probe, same as ConversationStepController) ---
  let gazeProvider: GazeProvider;
  let gazeType: "mouse" | "backend";

  function round(value: number, digits: number): number {
    return Number(value.toFixed(digits));
  }

  function updateProgress(message: string): void {
    const passedCount = points.filter((p) => p.passed).length;
    progressEl.textContent = `${passedCount} / ${points.length} points validated — ${message}`;
  }

  function resetMeasurementStats(): void {
    sampleCount = 0;
    sampleSumX = 0;
    sampleSumY = 0;
  }

  function startAttempt(now: number): void {
    const pt = points[currentIdx];
    pt.fillEl.style.transform = "scale(0)";
    phase = "acquire";
    attemptStartTime = now;
    phaseStartTime = now;
    resetMeasurementStats();
    updateProgress(`Point ${currentIdx + 1}: look at the highlighted point to start.`);
    callbacks.emitEvent?.("study.calibration_point_started", {
      step_id: step.id,
      point_index: currentIdx,
      target_x: round(pt.x, 4),
      target_y: round(pt.y, 4),
      attempt: pt.attempts + 1,
      gaze_source: gazeType,
    });
  }

  function activatePoint(index: number, now: number): void {
    for (const pt of points) {
      pt.el.classList.remove("active");
    }
    currentIdx = index;
    points[currentIdx].el.classList.add("active");
    startAttempt(now);
  }

  function finish(skipped: boolean): void {
    done = true;
    cursor.style.display = "none";
    successEl.textContent = skipped
      ? "Validation skipped. You can continue, but gaze-based behavior may be less reliable."
      : "Gaze validation complete. You can continue to the study.";
    successEl.style.display = "";
    nextBtn.disabled = false;
    skipBtn.style.display = "none";
    restartBtn.style.display = "";

    if (skipped) {
      for (const pt of points) {
        if (!pt.passed) pt.el.classList.add("skipped");
      }
      callbacks.emitEvent?.("study.calibration_skipped", {
        step_id: step.id,
        passed_points: points.filter((pt) => pt.passed).length,
        total_points: points.length,
      });
    } else {
      callbacks.emitEvent?.("study.calibration_completed", {
        step_id: step.id,
        total_points: points.length,
        total_attempts: points.reduce((sum, pt) => sum + pt.attempts, 0),
      });
    }
  }

  function initMouse(): void {
    gazeProvider = new MouseProvider(area);
    gazeType = "mouse";
    sourceEl.textContent = "Tracking source: Mouse (demo mode)";
    activatePoint(0, performance.now());
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

        activatePoint(0, performance.now());
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
    if (animId !== null) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    currentIdx = 0;
    cursor.style.display = "";
    successEl.style.display = "none";
    nextBtn.disabled = true;
    restartBtn.style.display = "none";
    skipBtn.style.display = "";

    for (const pt of points) {
      pt.passed = false;
      pt.attempts = 0;
      pt.fillEl.style.transform = "scale(0)";
      pt.el.classList.remove("active", "passed", "skipped");
    }
    activatePoint(0, performance.now());
    animId = requestAnimationFrame(tick);
  };

  // --- Restart button (hidden until verification finishes) ---
  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.className = "calibration-restart";
  restartBtn.textContent = "Restart validation";
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

    // Validation flow on current point
    if (currentIdx >= points.length) return;
    const pt = points[currentIdx];
    const dx = gaze.x - pt.x;
    const dy = gaze.y - pt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const now = performance.now();
    const isNearTarget = dist < ACQUIRE_THRESHOLD;
    cursor.classList.toggle("intersecting", isNearTarget);

    if (phase === "acquire") {
      if (isNearTarget) {
        phase = "settle";
        phaseStartTime = now;
        updateProgress(`Point ${currentIdx + 1}: hold your gaze steady.`);
      }
      return;
    }

    if (phase === "settle") {
      if (!isNearTarget) {
        phase = "acquire";
        phaseStartTime = now;
        pt.fillEl.style.transform = "scale(0)";
        updateProgress(`Point ${currentIdx + 1}: look at the highlighted point to start.`);
        return;
      }

      const settleRatio = Math.min((now - phaseStartTime) / SETTLE_MS, 1);
      pt.fillEl.style.transform = `scale(${0.2 + settleRatio * 0.2})`;

      if (now - phaseStartTime >= SETTLE_MS) {
        phase = "measure";
        phaseStartTime = now;
        resetMeasurementStats();
        updateProgress(`Point ${currentIdx + 1}: measuring... keep looking at the point.`);
      }
      return;
    }

    sampleCount++;
    sampleSumX += gaze.x;
    sampleSumY += gaze.y;

    const measureRatio = Math.min((now - phaseStartTime) / MEASUREMENT_WINDOW_MS, 1);
    pt.fillEl.style.transform = `scale(${0.4 + measureRatio * 0.6})`;

    if (now - phaseStartTime < MEASUREMENT_WINDOW_MS) {
      return;
    }

    pt.attempts++;
    const avgX = sampleCount > 0 ? sampleSumX / sampleCount : NaN;
    const avgY = sampleCount > 0 ? sampleSumY / sampleCount : NaN;
    const error = Number.isFinite(avgX) && Number.isFinite(avgY)
      ? Math.sqrt((avgX - pt.x) ** 2 + (avgY - pt.y) ** 2)
      : NaN;
    const passed = sampleCount >= MIN_SAMPLE_COUNT &&
      Number.isFinite(error) &&
      error <= PASS_THRESHOLD;

    callbacks.emitEvent?.("study.calibration_point_measured", {
      step_id: step.id,
      point_index: currentIdx,
      attempt: pt.attempts,
      gaze_source: gazeType,
      target_x: round(pt.x, 4),
      target_y: round(pt.y, 4),
      avg_x: Number.isFinite(avgX) ? round(avgX, 4) : null,
      avg_y: Number.isFinite(avgY) ? round(avgY, 4) : null,
      error_norm: Number.isFinite(error) ? round(error, 4) : null,
      sample_count: sampleCount,
      acquire_ms: round(phaseStartTime - attemptStartTime - SETTLE_MS, 1),
      measurement_window_ms: MEASUREMENT_WINDOW_MS,
      passed,
    });

    if (passed) {
      pt.passed = true;
      pt.el.classList.remove("active");
      pt.el.classList.add("passed");

      if (currentIdx < points.length - 1) {
        activatePoint(currentIdx + 1, now);
      } else {
        updateProgress("All points validated.");
        finish(false);
      }
      return;
    }

    phase = "acquire";
    attemptStartTime = now;
    phaseStartTime = now;
    pt.fillEl.style.transform = "scale(0)";
    updateProgress(`Point ${currentIdx + 1}: accuracy was too low. Please try again.`);
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
