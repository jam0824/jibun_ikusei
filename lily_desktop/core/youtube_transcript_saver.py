from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re


JST = timezone(timedelta(hours=9))
_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED_STEMS = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
}


@dataclass(frozen=True)
class YouTubeTranscriptSegment:
    start_seconds: float
    text: str


@dataclass(frozen=True)
class YouTubeTranscriptRecord:
    occurred_at: datetime
    saved_at: datetime
    video_id: str
    video_url: str
    video_title: str
    channel_name: str
    language_code: str
    transcript_source: str
    segments: list[YouTubeTranscriptSegment]


def _format_jst_timestamp(dt: datetime) -> str:
    return dt.astimezone(JST).strftime("%Y-%m-%d %H:%M:%S")


def _format_segment_timestamp(start_seconds: float) -> str:
    total_seconds = max(0, int(start_seconds))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def _sanitize_filename_stem(title: str, *, max_length: int = 80) -> str:
    sanitized = _INVALID_FILENAME_CHARS.sub("", title)
    sanitized = re.sub(r"\s+", " ", sanitized).strip().rstrip(".")
    if not sanitized:
        sanitized = "YouTube Transcript"
    if sanitized.upper() in _WINDOWS_RESERVED_STEMS:
        sanitized = f"_{sanitized}"
    if len(sanitized) > max_length:
        sanitized = sanitized[:max_length].rstrip()
    return sanitized or "YouTube Transcript"


def build_youtube_transcript_markdown(record: YouTubeTranscriptRecord) -> str:
    lines = [
        f"# {record.video_title}",
        "",
        f"- 視聴日時 (JST): {_format_jst_timestamp(record.occurred_at)}",
        f"- 保存日時 (JST): {_format_jst_timestamp(record.saved_at)}",
        f"- URL: {record.video_url}",
        f"- チャンネル: {record.channel_name}",
        f"- 字幕言語: {record.language_code}",
        f"- 字幕種別: {record.transcript_source}",
        "",
        "## Transcript",
        "",
    ]

    lines.extend(
        f"[{_format_segment_timestamp(segment.start_seconds)}] {segment.text}"
        for segment in record.segments
    )
    lines.append("")
    return "\n".join(lines)


def save_youtube_transcript(record: YouTubeTranscriptRecord, output_directory: Path) -> Path:
    output_directory.mkdir(parents=True, exist_ok=True)
    timestamp = record.occurred_at.astimezone(JST).strftime("%Y-%m-%d_%H-%M-%S")
    sanitized_title = _sanitize_filename_stem(record.video_title)
    base_name = f"{timestamp}__{sanitized_title}"

    candidate = output_directory / f"{base_name}.md"
    suffix = 2
    while candidate.exists():
        candidate = output_directory / f"{base_name}__{suffix}.md"
        suffix += 1

    candidate.write_text(
        build_youtube_transcript_markdown(record),
        encoding="utf-8",
    )
    return candidate
