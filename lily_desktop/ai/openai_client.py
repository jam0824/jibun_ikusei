"""OpenAI Chat Completions API ラッパー (src/lib/ai.ts の sendLilyChatMessage 移植)"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from core.constants import MAX_HISTORY_MESSAGES

logger = logging.getLogger(__name__)

_RETRYABLE = {408, 429, 500, 502, 503, 504}


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


async def send_chat_message(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None = None,
) -> ChatCompletionResult:
    """Chat Completions API を呼び出す。3回までリトライ。"""

    # システムプロンプト + 直近N件に制限
    system_msgs = [m for m in messages if m.get("role") == "system"]
    conv_msgs = [m for m in messages if m.get("role") != "system"]
    trimmed = conv_msgs[-MAX_HISTORY_MESSAGES:]
    final_messages = system_msgs + trimmed

    body: dict[str, Any] = {
        "model": model,
        "messages": final_messages,
        "max_completion_tokens": 500,
    }
    if tools:
        body["tools"] = tools

    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=60.0) as client:
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
            except httpx.RequestError as e:
                last_error = e
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

            if finish_reason == "tool_calls" and message.get("tool_calls"):
                tool_calls = [
                    ToolCall(
                        id=tc["id"],
                        function_name=tc["function"]["name"],
                        function_arguments=tc["function"]["arguments"],
                    )
                    for tc in message["tool_calls"]
                ]
                return ToolCallsResult(
                    type="tool_calls",
                    tool_calls=tool_calls,
                    assistant_message={
                        "role": "assistant",
                        "content": message.get("content"),
                        "tool_calls": message["tool_calls"],
                    },
                )

            content = message.get("content")
            if not content:
                raise Exception("OpenAI Chat response was empty.")
            return TextResult(content=content)

    raise last_error or Exception("OpenAI Chat request failed.")
