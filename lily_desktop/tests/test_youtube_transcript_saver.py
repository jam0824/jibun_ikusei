from datetime import datetime, timedelta, timezone

from core.youtube_transcript_saver import (
    YouTubeTranscriptRecord,
    YouTubeTranscriptSegment,
    build_youtube_transcript_markdown,
    save_youtube_transcript,
)


JST = timezone(timedelta(hours=9))


def build_record(title: str = "TypeScript: Deep Dive?") -> YouTubeTranscriptRecord:
    return YouTubeTranscriptRecord(
        occurred_at=datetime(2026, 4, 11, 21, 5, 6, tzinfo=JST),
        saved_at=datetime(2026, 4, 11, 21, 5, 30, tzinfo=JST),
        video_id="abc123",
        video_url="https://www.youtube.com/watch?v=abc123",
        video_title=title,
        channel_name="Lily Channel",
        language_code="ja",
        transcript_source="manual",
        segments=[
            YouTubeTranscriptSegment(start_seconds=0, text="hello world"),
            YouTubeTranscriptSegment(start_seconds=62, text="second line"),
        ],
    )


def test_build_youtube_transcript_markdown_includes_metadata_and_segments():
    markdown = build_youtube_transcript_markdown(build_record())

    assert "# TypeScript: Deep Dive?" in markdown
    assert "- 視聴日時 (JST): 2026-04-11 21:05:06" in markdown
    assert "- 保存日時 (JST): 2026-04-11 21:05:30" in markdown
    assert "- URL: https://www.youtube.com/watch?v=abc123" in markdown
    assert "[00:00:00] hello world" in markdown
    assert "[00:01:02] second line" in markdown


def test_save_youtube_transcript_creates_directory_and_sanitizes_filename(tmp_path):
    output_dir = tmp_path / "nested" / "transcripts"

    saved_path = save_youtube_transcript(build_record(), output_dir)

    assert saved_path.parent == output_dir
    assert saved_path.exists()
    assert saved_path.name == "2026-04-11_21-05-06__TypeScript Deep Dive.md"


def test_save_youtube_transcript_adds_suffix_when_filename_already_exists(tmp_path):
    output_dir = tmp_path / "transcripts"
    first_path = save_youtube_transcript(build_record(), output_dir)
    second_path = save_youtube_transcript(build_record(), output_dir)

    assert first_path.name == "2026-04-11_21-05-06__TypeScript Deep Dive.md"
    assert second_path.name == "2026-04-11_21-05-06__TypeScript Deep Dive__2.md"
