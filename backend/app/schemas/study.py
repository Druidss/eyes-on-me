"""Pydantic schemas for study configuration validation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# --- Assignment policy ---


class AssignmentPolicy(BaseModel):
    condition_order_mode: Literal["fixed", "counterbalanced", "random"] = "fixed"
    fixed_condition_order: list[str] | None = None
    question_order_mode: Literal["fixed", "shuffle"] = "fixed"


# --- study.json ---


class StudyMeta(BaseModel):
    id: str
    version: str
    name: str
    description: str = ""
    study_mode: str
    conditions: list[str] = Field(min_length=1)
    questions_per_condition: int = Field(ge=1)
    assignment: AssignmentPolicy = Field(default_factory=AssignmentPolicy)

    @model_validator(mode="before")
    @classmethod
    def _fill_default_assignment(cls, data: object) -> object:
        """Backward compat: when assignment block is absent, derive a
        default fixed policy from conditions.  When assignment IS present
        and mode is fixed, require fixed_condition_order explicitly."""
        if not isinstance(data, dict):
            return data
        if "assignment" not in data:
            # Study without assignment block — derive safe default
            data["assignment"] = {
                "condition_order_mode": "fixed",
                "fixed_condition_order": list(data.get("conditions", [])),
                "question_order_mode": "fixed",
            }
        else:
            a = data["assignment"]
            if isinstance(a, dict):
                mode = a.get("condition_order_mode", "fixed")
                if mode == "fixed" and "fixed_condition_order" not in a:
                    raise ValueError(
                        'fixed_condition_order is required when condition_order_mode is "fixed"'
                    )
        return data

    @model_validator(mode="after")
    def _validate_fixed_condition_order(self) -> StudyMeta:
        """Cross-validate fixed_condition_order against conditions."""
        fco = self.assignment.fixed_condition_order
        if fco is not None:
            if len(fco) != len(self.conditions):
                raise ValueError(
                    f"fixed_condition_order has {len(fco)} entries "
                    f"but conditions has {len(self.conditions)}"
                )
            if set(fco) != set(self.conditions):
                raise ValueError(
                    "fixed_condition_order must contain exactly the same IDs as conditions"
                )
            if len(fco) != len(set(fco)):
                raise ValueError("fixed_condition_order must not contain duplicates")
        return self


# --- flow.json ---


class FormField(BaseModel):
    id: str
    type: str
    label: str
    options: list[str] | None = None
    required: bool = False
    min: int | None = None
    max: int | None = None


class TimelineAction(BaseModel):
    """A single action fired when a TimelineCue triggers.

    `type` is open-ended on purpose — only "play_audio" is implemented
    today, but the schema does not constrain future action types (e.g.
    "set_expression", "say_line") to keep this additive.
    """

    type: str
    # play_audio fields
    src: str | None = None
    volume: float | None = Field(default=None, ge=0, le=1)
    loop: bool = False


class TimelineCue(BaseModel):
    """A single fixed-time trigger within a conversation step.

    `at_seconds` is measured from when the conversation step's timer
    starts (avatar ready), matching the same clock as `duration_seconds`.
    """

    id: str
    at_seconds: int = Field(ge=0)
    actions: list[TimelineAction] = Field(min_length=1)


# --- Dialogue scripts (branching audio + subtitle scenes) ---


class DialogueSafeWindow(BaseModel):
    """Suspicion gain multiplier applied while a line plays.

    0 fully suppresses gain (e.g. NPC looking away); restored to 1 once
    the line ends. Caller (frontend) is responsible for applying this —
    the backend only validates shape.
    """

    suspicion_multiplier: float = Field(ge=0)


class DialogueLineNode(BaseModel):
    id: str
    kind: Literal["line"] = "line"
    audio_src: str
    text: str
    speaker: str | None = None
    direction: str | None = None
    safe_window: DialogueSafeWindow | None = None
    next: str | None = None


class DialogueBranchNode(BaseModel):
    id: str
    kind: Literal["branch"] = "branch"
    branch: dict[Literal["low", "high"], str]

    @model_validator(mode="after")
    def _require_both_branch_keys(self) -> DialogueBranchNode:
        missing = {"low", "high"} - set(self.branch.keys())
        if missing:
            raise ValueError(
                f'branch node "{self.id}" is missing target(s) for: {sorted(missing)}'
            )
        return self


class DialogueScript(BaseModel):
    id: str
    start: str
    nodes: list[DialogueLineNode | DialogueBranchNode] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_node_refs(self) -> DialogueScript:
        ids = {n.id for n in self.nodes}
        if len(ids) != len(self.nodes):
            raise ValueError(f'dialogue script "{self.id}" has duplicate node ids')
        if self.start not in ids:
            raise ValueError(
                f'dialogue script "{self.id}" start node "{self.start}" not found in nodes'
            )
        for n in self.nodes:
            if isinstance(n, DialogueLineNode) and n.next is not None and n.next not in ids:
                raise ValueError(
                    f'dialogue script "{self.id}" node "{n.id}" references missing next node "{n.next}"'
                )
            if isinstance(n, DialogueBranchNode):
                for target in n.branch.values():
                    if target not in ids:
                        raise ValueError(
                            f'dialogue script "{self.id}" branch node "{n.id}" '
                            f'references missing node "{target}"'
                        )
        return self


class DialogueScripts(BaseModel):
    """study/<id>/dialogue_scripts.json — { "scripts": { "<script_id>": DialogueScript } }"""

    scripts: dict[str, DialogueScript] = Field(default_factory=dict)


class FlowStep(BaseModel):
    id: str
    type: Literal[
        "hero",
        "info",
        "consent",
        "form",
        "calibration",
        "avatar_selection",
        "conversation",
        "questionnaire",
    ]
    title: str | None = None
    content: str | None = None
    content_blocks: list[str] | None = None
    tagline: str | None = None
    footer: str | None = None
    bg_image: str | None = None
    button_label: str | None = None
    consent_label: str | None = None
    fields: list[FormField] | None = None
    condition: str | None = None
    questionnaire_id: str | None = None
    duration_seconds: int | None = Field(default=None, ge=1)
    timeline: list[TimelineCue] | None = None
    dialogue_script: str | None = None


class Flow(BaseModel):
    steps: list[FlowStep] = Field(min_length=1)


# --- avatars.json ---


class Avatar(BaseModel):
    id: str
    label: str
    model_file: str
    voice: str
    thumbnail: str | None = None


class Avatars(BaseModel):
    avatars: list[Avatar] = Field(min_length=1)


# --- questionnaires.json ---


class QuizClue(BaseModel):
    tag: str
    text: str


class QuestionnaireItem(BaseModel):
    id: str
    text: str
    type: Literal["likert", "choice", "text"]
    scale_min: int | None = None
    scale_max: int | None = None
    scale_labels: list[str] | None = None
    options: list[str] | None = None
    required: bool = False
    answer: int | None = None
    branch: str | None = None
    clues: list[QuizClue] | None = None
    section_key: str | None = None
    section_title: str | None = None
    section_zh: str | None = None
    section_note: str | None = None


class Questionnaire(BaseModel):
    title: str
    instruction: str = ""
    items: list[QuestionnaireItem] = Field(min_length=1)


class Questionnaires(BaseModel):
    questionnaires: dict[str, Questionnaire]


# --- prompts.json ---


class QuizQuestion(BaseModel):
    id: str
    text: str


class QuizPrompt(BaseModel):
    system_base: str
    system_end: str
    questions: list[QuizQuestion] = Field(min_length=1)


class Prompts(BaseModel):
    quiz: QuizPrompt


# --- gaze_profiles.json ---


class GazeProfile(BaseModel):
    states: list[str]
    pending_time_ms: int = Field(ge=0)
    mutual_time_ms: int = Field(ge=0)
    break_time_ms: int = Field(ge=0)
    lose_debounce_ms: int = Field(ge=0)


class GazeProfiles(BaseModel):
    profiles: dict[str, GazeProfile]


# --- Combined study config returned by API ---


class StudyConfig(BaseModel):
    meta: StudyMeta
    flow: Flow
    avatars: Avatars
    questionnaires: Questionnaires
    prompts: Prompts
    gaze_profiles: GazeProfiles
    dialogue_scripts: DialogueScripts = Field(default_factory=lambda: DialogueScripts(scripts={}))


# --- Resolved assignment (session-scoped) ---


class AssignmentRound(BaseModel):
    round_index: int
    step_id: str
    condition: str
    question_ids: list[str]
    questions: list[str]


class ResolvedStudyAssignment(BaseModel):
    session_id: str
    study_id: str
    seed: int
    condition_order: list[str]
    rounds: list[AssignmentRound]
    questions_per_condition: int


class AssignmentRequest(BaseModel):
    study_id: str = Field(pattern=r"^[a-zA-Z0-9_\-]{1,64}$")
