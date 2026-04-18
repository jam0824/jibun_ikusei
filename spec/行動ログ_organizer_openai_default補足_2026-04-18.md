# 行動ログ organizer OpenAI default 補足

- 対象は desktop の action-log organizer のみ。
- organizer の checked-in 既定値は `activity_processing.provider=openai` と `activity_processing.model=gpt-5-nano` にする。
- `activity_processing.base_url` は既存どおり保持するが、provider が `openai` のときは organizer では使わない。
- 日次 `DailyActivityLog` と週次 `WeeklyActivityReview` の backfill は従来どおり `gpt-5.4` を使う。
- organizer は OpenAI Structured Outputs を使って session enrichment を生成する。
- organizer は既存 session / open loop を `deviceId + dateKey + startedAt + appNames + domains + projectNames` の match key で再利用し、一致した candidate は再度 AI に送らない。
- organizer は uncached candidate を `startedAt` の新しい順に優先し、最大 8 session ごとに batch 化して OpenAI に送る。
- 1 run あたりの OpenAI enrichment はおおむね 60 秒で打ち切り、残りの uncached candidate は rule-based fallback で埋めて session / open-loop 同期を継続する。
- OpenAI organizer の自然言語フィールドは日本語を正本とし、韓国語（Hangul）を含む title / summary / activityKinds / open loop text は無効扱いにして rule-based fallback へ切り替える。既存 session の再利用時も同じ判定を適用する。
- OpenAI organizer の user-facing 文言では `heartbeat`, `browser_page_changed`, `active_window_changed`, `raw event` などの内部 telemetry 名を出さない。これらが含まれる title / summary / activityKinds / open loop text は無効扱いにして fallback へ切り替える。
- OpenAI usage が取得できた場合、batch ごとに `model`, `batch_size`, `input_tokens`, `output_tokens`, `total_tokens` をログ出力する。
- `OPENAI_API_KEY` 未設定、OpenAI request 失敗、Structured Outputs parse 失敗時でも organizer 全体は止めず、rule-based fallback で同期を継続する。
