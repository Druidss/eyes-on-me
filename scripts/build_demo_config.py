#!/usr/bin/env python3
"""Generate frontend/public/demo-config.json from study/demo-study/ source files.

Usage:
    python scripts/build_demo_config.py          # generate
    python scripts/build_demo_config.py --check   # verify up-to-date (CI)

This replaces manual maintenance of the static demo config snapshot.
The output file is used by the browser demo mode (?demo URL parameter).

Demo mode never uses Realtime, so system_base/system_end are replaced
with short stubs to keep the snapshot small.  Questions (id + text) are
preserved because the local assignment generator needs them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

STUDY_DIR = Path(__file__).resolve().parent.parent / "study" / "demo-study"
OUT_FILE = Path(__file__).resolve().parent.parent / "frontend" / "public" / "demo-config.json"

FRAGMENTS = [
    ("meta", "study.json"),
    ("flow", "flow.json"),
    ("avatars", "avatars.json"),
    ("questionnaires", "questionnaires.json"),
    ("prompts", "prompts.json"),
    ("gaze_profiles", "gaze_profiles.json"),
    ("dialogue_scripts", "dialogue_scripts.json"),
]

# Stubs replacing the full Realtime prompt prose (unused in demo mode)
_PROMPT_STUB_BASE = "(demo mode — Realtime disabled)"
_PROMPT_STUB_END = "(demo mode — Realtime disabled)"


def _build() -> str:
    """Read study source files and return the merged JSON string."""
    if not STUDY_DIR.is_dir():
        print(f"Error: study directory not found: {STUDY_DIR}", file=sys.stderr)
        sys.exit(1)

    config: dict[str, object] = {}
    for key, filename in FRAGMENTS:
        path = STUDY_DIR / filename
        if not path.is_file():
            print(f"Error: missing file: {path}", file=sys.stderr)
            sys.exit(1)
        config[key] = json.loads(path.read_text(encoding="utf-8"))

    # Shrink prompt prose — demo mode never uses Realtime
    prompts = config.get("prompts")
    if isinstance(prompts, dict):
        quiz = prompts.get("quiz")
        if isinstance(quiz, dict):
            quiz["system_base"] = _PROMPT_STUB_BASE
            quiz["system_end"] = _PROMPT_STUB_END

    return json.dumps(config, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    check_mode = "--check" in sys.argv

    expected = _build()

    if check_mode:
        if not OUT_FILE.is_file():
            print(f"FAIL: {OUT_FILE} does not exist — run without --check to generate", file=sys.stderr)
            sys.exit(1)
        actual = OUT_FILE.read_text(encoding="utf-8")
        if actual == expected:
            print(f"OK: {OUT_FILE.name} is up-to-date")
        else:
            print(
                f"FAIL: {OUT_FILE.name} is out of date — run: python scripts/build_demo_config.py",
                file=sys.stderr,
            )
            sys.exit(1)
    else:
        OUT_FILE.write_text(expected, encoding="utf-8")
        print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()
