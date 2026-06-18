"""Route handlers for jianjicode AI chat — natural language video editing."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from state.deps import get_state_service

if TYPE_CHECKING:
    from app_handler import AppHandler

router = APIRouter(prefix="/api/jianjicode", tags=["jianjicode_chat"])


# ============================================================================
# Request / Response Models
# ============================================================================


class ChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, description="Natural language video editing request")
    provider: str | None = Field(None, description="AI provider (openai, anthropic, google, etc.)")
    model: str | None = Field(None, description="AI model name")
    api_key: str | None = Field(None, description="API key override")
    base_url: str | None = Field(None, description="Custom API base URL")


class ChatResponse(BaseModel):
    success: bool
    data: dict | None = None
    error: str | None = None


class ToolsResponse(BaseModel):
    success: bool
    data: dict | None = None
    error: str | None = None


# ============================================================================
# Route Handlers
# ============================================================================


@router.post("/chat", response_model=ChatResponse)
def route_jianjicode_chat(
    req: ChatRequest,
    handler: "AppHandler" = Depends(get_state_service),
) -> ChatResponse:
    """Send a natural language video editing request to jianjicode AI.

    Example request:
        { "prompt": "trim first 5 seconds of video.mp4" }

    Returns AI analysis and tool execution result.
    """
    result = handler.jianjicode_chat.chat(
        prompt=req.prompt,
        provider=req.provider,
        model=req.model,
        api_key=req.api_key,
        base_url=req.base_url,
    )
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Unknown error"))
    return ChatResponse(**result)


@router.get("/tools", response_model=ToolsResponse)
def route_jianjicode_tools(
    handler: "AppHandler" = Depends(get_state_service),
) -> ToolsResponse:
    """List all available video editing tools."""
    result = handler.jianjicode_chat.list_tools()
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Unknown error"))
    return ToolsResponse(**result)