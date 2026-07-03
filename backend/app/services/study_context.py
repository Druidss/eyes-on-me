"""Thread-safe store for the current study context.

The frontend syncs session/step/condition to the backend via
POST /api/gaze/context.  The Tobii research logger reads from
this store to tag high-rate gaze samples with study context
without being limited by HTTP polling.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class _Context:
    session_id: str | None = None
    step_id: str | None = None
    condition: str | None = None
    step_started_monotonic: float | None = None


class StudyContext:
    """Single-writer / multi-reader store for the active study context."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ctx = _Context()

    def update(
        self,
        session_id: str | None,
        step_id: str | None = None,
        condition: str | None = None,
    ) -> None:
        with self._lock:
            same_step = (
                self._ctx.session_id == session_id
                and self._ctx.step_id == step_id
                and self._ctx.condition == condition
            )
            step_started_monotonic = (
                self._ctx.step_started_monotonic
                if same_step
                else (time.perf_counter() if session_id and step_id else None)
            )
            self._ctx = _Context(
                session_id=session_id,
                step_id=step_id,
                condition=condition,
                step_started_monotonic=step_started_monotonic,
            )

    def current(self) -> _Context:
        with self._lock:
            return self._ctx


# Module-level singleton.
study_context = StudyContext()
