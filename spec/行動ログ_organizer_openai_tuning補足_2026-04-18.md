# 行動ログ organizer OpenAI tuning 補足

- 2026-04-18 時点で、desktop の action-log organizer は `activity_processing.provider=openai` と `activity_processing.model=gpt-5-nano` を既定値とする。
- `gpt-5-nano` の Structured Outputs が `status=incomplete` / `reason=max_output_tokens` で打ち切られやすかったため、organizer の既定 `max_completion_tokens` は `1200` とする。
- OpenAI organizer は Responses API に `reasoning.effort=minimal` を明示して送る。要約・分類用途での内部推論コストを抑え、出力 token 予算を確保する。
- OpenAI organizer の uncached candidate batch は 1 request あたり最大 8 session とする。AI 整理対象は `startedAt` の新しい session から優先する。
- 1 run あたりの OpenAI enrichment はおおむね 60 秒で打ち切り、残りの uncached candidate はその run 内で rule-based fallback に切り替えて session / open-loop 同期を継続する。
- OpenAI organizer の自然言語フィールドは日本語を正本とし、韓国語（Hangul）を含む title / summary / activityKinds / open loop text は採用しない。既存 enrichment の再利用時も同じ判定を通し、該当 candidate は fallback で上書き可能にする。
- OpenAI organizer の user-facing 文言では `heartbeat`, `browser_page_changed`, `active_window_changed`, `raw event` などの内部 telemetry 名を出さない。これらが含まれる出力や再利用済み enrichment も採用しない。
- 既存 enrichment の再利用、OpenAI usage ログ、`OPENAI_API_KEY` 未設定時の fallback 継続、日次ログ / 週次レビュー backfill が `gpt-5.4` のままである点は従来どおりとする。
