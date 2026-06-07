import contextlib
import logging
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path


from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.gaze import router as gaze_router
from app.routes.health import router as health_router
from app.routes.logs import router as logs_router
from app.routes.realtime import router as realtime_router
from app.routes.runtime import router as runtime_router
from app.routes.sessions import router as sessions_router
from app.routes.study import router as study_router
from app.settings import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_tobii_stream_proc: subprocess.Popen | None = None


def _start_tobii_stream() -> None:
    """Spawn TobiiStream.exe if configured and available. Never raises."""
    global _tobii_stream_proc

    if not settings.tobiistream_path:
        logger.info("[tobii] TOBIISTREAM_PATH not set — skipping.")
        return

    exe = Path(settings.tobiistream_path)
    if not exe.is_absolute():
        exe = (Path(settings.study_dir).parent / settings.tobiistream_path).resolve()
    if not exe.exists():
        logger.warning("[tobii] TobiiStream not found at '%s' — skipping.", exe)
        return
    if sys.platform != "win32":
        logger.warning("[tobii] TobiiStream is Windows-only — skipping.")
        return

    try:
        # TobiiStream.exe is a .NET GUI app — it needs CREATE_NEW_CONSOLE
        # on Windows so it can run visibly alongside the backend.
        creation_flags = subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0
        _tobii_stream_proc = subprocess.Popen(
            [str(exe), "--no-wait"],
            cwd=str(exe.parent),
            creationflags=creation_flags,
        )
        logger.info("[tobii] TobiiStream started (pid=%d) from '%s'.", _tobii_stream_proc.pid, exe)
    except OSError:
        logger.exception("[tobii] Failed to start TobiiStream.")


def _stop_tobii_stream() -> None:
    """Terminate TobiiStream if we spawned it."""
    global _tobii_stream_proc
    if _tobii_stream_proc is None:
        return
    try:
        _tobii_stream_proc.terminate()
        _tobii_stream_proc.wait(timeout=5)
        logger.info("TobiiStream stopped.")
    except (OSError, subprocess.TimeoutExpired):
        logger.warning("TobiiStream did not exit cleanly — killing.")
        with contextlib.suppress(OSError):
            _tobii_stream_proc.kill()
    _tobii_stream_proc = None


@asynccontextmanager
async def lifespan(application: FastAPI):  # noqa: ARG001
    # --- startup ---
    if settings.tobii_enabled:
        from app.adapters import tobii_pro

        if tobii_pro.start():
            logger.info("Tobii Pro adapter started.")
        else:
            # Fall back to TobiiStream.exe + ZMQ adapter
            _start_tobii_stream()
            from app.adapters import tobii

            started = tobii.start(
                settings.tobii_zmq_endpoint,
                settings.tobii_screen_width,
                settings.tobii_screen_height,
            )
            if started:
                logger.info("Tobii ZMQ adapter started (endpoint=%s)", settings.tobii_zmq_endpoint)
            else:
                logger.warning("Tobii enabled but no adapter could start.")
    else:
        logger.info("Tobii disabled — running without eye-tracking.")

    yield

    # --- shutdown ---
    if settings.tobii_enabled:
        from app.adapters import tobii_pro, tobii

        tobii_pro.stop()
        tobii.stop()
    _stop_tobii_stream()


def create_app() -> FastAPI:
    application = FastAPI(title="gaze-aware-avatar-study-kit", version="0.1.0", lifespan=lifespan)

    # CORS: allow desktop-prod mode (file:// origin sends Origin: null)
    # and any localhost origin. Backend is local-only, not exposed externally.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["null", "http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(health_router)
    application.include_router(runtime_router)
    application.include_router(study_router)
    application.include_router(sessions_router)
    application.include_router(logs_router)
    application.include_router(gaze_router)
    application.include_router(realtime_router)
    return application


app = create_app()
