# 行動ログ organizer OpenAI 補足

- 対象は desktop の action-log organizer のみ。
- 本文書は 2026-04-18 時点の organizer OpenAI 運用メモを 1 本へ統合した補足であり、恒久仕様の正本は [行動ログ基盤仕様_v_0_1.md](./行動ログ基盤仕様_v_0_1.md) とする。

## 既定値

- checked-in の organizer 既定値は `activity_processing.provider=openai`、`activity_processing.model=gpt-5-nano`、`activity_processing.max_completion_tokens=1200` とする。
- `activity_processing.base_url` は既存どおり保持するが、provider が `openai` のとき organizer では使わない。
- 日次 `DailyActivityLog` と週次 `WeeklyActivityReview` の backfill は従来どおり `gpt-5.4` を使う。
- 日次 `DailyActivityLog` の backfill は `summary` / `questSummary` / `healthSummary` を 3 本別々の `gpt-5.4` request として送る。
- 日次 `DailyActivityLog` と週次 `WeeklyActivityReview` の backfill は `max_output_tokens=1600` を明示して送る。
- 日次 `healthSummary` request では JST 同日の `health-data` に加えて `fitbit-data` と `nutrition-data` も入力へ含める。
- 日次 `DailyActivityLog` はテンプレート fallback を使わず、成功した section だけ保存し、missing section は次回起動時または手動再生成時に再試行する。
- desktop のデバッグメニューには `前日の DailyActivityLog を再生成` を置き、3 section を強制再実行できるようにする。

## OpenAI organizer 契約

- organizer は OpenAI Structured Outputs を使って session enrichment を生成する。
- OpenAI organizer は Responses API に `reasoning.effort=minimal` を明示して送る。
- organizer は既存 session / open loop を `deviceId + dateKey + startedAt + appNames + domains + projectNames` の match key で再利用し、一致した candidate は再度 AI に送らない。
- uncached candidate は `startedAt` の新しい順に優先し、1 request あたり最大 8 session ごとに batch 化して OpenAI に送る。
- 1 run あたりの OpenAI enrichment はおおむね 60 秒で打ち切り、残りの uncached candidate はその run 内で rule-based fallback に切り替えて session / open-loop 同期を継続する。

## 出力制約

- 自然言語フィールドは日本語を正本とする。
- 韓国語（Hangul）を含む `title` / `summary` / `activityKinds` / `open loop text` は採用しない。
- `heartbeat`, `browser_page_changed`, `active_window_changed`, `raw event` などの内部 telemetry 名は user-facing 文言に出さない。
- 既存 enrichment の再利用時も同じ判定を適用し、違反があれば fallback へ切り替える。

## ログと fallback

- OpenAI usage が取得できた場合、batch ごとに `model`, `batch_size`, `input_tokens`, `output_tokens`, `total_tokens` をログ出力する。
- organizer stats には少なくとも `reused_count`, `ai_count`, `fallback_count`, `batch_count`, `budget_exhausted`, `language_rejected_count`, `telemetry_term_rejected_count` を残す。
- `OPENAI_API_KEY` 未設定、OpenAI request 失敗、Structured Outputs parse 失敗、言語制約違反、telemetry 用語違反があっても organizer 全体は止めず、rule-based fallback で同期を継続する。
