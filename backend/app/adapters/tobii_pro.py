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
from pathlib import Path

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # eyes-on-me/
_SDK_PATH = str(_PROJECT_ROOT / "tools" / "SDK")
_PYD_DIR = str(_PROJECT_ROOT / "tools" / "SDK" / "tobiiresearch" / "interop" / "python3")

_eyetracker = None
_running = False


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


def start() -> bool:
    """Find the first Tobii Pro device and subscribe to gaze data. Returns True if started."""
    global _eyetracker, _running

    if not _ensure_sdk():
        return False

    import tobii_research as tr

    trackers = tr.find_all_eyetrackers()
    if not trackers:
        logger.warning("[tobii_pro] No Tobii Pro device found.")
        return False

    _eyetracker = trackers[0]
    logger.info("[tobii_pro] Device: %s  address: %s", _eyetracker.model, _eyetracker.address)

    _eyetracker.subscribe_to(tr.EYETRACKER_GAZE_DATA, _on_gaze)
    _running = True
    logger.info("[tobii_pro] Gaze subscription started.")
    return True


def stop() -> None:
    global _eyetracker, _running
    _running = False
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
