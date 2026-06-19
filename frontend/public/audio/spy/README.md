# Audio cues

Two independent trigger sources both read files from this directory:

1. **Suspicion-state cues** (`SuspicionAudioController`) — fire on
   suspicion state transitions (e.g. neutral → suspicious). Configured
   in `frontend/src/modules/spy/SuspicionAudioController.ts`
   (`SUSPICION_AUDIO_SRC`).

   | Suspicion state | Expected file |
   | --- | --- |
   | relaxed | (none — silent) |
   | neutral | (none — silent) |
   | alert | alert.mp3 |
   | suspicious | suspicious.mp3 |
   | confrontational | confrontational.mp3 |

2. **Timeline cues** (`TimelineController` + `play_audio` action) — fire
   at fixed seconds within a conversation step, configured per-step in
   `study/<id>/flow.json` under `timeline`. Example (see
   `study/demo-study/flow.json`):

   ```json
   "timeline": [
     { "id": "cue_30s_alert", "at_seconds": 30,
       "actions": [{ "type": "play_audio", "src": "audio/spy/alert.mp3", "volume": 0.8 }] }
   ]
   ```

   `src` paths are relative to `frontend/public/`, so
   `audio/spy/alert.mp3` resolves to this directory.

Both sources can reuse the same files, or use entirely separate ones —
there's no requirement that timeline cues and suspicion-state cues share
filenames. Once real audio files are added, update either the table
above or the `flow.json` cue `src` paths to match the actual filenames.
