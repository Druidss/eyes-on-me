/**
 * Pure-DOM render functions for each non-conversation study step type.
 * Each function receives a wrapper element, the step config, and orchestrator
 * callbacks, then builds the step UI imperatively (no framework).
 */
import type { FlowStep, Avatar, StudyConfig, RuntimeInfo } from "../../shared/types.js";
import {
  renderQuestionnaire,
  type QuestionnaireResult,
} from "./QuestionnaireRenderer.js";

/** Callbacks the step renderers need from the orchestrator. */
export interface StepCallbacks {
  advance: () => void;
  createNextButton: (label?: string) => HTMLButtonElement;
}

// --- Info ---

/** Render a simple informational page with optional content blocks and a continue button. */
export function renderInfoStep(
  wrapper: HTMLElement,
  step: FlowStep,
  { createNextButton }: StepCallbacks,
): void {
  const h = document.createElement("h2");
  h.textContent = step.title ?? "Info";
  wrapper.appendChild(h);

  if (step.content_blocks && step.content_blocks.length > 0) {
    for (const block of step.content_blocks) {
      const p = document.createElement("p");
      p.textContent = block;
      wrapper.appendChild(p);
    }
  } else if (step.content) {
    const p = document.createElement("p");
    p.textContent = step.content;
    wrapper.appendChild(p);
  }

  if (step.id !== "ending") {
    wrapper.appendChild(createNextButton(step.button_label));
  }

  if (step.footer) {
    const footer = document.createElement("p");
    footer.className = "info-footer";
    footer.textContent = step.footer;
    wrapper.appendChild(footer);
  }
}

// --- Consent ---

/** Render a consent page with checkbox gate. The continue button stays disabled until checked. */
export function renderConsentStep(
  wrapper: HTMLElement,
  step: FlowStep,
  { createNextButton }: StepCallbacks,
  runtime?: RuntimeInfo,
): void {
  const h = document.createElement("h2");
  h.textContent = step.title ?? "Consent";
  wrapper.appendChild(h);

  if (step.content_blocks && step.content_blocks.length > 0) {
    for (const block of step.content_blocks) {
      const p = document.createElement("p");
      p.textContent = block;
      wrapper.appendChild(p);
    }
  } else if (step.content) {
    const p = document.createElement("p");
    p.textContent = step.content;
    wrapper.appendChild(p);
  }

  // Runtime-aware disclosure notice
  if (runtime) {
    const notice = buildConsentNotice(runtime);
    if (notice) wrapper.appendChild(notice);
  }

  const label = document.createElement("label");
  label.className = "study-consent-label";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = "consent-check";

  if (step.consent_label) {
    const text = document.createElement("span");
    text.textContent = ` ${step.consent_label}`;
    label.appendChild(checkbox);
    label.appendChild(text);
  } else {
    label.appendChild(checkbox);
  }

  wrapper.appendChild(label);

  const btn = createNextButton();
  btn.disabled = true;
  checkbox.addEventListener("change", () => {
    btn.disabled = !checkbox.checked;
  });
  wrapper.appendChild(btn);
}

/**
 * Build a disclosure notice listing what data this session captures.
 * Messages are derived from effective_capture flags so participants see
 * exactly what applies (demo vs research, Tobii on/off, Realtime on/off).
 * Returns null when there is nothing to disclose.
 */
function buildConsentNotice(runtime: RuntimeInfo): HTMLElement | null {
  const ec = runtime.effective_capture;
  const lines: string[] = [];

  if (runtime.env === "demo") {
    lines.push("Demo mode — no data is stored or sent externally.");
  } else {
    if (ec.audio_sent_to_openai) {
      lines.push("Voice audio is sent to OpenAI for realtime processing.");
    }
    if (ec.transcripts) {
      lines.push("Conversation transcripts are recorded.");
    }
    if (ec.gaze_tobii_raw) {
      lines.push("Eye-tracking gaze data is recorded (Tobii).");
    } else if (ec.gaze_samples) {
      lines.push("Gaze position (mouse-based) is recorded.");
    }
    if (ec.questionnaire_answers || ec.form_answers) {
      lines.push("Form and questionnaire responses are recorded.");
    }
    if (
      runtime.capabilities.tobii_enabled &&
      !ec.gaze_samples &&
      !ec.gaze_tobii_raw
    ) {
      lines.push(
        "Eye tracking is used for live avatar interaction but not stored.",
      );
    }
    if (!ec.transcripts && !ec.gaze_samples && !ec.questionnaire_answers) {
      lines.push("Only minimal session activity is recorded.");
    }
  }

  if (lines.length === 0) return null;

  const div = document.createElement("div");
  div.className = "consent-notice";
  const ul = document.createElement("ul");
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.appendChild(li);
  }
  div.appendChild(ul);
  return div;
}

// --- Form ---

/** Render a dynamic form from the step's `fields` array. Calls `onSubmit` with collected answers. */
export function renderFormStep(
  wrapper: HTMLElement,
  step: FlowStep,
  { advance }: StepCallbacks,
  onSubmit?: (answers: Record<string, string>) => void,
): void {
  const h = document.createElement("h2");
  h.textContent = step.title ?? "Form";
  wrapper.appendChild(h);

  const form = document.createElement("form");
  form.className = "study-form";

  for (const field of step.fields ?? []) {
    const group = document.createElement("div");
    group.className = "study-form-group";

    const label = document.createElement("label");
    label.textContent = field.label;
    label.htmlFor = `form-${field.id}`;
    if (field.required) {
      const req = document.createElement("span");
      req.className = "study-required";
      req.textContent = " *";
      label.appendChild(req);
    }
    group.appendChild(label);

    if (field.type === "select" && field.options) {
      const select = document.createElement("select");
      select.id = `form-${field.id}`;
      select.name = field.id;
      if (field.required) select.required = true;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "— Select —";
      select.appendChild(placeholder);

      for (const opt of field.options) {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
      }
      group.appendChild(select);
    } else {
      const input = document.createElement("input");
      input.id = `form-${field.id}`;
      input.name = field.id;
      input.type = field.type === "number" ? "number" : "text";
      if (field.required) input.required = true;
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      group.appendChild(input);
    }

    form.appendChild(group);
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "study-btn";
  submitBtn.textContent = "Continue";
  form.appendChild(submitBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (onSubmit) {
      const formData = new FormData(form);
      const answers: Record<string, string> = {};
      for (const field of step.fields ?? []) {
        const value = formData.get(field.id);
        if (value !== null && value !== "") {
          answers[field.id] = String(value);
        }
      }
      onSubmit(answers);
    }
    advance();
  });

  wrapper.appendChild(form);
}

// --- Avatar Selection ---

/** Render an avatar picker grid with optional thumbnails. Calls `onSelect` when a card is clicked. */
export function renderAvatarSelectionStep(
  wrapper: HTMLElement,
  step: FlowStep,
  avatars: Avatar[],
  onSelect: (avatar: Avatar) => void,
  { createNextButton }: StepCallbacks,
): void {
  const h = document.createElement("h2");
  h.textContent = step.title ?? "Avatar Selection";
  wrapper.appendChild(h);

  if (step.content) {
    const p = document.createElement("p");
    p.textContent = step.content;
    wrapper.appendChild(p);
  }

  const grid = document.createElement("div");
  grid.className = "study-avatar-grid";

  const nextBtn = createNextButton();
  nextBtn.disabled = true;

  for (const avatar of avatars) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "study-avatar-card";
    card.dataset.avatarId = avatar.id;

    if (avatar.thumbnail) {
      const img = document.createElement("img");
      img.className = "avatar-thumb";
      img.src = `${import.meta.env.BASE_URL}${avatar.thumbnail}`;
      img.alt = avatar.label;
      card.appendChild(img);
    }

    const label = document.createElement("span");
    label.className = "avatar-thumb-label";
    label.textContent = avatar.label;
    card.appendChild(label);

    card.addEventListener("click", () => {
      grid.querySelectorAll(".study-avatar-card").forEach((el) =>
        el.classList.remove("selected"),
      );
      card.classList.add("selected");
      onSelect(avatar);
      nextBtn.disabled = false;
    });

    grid.appendChild(card);
  }

  wrapper.appendChild(grid);
  wrapper.appendChild(nextBtn);
}

// --- Questionnaire ---

/** Render a questionnaire (Likert, choice, text) by looking up `questionnaire_id` in the study config. */
export function renderQuestionnaireStep(
  wrapper: HTMLElement,
  step: FlowStep,
  config: StudyConfig,
  onResult: (result: QuestionnaireResult) => void,
  { createNextButton }: StepCallbacks,
): void {
  const qId = step.questionnaire_id;
  if (!qId) {
    renderPlaceholderStep(wrapper, step, "Missing questionnaire_id.", { createNextButton, advance: () => {} });
    return;
  }

  const questionnaire = config.questionnaires.questionnaires[qId];
  if (!questionnaire) {
    renderPlaceholderStep(wrapper, step, `Questionnaire "${qId}" not found.`, { createNextButton, advance: () => {} });
    return;
  }

  renderQuestionnaire(wrapper, qId, questionnaire, onResult, step.title);
}

// --- Hero (Start screen) ---

const EYE_SVG = `<svg class="hero-eye-mark" width="78" height="78" viewBox="0 0 64 64" aria-hidden="true" fill="none"
  stroke="#ebe1c9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 32 C 14 13,50 13,61 32 C 50 51,14 51,3 32 Z"/>
  <circle cx="32" cy="32" r="10.5" stroke="#d4a64a" stroke-width="2.4"/>
  <circle class="hero-pupil" cx="32" cy="32" r="5" fill="#ebe1c9" stroke="none"/>
</svg>`;

export function renderHeroStep(
  wrapper: HTMLElement,
  step: FlowStep,
  { advance }: StepCallbacks,
): void {
  wrapper.classList.add("hero-step");

  // Background image
  if (step.bg_image) {
    const bg = document.createElement("div");
    bg.className = "hero-bg";
    bg.style.backgroundImage = `url("${import.meta.env.BASE_URL}${step.bg_image}")`;
    wrapper.appendChild(bg);
  }

  // Scrims (vignette + bottom gradient)
  const scrimV = document.createElement("div");
  scrimV.className = "hero-scrim-vignette";
  wrapper.appendChild(scrimV);

  const scrimB = document.createElement("div");
  scrimB.className = "hero-scrim-bottom";
  wrapper.appendChild(scrimB);

  // Film grain
  const grain = document.createElement("div");
  grain.className = "hero-grain";
  wrapper.appendChild(grain);

  // Content layer
  const content = document.createElement("div");
  content.className = "hero-content";

  // Eyebrow: ── Harbor City · 1949 ──
  const eyebrow = document.createElement("div");
  eyebrow.className = "hero-eyebrow";
  eyebrow.innerHTML = `<span class="hero-rule"></span>${step.footer ?? ""}<span class="hero-rule"></span>`;
  content.appendChild(eyebrow);

  // Eye + wordmark on same row
  const lockupRow = document.createElement("div");
  lockupRow.className = "hero-lockup-row";
  lockupRow.innerHTML = EYE_SVG;

  const wordmark = document.createElement("h1");
  wordmark.className = "hero-wordmark";
  // Split title: "Eyes On Me" → "Eyes" + "On Me" (middle word gold)
  const words = (step.title ?? "Eyes On Me").split(" ");
  if (words.length >= 3) {
    wordmark.innerHTML = `${words[0]} <span class="hero-on">${words[1]}</span> ${words.slice(2).join(" ")}`;
  } else {
    wordmark.textContent = step.title ?? "Eyes On Me";
  }
  lockupRow.appendChild(wordmark);

  const lockup = document.createElement("div");
  lockup.className = "hero-lockup";
  lockup.appendChild(lockupRow);
  content.appendChild(lockup);

  // Tagline
  if (step.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "hero-tagline";
    tagline.textContent = step.tagline;
    content.appendChild(tagline);
  }

  // Start button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hero-btn";
  btn.innerHTML = `<span class="hero-btn-fill"></span>
    <svg class="hero-btn-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 4l14 8-14 8V4z"/>
    </svg>
    <span class="hero-btn-label">${step.button_label ?? "Start"}</span>`;
  btn.addEventListener("click", () => advance());
  content.appendChild(btn);

  const press = document.createElement("p");
  press.className = "hero-press";
  press.textContent = "Press to begin the investigation";
  content.appendChild(press);

  wrapper.appendChild(content);

  // Bottom-right status footer (tracker status)
  const footer = document.createElement("div");
  footer.className = "hero-footer";
  footer.innerHTML = `<span class="hero-footer-right">
    <span class="hero-dot"></span>
    <span>Tracker Calibrated</span>
  </span>`;
  wrapper.appendChild(footer);
}

// --- Placeholder ---

/** Fallback renderer shown when a step type is unsupported or misconfigured. */
export function renderPlaceholderStep(
  wrapper: HTMLElement,
  step: FlowStep,
  message: string,
  { createNextButton }: StepCallbacks,
): void {
  const h = document.createElement("h2");
  h.textContent = step.title ?? step.id;
  wrapper.appendChild(h);

  const p = document.createElement("p");
  p.className = "study-placeholder";
  p.textContent = message;
  wrapper.appendChild(p);

  wrapper.appendChild(createNextButton());
}
