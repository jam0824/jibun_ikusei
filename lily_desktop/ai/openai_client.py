"""OpenAI Chat Completions API ラッパー (src/lib/ai.ts の sendLilyChatMessage 移植)"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx

from core.constants import MAX_HISTORY_MESSAGES

_RETRYABLE = {408, 429, 500, 502, 503, 504}
_MAX_COMPLETION_TOKENS = 900


@dataclass
class TextResult:
    type: str = "text"
    content: str = ""


@dataclass
class ToolCall:
    id: str
    function_name: str
    function_arguments: str  # JSON文字列


@dataclass
class ToolCallsResult:
    type: str = "tool_calls"
    tool_calls: list[ToolCall] | None = None
    assistant_message: dict | None = None  # role=assistant メッセージ全体


ChatCompletionResult = TextResult | ToolCallsResult


def _normalize_openai_chat_content(content: Any) -> str | None:
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return None

    text = "\n".join(
        part_text
        for part in content
        for part_text in [_extract_chat_content_part_text(part)]
        if part_text
    )
    return text or None


def _extract_chat_content_part_text(part: Any) -> str:
    if isinstance(part, str):
        return part

    if not isinstance(part, dict):
        return ""

    text_value = part.get("text")
    return text_value if isinstance(text_value, str) else ""


async def send_chat_message(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None = None,
    max_completion_tokens: int = _MAX_COMPLETION_TOKENS,
) -> ChatCompletionResult:
    """Chat Completions API を呼び出す。3回までリトライ。"""

    system_msgs = [message for message in messages if message.get("role") == "system"]
    conversation_msgs = [message for message in messages if message.get("role") != "system"]
    trimmed = conversation_msgs[-MAX_HISTORY_MESSAGES:]
    final_messages = system_msgs + trimmed

    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=60.0) as client:
        body: dict[str, Any] = {
            "model": model,
            "messages": final_messages,
            "max_completion_tokens": max_completion_tokens,
        }
        if tools:
            body["tools"] = tools

        for attempt in range(1, 4):
            try:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    },
                    json=body,
                )
            except httpx.RequestError as exc:
                last_error = exc
                if attempt < 3:
                    await asyncio.sleep(0.3 * attempt)
                    continue
                raise

            if not resp.is_success:
                detail = resp.text[:200]
                last_error = Exception(
                    f"OpenAI Chat request failed: {resp.status_code} - {detail}"
                )
                if attempt < 3 and resp.status_code in _RETRYABLE:
                    await asyncio.sleep(0.3 * attempt)
                    continue
                raise last_error

            payload = resp.json()
            choice = payload.get("choices", [{}])[0]
            message = choice.get("message", {})
            finish_reason = choice.get("finish_reason")
            raw_tool_calls = message.get("tool_calls") or []
            content = _normalize_openai_chat_content(message.get("content"))

            if raw_tool_calls:
                tool_calls = [
                    ToolCall(
                        id=tool_call["id"],
                        function_name=tool_call["function"]["name"],
                        function_arguments=tool_call["function"]["arguments"],
                    )
                    for tool_call in raw_tool_calls
                ]
                return ToolCallsResult(
                    type="tool_calls",
                    tool_calls=tool_calls,
                    assistant_message={
                        "role": "assistant",
                        "content": content,
                        "tool_calls": raw_tool_calls,
                    },
                )

            if not content:
                if finish_reason == "length":
                    raise Exception(
                        "OpenAI Chat response was truncated before text was returned."
                    )
                raise Exception("OpenAI Chat response was empty.")

            return TextResult(content=content)

    raise last_error or Exception("OpenAI Chat request failed.")
