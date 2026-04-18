# 行動ログ organizer OpenAI nano 補足

- 対象は desktop の action-log organizer のみ。
- 日次 `DailyActivityLog` と週次 `WeeklyActivityReview` の backfill は従来どおり `gpt-5.4` を使う。
- checked-in の既定値は変更しない。`activity_processing` の既定値は `ollama + gemma4:e4b` のまま維持する。
- organizer は `activity_processing.provider=openai` のとき、OpenAI Structured Outputs で session enrichment を生成できる。
- organizer で OpenAI を使う場合の想定モデルは `gpt-5-nano`。
- organizer は既存 session / open loop を `deviceId + dateKey + startedAt + appNames + domains + projectNames` の match key で再利用し、一致した candidate は再度 AI に送らない。
- organizer は uncached candidate を最大 8 session ごとに batch 化して OpenAI に送る。
- OpenAI の usage が取得できた場合、batch ごとに `model`, `batch_size`, `input_tokens`, `output_tokens`, `total_tokens` をログ出力する。
- `OPENAI_API_KEY` 未設定、OpenAI request 失敗、Structured Outputs parse 失敗時でも organizer 全体は止めず、rule-based fallback で同期を継続する。
