"""Optional Tobii adapter — subscribes to TobiiStream via ZMQ.

Protocol: TobiiStream.exe publishes on ZMQ PUB socket
    topic: "TobiiStream"
    format: "TobiiStream <seq> <x> <y>"
    default endpoint: tcp://127.0.0.1:5556

The adapter writes normalised (x, y) into gaze_store.
If pyzmq is not installed or the connection fails, the adapter
logs a warning and stays inactive — the app continues without Tobii.
"""

from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)

_thread: threading.Thread | None = None
_running = False


def _detect_screen_size() -> tuple[int, int]:
    """Auto-detect the physical screen resolution (DPI-aware) on Windows."""
    try:
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        user32.SetProcessDPIAware()
        return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    except (OSError, ValueError):
        return 0, 0


_RESEARCH_FLUSH_SIZE = 50
_RESEARCH_FLUSH_INTERVAL = 0.5  # seconds


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
                    "seq": s["seq"],
                    "gaze_source": "backend",
                    "step_id": s["step_id"],
                    "condition": s["condition"],
                },
            )
        )
    logging_service.write_events(events)


def _zmq_loop(endpoint: str, screen_w: int, screen_h: int) -> None:
    """Background thread: subscribe to TobiiStream and feed gaze_store."""
    # Late import so the module loads even without pyzmq.
    import time
    from datetime import datetime, timezone

    import zmq  # noqa: F811

    from app.services.gaze_store import gaze_store
    from app.settings import settings

    logger.info("Screen size for gaze normalisation: %dx%d", screen_w, screen_h)

    zctx = zmq.Context()
    sub = zctx.socket(zmq.SUB)
    sub.connect(endpoint)
    sub.setsockopt_string(zmq.SUBSCRIBE, "TobiiStream")
    logger.info("Tobii ZMQ subscriber connected to %s", endpoint)

    # Research-mode high-rate logging
    research_logging = settings.log_mode == "research"
    buffer: list[dict] = []
    last_flush = time.monotonic()

    if research_logging:
        from app.services.study_context import study_context

        logger.info("Tobii research logging enabled — gaze.tobii_raw events will be written.")

    global _running
    _running = True

    while _running:
        try:
            msg = sub.recv_string(flags=zmq.NOBLOCK)
        except zmq.Again:
            # No message — flush buffer if due, then sleep.
            flush_due = time.monotonic() - last_flush > _RESEARCH_FLUSH_INTERVAL
            if research_logging and buffer and flush_due:
                _flush_research_buffer(buffer)
                buffer = []
                last_flush = time.monotonic()
            time.sleep(0.001)
            continue
        except zmq.ZMQError:
            logger.exception("ZMQ receive error")
            continue

        parts = msg.split()
        if len(parts) < 4 or parts[0] != "TobiiStream":
            continue

        try:
            x_raw = float(parts[2])
            y_raw = float(parts[3])
            x = x_raw / screen_w
            y = y_raw / screen_h
            gaze_store.update(x, y)

            if research_logging:
                ctx = study_context.current()
                if ctx.session_id:
                    try:
                        seq = int(parts[1])
                    except (ValueError, IndexError):
                        seq = 0
                    buffer.append(
                        {
                            "session_id": ctx.session_id,
                            "received_at": datetime.now(timezone.utc).isoformat(),
                            "x_norm": round(x, 4),
                            "y_norm": round(y, 4),
                            "x_raw_px": round(x_raw, 1),
                            "y_raw_px": round(y_raw, 1),
                            "seq": seq,
                            "step_id": ctx.step_id,
                            "condition": ctx.condition,
                        }
                    )
                    if len(buffer) >= _RESEARCH_FLUSH_SIZE:
                        _flush_research_buffer(buffer)
                        buffer = []
                        last_flush = time.monotonic()
        except (ValueError, IndexError):
            pass

    # Final flush on shutdown
    if research_logging and buffer:
        _flush_research_buffer(buffer)

    sub.close()
    zctx.term()
    logger.info("Tobii ZMQ subscriber stopped.")


def start(endpoint: str, screen_w: int = 0, screen_h: int = 0) -> bool:
    """Start the ZMQ listener thread. Returns True if started, False otherwise.

    ``screen_w``/``screen_h`` are the physical screen resolution used to
    normalise TobiiStream pixel coordinates to [0, 1].  When 0 (default),
    the resolution is auto-detected via the Windows API.
    """
    global _thread

    try:
        import zmq  # noqa: F401
    except ImportError:
        logger.warning(
            "pyzmq is not installed — Tobii adapter disabled. "
            'Install with: pip install -e ".[tobii]"'
        )
        return False

    if _thread is not None and _thread.is_alive():
        logger.warning("Tobii adapter already running.")
        return True

    if screen_w <= 0 or screen_h <= 0:
        screen_w, screen_h = _detect_screen_size()
    if screen_w <= 0 or screen_h <= 0:
        logger.error(
            "Cannot determine screen size — Tobii adapter disabled. "
            "Set TOBII_SCREEN_WIDTH / TOBII_SCREEN_HEIGHT in .env."
        )
        return False

    _thread = threading.Thread(
        target=_zmq_loop,
        args=(endpoint, screen_w, screen_h),
        daemon=True,
    )
    _thread.start()
    return True


def stop() -> None:
    """Signal the listener thread to stop."""
    global _running
    _running = False


def is_running() -> bool:
    """Return True if the ZMQ listener thread is alive."""
    return _thread is not None and _thread.is_alive()
