# Data Formats

How Gaze-Aware Avatar Study Kit logs telemetry events and what the resulting data looks like.

## Overview

When a participant runs through a study in **full local mode** (with the
backend running), the frontend sends structured telemetry events to the
backend in batches. The backend writes each event as one JSON line to a
session-specific JSONL file in `data/logs/`.

In **browser demo mode** (`?demo`), telemetry is disabled — no events
are sent and no log files are created.

## Log modes

The backend supports two logging modes, controlled by the `LOG_MODE`
environment variable in `backend/.env`:

| Mode | Value | Description |
| ---- | ----- | ----------- |
| **Default** | `LOG_MODE=default` | Slim, privacy-conservative logging. Only structural study-flow events are recorded (step navigation, avatar selection, gaze/FSM transitions, voice state). No study-outcome data (form answers, questionnaire responses). This is the default when `LOG_MODE` is not set. |
| **Research** | `LOG_MODE=research` | Extended logging for research use. Adds study-outcome events (assignment metadata, form submissions, questionnaire answers), conversation transcripts, and dense gaze samples. The gaze sample rate is configurable via `RESEARCH_GAZE_SAMPLE_HZ` (default 90). |

Research mode must be explicitly activated — it is never the implicit
default. The active log mode is:
- reported by `GET /api/runtime` in the `log_mode` field
- recorded as a `session.started` marker event at the beginning of each
  session log file

Both modes write to the same `data/logs/` directory and use the same
JSONL format. The difference is which event types and data fields are
emitted.

## Log file location

```
data/logs/{session_id}.jsonl
```

Each session creates one file. The session ID is a random 16-character
hex string assigned by the backend when the session starts
(`POST /api/app-sessions`). The `data/logs/` directory is git-ignored
and created automatically at runtime.

## JSONL format

Each line in a log file is one complete JSON object — one event.
Lines are appended in chronological order.

```jsonl
{"schema_version": 1, "timestamp": "2026-01-15T10:30:00.100Z", "session_id": "a1b2c3d4e5f60001", "event_type": "study.step_entered", "data": {"step_id": "condition1", "step_type": "conversation", "step_index": 5, "condition": "baseline", "study_id": "demo-study"}}
{"schema_version": 1, "timestamp": "2026-01-15T10:30:00.500Z", "session_id": "a1b2c3d4e5f60001", "event_type": "avatar.loaded", "data": {"avatar_id": "avatar_b", "avatar_label": "Character A", "model_file": "AvatarSample_B.vrm", "voice": "alloy", "condition": "baseline", "step_id": "condition1"}}
```

## Event fields

Every event has these mandatory fields:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `schema_version` | integer | Always `1` in v1. Will increment if the format changes. |
| `timestamp` | string | ISO 8601 timestamp from the browser (`new Date().toISOString()`). |
| `session_id` | string | 16-char hex (backend-issued) or UUID (frontend-generated in demo mode). Identifies the participant session. |
| `event_type` | string | Dot-separated event category (e.g., `avatar.loaded`). |

And one optional field:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `data` | object or null | Event-specific payload. Structure varies by `event_type`. |

The backend validates these fields via the `LogEvent` Pydantic schema
(`backend/app/schemas/events.py`). Events missing required fields or
with malformed `session_id` values are rejected with a 422 response.

## Event types

### Both modes (default + research)

The following events are emitted in both log modes:

### `session.started`

Emitted by the backend when a new session is created
(`POST /api/app-sessions`). Always the first event in a session log
file. In full local / desktop / kiosk modes, the experimenter start
screen collects session metadata before the session is created, so
these fields are included in the marker event.

```json
{
  "event_type": "session.started",
  "data": {
    "log_mode": "research",
    "participant_id": "P-20260323-a1b",
    "trial_id": "T1",
    "session_label": "morning-run"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `log_mode` | string | Active log mode for this session: `"default"` or `"research"` |
| `participant_id` | string or absent | Pseudonymous participant identifier set by the experimenter. Absent when no metadata was provided (e.g., demo mode). |
| `trial_id` | string or absent | Optional trial/run identifier. |
| `session_label` | string or absent | Optional free-form session label. |
| `operator_notes` | string or absent | Optional experimenter notes. **Only persisted in research mode.** Omitted in default mode even if provided. |
| `effective_capture` | object | What this session actually captures, derived from `log_mode` and backend capabilities at session creation time. See below. |

**`effective_capture` fields** (all boolean):

| Field | When `true` |
| ----- | ----------- |
| `session_metadata` | Session metadata (participant_id, etc.) is recorded |
| `questionnaire_answers` | Questionnaire answers are recorded (research mode) |
| `form_answers` | Form answers are recorded (research mode) |
| `transcripts` | Conversation transcripts are recorded (research + realtime) |
| `gaze_samples` | Dense gaze stream is recorded (research mode) |
| `gaze_tobii_raw` | High-rate Tobii raw stream is recorded (research + Tobii) |
| `speaking_states` | Speaking state transitions are recorded (research + realtime) |
| `operator_notes_persisted` | Operator notes are stored in the log (research mode) |
| `audio_sent_to_openai` | Voice audio is sent to OpenAI (realtime enabled) |

This summary is also returned by `GET /api/runtime` so the frontend
can display it on the experimenter start screen and consent step
before the session begins.

### `study.step_entered`

Emitted when the study flow renders a new step. Every step in the flow
produces one of these events, making it possible to segment the session
log into steps and conditions.

```json
{
  "event_type": "study.step_entered",
  "data": {
    "step_id": "condition1",
    "step_type": "conversation",
    "step_index": 5,
    "condition": "baseline",
    "study_id": "demo-study"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `step_id` | string | The step's ID from `flow.json` |
| `step_type` | string | Step type: `info`, `consent`, `form`, `calibration`, `avatar_selection`, `conversation`, `questionnaire` |
| `step_index` | integer | Zero-based position in the step sequence |
| `condition` | string or null | Condition label (e.g., `"baseline"`, `"gazeaware"`) or `null` for non-conversation steps |
| `study_id` | string | Study identifier from study config |

### `study.avatar_selected`

Emitted when the participant selects an avatar in the avatar selection
step. Fires once per session (unless the flow has multiple selection
steps).

```json
{
  "event_type": "study.avatar_selected",
  "data": {
    "avatar_id": "avatar_b",
    "avatar_label": "Character A",
    "model_file": "AvatarSample_B.vrm",
    "voice": "alloy"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `avatar_id` | string | Avatar identifier from `avatars.json` |
| `avatar_label` | string | Display label shown to the participant |
| `model_file` | string | VRM file name |
| `voice` | string | Realtime voice ID associated with this avatar |

### `avatar.loaded`

Emitted when an avatar is successfully loaded for a conversation step.

```json
{
  "event_type": "avatar.loaded",
  "data": {
    "avatar_id": "avatar_b",
    "avatar_label": "Character A",
    "model_file": "AvatarSample_B.vrm",
    "voice": "alloy",
    "condition": "gazeaware",
    "step_id": "condition2"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `avatar_id` | string | Avatar identifier |
| `avatar_label` | string | Display label |
| `model_file` | string | VRM file name |
| `voice` | string | Voice ID |
| `condition` | string or null | Active condition for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |

### `gaze.intersection_changed`

Emitted when the gaze ray starts or stops intersecting the avatar's
face bounding box.

```json
{
  "event_type": "gaze.intersection_changed",
  "data": {
    "intersecting": true,
    "gaze_source": "mouse",
    "condition": "gazeaware",
    "step_id": "condition2",
    "elapsed_ms_since_step_start": 842.5
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `intersecting` | boolean | `true` when gaze enters the face bounding box, `false` when it leaves |
| `gaze_source` | string | `"mouse"` (browser demo / no Tobii) or `"backend"` (Tobii via backend) |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number or null | Frontend elapsed time since the conversation step began |

This fires on every transition (hit → miss or miss → hit), not on every
frame. In a typical session there are many of these events.

### `fsm.state_changed`

Emitted when the GazeAwarenessMachine transitions between states.
Only fires during `gazeaware` conditions (not during `baseline`).

```json
{
  "event_type": "fsm.state_changed",
  "data": {
    "from": "baseline",
    "to": "gazeaware_pending",
    "condition": "gazeaware",
    "step_id": "condition2",
    "elapsed_ms_since_step_start": 1186.9
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `from` | string or null | Previous FSM state (`null` for the initial transition) |
| `to` | string | New FSM state |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number or null | Frontend elapsed time since the conversation step began |

The four FSM states are: `baseline`, `gazeaware_pending`, `gazeaware`,
`gaze_break`. See `gaze_profiles.json` for timing parameters.

### `realtime.state_changed`

Emitted when the WebRTC voice session changes state.
Only fires when OpenAI Realtime is enabled.

```json
{
  "event_type": "realtime.state_changed",
  "data": {
    "state": "connected",
    "condition": "gazeaware"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `state` | string | Voice session state: `connecting`, `connected`, `idle`, or `error` |
| `condition` | string or null | Condition label for this conversation step |

### `gaze.source_status_changed`

Emitted when the backend gaze provider transitions between valid and
invalid data. Only fires when the gaze source is `backend` (Tobii mode),
and only on transitions — not per frame.

```json
{
  "event_type": "gaze.source_status_changed",
  "data": {
    "gaze_source": "backend",
    "status": "invalid"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `gaze_source` | string | Always `"backend"` (this event only fires for backend gaze) |
| `status` | string | `"valid"` (receiving gaze data) or `"invalid"` (no usable data) |

### `gaze.source_status_initialized`

Emitted once at the start of a conversation step to record the initial
backend gaze validity state. This closes the blind spot where a step
could stay valid (or invalid) the entire time and never emit a
transition event.

```json
{
  "event_type": "gaze.source_status_initialized",
  "data": {
    "gaze_source": "backend",
    "status": "valid",
    "condition": "gazeaware",
    "step_id": "condition2",
    "elapsed_ms_since_step_start": 0,
    "stale_threshold_ms": 150
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `gaze_source` | string | Always `"backend"` |
| `status` | string | Initial validity state: `"valid"` or `"invalid"` |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number | Always `0` for the initialized event |
| `stale_threshold_ms` | integer | Freshness threshold used to decide validity |

### `gaze.source_timeline_summary`

Emitted once when a conversation step ends. Summarises the backend
gaze-validity timeline for signal-quality analysis and also includes the
reconstructed valid/invalid segments.

```json
{
  "event_type": "gaze.source_timeline_summary",
  "data": {
    "gaze_source": "backend",
    "condition": "gazeaware",
    "step_id": "condition2",
    "total_ms": 180000.0,
    "valid_ms": 172450.5,
    "invalid_ms": 7549.5,
    "valid_ratio": 0.9581,
    "dropout_count": 3,
    "stale_threshold_ms": 150,
    "segments": [
      { "status": "valid", "start_ms": 0, "end_ms": 32450.2, "duration_ms": 32450.2 },
      { "status": "invalid", "start_ms": 32450.2, "end_ms": 32820.7, "duration_ms": 370.5 }
    ]
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `gaze_source` | string | Always `"backend"` |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `total_ms` | number | Total tracked duration for the step |
| `valid_ms` | number | Milliseconds spent in a valid state |
| `invalid_ms` | number | Milliseconds spent in an invalid state |
| `valid_ratio` | number or null | `valid_ms / total_ms` |
| `dropout_count` | integer | Number of invalid segments observed |
| `stale_threshold_ms` | integer | Freshness threshold used to decide validity |
| `segments` | array | Reconstructed valid/invalid timeline segments |

### Research mode only

The following events are only emitted when `LOG_MODE=research`. They
are never written in default mode.

### `gaze.avatar_eye_contact_changed`

Emitted when the avatar's eye contact state changes.

The avatar is considered to be making eye contact when its lookAt target
offset from the camera center is below a threshold (magnitude < 0.15),
meaning the avatar is oriented toward the user. This is derived from
the actual lookAt target position, not from the FSM state label.

In baseline conditions (no FSM), the avatar always faces the camera,
so `avatar_eye_contact` is always `true`.

```json
{
  "event_type": "gaze.avatar_eye_contact_changed",
  "data": {
    "avatar_eye_contact": true,
    "condition": "gazeaware",
    "step_id": "condition2",
    "elapsed_ms_since_step_start": 1422.1
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `avatar_eye_contact` | boolean | `true` when avatar is oriented toward the user, `false` when looking away |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number or null | Frontend elapsed time since the conversation step began |

### `gaze.mutual_gaze_changed`

Emitted when the mutual gaze state changes.

Mutual gaze is `true` when both conditions are met simultaneously:
1. The avatar is making eye contact (`avatar_eye_contact` is `true`)
2. The user is looking at the avatar's face (`user_intersection` is `true`)

```json
{
  "event_type": "gaze.mutual_gaze_changed",
  "data": {
    "mutual_gaze": true,
    "avatar_eye_contact": true,
    "user_intersection": true,
    "condition": "gazeaware",
    "step_id": "condition2",
    "elapsed_ms_since_step_start": 1540.8
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `mutual_gaze` | boolean | `true` when both avatar eye contact and user face intersection are active |
| `avatar_eye_contact` | boolean | Whether avatar is oriented toward the user at the time of transition |
| `user_intersection` | boolean | Whether user gaze hits the avatar face at the time of transition |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number or null | Frontend elapsed time since the conversation step began |

### `spy.gaze_zone_changed`

Emitted when the spy gameplay layer's active gaze zone changes.
This is useful for latency/responsiveness analysis because it marks when
the P1 zone system classified gaze as having moved between background,
officer, and evidence regions.

```json
{
  "event_type": "spy.gaze_zone_changed",
  "data": {
    "from_zone_id": "background",
    "from_zone_kind": "background",
    "to_zone_id": "evidence_photo",
    "to_zone_kind": "evidence",
    "condition": "baseline",
    "step_id": "condition1",
    "elapsed_ms_since_step_start": 6521.4
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `from_zone_id` | string or null | Previous active spy zone ID |
| `from_zone_kind` | string or null | Previous active spy zone kind |
| `to_zone_id` | string | New active spy zone ID |
| `to_zone_kind` | string | New active spy zone kind |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number or null | Frontend elapsed time since the conversation step began |

### `spy.metrics_summary`

Emitted once when the conversation step ends. Summarises the spy
gameplay metrics for downstream analysis so fixation, dwell, rapport,
and suspicion outcomes do not need to be reconstructed entirely from
frame-by-frame events.

```json
{
  "event_type": "spy.metrics_summary",
  "data": {
    "condition": "baseline",
    "step_id": "condition1",
    "total_tracked_ms": 171162.5,
    "fixation_count_total": 42,
    "fixation_count_per_zone": {
      "wall_map": 6,
      "newspaper": 5,
      "officer_face": 18
    },
    "dwell_ms_per_zone": {
      "background": 54210.4,
      "officer_body": 18745.8,
      "wall_map": 22318.1
    },
    "eye_contact_state_ms": {
      "baseline": 15430.2,
      "gazeaware_pending": 9022.4,
      "gazeaware": 118700.0,
      "gaze_break": 28009.9
    },
    "average_suspicion": 41.2381,
    "average_overall_suspicion": 46.9012,
    "average_rapport": 58.4403,
    "average_rapport_multiplier": 0.9342,
    "branch_history": ["VANE_01", "VANE_02", "VANE_08.1"]
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `total_tracked_ms` | number | Total gameplay time accumulated into the summary |
| `fixation_count_total` | integer | Total fixation count across the whole conversation |
| `fixation_count_per_zone` | object | Per-zone fixation counts keyed by spy zone ID |
| `dwell_ms_per_zone` | object | Total dwell time per spy zone ID |
| `eye_contact_state_ms` | object | Time spent in each eye-contact / gaze-FSM state |
| `average_suspicion` | number or null | Time-weighted average of momentary suspicion over the tracked interval |
| `average_overall_suspicion` | number or null | Time-weighted average of overall suspicion over the tracked interval |
| `average_rapport` | number or null | Time-weighted average of rapport over the tracked interval |
| `average_rapport_multiplier` | number or null | Time-weighted average of the rapport-derived suspicion multiplier |
| `branch_history` | string[] | Ordered dialogue line-node IDs visited during the script |

### `study.assignment_recorded`

Emitted once at the start of the study flow. Captures the resolved
session-scoped assignment so that downstream analysis has the exact
condition order, question assignment, and reproducibility seed.

```json
{
  "event_type": "study.assignment_recorded",
  "data": {
    "study_id": "demo-study",
    "study_mode": "within_subjects",
    "seed": 1234567890,
    "condition_order": ["baseline", "gazeaware"],
    "questions_per_condition": 5,
    "rounds": [
      {
        "round_index": 0,
        "step_id": "condition1",
        "condition": "baseline",
        "question_ids": ["q01", "q02", "q03", "q04", "q05"],
        "questions": ["What is the capital of France?", "..."]
      },
      {
        "round_index": 1,
        "step_id": "condition2",
        "condition": "gazeaware",
        "question_ids": ["q06", "q07", "q08", "q09", "q10"],
        "questions": ["Which ocean is the largest on Earth?", "..."]
      }
    ],
    "log_mode": "research"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `study_id` | string | Study identifier |
| `study_mode` | string | Descriptive study design label (e.g., `"within_subjects"`). No runtime effect. |
| `seed` | integer | RNG seed used to generate this assignment (for reproducibility) |
| `condition_order` | string[] | Actual condition order for this session (may differ from config due to counterbalancing) |
| `questions_per_condition` | integer | Number of quiz questions per condition |
| `rounds` | array | Per-round assignment details (see below) |
| `log_mode` | string | Active log mode |

Each round in `rounds` contains:

| Field | Type | Description |
| ----- | ---- | ----------- |
| `round_index` | integer | Zero-based round position |
| `step_id` | string | Conversation step ID from `flow.json` |
| `condition` | string | Assigned condition for this round |
| `question_ids` | string[] | Assigned question IDs from `prompts.json` |
| `questions` | string[] | Assigned question texts |

The `seed` field enables exact reproduction of any session's assignment.
With counterbalancing enabled (`condition_order_mode: "counterbalanced"`),
different sessions receive different condition orders and question
assignments.

### `study.form_submitted`

Emitted when a `form` step is completed. Captures the structured
answers keyed by field ID. Typical use: demographics.

```json
{
  "event_type": "study.form_submitted",
  "data": {
    "step_id": "demographic",
    "step_type": "form",
    "study_id": "demo-study",
    "answers": {
      "age": "25",
      "gender": "female",
      "corrective_lenses": "none"
    }
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `step_id` | string | Step ID from `flow.json` |
| `step_type` | string | Always `"form"` |
| `study_id` | string | Study identifier |
| `answers` | object | Form answers keyed by field ID (all values are strings) |

### `study.questionnaire_submitted`

Emitted when a `questionnaire` step is completed. Captures all answers
keyed by item ID. Covers round questionnaires, comparison, and feedback.

```json
{
  "event_type": "study.questionnaire_submitted",
  "data": {
    "questionnaire_id": "round",
    "step_id": "questionnaire1",
    "step_index": 6,
    "study_id": "demo-study",
    "condition": "baseline",
    "answers": {
      "q1": 4,
      "q2": 3,
      "q3": 5,
      "q4": 4,
      "q5": 3
    }
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `questionnaire_id` | string | Questionnaire key from `questionnaires.json` |
| `step_id` | string | Step ID from `flow.json` |
| `step_index` | integer | Zero-based step position |
| `study_id` | string | Study identifier |
| `condition` | string or null | Linked condition — set when the questionnaire directly follows a conversation step, `null` for cross-condition questionnaires (comparison, feedback) |
| `answers` | object | Answers keyed by item ID. Likert values are integers, choice/text values are strings. |

**Condition linking logic:** A questionnaire step inherits the condition
of the immediately preceding conversation step. If any other step type
intervenes, `condition` is `null`. This means per-round questionnaires
get their condition automatically, while comparison and feedback
questionnaires (which follow another questionnaire, not a conversation)
correctly get `null`.

### `conversation.turn`

Emitted when the OpenAI Realtime session delivers a completed
transcript for a user or assistant turn. Only fires in research mode
and only when a Realtime voice session is active.

**How transcripts are obtained:** The OpenAI Realtime WebRTC
DataChannel sends structured events including
`response.audio_transcript.done` (assistant speech-to-text) and
`conversation.item.input_audio_transcription.completed` (user
speech-to-text via Whisper). The frontend listens for these events
and emits `conversation.turn` log entries. No audio is stored or
persisted — only the textual transcript.

**User transcripts** require `input_audio_transcription` to be
enabled in the session config. The backend enables this automatically
when `LOG_MODE=research`.

```json
{
  "event_type": "conversation.turn",
  "data": {
    "role": "assistant",
    "transcript": "Hello! Let me ask you a few questions.",
    "item_id": "item_001",
    "condition": "gazeaware",
    "step_id": "condition2",
    "turn_index": 0
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `role` | string | `"user"` or `"assistant"` |
| `transcript` | string | Completed transcript text for this turn |
| `item_id` | string or null | OpenAI conversation item ID (for cross-referencing with Realtime events) |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `turn_index` | integer | Zero-based sequential turn counter, resets per conversation step |

**Limitations:**
- Transcripts are only available when OpenAI Realtime is active
- User transcripts depend on Whisper quality and may contain errors
- `turn_index` counts within a single voice session per step; if the
  user disconnects and reconnects within the same step, the counter
  does not reset
- No raw audio is stored — only the text returned by OpenAI

### `conversation.speaking_changed`

Emitted when a user or assistant starts or stops speaking during a
Realtime voice session. Only fires in research mode and only when
a Realtime voice session is active.

**How speaking is detected:**

- **User:** OpenAI's server-side voice activity detection (VAD) sends
  `input_audio_buffer.speech_started` and `speech_stopped` events via
  the WebRTC DataChannel. No custom VAD is implemented — the signals
  come directly from OpenAI's turn detection system.
- **Assistant:** `response.created` marks the start of a new assistant
  response (audio generation begins). `response.done` marks the end
  of the complete response. In WebRTC mode, audio streams through the
  audio track — not the DataChannel — so audio-chunk events are not
  available. The response lifecycle events are reliable proxies for
  speaking phases, though there may be a small latency offset between
  `response.created` and the user actually hearing audio.

```json
{
  "event_type": "conversation.speaking_changed",
  "data": {
    "role": "user",
    "speaking": true,
    "condition": "gazeaware",
    "step_id": "condition2"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `role` | string | `"user"` or `"assistant"` |
| `speaking` | boolean | `true` when speech starts, `false` when speech ends |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |

**Limitations:**
- Only available when OpenAI Realtime is active (no speaking detection
  without a voice session)
- User speech detection depends on OpenAI's server-side VAD accuracy
- Assistant speaking boundaries track response lifecycle
  (`response.created`/`response.done`), not audio playback — there
  may be a small delay between `speaking: true` and the user hearing
  audio due to generation and network latency
- No audio content is stored — only the boolean speaking state

### `gaze.sample`

Emitted at a configurable rate during conversation steps. Provides
a dense gaze time-series for heatmaps and temporal analysis. Only
fires in research mode. Not emitted when backend gaze data is
stale/invalid.

**Sampling rate:** Configurable via `RESEARCH_GAZE_SAMPLE_HZ` in
`backend/.env` (default: 90). The backend includes this value in
the `/api/runtime` response; the frontend uses it to set the
throttle interval. Samples are taken inside the existing
`requestAnimationFrame` loop using `performance.now()`.

Effective rate limits by gaze source:

| Source | Max effective rate | Limiting factor |
| ------ | ------------------ | --------------- |
| Mouse  | ~60 Hz | rAF / display refresh rate |
| Backend (Tobii, WS) | ~125 Hz | WebSocket push check rate |
| Backend (Tobii, polling fallback) | ~30 Hz | HTTP polling interval (33 ms) |

Setting `RESEARCH_GAZE_SAMPLE_HZ` above the source's effective
ceiling will not produce higher-resolution data — the sampler
will emit at the source rate with duplicate-free throttling.

At 90 Hz a 5-minute conversation produces ~27 000 samples (~6 MB
JSONL). At 10 Hz: ~3 000 samples (~700 KB).

**Coordinate system:** `x_norm` and `y_norm` are normalised to
`[0, 1]` relative to the viewer container (the 3D canvas area).
`x_px` and `y_px` are the derived pixel positions within the
container. `viewer_width_px` and `viewer_height_px` record the
container dimensions at the time of the sample, so pixel values
can be validated or recomputed if the container was resized.

For mouse input, coordinates are the mouse position within the
container. For backend (Tobii) input, screen-normalised coordinates
are remapped to container-relative values.

```json
{
  "event_type": "gaze.sample",
  "data": {
    "x_norm": 0.5023,
    "y_norm": 0.3455,
    "x_px": 401.8,
    "y_px": 207.3,
    "viewer_width_px": 800,
    "viewer_height_px": 600,
    "viewer_left_screen_px": 560.0,
    "viewer_top_screen_px": 84.0,
    "viewer_left_screen_norm": 0.2917,
    "viewer_top_screen_norm": 0.0778,
    "viewer_width_screen_norm": 0.4167,
    "viewer_height_screen_norm": 0.5556,
    "gaze_source": "mouse",
    "intersecting": true,
    "avatar_lookat_yaw_deg": 18.02,
    "avatar_lookat_pitch_deg": 3.99,
    "condition": "gazeaware",
    "step_id": "condition2",
    "elapsed_ms_since_step_start": 12450.6
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `x_norm` | number | Normalised gaze x [0, 1] relative to viewer container |
| `y_norm` | number | Normalised gaze y [0, 1] relative to viewer container |
| `x_px` | number | Gaze x in CSS pixels within the viewer container |
| `y_px` | number | Gaze y in CSS pixels within the viewer container |
| `viewer_width_px` | integer | Viewer container width in CSS pixels |
| `viewer_height_px` | integer | Viewer container height in CSS pixels |
| `viewer_left_screen_px` | number | Viewer container left edge in CSS pixels relative to the full screen |
| `viewer_top_screen_px` | number | Viewer container top edge in CSS pixels relative to the full screen |
| `viewer_left_screen_norm` | number | Viewer container left edge normalised to full-screen width |
| `viewer_top_screen_norm` | number | Viewer container top edge normalised to full-screen height |
| `viewer_width_screen_norm` | number | Viewer container width normalised to full-screen width |
| `viewer_height_screen_norm` | number | Viewer container height normalised to full-screen height |
| `gaze_source` | string | `"mouse"` or `"backend"` (Tobii) |
| `intersecting` | boolean | Whether gaze hits the avatar face bounding box |
| `avatar_lookat_yaw_deg` | number or null | Horizontal angle of the avatar's lookAt target from the camera center, in degrees. Positive = target right of the user. `null` when no avatar is loaded. |
| `avatar_lookat_pitch_deg` | number or null | Vertical angle of the avatar's lookAt target from the camera center, in degrees. Positive = target above center. `null` when no avatar is loaded. |
| `condition` | string or null | Condition label for this conversation step |
| `step_id` | string or null | Step ID from `flow.json` |
| `elapsed_ms_since_step_start` | number or null | Frontend `performance.now()` elapsed time since the conversation step began |

**Precision:** `x_norm`/`y_norm` are rounded to 4 decimal places
(0.0001 ≈ 0.1 px on a 1000 px container). `x_px`/`y_px` are
rounded to 1 decimal place. `avatar_lookat_yaw_deg`/`avatar_lookat_pitch_deg`
are rounded to 2 decimal places.

**Avatar lookAt orientation:** `avatar_lookat_yaw_deg` and
`avatar_lookat_pitch_deg` are derived from the VRM lookAt target's
camera-local offset, not from head/eye bone rotation directly.
The lookAt target is a child of the camera; offset `(0, 0, 0)` =
avatar looking directly at the camera (eye contact). The angles
are computed as `atan2(offset.x, camera_z) * 180/π` (yaw) and
`atan2(offset.y, camera_z) * 180/π` (pitch), where `camera_z`
is the camera-to-avatar distance (~2.15 units).

In **baseline** conditions (no gaze FSM), the lookAt target stays
at `(0, 0, 0)`, so both values are always `0.0` (constant eye
contact). In **gazeaware** conditions, the values change with FSM
state transitions: `~18°/~4°` when the avatar is looking away
(baseline/pending states), `0°/0°` during mutual eye contact
(gazeaware state), `~-20°/~-7°` during gaze breaks.

These values reflect the actual lookAt target input, not the final
VRM bone rotation (which may differ due to VRM lookAt clamping and
smoothing). They change discretely when the FSM transitions; if
future work adds smooth transitions or independent head motion,
the values will capture that continuously at the sample rate.

### `gaze.tobii_raw`

Emitted by the backend Tobii adapter at the hardware sample rate
(typically ~90 Hz). This is a **Tobii-only** event — it is never
emitted for mouse gaze. Only fires in research mode and only when
a session with an active conversation step is in progress.

**How it differs from `gaze.sample`:**

| | `gaze.sample` | `gaze.tobii_raw` |
|-| --------------------- | ----------------------- |
| Source | Frontend rAF loop | Backend Tobii adapter thread |
| Rate | Configurable (default 90 Hz) | Tobii hardware rate (~90 Hz) |
| Gaze sources | Mouse + Backend | Backend (Tobii) only |
| Coordinates | Viewer-container-relative | Screen-normalised + raw pixel |
| Includes intersection | Yes | No (no avatar context in backend) |
| Includes viewer size | Yes | No |
| Purpose | Cross-source heatmaps, viewer analysis | High-rate eye tracking, fixation/saccade analysis |

Both event types can coexist in the same session log — they serve
different analysis needs.

**Sampling:** One event per ZMQ message from TobiiStream. The
backend buffers up to 50 samples and flushes to JSONL every 50
samples or every 500 ms, whichever comes first. This keeps file
I/O manageable (~2 writes/sec at 90 Hz).

**Context:** The frontend syncs the current session/step/condition
to the backend via `POST /api/gaze/context` when conversation steps
start and end. The Tobii thread reads this context to tag samples.
Between conversation steps, no samples are logged (context is
cleared).

**Achievable rate:** The actual rate depends on Tobii hardware. Most
consumer Tobii trackers run at 60–90 Hz. TobiiStream delivers one
ZMQ message per sample. The backend receives and logs each message
with ~1 ms loop latency. The logged rate will match the actual
hardware output — no artificial upsampling.

```json
{
  "event_type": "gaze.tobii_raw",
  "data": {
    "x_norm": 0.4821,
    "y_norm": 0.3102,
    "x_raw_px": 925.6,
    "y_raw_px": 335.0,
    "seq": 48001,
    "capture_adapter": "tobii_stream",
    "gaze_source": "backend",
    "step_id": "condition2",
    "condition": "gazeaware",
    "elapsed_ms_since_step_start": 12447.2
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `x_norm` | number | Normalised gaze x [0, 1] relative to full screen |
| `y_norm` | number | Normalised gaze y [0, 1] relative to full screen |
| `x_raw_px` | number or null | Raw screen x in pixels from the active Tobii adapter |
| `y_raw_px` | number or null | Raw screen y in pixels from the active Tobii adapter |
| `seq` | integer or null | TobiiStream sequence number when available; `null` for direct Tobii Pro SDK capture |
| `capture_adapter` | string | `"tobii_stream"` or `"tobii_pro"` |
| `gaze_source` | string | Always `"backend"` |
| `step_id` | string or null | Step ID from study context sync |
| `condition` | string or null | Condition from study context sync |
| `elapsed_ms_since_step_start` | number or null | Backend elapsed time since the current conversation step context was set |

**Note:** `x_norm`/`y_norm` are screen-relative (full display), not
viewer-container-relative like `gaze.sample`. To map these to the
viewer container, use the viewer screen-rect fields from `gaze.sample`
(`viewer_left_screen_norm`, `viewer_top_screen_norm`,
`viewer_width_screen_norm`, `viewer_height_screen_norm`).

**Precision:** `x_norm`/`y_norm` rounded to 4 decimal places.
`x_raw_px`/`y_raw_px` rounded to 1 decimal place (sub-pixel from
TobiiStream).

## What is NOT logged

- No personally identifiable information (names, emails, IPs)
- No gaze coordinate streams in default mode (only intersection
  change events; research mode adds `gaze.sample` at configurable
  rate, default 90 Hz)
- No raw audio content (no audio recording, no audio files)
- No API keys or secrets
- No transcripts in default mode (only in research mode via
  `conversation.turn` events)

See [PRIVACY.md](PRIVACY.md) for the full data handling policy.

## Demo mode vs full local mode

| | Full local mode | Demo mode (`?demo`) |
|-| --------------- | ------------------- |
| Events sent to backend | Yes | No |
| JSONL files created | Yes, in `data/logs/` | No |
| Session ID source | Backend (`POST /api/app-sessions`) | Frontend (`crypto.randomUUID()`) |
| Telemetry reporter | Active (`BackendReporter`) | Disabled |

In demo mode, the `BackendReporter` is instantiated with `disabled: true`.
No network calls are made and no log files are written.

## Backend API endpoints

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/app-sessions` | POST | Create a new session. Accepts optional JSON body with `participant_id`, `trial_id`, `session_label`, `operator_notes`. Returns `{ session_id }`. |
| `/api/sessions/{id}/assignment` | POST | Generate or return existing session-scoped study assignment. Body: `{ study_id }`. |
| `/api/studies/{id}` | GET | Load the complete study configuration for the given study ID. |
| `/api/runtime` | GET | Runtime capabilities, log mode, and effective capture flags. |
| `/api/health` | GET | Health check. Returns `{ status: "ok" }`. |
| `/api/log/events` | POST | Accept a batch of events `{ events: [...] }` |
| `/api/logs` | POST | Alias for `/api/log/events` |
| `/api/realtime/session` | POST | Relay SDP offer to OpenAI Realtime API, return SDP answer. |
| `/api/gaze/context` | POST | Sync session context (session ID, step, condition) for Tobii logging. |
| `/api/gaze/latest` | GET | Last gaze sample (polling fallback when WebSocket is unavailable). |
| `/api/gaze/stream` | WebSocket | Live gaze data stream. |

The frontend batches events and flushes them every 5 seconds (default).
The backend groups events by `session_id` and appends to the
corresponding JSONL file.

## Sample logs

Three synthetic sample logs are included in the repository for reference
and testing:

| File | Description |
| ---- | ----------- |
| `data/sample/demo-session-full.jsonl` | 54 events — research mode session with full study outcomes: assignment metadata, demographics, step navigation, avatar selection, gaze samples, Tobii raw samples, gaze/FSM/voice events, speaking states, mutual gaze, conversation transcripts, all questionnaire submissions |
| `data/sample/demo-session-counterbalanced.jsonl` | 44 events — research mode session with reversed condition order (gazeaware → baseline). Includes all major event types with counterbalanced assignment. |
| `data/sample/demo-session-minimal.jsonl` | 4 events — step entry, avatar load, two gaze changes |

These contain only synthetic data — no real participant, gaze, or audio
data. They illustrate the event types and field structures documented
above.

## Inspecting logs

A summary script is included:

```bash
python scripts/inspect_logs.py data/sample/demo-session-full.jsonl
```

Output:

```
File:       demo-session-full.jsonl
Events:     54
Session(s): a1b2c3d4e5f60001
Time span:  2026-01-15T10:29:54.500Z  ->  2026-01-15T10:31:22.100Z

Event types:
  study.step_entered                         11
  conversation.speaking_changed               6
  gaze.sample                                 5
  gaze.intersection_changed                   5
  study.questionnaire_submitted               4
  fsm.state_changed                           4
  gaze.tobii_raw                              3
  realtime.state_changed                      3
  conversation.turn                           3
  avatar.loaded                               2
  gaze.avatar_eye_contact_changed             2
  gaze.mutual_gaze_changed                    2
  session.started                             1
  study.assignment_recorded                   1
  study.form_submitted                        1
  study.avatar_selected                       1

Step sequence:
  [0] welcome (info)
  [1] consent (consent)
  [2] demographic (form)
  [4] character_selection (avatar_selection)
  [5] condition1 (conversation)  (baseline)
  [6] questionnaire1 (questionnaire)
  [7] condition2 (conversation)  (gazeaware)
  [8] questionnaire2 (questionnaire)
  [9] comparison (questionnaire)
  [10] feedback (questionnaire)
  [11] ending (info)

Log mode:   research

Study assignment:
  study_id:    demo-study
  study_mode:  within_subjects
  seed:        1234567890
  cond. order: ['baseline', 'gazeaware']
  q/condition: 5
    round 0: baseline (condition1) -> ['q01', 'q02', 'q03', 'q04', 'q05']
    round 1: gazeaware (condition2) -> ['q06', 'q07', 'q08', 'q09', 'q10']

Form submissions:
  [demographic] age=25, gender=female, corrective_lenses=none

Questionnaire submissions:
  [questionnaire1] round (baseline)  — 5 answer(s)
  [questionnaire2] round (gazeaware)  — 5 answer(s)
  [comparison] comparison  — 2 answer(s)
  [feedback] feedback  — 1 answer(s)

Conversation turns: 3 total (1 user, 2 assistant)
  Steps with turns: condition2
  [0] assistant: Hello! Let me ask you a few questions. Which ocean is the la...
  [1] user: I think it's the Pacific Ocean.
  [2] assistant: That's correct! The Pacific Ocean is the largest. Next quest...

Speaking transitions: 6 (2 user, 4 assistant)
  Steps: condition2

Gaze samples: 5 (~90 Hz research stream)
  Steps: condition1, condition2
  Intersecting: 3/5
  Avatar lookAt yaw:   min=0.00  max=18.02  (deg)
  Avatar lookAt pitch:  min=0.00  max=3.99  (deg)

Tobii raw samples: 3 (backend high-rate)
  Steps: condition2
  Seq range: 48001–48003
  Time span: 2026-01-15T10:30:35.611Z -> 2026-01-15T10:30:35.633Z

Avatar eye contact transitions: 2
  Onsets (avatar looking at user): 1
Mutual gaze transitions: 2
  Onsets (both looking at each other): 1

Gaze source(s): backend, mouse
```

The script counts events, groups by type, shows the step sequence,
study assignment, form and questionnaire submissions, and lists gaze
sources. It requires no dependencies beyond Python 3.11+.
Run with multiple files to compare sessions:

```bash
python scripts/inspect_logs.py data/logs/*.jsonl
```

JSONL log files can also be loaded directly with Python:

```python
import json
events = [json.loads(line) for line in open("session.jsonl")]
```

Or with pandas:

```python
import pandas as pd
df = pd.read_json("session.jsonl", lines=True)
```

## Current limitations

- **No database** — JSONL files are the only persistence layer.
- **No built-in export** to CSV, Parquet, or other analysis formats.
  JSONL can be loaded directly with Python's `json` module or with
  `pandas.read_json("file.jsonl", lines=True)`.
- **LookAt orientation is target-derived** — `avatar_lookat_yaw_deg` and
  `avatar_lookat_pitch_deg` in `gaze.sample` events are derived from
  the lookAt target offset, not from head/eye bone rotation directly.
  They reflect the input to VRM's lookAt system, not the final bone
  pose after clamping and smoothing.
- **Mutual gaze / avatar eye contact** — available in research mode via
  `gaze.avatar_eye_contact_changed` and `gaze.mutual_gaze_changed`
  events. Avatar eye contact is derived from the lookAt target offset,
  not from geometric head/eye bone analysis. See the event documentation
  above for details and limitations.
- **Speaking detection requires Realtime** — `conversation.speaking_changed`
  events are only emitted when an OpenAI Realtime voice session is active.
  User speech detection relies on OpenAI's server-side VAD; assistant
  speaking tracks audio generation, not playback.
- **Transcripts only in research mode** — `conversation.turn` events
  capture user/assistant transcripts from the OpenAI Realtime
  DataChannel, but only when `LOG_MODE=research`.
- **Schema may evolve** — `schema_version` will increment if the event
  format changes in future versions.

## Further reading

- [Privacy](PRIVACY.md) — what data is processed and stored
- [Architecture](ARCHITECTURE.md) — system overview and telemetry flow
- [Create Your Own Study](CREATE_STUDY.md) — study configuration guide
