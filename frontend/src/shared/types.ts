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

export interface IntroTactic {
  text: string;
  danger?: boolean;
}

export interface IntroSection {
  num: string;
  title: string;
  alert?: boolean;
  body?: string;
  tactics?: IntroTactic[];
}

/**
 * A single action fired when a TimelineCue triggers.
 *
 * `type` is open-ended on purpose: only "play_audio" is implemented
 * today, but new action types (e.g. "set_expression", "say_line") can
 * be added without touching this interface's shape contract.
 */
export interface TimelineAction {
  type: string;
  // play_audio fields
  src?: string;
  volume?: number;
  loop?: boolean;
}

/**
 * A single fixed-time trigger within a conversation step.
 *
 * `at_seconds` is measured from when the conversation step's timer
 * starts (avatar ready) — the same clock as `duration_seconds`.
 */
export interface TimelineCue {
  id: string;
  at_seconds: number;
  actions: TimelineAction[];
}

/**
 * Generic branching dialogue script — sequential audio+subtitle nodes
 * that advance "when the current line finishes playing" rather than at
 * fixed wall-clock offsets (unlike TimelineCue). Branch nodes consult
 * suspicion state at decision points; safe-window nodes temporarily
 * adjust suspicion gain while a line plays (e.g. NPC looking away).
 *
 * Designed to be script-agnostic: swapping in a different interrogation
 * (or any other branching voice scene) means authoring a new JSON file
 * in this shape, not touching DialogueSequencer's code.
 */
export type DialogueBranchKey = "low" | "high";

export interface DialogueSafeWindow {
  /**
   * Suspicion gain multiplier applied while this node's audio is
   * playing (e.g. 0 = fully suppress gain during a "safe window" where
   * the NPC is looking away). Restored to 1 when the node ends.
   */
  suspicion_multiplier: number;
}

export interface DialogueLineNode {
  id: string;
  kind: "line";
  /** Path relative to `frontend/public/`. */
  audio_src: string;
  /** Subtitle text shown while this line plays. */
  text: string;
  /** Speaker label for the subtitle UI (e.g. "Director Vane"). */
  speaker?: string;
  /** Stage direction / scene note shown above the subtitle, if any. */
  direction?: string;
  /** Suspicion gain adjustment active for the duration of this line. */
  safe_window?: DialogueSafeWindow;
  /** Custom VRMA animation to play when the dialogue line starts. */
  motion?: string;
  /** Whether the custom VRMA animation should loop continuously until the dialogue line ends. */
  motion_loop?: boolean;
  /** Custom delay in milliseconds to wait after the voice line finishes playing before advancing. */
  pause_after_ms?: number;
  /** Next node id. Omit on the script's final node. */
  next?: string;
}

export interface DialogueBranchNode {
  id: string;
  kind: "branch";
  /** Reads the current low/high suspicion split and follows the matching id. */
  branch: Record<DialogueBranchKey, string>;
}

export type DialogueNode = DialogueLineNode | DialogueBranchNode;

export interface DialogueScript {
  id: string;
  /** Id of the first node to play when the script starts. */
  start: string;
  nodes: DialogueNode[];
}

export interface FlowStep {
  id: string;
  type:
    | "hero"
    | "intro"
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
  tagline?: string;
  footer?: string;
  bg_image?: string;
  button_label?: string;
  consent_label?: string;
  fields?: FormField[];
  condition?: string;
  questionnaire_id?: string;
  // Intro (mission briefing) step fields
  class_tag?: string;
  class_meta?: string;
  file_number?: string;
  sections?: IntroSection[];
  order_text?: string;
  agent_name?: string;
  agent_clearance?: string;
  /** Max duration in seconds for conversation steps. Timer counts up; auto-advances when reached. */
  duration_seconds?: number;
  /** Fixed-time triggers within a conversation step (e.g. play_audio cues). */
  timeline?: TimelineCue[];
  /** Id of a dialogue script (see study/<id>/dialogue_scripts/) to play during this conversation step. */
  dialogue_script?: string;
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

export interface QuizClue {
  tag: string;
  text: string;
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
  answer?: number;
  branch?: string;
  clues?: QuizClue[];
  section_key?: string;
  section_title?: string;
  section_zh?: string;
  section_note?: string;
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

export interface DialogueScripts {
  scripts: Record<string, DialogueScript>;
}

export interface StudyConfig {
  meta: StudyMeta;
  flow: Flow;
  avatars: Avatars;
  questionnaires: Questionnaires;
  prompts: Prompts;
  gaze_profiles: GazeProfiles;
  dialogue_scripts: DialogueScripts;
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
