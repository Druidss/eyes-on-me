/**
 * Application entry point.  Orchestrates the startup sequence:
 * runtime detection → study config load → experimenter start screen →
 * session creation → assignment resolution → StudyFlow launch.
 *
 * In demo mode (?demo query param) every backend call is replaced with
 * local stubs so the app works without a running backend.
 */
import { fetchRuntime } from "./runtime.js";
import { createAppSession } from "./session.js";
import { isDemoMode, demoRuntime, fetchDemoStudyConfig } from "./demoMode.js";
import { fetchStudyConfig, StudyFlow } from "../modules/study/StudyFlow.js";
import { generateLocalAssignment, fetchAssignment } from "../modules/study/assignment.js";
import { showExperimentStartScreen } from "../modules/study/ExperimentStartScreen.js";

const STUDY_ID = "demo-study";

export async function bootstrap(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    throw new Error("Missing #app element");
  }

  const demoMode = isDemoMode();

  // Loading state
  app.innerHTML = `<p class="study-status">Loading${demoMode ? " (demo mode)" : ""}…</p>`;

  // --- Runtime ---
  let runtime;
  if (demoMode) {
    runtime = demoRuntime();
  } else {
    try {
      runtime = await fetchRuntime();
    } catch {
      app.innerHTML = `<p class="study-status study-error">Backend not reachable. Please start the backend first.</p>`;
      return;
    }
  }

  // --- Study config ---
  let config;
  try {
    config = demoMode
      ? await fetchDemoStudyConfig()
      : await fetchStudyConfig(STUDY_ID);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.innerHTML = `<p class="study-status study-error">Failed to load study: ${escapeHtml(message)}</p>`;
    return;
  }

  // --- Experimenter start screen (skip in demo mode) ---
  const metadata = demoMode
    ? { participant_id: `demo-${Date.now()}` }
    : await showExperimentStartScreen(app, config, runtime);

  // --- Session ---
  let sessionId: string;
  if (demoMode) {
    sessionId = crypto.randomUUID();
  } else {
    try {
      sessionId = await createAppSession(metadata);
    } catch {
      sessionId = crypto.randomUUID();
    }
  }

  // --- Assignment + StudyFlow ---
  try {
    const assignment = demoMode
      ? generateLocalAssignment(config, sessionId)
      : await fetchAssignment(sessionId, STUDY_ID);

    const flow = new StudyFlow(app, config, runtime, sessionId, assignment, { demoMode });
    flow.start();

    // Best-effort final telemetry flush on page unload
    window.addEventListener("pagehide", () => { flow.destroy(); });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.innerHTML = `<p class="study-status study-error">Failed to load study: ${escapeHtml(message)}</p>`;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
