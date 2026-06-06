import type { Questionnaire, QuestionnaireItem } from "../../shared/types.js";

export type QuestionnaireAnswers = Record<string, string | number>;

export interface QuestionnaireResult {
  questionnaire_id: string;
  answers: QuestionnaireAnswers;
  score?: { correct: number; total: number; percent: number };
}

const CHECK_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg>`;
const X_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const LETTERS = ["A", "B", "C", "D"];

/**
 * Renders a questionnaire into a container and collects answers.
 * When any item has an `answer` field, routes to quiz (scored) mode.
 */
export function renderQuestionnaire(
  container: HTMLElement,
  questionnaireId: string,
  questionnaire: Questionnaire,
  onSubmit: (result: QuestionnaireResult) => void,
  titleOverride?: string,
): void {
  if (questionnaire.items.some(item => item.answer != null)) {
    renderQuizQuestionnaire(container, questionnaireId, questionnaire, onSubmit, titleOverride);
    return;
  }

  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = titleOverride ?? questionnaire.title;
  container.appendChild(heading);

  if (questionnaire.instruction) {
    const instruction = document.createElement("p");
    instruction.className = "study-instruction";
    instruction.textContent = questionnaire.instruction;
    container.appendChild(instruction);
  }

  const form = document.createElement("form");
  form.className = "study-questionnaire";

  let i = 0;
  while (i < questionnaire.items.length) {
    const item = questionnaire.items[i];

    if (item.type === "likert") {
      const group = [item];
      while (i + 1 < questionnaire.items.length) {
        const next = questionnaire.items[i + 1];
        if (next.type === "likert" && sameScale(item, next)) {
          group.push(next);
          i++;
        } else break;
      }
      if (group.length >= 2) {
        renderLikertMatrix(form, group);
      } else {
        appendFieldset(form, item);
      }
    } else {
      appendFieldset(form, item);
    }
    i++;
  }

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "study-btn";
  submitBtn.textContent = "Continue";
  form.appendChild(submitBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = collectAnswers(form, questionnaire.items);
    if (answers === null) return;
    onSubmit({ questionnaire_id: questionnaireId, answers });
  });

  container.appendChild(form);
}

// ─── Quiz (scored) renderer ──────────────────────────────────────────────────

function renderQuizQuestionnaire(
  container: HTMLElement,
  questionnaireId: string,
  questionnaire: Questionnaire,
  onSubmit: (result: QuestionnaireResult) => void,
  titleOverride?: string,
): void {
  container.dataset.quizMode = "true";
  container.innerHTML = "";

  const total = questionnaire.items.length;
  const selected = new Map<string, number>(); // item.id → chosen option index
  let graded = false;

  // Atmospheric layers (position:fixed, viewport-relative)
  const backdrop = document.createElement("div");
  backdrop.className = "quiz-backdrop";
  container.appendChild(backdrop);

  const vignette = document.createElement("div");
  vignette.className = "quiz-vignette";
  container.appendChild(vignette);

  // Scrollable page
  const page = document.createElement("div");
  page.className = "quiz-page";
  container.appendChild(page);

  // ── Sticky topbar ──
  const topbar = document.createElement("div");
  topbar.className = "quiz-topbar";
  topbar.innerHTML = `
    <div class="quiz-brand">
      <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
        <g fill="none" stroke="#ebe1c9" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 32 C 14 14, 50 14, 60 32 C 50 50, 14 50, 4 32 Z"/>
          <circle cx="32" cy="32" r="9" fill="#d4a64a" stroke="none"/>
        </g>
      </svg>
      <span class="quiz-brand-wm">EYES ON ME</span>
    </div>
    <span class="quiz-score-chip">Recall <b id="quizLiveScore">0</b>/${total}</span>
    <span class="quiz-case-label">CASE — INC-1949-0412</span>
  `;
  page.appendChild(topbar);

  // ── Hero block ──
  const hero = document.createElement("div");
  hero.className = "quiz-hero";
  hero.innerHTML = `
    <div class="quiz-eyebrow"><span class="quiz-rule"></span>Field Debriefing &middot; Memory Test<span class="quiz-rule"></span></div>
    <h1 class="quiz-title">${titleOverride ?? questionnaire.title}</h1>
    <p class="quiz-lead">${questionnaire.instruction}</p>
  `;
  page.appendChild(hero);

  // ── Sections + Questions ──
  const sectionsEl = document.createElement("div");
  let currentSectionKey: string | null = null;
  let currentSectionEl: HTMLElement = sectionsEl;
  let globalIndex = 0;

  for (const item of questionnaire.items) {
    // New section header
    if (item.section_key && item.section_key !== currentSectionKey) {
      currentSectionKey = item.section_key;
      const section = document.createElement("div");
      section.className = "quiz-section";
      section.innerHTML = `
        <div class="quiz-section-head">
          <div class="quiz-section-badge">${item.section_key}</div>
          <div class="quiz-section-meta">
            <span class="quiz-kicker">Section ${item.section_key}</span>
            <h2 class="quiz-section-title">${item.section_title ?? ""}</h2>
          </div>
        </div>
        ${item.section_note ? `<p class="quiz-section-note">${item.section_note}</p>` : ""}
        <div class="quiz-section-rule"></div>
      `;
      sectionsEl.appendChild(section);
      currentSectionEl = section;
    }

    // Question card
    globalIndex++;
    const cluesHtml = "";
    const branchHtml = "";

    const card = document.createElement("div");
    card.className = "quiz-q";
    card.id = `quizQ_${item.id}`;
    card.innerHTML = `
      <div class="quiz-q-head">
        <span class="quiz-q-num">${String(globalIndex).padStart(2, "0")}</span>
        <div><div class="quiz-q-text">${item.text}</div>${branchHtml}</div>
      </div>
      ${cluesHtml}
      <div class="quiz-opts">
        ${(item.options ?? []).map((opt, i) => `
          <button type="button" class="quiz-opt" data-item-id="${item.id}" data-index="${i}">
            <span class="quiz-opt-key">${LETTERS[i]}</span>
            <span class="quiz-opt-text">${opt}</span>
            <span class="quiz-opt-mark"></span>
          </button>
        `).join("")}
      </div>
    `;
    currentSectionEl.appendChild(card);
  }
  page.appendChild(sectionsEl);

  // ── Sticky footer ──
  const footerBar = document.createElement("div");
  footerBar.className = "quiz-footer-bar";
  footerBar.innerHTML = `
    <span class="quiz-progress-label" id="quizProgressLabel">0 / ${total}</span>
    <div class="quiz-progress-track"><div class="quiz-progress-fill" id="quizProgressFill"></div></div>
    <button type="button" class="quiz-submit-btn" id="quizSubmitBtn" disabled>Submit Report</button>
  `;
  page.appendChild(footerBar);

  // ── Result overlay ──
  const resultOverlay = document.createElement("div");
  resultOverlay.className = "quiz-result";
  resultOverlay.innerHTML = `
    <div class="quiz-result-card">
      <div class="quiz-result-eyebrow">Debriefing Complete</div>
      <div class="quiz-result-verdict" id="quizVerdict">Reliable</div>
      <div class="quiz-result-score" id="quizScoreBig">0%</div>
      <div class="quiz-result-sub" id="quizScoreSub">0 of ${total} details recalled</div>
      <div class="quiz-result-breakdown" id="quizBreakdown"></div>
      <div class="quiz-result-actions">
        <button type="button" class="quiz-btn quiz-btn-ghost" id="quizReviewBtn">Review Answers</button>
        <button type="button" class="quiz-btn" id="quizContinueBtn">Continue</button>
      </div>
    </div>
  `;
  container.appendChild(resultOverlay);

  // ── Progress updater ──
  function updateProgress() {
    const answered = selected.size;
    const label = container.querySelector<HTMLElement>("#quizProgressLabel");
    const fill = container.querySelector<HTMLElement>("#quizProgressFill");
    const btn = container.querySelector<HTMLButtonElement>("#quizSubmitBtn");
    if (label) label.textContent = `${answered} / ${total}`;
    if (fill) fill.style.width = `${(answered / total) * 100}%`;
    if (btn) btn.disabled = answered < total;
  }

  // ── Option click ──
  sectionsEl.addEventListener("click", (e) => {
    if (graded) return;
    const opt = (e.target as HTMLElement).closest<HTMLElement>(".quiz-opt");
    if (!opt) return;
    const itemId = opt.dataset.itemId!;
    const index = parseInt(opt.dataset.index!, 10);
    opt.closest(".quiz-opts")!.querySelectorAll(".quiz-opt").forEach(o => o.classList.remove("selected"));
    opt.classList.add("selected");
    selected.set(itemId, index);
    updateProgress();
  });

  // ── Submit / Grade ──
  container.querySelector("#quizSubmitBtn")?.addEventListener("click", () => {
    graded = true;
    let correctCount = 0;
    const sectionCounts: Record<string, { c: number; t: number; title: string }> = {};

    for (const item of questionnaire.items) {
      const sk = item.section_key ?? "—";
      if (!sectionCounts[sk]) sectionCounts[sk] = { c: 0, t: 0, title: item.section_title ?? sk };
      sectionCounts[sk].t++;

      const card = container.querySelector(`#quizQ_${item.id}`);
      const sel = selected.get(item.id);
      const correct = item.answer ?? -1;
      const isRight = sel === correct;
      if (isRight) { correctCount++; sectionCounts[sk].c++; }

      if (card) {
        card.classList.add("answered", isRight ? "correct" : "wrong");
        card.querySelectorAll<HTMLElement>(".quiz-opt").forEach(o => {
          const oi = parseInt(o.dataset.index!, 10);
          o.classList.remove("selected");
          if (oi === correct) {
            o.classList.add("is-correct");
            o.querySelector(".quiz-opt-mark")!.innerHTML = CHECK_SVG;
          } else if (oi === sel) {
            o.classList.add("is-wrong");
            o.querySelector(".quiz-opt-mark")!.innerHTML = X_SVG;
          }
        });
      }
    }

    const liveScore = container.querySelector("#quizLiveScore");
    if (liveScore) liveScore.textContent = String(correctCount);

    // Verdict
    const pct = Math.round((correctCount / total) * 100);
    let verdict = "Unreliable", vColor = "var(--eom-red)";
    if (pct >= 90) { verdict = "Total Recall"; vColor = "var(--eom-gold)"; }
    else if (pct >= 70) { verdict = "Reliable"; vColor = "var(--eom-ok)"; }
    else if (pct >= 45) { verdict = "Hazy"; vColor = "#f59e0b"; }

    const verdictEl = container.querySelector<HTMLElement>("#quizVerdict");
    if (verdictEl) { verdictEl.textContent = verdict; verdictEl.style.color = vColor; }
    const scoreBig = container.querySelector("#quizScoreBig");
    if (scoreBig) scoreBig.textContent = `${pct}%`;
    const scoreSub = container.querySelector("#quizScoreSub");
    if (scoreSub) scoreSub.textContent = `${correctCount} of ${total} details recalled`;

    const breakdownEl = container.querySelector("#quizBreakdown");
    if (breakdownEl) {
      breakdownEl.innerHTML = Object.entries(sectionCounts)
        .map(([key, { c, t, title }]) => `
          <div class="quiz-bd">
            <div class="quiz-bd-k">${key}</div>
            <div class="quiz-bd-v">${c}/${t}</div>
            <div class="quiz-bd-l">${title.split(" ")[0]}</div>
          </div>
        `).join("");
    }

    resultOverlay.classList.add("show");

    const answers: QuestionnaireAnswers = {};
    for (const [id, idx] of selected) answers[id] = idx;
    // Store for continue button
    resultOverlay.dataset.answers = JSON.stringify(answers);
    resultOverlay.dataset.score = JSON.stringify({ correct: correctCount, total, percent: pct });
  });

  // ── Review ──
  container.querySelector("#quizReviewBtn")?.addEventListener("click", () => {
    resultOverlay.classList.remove("show");
    page.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ── Continue ──
  container.querySelector("#quizContinueBtn")?.addEventListener("click", () => {
    const answers = JSON.parse(resultOverlay.dataset.answers ?? "{}") as QuestionnaireAnswers;
    const score = JSON.parse(resultOverlay.dataset.score ?? "null") as { correct: number; total: number; percent: number } | null;
    onSubmit({ questionnaire_id: questionnaireId, answers, ...(score ? { score } : {}) });
  });
}

// ─── Standard questionnaire helpers ──────────────────────────────────────────

function appendFieldset(form: HTMLElement, item: QuestionnaireItem): void {
  const fieldset = document.createElement("fieldset");
  fieldset.className = `study-item study-item--${item.type}`;

  const legend = document.createElement("legend");
  legend.textContent = item.text;
  if (item.required) {
    const req = document.createElement("span");
    req.className = "study-required";
    req.textContent = " *";
    legend.appendChild(req);
  }
  fieldset.appendChild(legend);

  switch (item.type) {
    case "likert": renderLikertRow(fieldset, item); break;
    case "choice": renderChoice(fieldset, item); break;
    case "text":   renderText(fieldset, item); break;
  }
  form.appendChild(fieldset);
}

function sameScale(a: QuestionnaireItem, b: QuestionnaireItem): boolean {
  return (
    (a.scale_min ?? 1) === (b.scale_min ?? 1) &&
    (a.scale_max ?? 5) === (b.scale_max ?? 5) &&
    JSON.stringify(a.scale_labels ?? []) === JSON.stringify(b.scale_labels ?? [])
  );
}

function renderLikertMatrix(container: HTMLElement, items: QuestionnaireItem[]): void {
  const min = items[0].scale_min ?? 1;
  const max = items[0].scale_max ?? 5;
  const labels = items[0].scale_labels ?? [];

  const table = document.createElement("table");
  table.className = "study-likert-matrix";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.appendChild(document.createElement("th"));
  for (let i = min; i <= max; i++) {
    const th = document.createElement("th");
    th.textContent = labels[i - min] ?? String(i);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const item of items) {
    const tr = document.createElement("tr");
    const labelTd = document.createElement("td");
    labelTd.className = "study-likert-matrix-label";
    labelTd.textContent = item.text;
    if (item.required) {
      const req = document.createElement("span");
      req.className = "study-required";
      req.textContent = " *";
      labelTd.appendChild(req);
    }
    tr.appendChild(labelTd);
    for (let i = min; i <= max; i++) {
      const td = document.createElement("td");
      td.dataset.label = labels[i - min] ?? String(i);
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = item.id;
      radio.value = String(i);
      if (item.required) radio.required = true;
      td.appendChild(radio);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function renderLikertRow(fieldset: HTMLElement, item: QuestionnaireItem): void {
  const min = item.scale_min ?? 1;
  const max = item.scale_max ?? 5;
  const labels = item.scale_labels ?? [];
  const group = document.createElement("div");
  group.className = "study-likert-group";
  for (let i = min; i <= max; i++) {
    const label = document.createElement("label");
    label.className = "study-likert-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = item.id;
    radio.value = String(i);
    if (item.required) radio.required = true;
    const text = document.createElement("span");
    text.textContent = labels[i - min] ?? String(i);
    label.appendChild(radio);
    label.appendChild(text);
    group.appendChild(label);
  }
  fieldset.appendChild(group);
}

function renderChoice(fieldset: HTMLElement, item: QuestionnaireItem): void {
  const group = document.createElement("div");
  group.className = "study-choice-group";
  for (const option of item.options ?? []) {
    const label = document.createElement("label");
    label.className = "study-choice-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = item.id;
    radio.value = option;
    if (item.required) radio.required = true;
    const text = document.createElement("span");
    text.textContent = option;
    label.appendChild(radio);
    label.appendChild(text);
    group.appendChild(label);
  }
  fieldset.appendChild(group);
}

function renderText(fieldset: HTMLElement, item: QuestionnaireItem): void {
  const textarea = document.createElement("textarea");
  textarea.name = item.id;
  textarea.className = "study-textarea";
  textarea.rows = 4;
  if (item.required) textarea.required = true;
  fieldset.appendChild(textarea);
}

function collectAnswers(
  form: HTMLFormElement,
  items: QuestionnaireItem[],
): QuestionnaireAnswers | null {
  const data = new FormData(form);
  const answers: QuestionnaireAnswers = {};
  for (const item of items) {
    const value = data.get(item.id);
    if (item.required && (value === null || value === "")) return null;
    if (value !== null && value !== "") {
      answers[item.id] = item.type === "likert" ? Number(value) : String(value);
    }
  }
  return answers;
}
