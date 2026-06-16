# Third-Party Assets

This document lists all third-party code, assets, and external dependencies
used by Gaze-Aware Avatar Study Kit. It exists for transparency — so that anyone cloning or
forking the repo knows exactly what is included, what is excluded, and what
they need to provide themselves.

This is not legal advice. If you plan to redistribute modified versions of
this project, review the relevant licenses yourself.

## Third-party code included in the repo

### ChatVRM-derived behavior modules

`frontend/src/modules/viewer/chatvrm/` contains avatar behavior modules
ported and adapted from the open-source ChatVRM project (MIT license).
These modules cover lookAt smoothing, auto-blink, expression/emote
control, lip sync, and VRM animation loading.

- Primary source: [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM) (MIT)
- Secondary reference: [zoan37/ChatVRM](https://github.com/zoan37/ChatVRM) (MIT)
- Tertiary reference: [josephrocca/ChatVRM-js](https://github.com/josephrocca/ChatVRM-js) — used only as a viewer/asset/standalone reference where relevant

The ported modules have been adapted to compile against the current
Gaze-Aware Avatar Study Kit toolchain (three 0.183 / @pixiv/three-vrm 3.5 / TypeScript 5.x).
All ported modules are **active in the runtime path**:
- `VRMLookAtSmoother` / `VRMLookAtSmootherLoaderPlugin` drive the
  avatar's lookAt/gaze behavior (smooth damped tracking, head rotation
  blending, eye saccade micro-jitter)
- `VRMAnimation` / `loadVRMAnimation` loads `idle_loop.vrma` for idle
  body animation
- `ChatVrmAvatarRuntime` coordinates `AutoBlink`, `ExpressionController`,
  `EmoteController`, and `LipSync` as the central blink/expression/lip
  sync owner

### npm / pip dependencies

All runtime dependencies are installed via standard package managers:

### Frontend (npm)

| Package             | Version | License | Purpose                      |
| ------------------- | ------- | ------- | ---------------------------- |
| `three`             | 0.183   | MIT     | 3D rendering engine          |
| `@pixiv/three-vrm`  | 3.5     | MIT     | VRM avatar loading for Three.js |

Dev dependencies (TypeScript, Vite, ESLint, Vitest) are build/test tools
only and are not shipped to end users.

Full list: `frontend/package.json`

### Backend (pip)

| Package            | License    | Purpose                        |
| ------------------ | ---------- | ------------------------------ |
| `fastapi`          | MIT        | Web framework                  |
| `uvicorn`          | BSD-3      | ASGI server                    |
| `pydantic`         | MIT        | Data validation                |
| `python-dotenv`    | BSD-3      | Environment file loading       |
| `httpx`            | BSD-3      | HTTP client (OpenAI SDP relay) |
| `pyzmq` (optional) | BSD-3     | ZMQ bindings (Tobii adapter)   |

Dev dependencies (ruff, pytest) are lint/test tools only.

Full list: `backend/pyproject.toml`

## VRM avatars

### Demo avatars included in the repo

Two VRM demo avatars are committed to the repository:

| File | Source | Model page |
| ---- | ------ | ---------- |
| `frontend/public/avatars/AvatarSample_B.vrm` | VRoid Hub — AvatarSample_B | https://hub.vroid.com/en/characters/8604951156498804530/models/7726079986498742071 |
| `frontend/public/avatars/AvatarSample_C.vrm` | VRoid Hub — AvatarSample_C | https://hub.vroid.com/en/characters/2446659191657992498/models/4391498938498498498 |

These models are part of the VRoid Hub "VRoidPreset_A–Z" sample set
published by pixiv Inc.

**Conditions at the time of inclusion (check the model pages for current
terms):**

- Redistribution: allowed
- Alterations: allowed
- Corporate use: allowed
- Individual commercial use: allowed
- Attribution: not required

These conditions apply specifically to these two models as stated on
their VRoid Hub model pages. They do not imply that every VRM model on
VRoid Hub is redistributable — each model has its own terms.

For background on the VRoidPreset sample models, see the VRoid Hub FAQ.

### Custom avatars

`.vrm` and `.fbx` files are excluded from git tracking by default
(`.gitignore`). Only the two demo avatars listed above are explicitly
allowed via a gitignore allowlist.

To use your own avatars, place `.vrm` files in
`frontend/public/avatars/` and edit `study/demo-study/avatars.json` (or
your own study config) to reference them. Custom avatar files remain
git-ignored and will not be committed.

If the demo avatar files are missing, the conversation step displays a
designed fallback state instead of a 3D model.

### Redistribution note

Not every VRM model is freely redistributable. Many models on platforms
like VRoid Hub or Booth have licenses that restrict redistribution. Before
committing any VRM file to a public fork, check its license terms.
Do not add custom VRM files to the gitignore allowlist without verifying
and documenting their redistribution status here first.

## Animations

### idle_loop.vrma

| Item | Value |
| ---- | ----- |
| File | `frontend/public/animations/idle_loop.vrma` |
| Format | VRMC_vrm_animation glTF binary (.vrma) |
| Size | ~154 KB |
| Source path | `public/idle_loop.vrma` in [zoan37/ChatVRM](https://github.com/zoan37/ChatVRM) |
| Also present in | [josephrocca/ChatVRM-js](https://github.com/josephrocca/ChatVRM-js) (same file) |
| Primary upstream | [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM) (MIT) — included in the initial commit (2023-04-28) |

This animation provides a subtle body idle loop (breathing, weight
shift, gentle sway). It is loaded by `AvatarLoader` and played through
the Three.js `AnimationMixer` on every avatar load.

**Provenance:** The file originates from pixiv/ChatVRM, where it was
included in the initial commit by pixiv Inc. under MIT license
(Copyright (c) 2023 pixiv Inc.). The forks (zoan37/ChatVRM,
josephrocca/ChatVRM-js) carried it forward under the same terms.

`IdleMotionController` retains a procedural arm rest pose fallback
(lowering arms from T-pose) but no longer provides body idle motion.

### look_around.vrma, thinking.vrma, relax.vrma, angry.vrma, sleepy.vrma

| Item | Value |
| ---- | ----- |
| Files | `frontend/public/animations/{look_around,thinking,relax,angry,sleepy}.vrma` |
| Format | VRMC_vrm_animation glTF binary (.vrma) |
| Size | ~118 KB each |
| Source | [tk256ailab/vrm-viewer](https://github.com/tk256ailab/vrm-viewer) |
| Path in Source | `/VRMA/` directory on `main` branch |
| License | MIT / Open-Source (tk256ailab/vrm-viewer) |

These animations provide specialized head and body movements (such as looking down, studying maps, showing irritation, or resting) mapped to script stages in SCRIPT.md.


## Fonts

### IBM Plex Sans

| Item | Value |
| ---- | ----- |
| Files | `frontend/public/fonts/ibm-plex-sans-{400,500,600,700}.ttf` |
| Family | IBM Plex Sans |
| Source | [IBM/plex](https://github.com/IBM/plex) |
| License | SIL Open Font License 1.1 (see `frontend/public/fonts/LICENSE.txt`) |

Font files are bundled locally to avoid external requests to Google
Fonts, ensuring the demo mode operates without any network traffic.

## Tobii / TobiiStream

Tobii eye tracking is **optional** and **Windows-only**.

### What is in the repo

- `backend/app/adapters/tobii.py` — a ZMQ subscriber that reads gaze data
  from TobiiStream. This is original project code, not a Tobii SDK.
- No Tobii binaries, SDKs, or proprietary files are included.

### What you need to provide (if using Tobii)

- **TobiiStream.exe** — a separate Windows binary that connects to Tobii
  hardware and publishes gaze data via ZMQ. You must obtain and place it
  yourself.
- **Tobii eye tracker hardware** — a compatible Tobii device.
- **pyzmq** — install via `pip install -e ".[tobii]"` in the backend
  directory.

Configuration is done entirely through `backend/.env`. See
[TOBII_SETUP.md](TOBII_SETUP.md) for detailed instructions.

### Without Tobii

The browser demo works without Tobii. Mouse position is used as a
simulated gaze source. No error is shown when Tobii is absent.

## OpenAI Realtime voice

Realtime voice is **optional**.

### What is in the repo

- `backend/app/services/realtime_service.py` — SDP relay service.
  Original project code that forwards the WebRTC offer to OpenAI and
  returns the answer. The API key never reaches the frontend.
- `frontend/src/modules/realtime/RealtimeClient.ts` — WebRTC client.
  No direct OpenAI API access.

### What you need to provide (if using Realtime)

- A valid OpenAI API key with Realtime API access, set in `backend/.env`.
- The key is never committed, never exposed to the frontend, and never
  logged.

When Realtime is disabled or unconfigured, conversation steps show a
fallback message. See [PRIVACY.md](PRIVACY.md) for data-flow details.

## Practical rules for contributors

- Do not commit `.env` files (they contain secrets).
- Do not commit additional `.vrm` or `.fbx` files unless their license
  explicitly allows redistribution — and document them here first.
  The two demo avatars (AvatarSample_B, AvatarSample_C) are already
  documented and allowed.
- Do not commit Tobii binaries or SDKs.
- Do not commit OpenAI API keys or other secrets.
- Keep sample/demo assets documented — if you add a redistributable
  asset, add an entry to this file.
- When adding a new npm or pip dependency, prefer permissive licenses
  (MIT, BSD, Apache 2.0).

## Repository reality check

### Included

- All application source code (frontend, backend, electron, study configs)
- Two demo VRM avatars in `frontend/public/avatars/` (see above)
- Study configuration JSONs (`study/demo-study/`)
- Documentation (`docs/`)
- CI workflow (`.github/workflows/`)
- Dev helper scripts (`scripts/`)

### Intentionally excluded

| Item               | Reason                                          |
| ------------------ | ----------------------------------------------- |
| `.env` files       | Contain secrets (API keys, local paths)         |
| custom `*.vrm` avatars | User-provided; only demo avatars are tracked |
| `*.fbx` animations | Not confirmed redistributable; user-provided    |
| custom `*.vrma` animations | User-provided; only `idle_loop.vrma` is tracked |
| `TobiiStream.exe`  | Proprietary binary; user-provided               |
| `data/logs/`       | Runtime session data; created at runtime         |
| `node_modules/`    | Installed via `npm ci`                           |
| `.venv/`           | Installed via `pip install`                      |
