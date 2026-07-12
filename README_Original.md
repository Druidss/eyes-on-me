# Gaze-Aware Avatar Study Kit

A configurable, public-safe research software kit for building and running
gaze-aware human-avatar studies with VRM avatars. It supports JSON-driven
study flows, configurable gaze profiles, optional Tobii eye tracking,
optional OpenAI Realtime voice interaction, structured JSONL telemetry,
and a browser demo mode without specialized hardware.

The software is built as a three-tier architecture: an Electron desktop shell,
a TypeScript/Three.js frontend, and a FastAPI backend. Study content — including
flow, avatars, prompts, questionnaires, and gaze profiles — is driven by JSON
configuration.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Try_it_now-2563eb)](https://ad-042.github.io/gaze-aware-avatar-study-kit/?demo)

**[Try the browser demo](https://ad-042.github.io/gaze-aware-avatar-study-kit/?demo)** — no install needed. Runs entirely in the browser using mouse as gaze source. Realtime voice and Tobii are disabled. The full study flow (welcome, consent, demographics, calibration, avatar selection, conversation rounds, questionnaires) is explorable.

> **Provenance and status**
>
> This project **began as a ground-up rewrite** of an earlier research
> prototype. The overall architecture, toolchain, and platform code are
> new. The current viewer behavior stack includes adapted modules ported
> from the open-source ChatVRM project (MIT) — see
> [docs/THIRD_PARTY_ASSETS.md](docs/THIRD_PARTY_ASSETS.md) for details.
> Implementation and documentation were **significantly assisted by
> Claude Code** (Anthropic).
> This is **experimental research software**. There is no guarantee of
> completeness, correctness, or bug-free behavior. Use at your own
> discretion and verify results independently.

## Main Features

- **Config-driven study flow** — steps, avatars, prompts, and questionnaires
  are defined in JSON; no hardcoded study content
- **Gaze-aware VRM avatars** — Three.js scene with gaze-state logic and
  optional richer avatar behavior over time
- **Public browser demo** — a browser-first demo path using mouse as the
  gaze source; no external hardware required
- **Optional Tobii eye tracking** — backend ZMQ adapter relays real gaze
  data with graceful fallback when unavailable
- **Optional OpenAI Realtime voice** — backend SDP relay keeps the API key
  server-side; after setup, WebRTC audio flows directly Browser ↔ OpenAI
- **JSONL telemetry** — structured per-session event logs with a default
  (slim) and research (extended) log mode; research mode adds transcripts,
  dense gaze streams, mutual gaze, and study outcomes
- **CI** — GitHub Actions for lint, build, unit tests, Playwright E2E
  (demo + full-local integration), and Windows release build smoke

## Repository Structure

| Folder       | Purpose                                              |
| ------------ | ---------------------------------------------------- |
| `backend/`   | FastAPI backend — API only, no server rendering      |
| `frontend/`  | TypeScript frontend — Three.js + VRM avatars         |
| `electron/`  | Desktop shell and child-process manager              |
| `study/`     | Study config JSONs (one subfolder per study)         |
| `scripts/`   | Dev helper scripts and small CLI tooling             |
| `data/`      | Runtime logs                                         |
| `docs/`      | Active docs: architecture, privacy, setup, guides    |

## Quickstart

### Prerequisites

| Tool       | Version   | Notes                                        |
| ---------- | --------- | -------------------------------------------- |
| Node.js    | 22+       |                                              |
| Python     | 3.11+     |                                              |
| npm        | (bundled) |                                              |
| Git        | any       |                                              |

### 1. Clone and install

```bash
git clone https://github.com/ad-042/gaze-aware-avatar-study-kit.git
cd gaze-aware-avatar-study-kit

# Backend
cd backend
python -m venv .venv
# Linux / macOS:
source .venv/bin/activate
# Windows (PowerShell):
.venv\Scripts\Activate.ps1

pip install -e ".[dev]"
cd ..

# Frontend
cd frontend
npm ci
cd ..
```

### 2. Demo avatars (included)

Two demo VRM avatars (AvatarSample_B and AvatarSample_C) are included in
the repository. No manual avatar setup is needed for the default browser
demo.

To use your own avatars, place `.vrm` files in
`frontend/public/avatars/` and edit `study/demo-study/avatars.json`.
Custom avatar files are git-ignored by default. See
[docs/THIRD_PARTY_ASSETS.md](docs/THIRD_PARTY_ASSETS.md) for details.

### 3. Create backend `.env`

Create a file at `backend/.env`. Minimal content for the default backend:

```dotenv
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8000
```

To enable extended research logging (see [docs/DATA_FORMATS.md](docs/DATA_FORMATS.md)):

```dotenv
LOG_MODE=research
```

For optional features, see sections below.

### 4a. Public Browser Demo (no backend required)

The fastest way to see the project in action — no Python backend needed:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173/?demo` in your browser.

The `?demo` query parameter activates demo mode:
- study config is loaded from a static JSON snapshot
- telemetry is disabled
- Realtime voice is disabled
- Tobii is disabled
- mouse position is used as the gaze source
- the full study flow remains explorable

This mode is suitable for public sharing and static hosting after
`npm run build`.

### 4b. Full Local Mode (with backend)

For the complete experience including telemetry logging and optional
Realtime voice, run both backend and frontend:

```bash
# Terminal 1 — Backend
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

If the backend runs on a different port, set `VITE_API_URL`:

```bash
VITE_API_URL=http://localhost:8001 npm run dev
```

### 4c. Desktop Dev Mode (Electron + Vite)

Install Electron dependencies:

```bash
cd electron
npm ci
```

Start the frontend dev server and Electron in separate terminals:

```bash
# Terminal 1
cd frontend
npm run dev

# Terminal 2
cd electron
npm run dev
```

Electron spawns its own backend process and waits for `/api/health`
before showing the window. The frontend is loaded from the Vite dev
server (`http://localhost:5173`).

### 4d. Desktop Production Mode (Electron, no Vite)

Build the frontend first, then start Electron in production mode:

```bash
# Build frontend
cd frontend
npm run build

# Start desktop app
cd ../electron
npm run start
```

In this mode, Electron loads the built frontend directly from
`frontend/dist/` — no Vite dev server is needed. The backend is still
spawned and managed by Electron. The frontend detects the `file://`
protocol and sends API requests directly to `http://127.0.0.1:8000`.

### 4e. Lab / Kiosk Mode (Electron, fullscreen study)

For controlled lab or study sessions, start Electron in kiosk mode:

```bash
# Build frontend first (if not already done)
cd frontend
npm run build

# Start in kiosk mode
cd ../electron
npm run lab
```

This mode is identical to desktop prod mode but opens the window in
fullscreen kiosk mode (no window chrome, no taskbar). DevTools
shortcuts (F12, Ctrl+Shift+I) are suppressed.

**Safe exit:** Press `Ctrl+Shift+Q` to quit the kiosk app cleanly.

### 4f. Windows Release Build (portable, no dev tools needed)

Build a self-contained Windows release that bundles the backend
(PyInstaller executable), the built frontend, study files, and
the Electron shell. No Python install or Vite is needed to run it.

**Additional prerequisites:**

| Tool       | Install                                      |
| ---------- | -------------------------------------------- |
| PyInstaller | `cd backend && pip install -e ".[package]"` |

Optional for Tobii support in the release:
`cd backend && pip install -e ".[tobii]"`

**Build:**

```powershell
.\scripts\build_release.ps1
```

This produces `release/win-unpacked/` — a portable directory you can
copy to any Windows machine and run directly.

**Run the release:**

```
release\win-unpacked\gaze-aware-avatar-study-kit.exe
```

**Configuration:** place an optional `.env` file next to
`gaze-aware-avatar-study-kit.exe` to configure OpenAI Realtime, Tobii, log mode, etc:

```
release/win-unpacked/
  gaze-aware-avatar-study-kit.exe
  .env              <-- optional config file
  resources/...
```

**Logs** are written to Electron's `userData` directory
(typically `%APPDATA%/gaze-aware-avatar-study-kit/data/logs/`).

The backend binds to `127.0.0.1:8000` (fixed in packaged mode).
No extra console window appears — backend output is captured
internally.

**Without `.env`:** the app starts with Realtime and Tobii
disabled. All other features work normally.

### 5. Run Tests and Lint

```bash
# Backend
cd backend
pytest -q
ruff check .
ruff format --check .

# Frontend
cd frontend
npm test
npm run lint
npm run build
```

Or use the helper scripts:

```bash
./scripts/dev.sh lint          # Linux / macOS
.\scripts\dev.ps1 lint       # Windows PowerShell
```

## Optional Features

### Tobii Eye Tracking

Tobii integration is **optional and Windows-only**. The project is
currently developed and tested with the **Tobii Eye Tracker 4C**. Other
Tobii models that work with TobiiStream may function but are untested.
The browser demo works without Tobii. See
[docs/TOBII_SETUP.md](docs/TOBII_SETUP.md).

Minimal example in `backend/.env`:

```dotenv
TOBII_ENABLED=true
TOBIISTREAM_PATH=C:\path\to\TobiiStream.exe
TOBII_ZMQ_ENDPOINT=tcp://127.0.0.1:5556
```

### OpenAI Realtime Voice

Realtime voice chat is **optional**. It requires an OpenAI API key in
`backend/.env` and explicit enablement:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_ENABLED=true
OPENAI_REALTIME_MODEL=gpt-realtime-mini
OPENAI_REALTIME_VOICE=alloy
```

The API key stays in the backend. The frontend never sends a direct
Bearer-key request to OpenAI.

**Operating constraints:** Realtime voice works best in a **quiet
environment**. OpenAI's server-side VAD (voice activity detection) is
sensitive to background noise — ambient sounds can trigger unintended
responses or prevent reliable speech detection. Use a headset and
minimize background noise where possible. The model and voice can be
changed via `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE` in
`backend/.env`. Deeper VAD / turn-detection tuning currently requires
backend code changes. See
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for more tips.

## Known Limitations

- **Calibration** — the calibration step performs a 3-point gaze
  verification (fixation check); it does not replace the eye tracker
  manufacturer's own calibration tool
- **Static demo config** — `?demo` uses a generated snapshot; regenerate
  with `python scripts/build_demo_config.py` after editing study config
- **Conversation UX** — voice session auto-starts when entering a
  conversation step (if Realtime is enabled); the assistant triggers its
  first turn automatically. Microphone permission must be granted by the
  browser; if auto-start fails, a manual start button appears as fallback
- **Gaze transitions** — avatar gaze uses per-state saccade profiles
  with smooth interpolation; idle head micro-motion blends with VRM
  lookAt; gaze breaks use randomized aversion directions
- **Sideband control** — no ongoing server-side Realtime control after
  the initial WebRTC session setup
- **Avatar expressions** — auto-blink, a subtle default expression, and
  emotion presets are driven by the ChatVRM-derived behaviour runtime
  (`ChatVrmAvatarRuntime`); lip sync reacts to Realtime audio volume
  (amplitude-based, no phoneme detection); richer mood systems are not
  implemented

## Further Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Create Your Own Study](docs/CREATE_STUDY.md)
- [Data Formats](docs/DATA_FORMATS.md)
- [Privacy](docs/PRIVACY.md)
- [Tobii Setup](docs/TOBII_SETUP.md)
- [Third-Party Assets](docs/THIRD_PARTY_ASSETS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
