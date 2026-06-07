from fastapi import APIRouter

from app.settings import settings

router = APIRouter()


@router.get("/api/runtime")
def runtime() -> dict:
    tobii_connected = False
    if settings.tobii_enabled:
        from app.adapters import tobii_pro, tobii

        tobii_connected = tobii_pro.is_running() or tobii.is_running()

    result: dict = {
        "env": settings.app_env,
        "log_mode": settings.log_mode,
        "capabilities": {
            "openai_realtime_enabled": settings.openai_realtime_enabled,
            "tobii_enabled": settings.tobii_enabled,
            "tobii_connected": tobii_connected,
        },
    }

    if settings.log_mode == "research":
        result["research_gaze_sample_hz"] = settings.research_gaze_sample_hz

    result["effective_capture"] = settings.effective_capture()

    return result
