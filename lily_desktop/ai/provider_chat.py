"""Shared request builders for OpenAI and Ollama chat providers."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
_OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


@dataclass(frozen=True)
class ChatRequest:
    url: str
    headers: dict[str, str]
    body: dict[str, Any]


def normalize_provider(value: str | None, *, default: str = "openai") -> str:
    provider = (value or default).strip().lower()
    if provider not in {"openai", "ollama"}:
        raise ValueError(f"Unsupported AI provider: {provider}")
    return provider


def normalize_base_url(
    value: str | None,
    *,
    default: str = DEFAULT_OLLAMA_BASE_URL,
) -> str:
    raw = (value or "").strip()
    if not raw:
        return default

    parts = urlsplit(raw)
    if parts.scheme and parts.netloc:
        return f"{parts.scheme}://{parts.netloc}"

    return raw.rstrip("/")


def build_text_chat_request(
    *,
    provider: str,
    api_key: str,
    model: str,
    base_url: str,
    system_prompt: str,
    user_text: str,
    max_completion_tokens: int,
) -> ChatRequest:
    normalized_provider = normalize_provider(provider)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_text},
    ]

    if normalized_provider == "openai":
        return ChatRequest(
            url=_OPENAI_CHAT_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            body={
                "model": model,
                "messages": messages,
                "max_completion_tokens": max_completion_tokens,
            },
        )

    return ChatRequest(
        url=f"{normalize_base_url(base_url)}/api/chat",
        headers={"Content-Type": "application/json"},
        body={
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": max_completion_tokens},
        },
    )


def build_vision_chat_request(
    *,
    provider: str,
    api_key: str,
    model: str,
    base_url: str,
    system_prompt: str,
    user_text: str,
    image_pngs: list[bytes],
    max_completion_tokens: int,
) -> ChatRequest:
    normalized_provider = normalize_provider(provider)

    if normalized_provider == "openai":
        user_content: list[dict[str, Any]] = [
            {
                "type": "text",
                "text": user_text,
            },
        ]
        for image_png in image_pngs:
            b64_image = base64.b64encode(image_png).decode("ascii")
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{b64_image}",
                        "detail": "low",
                    },
                }
            )

        return ChatRequest(
            url=_OPENAI_CHAT_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            body={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                "max_completion_tokens": max_completion_tokens,
            },
        )

    return ChatRequest(
        url=f"{normalize_base_url(base_url)}/api/chat",
        headers={"Content-Type": "application/json"},
        body={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": user_text,
                    "images": [
                        base64.b64encode(image_png).decode("ascii")
                        for image_png in image_pngs
                    ],
                },
            ],
            "stream": False,
            "options": {"num_predict": max_completion_tokens},
        },
    )


def extract_chat_response_text(provider: str, payload: dict[str, Any]) -> str:
    normalized_provider = normalize_provider(provider)
    if normalized_provider == "openai":
        choice = payload.get("choices", [{}])[0]
        message = choice.get("message", {})
        return _normalize_chat_content(message.get("content"))

    message = payload.get("message", {})
    return _normalize_chat_content(message.get("content"))


def extract_chat_finish_reason(provider: str, payload: dict[str, Any]) -> str:
    normalized_provider = normalize_provider(provider)
    if normalized_provider == "openai":
        choice = payload.get("choices", [{}])[0]
        return str(choice.get("finish_reason", "unknown"))

    done_reason = payload.get("done_reason")
    if isinstance(done_reason, str) and done_reason:
        return done_reason
    if payload.get("done") is True:
        return "stop"
    return "unknown"


def _normalize_chat_content(content: Any) -> str:
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
            continue
        if isinstance(part, dict):
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)

    return "\n".join(parts)
