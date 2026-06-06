import type {
  StudyConfig,
  FlowStep,
  Avatar,
  RuntimeInfo,
  ResolvedStudyAssignment,
} from "../../shared/types.js";
import { parseStudyConfig } from "../../shared/apiParse.js";
import { apiBase } from "../../shared/apiBase.js";
import type { QuestionnaireResult } from "./QuestionnaireRenderer.js";
import { BackendReporter } from "../telemetry/BackendReporter.js";
import { ConversationStepController } from "./ConversationStepController.js";
import { getRoundForStep } from "./assignment.js";
import {
  renderHeroStep,
  renderInfoStep,
  renderConsentStep,
  renderFormStep,
  renderAvatarSelectionStep,
  renderQuestionnaireStep,
  type StepCallbacks,
} from "./stepRenderers.js";
import { renderCalibrationStep } from "./CalibrationStepRenderer.js";

/** Fetches the full StudyConfig from the backend. */
export async function fetchStudyConfig(
  studyId: string,
): Promise<StudyConfig> {
  const res = await fetch(`${apiBase()}/api/studies/${encodeURIComponent(studyId)}`);
  if (!res.ok) {
    throw new Error(`Failed to load study "${studyId}": ${res.status}`);
  }
  return parseStudyConfig(await res.json());
}

/**
 * Drives the study flow: manages step index, renders each step type,
 * and handles navigation. Delegates rendering and lifecycle to
 * extracted modules.
 *
 * The static StudyConfig is never mutated. Session-specific reality
 * (condition order, question assignment) comes from the resolved
 * assignment.
 */
export class StudyFlow {
  private readonly container: HTMLElement;
  private readonly config: StudyConfig;
  private readonly runtime: RuntimeInfo;
  private readonly sessionId: string;
  private readonly assignment: ResolvedStudyAssignment;
  private stepIndex = 0;
  private _selectedAvatar: Avatar | null = null;
  private _results: QuestionnaireResult[] = [];
  private readonly reporter: BackendReporter;
  private conversationController: ConversationStepController | null = null;
  private calibrationCleanup: (() => void) | null = null;

  /** Maps step index → condition for questionnaire steps that follow a conversation. */
  private readonly stepConditionMap: Map<number, string>;

  constructor(
    container: HTMLElement,
    config: StudyConfig,
    runtime: RuntimeInfo,
    sessionId: string,
    assignment: ResolvedStudyAssignment,
    options?: { demoMode?: boolean },
  ) {
    this.container = container;
    this.config = config;
    this.runtime = runtime;
    this.sessionId = sessionId;
    this.assignment = assignment;
    this.reporter = new BackendReporter({
      sessionId,
      disabled: options?.demoMode,
    });
    this.stepConditionMap = this.buildStepConditionMap();
  }

  /** The avatar chosen by the participant (null until selection). */
  get chosenAvatar(): Avatar | null {
    return this._selectedAvatar;
  }

  /** Collected questionnaire results so far. */
  get questionnaireResults(): readonly QuestionnaireResult[] {
    return this._results;
  }

  start(): void {
    this.stepIndex = 0;
    this.emitAssignmentIfResearch();
    this.render();
  }

  private currentStep(): FlowStep {
    return this.config.flow.steps[this.stepIndex];
  }

  private advance(): void {
    if (this.stepIndex < this.config.flow.steps.length - 1) {
      this.stepIndex++;
      this.render();
    }
  }

  private destroyConversation(): void {
    if (this.conversationController) {
      this.conversationController.destroy();
      this.conversationController = null;
    }
  }

  private destroyCalibration(): void {
    if (this.calibrationCleanup) {
      this.calibrationCleanup();
      this.calibrationCleanup = null;
    }
  }

  /** Tear down all active controllers and flush remaining telemetry. */
  async destroy(): Promise<void> {
    this.destroyConversation();
    this.destroyCalibration();
    await this.reporter.destroy();
  }

  /** Resolve the actual condition for a conversation step from the assignment. */
  private resolveCondition(step: FlowStep): string | undefined {
    const round = getRoundForStep(this.assignment, step.id);
    return round?.condition ?? step.condition;
  }

  private render(): void {
    this.destroyConversation();
    this.destroyCalibration();
    const step = this.currentStep();
    this.container.innerHTML = "";
    const isFullscreen = step.type === "conversation" || step.type === "calibration";
    this.container.classList.toggle("conversation-active", isFullscreen);

    const wrapper = document.createElement("div");
    wrapper.className = "study-screen";
    wrapper.dataset.stepId = step.id;
    wrapper.dataset.stepType = step.type;

    const callbacks: StepCallbacks = {
      advance: () => this.advance(),
      createNextButton: (label?: string) => this.createNextButton(label),
    };

    // Resolve condition from assignment (not from static flow config)
    const resolvedCondition = step.type === "conversation"
      ? this.resolveCondition(step)
      : step.condition;

    this.reporter.emit("study.step_entered", {
      step_id: step.id,
      step_type: step.type,
      step_index: this.stepIndex,
      condition: resolvedCondition ?? null,
      study_id: this.config.meta.id,
    });

    switch (step.type) {
      case "hero":
        renderHeroStep(wrapper, step, callbacks);
        break;
      case "info":
        renderInfoStep(wrapper, step, callbacks);
        break;
      case "consent":
        renderConsentStep(wrapper, step, callbacks, this.runtime);
        break;
      case "form":
        renderFormStep(
          wrapper, step, callbacks,
          this.isResearch()
            ? (answers) => this.emitFormSubmitted(step, answers)
            : undefined,
        );
        break;
      case "calibration":
        this.calibrationCleanup = renderCalibrationStep(wrapper, step, this.runtime, callbacks);
        break;
      case "avatar_selection":
        renderAvatarSelectionStep(
          wrapper, step,
          this.config.avatars.avatars,
          (avatar) => {
            this._selectedAvatar = avatar;
            this.reporter.emit("study.avatar_selected", {
              avatar_id: avatar.id,
              avatar_label: avatar.label,
              model_file: avatar.model_file,
              voice: avatar.voice,
            });
          },
          callbacks,
        );
        break;
      case "conversation":
        this.renderConversation(wrapper, step);
        break;
      case "questionnaire":
        renderQuestionnaireStep(
          wrapper, step, this.config,
          (result) => {
            this._results.push(result);
            this.emitQuestionnaireSubmittedIfResearch(step, result);
            this.advance();
          },
          callbacks,
        );
        break;
    }

    this.container.appendChild(wrapper);
  }

  private renderConversation(wrapper: HTMLElement, step: FlowStep): void {
    if (!this._selectedAvatar && this.config.avatars.avatars.length > 0) {
      this._selectedAvatar = this.config.avatars.avatars[0];
    }
    const resolvedCondition = this.resolveCondition(step);
    this.conversationController = new ConversationStepController({
      config: this.config,
      runtime: this.runtime,
      sessionId: this.sessionId,
      reporter: this.reporter,
    });
    this.conversationController.render(wrapper, step, this._selectedAvatar, resolvedCondition);
    wrapper.appendChild(this.createNextButton());
  }

  private createNextButton(label?: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "study-btn";
    btn.textContent = label ?? "Continue";
    btn.addEventListener("click", () => this.advance());
    return btn;
  }

  // --- Research log mode helpers ---

  private isResearch(): boolean {
    return this.runtime.log_mode === "research";
  }

  /**
   * Pre-compute which condition each questionnaire step belongs to.
   * Uses the resolved assignment to determine the actual condition
   * for conversation steps, rather than the static flow config.
   */
  private buildStepConditionMap(): Map<number, string> {
    const map = new Map<number, string>();
    let lastConvCondition: string | null = null;
    let lastWasConversation = false;

    for (let i = 0; i < this.config.flow.steps.length; i++) {
      const s = this.config.flow.steps[i];
      if (s.type === "conversation") {
        const round = getRoundForStep(this.assignment, s.id);
        lastConvCondition = round?.condition ?? s.condition ?? null;
        lastWasConversation = true;
      } else if (s.type === "questionnaire") {
        if (lastWasConversation && lastConvCondition) {
          map.set(i, lastConvCondition);
        }
        lastWasConversation = false;
      } else {
        lastWasConversation = false;
      }
    }
    return map;
  }

  /** Emit the resolved assignment once at start (research mode only). */
  private emitAssignmentIfResearch(): void {
    if (!this.isResearch()) return;

    this.reporter.emit("study.assignment_recorded", {
      study_id: this.assignment.study_id,
      study_mode: this.config.meta.study_mode,
      seed: this.assignment.seed,
      condition_order: this.assignment.condition_order,
      questions_per_condition: this.assignment.questions_per_condition,
      rounds: this.assignment.rounds.map((r) => ({
        round_index: r.round_index,
        step_id: r.step_id,
        condition: r.condition,
        question_ids: r.question_ids,
        questions: r.questions,
      })),
      log_mode: this.runtime.log_mode,
    });
  }

  /** Emit form submission (research mode — called via callback). */
  private emitFormSubmitted(step: FlowStep, answers: Record<string, string>): void {
    this.reporter.emit("study.form_submitted", {
      step_id: step.id,
      step_type: step.type,
      study_id: this.config.meta.id,
      answers,
    });
  }

  /** Emit questionnaire submission (research mode only). */
  private emitQuestionnaireSubmittedIfResearch(step: FlowStep, result: QuestionnaireResult): void {
    if (!this.isResearch()) return;

    this.reporter.emit("study.questionnaire_submitted", {
      questionnaire_id: result.questionnaire_id,
      step_id: step.id,
      step_index: this.stepIndex,
      study_id: this.config.meta.id,
      condition: this.stepConditionMap.get(this.stepIndex) ?? null,
      answers: result.answers,
    });
  }
}
