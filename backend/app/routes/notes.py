import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.supabase_client import supabase

router = APIRouter()

# Columns returned to the client. `deleted_at` is intentionally omitted —
# soft-deleted notes are filtered out server-side and never reach the UI.
NOTE_FIELDS = (
    "id, request_id, cr_id, body, author_staff_id, author_name, "
    "source, created_at, edited_at"
)


class NoteCreate(BaseModel):
    request_id: str
    body: str
    author_name: str
    author_staff_id: str | None = None
    cr_id: str | None = None


class NoteUpdate(BaseModel):
    id: str
    body: str


class NoteRemove(BaseModel):
    id: str


def _check_token(token: str) -> None:
    """Matches the inline pattern used by /interest and /update_status."""
    if token != os.getenv("VITE_ADMIN_TOKEN"):
        raise HTTPException(status_code=403, detail="Invalid token")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/notes")
async def list_notes(request_id: str = "", token: str = ""):
    _check_token(token)

    if not request_id:
        raise HTTPException(status_code=422, detail="Missing 'request_id'")

    try:
        res = (
            supabase.table("request_notes")
            .select(NOTE_FIELDS)
            .eq("request_id", request_id)
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        return {"success": True, "data": res.data or []}
    except Exception as e:
        print("Error listing notes:", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notes/add")
async def add_note(payload: NoteCreate, token: str = ""):
    _check_token(token)

    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Note body cannot be empty")

    author = (payload.author_name or "").strip()
    if not author:
        raise HTTPException(status_code=422, detail="Missing 'author_name'")

    try:
        record = {
            "request_id": payload.request_id,
            "cr_id": payload.cr_id,
            "body": body,
            "author_name": author,
            "author_staff_id": payload.author_staff_id,
            "source": "ui",
        }

        res = (
            supabase.table("request_notes")
            .insert(record)
            .execute()
        )

        if not res.data:
            raise Exception("Insert returned no data")

        return {"success": True, "data": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        print("Error adding note:", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notes/update")
async def update_note(payload: NoteUpdate, token: str = ""):
    _check_token(token)

    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Note body cannot be empty")

    try:
        res = (
            supabase.table("request_notes")
            .update({"body": body, "edited_at": _now()})
            .eq("id", payload.id)
            .is_("deleted_at", "null")
            .execute()
        )

        if not res.data:
            raise HTTPException(status_code=404, detail="Note not found")

        return {"success": True, "data": res.data[0]}
    except HTTPException:
        raise
    except Exception as e:
        print("Error updating note:", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notes/remove")
async def remove_note(payload: NoteRemove, token: str = ""):
    _check_token(token)

    try:
        res = (
            supabase.table("request_notes")
            .update({"deleted_at": _now()})
            .eq("id", payload.id)
            .is_("deleted_at", "null")
            .execute()
        )

        if not res.data:
            raise HTTPException(status_code=404, detail="Note not found")

        return {"success": True, "id": payload.id}
    except HTTPException:
        raise
    except Exception as e:
        print("Error removing note:", e)
        raise HTTPException(status_code=500, detail=str(e))
