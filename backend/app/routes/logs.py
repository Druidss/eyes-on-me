"""Batched event logging endpoint."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.schemas.events import EventBatch
from app.services.logging_service import logging_service

router = APIRouter()


class LogLabelCopyRequest(BaseModel):
    session_id: str
    participant_name: str | None = None


@router.post("/api/log/events", status_code=202)
def log_events(batch: EventBatch) -> dict:
    written = logging_service.write_events(batch.events)
    return {"accepted": written}


@router.post("/api/logs", status_code=202, include_in_schema=False)
def log_events_compat(batch: EventBatch) -> dict:
    """Alias for /api/log/events — matches the frontend BackendReporter default."""
    return log_events(batch)


@router.post("/api/logs/copy-labeled", status_code=201)
def copy_labeled_log(body: LogLabelCopyRequest) -> dict:
    return logging_service.copy_session_log_to_labeled_name(
        session_id=body.session_id,
        participant_name=body.participant_name,
    )
