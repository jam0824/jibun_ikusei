"""OpenAI Chat Completions API ラッパー (src/lib/ai.ts の sendLilyChatMessage 移植)"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

import httpx

from core.constants import MAX_HISTORY_MESSAGES

_RETRYABLE = {408, 429, 500, 502, 503, 504}
_MAX_COMPLETION_TOKENS = 900
_DEFAULT_JSON_SYSTEM_PROMPT = (
    "You are the structured-output engine for a self-growth app. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Do not include markdown or extra commentary."
)


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


@dataclass(frozen=True)
class StructuredJsonResult:
    output: dict[str, Any]
    usage: dict[str, int] | None = None


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


def _extract_openai_responses_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    output = payload.get("output")
    if not isinstance(output, list):
        raise Exception("OpenAI response text was empty.")

    refusal_text: str | None = None
    for item in output:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, list):
            continue
        for fragment in content:
            if not isinstance(fragment, dict):
                continue
            text = fragment.get("text")
            if isinstance(text, str) and text.strip():
                return text
            refusal = fragment.get("refusal")
            if isinstance(refusal, str) and refusal.strip():
                refusal_text = refusal

    if refusal_text:
        raise Exception(f"OpenAI refused the request: {refusal_text}")

    status = payload.get("status")
    if isinstance(status, str) and status != "completed":
        raise Exception(f"OpenAI response did not complete successfully: {status}")

    raise Exception("OpenAI response text was empty.")


def _format_openai_error_detail(resp: httpx.Response) -> str:
    text = resp.text[:500].strip()
    if not text:
        return ""

    try:
        payload = resp.json()
    except Exception:
        return text

    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            err_type = error.get("type")
            err_code = error.get("code")
            if isinstance(message, str) and message:
                extras = "/".join(str(value) for value in (err_type, err_code) if value)
                return f"{message} ({extras})" if extras else message

    return text


def _extract_openai_usage(payload: dict[str, Any]) -> dict[str, int] | None:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None

    normalized: dict[str, int] = {}
    for key in ("input_tokens", "output_tokens", "total_tokens"):
        value = usage.get(key)
        if isinstance(value, int):
            normalized[key] = value

    return normalized or None


async def request_openai_json(
    *,
    api_key: str,
    model: str,
    schema_name: str,
    schema: dict[str, Any],
    input_payload: dict[str, Any],
    system_prompt: str = _DEFAULT_JSON_SYSTEM_PROMPT,
    max_output_tokens: int = 300,
) -> dict[str, Any]:
    result = await request_openai_json_with_usage(
        api_key=api_key,
        model=model,
        schema_name=schema_name,
        schema=schema,
        input_payload=input_payload,
        system_prompt=system_prompt,
        max_output_tokens=max_output_tokens,
    )
    return result.output


async def request_openai_json_with_usage(
    *,
    api_key: str,
    model: str,
    schema_name: str,
    schema: dict[str, Any],
    input_payload: dict[str, Any],
    system_prompt: str = _DEFAULT_JSON_SYSTEM_PROMPT,
    max_output_tokens: int = 300,
) -> StructuredJsonResult:
    """Call the OpenAI Responses API and return parsed JSON plus usage."""

    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=60.0) as client:
        body = {
            "model": model,
            "input": [
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": system_prompt,
                        },
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": json.dumps(input_payload, ensure_ascii=False),
                        },
                    ],
                },
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "schema": schema,
                    "strict": True,
                },
            },
            "max_output_tokens": max_output_tokens,
        }

        for attempt in range(1, 4):
            try:
                resp = await client.post(
                    "https://api.openai.com/v1/responses",
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
                detail = _format_openai_error_detail(resp)
                last_error = Exception(
                    f"OpenAI request failed: {resp.status_code}"
                    f"{f' - {detail}' if detail else ''}"
                )
                if attempt < 3 and resp.status_code in _RETRYABLE:
                    await asyncio.sleep(0.3 * attempt)
                    continue
                raise last_error

            payload = resp.json()
            raw_text = _extract_openai_responses_text(payload)
            return StructuredJsonResult(
                output=json.loads(raw_text),
                usage=_extract_openai_usage(payload),
            )

    raise last_error or Exception("OpenAI request failed.")
