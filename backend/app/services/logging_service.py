"""JSONL logging service — writes one event per line to session-specific files."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.schemas.events import LogEvent
from app.settings import settings

logger = logging.getLogger(__name__)


class LoggingService:
    """Manages session creation and JSONL event writing."""

    def __init__(self, log_dir: str | None = None) -> None:
        self._log_dir = Path(log_dir or settings.log_dir)

    # -- Session management --------------------------------------------------

    def create_session(self, metadata: dict[str, str] | None = None) -> str:
        """Create a new session and return its ID.

        Writes a ``session.started`` marker event to the log file so the
        active log mode is recorded at the beginning of every session.
        Optional *metadata* (participant_id, trial_id, etc.) is merged
        into the marker event data.
        """
        session_id = uuid.uuid4().hex[:16]
        self._log_dir.mkdir(parents=True, exist_ok=True)

        data: dict[str, object] = {
            "log_mode": settings.log_mode,
            "effective_capture": settings.effective_capture(),
        }
        if metadata:
            data.update(metadata)

        marker = LogEvent(
            schema_version=1,
            timestamp=datetime.now(timezone.utc).isoformat(),
            session_id=session_id,
            event_type="session.started",
            data=data,
        )
        self.write_events([marker])

        return session_id

    # -- Event writing -------------------------------------------------------

    def write_events(self, events: list[LogEvent]) -> int:
        """Append *events* to their session JSONL file.

        Returns the number of events successfully written.
        Fails silently on I/O errors so logging never blocks the app.
        """
        written = 0
        # Group events by session_id so each file is opened only once
        by_session: dict[str, list[LogEvent]] = {}
        for ev in events:
            by_session.setdefault(ev.session_id, []).append(ev)

        for session_id, batch in by_session.items():
            try:
                self._log_dir.mkdir(parents=True, exist_ok=True)
                path = self._log_dir / f"{session_id}.jsonl"
                with path.open("a", encoding="utf-8") as fh:
                    for ev in batch:
                        fh.write(json.dumps(ev.model_dump(), ensure_ascii=False) + "\n")
                        written += 1
            except OSError:
                logger.exception("Failed to write events for session %s", session_id)

        return written


# Module-level singleton — used by route handlers.
logging_service = LoggingService()
