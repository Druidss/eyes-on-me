"""Tobii Pro adapter — reads gaze data directly via tobiiresearch SDK.

Connects to the first available Tobii Pro eye tracker and feeds
normalised (x, y) coordinates into gaze_store.
No ZMQ or TobiiStream.exe needed.

SDK location: tools/SDK (relative to project root).
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # eyes-on-me/
_SDK_PATH = str(_PROJECT_ROOT / "tools" / "SDK")
_PYD_DIR = str(_PROJECT_ROOT / "tools" / "SDK" / "tobiiresearch" / "interop" / "python3")

_eyetracker = None
_running = False
_screen_w = 0
_screen_h = 0
_research_buffer: list[dict] = []
_research_buffer_lock = threading.Lock()
_research_last_flush = 0.0

_RESEARCH_FLUSH_SIZE = 50
_RESEARCH_FLUSH_INTERVAL = 0.5  # seconds


def _detect_screen_size() -> tuple[int, int]:
    """Auto-detect the physical screen resolution (DPI-aware) on Windows."""
    try:
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        user32.SetProcessDPIAware()
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    except (OSError, ValueError):
        return 0, 0


def _flush_research_buffer(buffer: list[dict]) -> None:
    """Write buffered gaze samples as gaze.tobii_raw events."""
    if not buffer:
        return

    from app.schemas.events import LogEvent
    from app.services.logging_service import logging_service

    events = []
    for s in buffer:
        events.append(
            LogEvent(
                schema_version=1,
                timestamp=s["received_at"],
                session_id=s["session_id"],
                event_type="gaze.tobii_raw",
                data={
                    "x_norm": s["x_norm"],
                    "y_norm": s["y_norm"],
                    "x_raw_px": s["x_raw_px"],
                    "y_raw_px": s["y_raw_px"],
                    "seq": None,
                    "capture_adapter": "tobii_pro",
                    "gaze_source": "backend",
                    "step_id": s["step_id"],
                    "condition": s["condition"],
                    "elapsed_ms_since_step_start": s["elapsed_ms_since_step_start"],
                },
            )
        )
    logging_service.write_events(events)


def _ensure_sdk() -> bool:
    # Add SDK to Python import path
    if _SDK_PATH not in sys.path:
        sys.path.insert(0, _SDK_PATH)

    # Explicitly register DLL search directories (required in Python 3.8+)
    for dll_dir in [_SDK_PATH, _PYD_DIR]:
        if Path(dll_dir).is_dir():
            os.add_dll_directory(dll_dir)

    try:
        import tobii_research  
        return True
    except (ImportError, OSError) as e:
        logger.warning("[tobii_pro] Import failed: %s", e)
        return False


def _on_gaze(gaze_data) -> None:
    from app.services.gaze_store import gaze_store
    from app.services.study_context import study_context
    from app.settings import settings

    left = gaze_data.left_eye.gaze_point
    right = gaze_data.right_eye.gaze_point

    if left.validity and right.validity:
        x = (left.position_on_display_area[0] + right.position_on_display_area[0]) / 2
        y = (left.position_on_display_area[1] + right.position_on_display_area[1]) / 2
    elif left.validity:
        x, y = left.position_on_display_area
    elif right.validity:
        x, y = right.position_on_display_area
    else:
        return

    gaze_store.update(x, y)

    if settings.log_mode != "research":
        return

    ctx = study_context.current()
    if not ctx.session_id:
        return

    sample = {
        "session_id": ctx.session_id,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "x_norm": round(x, 4),
        "y_norm": round(y, 4),
        "x_raw_px": round(x * _screen_w, 1) if _screen_w > 0 else None,
        "y_raw_px": round(y * _screen_h, 1) if _screen_h > 0 else None,
        "step_id": ctx.step_id,
        "condition": ctx.condition,
        "elapsed_ms_since_step_start": (
            round((time.perf_counter() - ctx.step_started_monotonic) * 1000, 1)
            if ctx.step_started_monotonic is not None
            else None
        ),
    }

    batch: list[dict] = []
    with _research_buffer_lock:
        global _research_last_flush
        _research_buffer.append(sample)
        flush_due = (
            len(_research_buffer) >= _RESEARCH_FLUSH_SIZE
            or time.perf_counter() - _research_last_flush >= _RESEARCH_FLUSH_INTERVAL
        )
        if flush_due:
            batch = _research_buffer[:]
            _research_buffer.clear()
            _research_last_flush = time.perf_counter()

    if batch:
        _flush_research_buffer(batch)


def start() -> bool:
    """Find the first Tobii Pro device and subscribe to gaze data. Returns True if started."""
    global _eyetracker, _running, _screen_w, _screen_h, _research_last_flush

    if not _ensure_sdk():
        return False

    import tobii_research as tr
    from app.settings import settings

    trackers = tr.find_all_eyetrackers()
    if not trackers:
        logger.warning("[tobii_pro] No Tobii Pro device found.")
        return False

    _eyetracker = trackers[0]
    logger.info("[tobii_pro] Device: %s  address: %s", _eyetracker.model, _eyetracker.address)

    if settings.tobii_screen_width > 0 and settings.tobii_screen_height > 0:
        _screen_w = settings.tobii_screen_width
        _screen_h = settings.tobii_screen_height
    else:
        _screen_w, _screen_h = _detect_screen_size()
    _research_last_flush = time.perf_counter()

    _eyetracker.subscribe_to(tr.EYETRACKER_GAZE_DATA, _on_gaze)
    _running = True
    logger.info("[tobii_pro] Gaze subscription started.")
    return True


def stop() -> None:
    global _eyetracker, _running, _research_last_flush
    _running = False

    batch: list[dict] = []
    with _research_buffer_lock:
        if _research_buffer:
            batch = _research_buffer[:]
            _research_buffer.clear()
    if batch:
        _flush_research_buffer(batch)

    _research_last_flush = 0.0
    if _eyetracker is None:
        return
    try:
        import tobii_research as tr
        _eyetracker.unsubscribe_from(tr.EYETRACKER_GAZE_DATA, _on_gaze)
    except Exception:
        logger.warning("[tobii_pro] Error unsubscribing.", exc_info=True)
    _eyetracker = None
    logger.info("[tobii_pro] Stopped.")


def is_running() -> bool:
    return _running and _eyetracker is not None
