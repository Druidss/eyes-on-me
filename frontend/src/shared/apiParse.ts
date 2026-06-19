/**
 * Lightweight runtime guards for API responses.
 * Replaces unsafe `as` casts with basic shape validation.
 * No external dependencies — just plain checks.
 */

import type { RuntimeInfo, EffectiveCapture, StudyConfig, ResolvedStudyAssignment } from "./types.js";

// -- helpers --

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireFields(
  obj: Record<string, unknown>,
  fields: string[],
  label: string,
): void {
  for (const f of fields) {
    if (!(f in obj)) {
      throw new Error(`Invalid ${label}: missing field "${f}"`);
    }
  }
}

// -- guards --

/** Validates and returns a RuntimeInfo from raw JSON. */
export function parseRuntimeInfo(data: unknown): RuntimeInfo {
  if (!isObject(data)) {
    throw new Error("Invalid runtime response: expected JSON object");
  }
  requireFields(data, ["env", "capabilities"], "runtime response");

  const caps = data.capabilities;
  if (!isObject(caps)) {
    throw new Error(
      "Invalid runtime response: capabilities is not an object",
    );
  }

  const rawMode = typeof data.log_mode === "string" ? data.log_mode : "default";
  const log_mode = rawMode === "research" ? "research" : "default";

  const rawCapture = isObject(data.effective_capture) ? data.effective_capture : {};
  const ec: EffectiveCapture = {
    session_metadata: Boolean(rawCapture.session_metadata),
    questionnaire_answers: Boolean(rawCapture.questionnaire_answers),
    form_answers: Boolean(rawCapture.form_answers),
    transcripts: Boolean(rawCapture.transcripts),
    gaze_samples: Boolean(rawCapture.gaze_samples),
    gaze_tobii_raw: Boolean(rawCapture.gaze_tobii_raw),
    speaking_states: Boolean(rawCapture.speaking_states),
    operator_notes_persisted: Boolean(rawCapture.operator_notes_persisted),
    audio_sent_to_openai: Boolean(rawCapture.audio_sent_to_openai),
  };

  const info: RuntimeInfo = {
    env: String(data.env),
    log_mode,
    capabilities: {
      openai_realtime_enabled: Boolean(caps.openai_realtime_enabled),
      tobii_enabled: Boolean(caps.tobii_enabled),
      tobii_connected: Boolean(caps.tobii_connected),
    },
    effective_capture: ec,
  };

  if (
    log_mode === "research" &&
    typeof data.research_gaze_sample_hz === "number" &&
    data.research_gaze_sample_hz > 0
  ) {
    info.research_gaze_sample_hz = data.research_gaze_sample_hz;
  }

  return info;
}

/** Validates and returns a session_id from the session creation response. */
export function parseSessionId(data: unknown): string {
  if (!isObject(data)) {
    throw new Error("Invalid session response: expected JSON object");
  }
  if (typeof data.session_id !== "string" || !data.session_id) {
    throw new Error(
      "Invalid session response: missing or empty session_id",
    );
  }
  return data.session_id;
}

/** Validates top-level structure of a StudyConfig from raw JSON. */
export function parseStudyConfig(data: unknown): StudyConfig {
  if (!isObject(data)) {
    throw new Error("Invalid study config: expected JSON object");
  }
  requireFields(
    data,
    ["meta", "flow", "avatars", "questionnaires", "prompts", "gaze_profiles"],
    "study config",
  );

  const flow = data.flow;
  if (!isObject(flow) || !Array.isArray(flow.steps)) {
    throw new Error("Invalid study config: flow.steps must be an array");
  }

  const avatars = data.avatars;
  if (!isObject(avatars) || !Array.isArray(avatars.avatars)) {
    throw new Error("Invalid study config: avatars.avatars must be an array");
  }

  // dialogue_scripts is optional on the wire — most studies have none.
  // Backend fills an empty collection when dialogue_scripts.json is
  // absent, but older cached configs or the static demo snapshot may
  // not have the key at all.
  if (!isObject(data.dialogue_scripts)) {
    (data as Record<string, unknown>).dialogue_scripts = { scripts: {} };
  }

  // Assignment policy: fill default when absent, strict when present
  const meta = data.meta;
  if (isObject(meta)) {
    if (!meta.assignment) {
      // Config without assignment block — derive from conditions
      (meta as Record<string, unknown>).assignment = {
        condition_order_mode: "fixed",
        fixed_condition_order: meta.conditions,
        question_order_mode: "fixed",
      };
    }
    // No silent fill when assignment IS present — backend validates strictly
  }

  // Backend validates the full schema — we check the critical shape here
  return data as unknown as StudyConfig;
}

/** Validates and returns a ResolvedStudyAssignment from raw JSON. */
export function parseAssignment(data: unknown): ResolvedStudyAssignment {
  if (!isObject(data)) {
    throw new Error("Invalid assignment response: expected JSON object");
  }
  requireFields(
    data,
    ["session_id", "study_id", "seed", "condition_order", "rounds", "questions_per_condition"],
    "assignment response",
  );
  if (!Array.isArray(data.rounds)) {
    throw new Error("Invalid assignment response: rounds must be an array");
  }
  return data as unknown as ResolvedStudyAssignment;
}

/** Validates and returns the SDP answer string from a realtime response. */
export function parseSdpAnswer(data: unknown): string {
  if (!isObject(data)) {
    throw new Error("Invalid realtime response: expected JSON object");
  }
  if (typeof data.sdp_answer !== "string" || !data.sdp_answer) {
    throw new Error(
      "Invalid realtime response: missing or empty sdp_answer",
    );
  }
  return data.sdp_answer;
}

/** Extracts a detail message from an error response body, or returns fallback. */
export function parseErrorDetail(
  data: unknown,
  fallback: string,
): string {
  if (isObject(data) && typeof data.detail === "string") {
    return data.detail;
  }
  return fallback;
}
