import type { Questionnaire, QuestionnaireItem, StudyConfig } from "../../shared/types.js";
import type { QuestionnaireResult } from "./QuestionnaireRenderer.js";

export interface SessionReportInput {
  config: StudyConfig;
  sessionId: string;
  participantName: string | null;
  results: QuestionnaireResult[];
}

/** Builds a human-readable Markdown summary of one completed session. */
export function buildSessionReportMarkdown(input: SessionReportInput): string {
  const { config, sessionId, participantName, results } = input;
  const lines: string[] = [];

  lines.push(`# ${config.meta.name} — Test Report`);
  lines.push("");
  lines.push(`- Tester: ${participantName ?? "(not provided)"}`);
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Session ID: ${sessionId}`);
  lines.push(`- Study: ${config.meta.id} (v${config.meta.version})`);
  lines.push("");

  for (const result of results) {
    const questionnaire = config.questionnaires.questionnaires[result.questionnaire_id];
    if (!questionnaire) continue;
    lines.push(...renderQuestionnaireSection(questionnaire, result));
  }

  return lines.join("\n") + "\n";
}

function renderQuestionnaireSection(
  questionnaire: Questionnaire,
  result: QuestionnaireResult,
): string[] {
  const lines: string[] = [];
  lines.push(`## ${questionnaire.title}`);
  if (result.score) {
    lines.push(`Score: ${result.score.correct}/${result.score.total} (${result.score.percent}%)`);
  }
  lines.push("");

  let currentSection: string | null = null;
  let n = 0;

  for (const item of questionnaire.items) {
    if (item.section_key && item.section_key !== currentSection) {
      currentSection = item.section_key;
      lines.push(`### Section ${item.section_key}${item.section_title ? ` — ${item.section_title}` : ""}`);
    }
    n++;
    lines.push(`${n}. ${item.text}`);
    lines.push(`   - ${formatAnswer(item, result)}`);
  }
  lines.push("");
  return lines;
}

function formatAnswer(item: QuestionnaireItem, result: QuestionnaireResult): string {
  const raw = result.answers[item.id];
  if (raw === undefined) return "(no answer)";

  if (item.type === "choice" && item.options) {
    const idx = Number(raw);
    const text = item.options[idx] ?? String(raw);
    if (item.answer != null) {
      const isCorrect = idx === item.answer;
      return `${text} ${isCorrect ? "✅" : `❌ (correct: ${item.options[item.answer] ?? item.answer})`}`;
    }
    return text;
  }

  return String(raw);
}

/** Triggers a browser download of `content` as a UTF-8 text file named `filename`. */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Triggers a browser download of `content` as a UTF-8 JSON file named `filename`. */
export function downloadJsonFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Sanitizes a free-text name for use in a filename. */
export function slugifyForFilename(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "anonymous";
}
