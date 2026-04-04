# イベント駆動 + ジョブ管理 リファクタ TODO

参照仕様:
- `spec/リリィデスクトップ_イベント駆動ジョブ設計.md`
- `spec/リリィデスクトップ仕様.md`

完了条件:
- 各 Phase は `spec作成 -> failing test追加 -> 最小実装 -> 関連テスト実行 -> TODO更新` の順で進める

---

## Phase 1: 基盤とドキュメント
- [x] `spec/リリィデスクトップ_イベント駆動ジョブ設計.md` を作成
- [x] `spec/リリィデスクトップ仕様.md` に要約と参照導線を追加
- [x] `core/domain_events.py` を追加
- [x] `core/job_manager.py` を追加
- [x] `core/background_event_runtime.py` を追加
- [x] `tests/test_domain_events.py` を追加して green
- [x] `tests/test_job_manager.py` を追加して green

## Phase 2: 起動時同期のイベント化
- [x] `AppStarted` から Health Planet / Fitbit 同期要求を publish
- [x] `async_init()` は直接同期せず `AppStarted` を publish
- [x] Health Planet 同期を `single_flight_coalesce` へ移行
- [x] Fitbit 同期を `single_flight_coalesce` へ移行
- [x] `tests/test_background_event_runtime.py` の起動時ケースを追加して green
- [x] `tests/test_main_evented.py` で `async_init()` のイベント化を検証して green

## Phase 3: 自動おしゃべりのイベント化
- [x] `ChatAutoTalkDue` を timer から publish
- [x] 自動おしゃべりジョブを `single_flight_drop` へ移行
- [x] interrupt の既存挙動を維持
- [x] `tests/test_auto_conversation_evented.py` を追加して green

## Phase 4: follow-up と状況取得のイベント化
- [x] `ChatFollowUpRequested` を追加
- [x] `CaptureSnapshotRequested` を追加
- [x] `CaptureSummaryDue` を追加
- [x] follow-up を `single_flight_drop` へ移行
- [x] 定期キャプチャを `latest_wins` へ移行
- [x] 30分サマリを `serial` へ移行
- [x] `tests/test_background_event_runtime.py` の follow-up / capture ケースを追加して green
- [x] `tests/test_main_evented.py` で timer 発火のイベント化を検証して green

## Phase 5: 構成の締め
- [x] handler 登録を `core/background_event_runtime.py` に集約
- [x] `main.py` に event hub / job manager を注入
- [x] UI signal bus と internal event/job layer の二層構成を `spec/リリィデスクトップ仕様.md` に明記
- [x] 実施済みテストと進捗をこの TODO に反映

## 実施済みテスト
- [x] `uv run pytest tests/test_main_evented.py -v`
- [x] `uv run pytest tests/test_domain_events.py tests/test_job_manager.py tests/test_background_event_runtime.py tests/test_auto_conversation_evented.py tests/test_main_evented.py -v`
- [x] `uv run pytest tests/test_health_sync_policy.py tests/fitbit/test_fitbit_sync.py tests/test_local_http_bridge.py -v`
- [x] `uv run pytest -v`

## 備考
- `core/event_bus.py` は UI signal 専用のまま維持
- 背景処理の入口は `core/domain_events.py` と `core/background_event_runtime.py` 経由に寄せた
