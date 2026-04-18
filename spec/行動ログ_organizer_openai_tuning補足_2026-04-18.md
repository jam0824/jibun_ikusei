# 行動ログ organizer OpenAI tuning 補足

- 2026-04-18 時点で、desktop の action-log organizer は `activity_processing.provider=openai` と `activity_processing.model=gpt-5-nano` を既定値とする。
- `gpt-5-nano` の Structured Outputs が `status=incomplete` / `reason=max_output_tokens` で打ち切られやすかったため、organizer の既定 `max_completion_tokens` は `1200` とする。
- OpenAI organizer は Responses API に `reasoning.effort=minimal` を明示して送る。要約・分類用途での内部推論コストを抑え、出力 token 予算を確保する。
- OpenAI organizer の uncached candidate batch は 1 request あたり最大 1 session とする。これにより 1 回の JSON 出力量を最小化し、途中打ち切りを減らす。
- 既存 enrichment の再利用、OpenAI usage ログ、`OPENAI_API_KEY` 未設定時の fallback 継続、日次ログ / 週次レビュー backfill が `gpt-5.4` のままである点は従来どおりとする。
