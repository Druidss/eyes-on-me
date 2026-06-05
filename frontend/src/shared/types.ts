/**
 * TypeScript interfaces matching the backend StudyConfig schemas.
 *
 * Key relationships:
 * - StudyConfig is the top-level study definition loaded from JSON files.
 * - RuntimeInfo describes the current backend environment (capabilities,
 *   log mode, effective capture flags).  It is fetched once at startup and
 *   passed through the app to drive feature gates and consent disclosure.
 * - EffectiveCapture (nested in RuntimeInfo) lists exactly which data
 *   categories the backend will persist for this session, derived from
 *   log_mode + enabled integrations (see Settings.effective_capture()).
 * - ResolvedStudyAssignment is the session-scoped assignment generated
 *   from StudyConfig.meta.assignment policy (condition order, question
 *   shuffling).  It pins the concrete round sequence for one participant.
 */

export type LogMode = "default" | "research";

export interface EffectiveCapture {
  session_metadata: boolean;
  questionnaire_answers: boolean;
  form_answers: boolean;
  transcripts: boolean;
  gaze_samples: boolean;
  gaze_tobii_raw: boolean;
  speaking_states: boolean;
  operator_notes_persisted: boolean;
  audio_sent_to_openai: boolean;
}

export interface RuntimeInfo {
  env: string;
  log_mode: LogMode;
  capabilities: {
    openai_realtime_enabled: boolean;
    tobii_enabled: boolean;
    tobii_connected: boolean;
  };
  effective_capture: EffectiveCapture;
  /** Gaze sample rate for research mode (Hz). Only present when log_mode is "research". */
  research_gaze_sample_hz?: number;
}

export type ConditionOrderMode = "fixed" | "counterbalanced" | "random";
export type QuestionOrderMode = "fixed" | "shuffle";

export interface AssignmentPolicy {
  condition_order_mode: ConditionOrderMode;
  fixed_condition_order?: string[];
  question_order_mode: QuestionOrderMode;
}

export interface StudyMeta {
  id: string;
  version: string;
  name: string;
  description: string;
  study_mode: string;
  conditions: string[];
  questions_per_condition: number;
  assignment: AssignmentPolicy;
}

export interface FormField {
  id: string;
  type: string;
  label: string;
  options?: string[];
  required: boolean;
  min?: number;
  max?: number;
}

export interface FlowStep {
  id: string;
  type:
    | "info"
    | "consent"
    | "form"
    | "calibration"
    | "avatar_selection"
    | "conversation"
    | "questionnaire";
  title?: string;
  content?: string;
  content_blocks?: string[];
  button_label?: string;
  consent_label?: string;
  fields?: FormField[];
  condition?: string;
  questionnaire_id?: string;
  /** Max duration in seconds for conversation steps. Timer counts up; auto-advances when reached. */
  duration_seconds?: number;
}

export interface Flow {
  steps: FlowStep[];
}

export interface Avatar {
  id: string;
  label: string;
  model_file: string;
  voice: string;
  thumbnail?: string;
}

export interface Avatars {
  avatars: Avatar[];
}

export interface QuestionnaireItem {
  id: string;
  text: string;
  type: "likert" | "choice" | "text";
  scale_min?: number;
  scale_max?: number;
  scale_labels?: string[];
  options?: string[];
  required: boolean;
}

export interface Questionnaire {
  title: string;
  instruction: string;
  items: QuestionnaireItem[];
}

export interface Questionnaires {
  questionnaires: Record<string, Questionnaire>;
}

export interface QuizQuestion {
  id: string;
  text: string;
}

export interface QuizPrompt {
  system_base: string;
  system_end: string;
  questions: QuizQuestion[];
}

export interface Prompts {
  quiz: QuizPrompt;
}

export interface GazeProfile {
  states: string[];
  pending_time_ms: number;
  mutual_time_ms: number;
  break_time_ms: number;
  lose_debounce_ms: number;
}

export interface GazeProfiles {
  profiles: Record<string, GazeProfile>;
}

export interface StudyConfig {
  meta: StudyMeta;
  flow: Flow;
  avatars: Avatars;
  questionnaires: Questionnaires;
  prompts: Prompts;
  gaze_profiles: GazeProfiles;
}

// --- Session metadata (experimenter start screen) ---

export interface SessionMetadata {
  participant_id: string;
  trial_id?: string;
  session_label?: string;
  operator_notes?: string;
}

// --- Resolved assignment (session-scoped) ---

export interface AssignmentRound {
  round_index: number;
  step_id: string;
  condition: string;
  question_ids: string[];
  questions: string[];
}

export interface ResolvedStudyAssignment {
  session_id: string;
  study_id: string;
  seed: number;
  condition_order: string[];
  rounds: AssignmentRound[];
  questions_per_condition: number;
}
