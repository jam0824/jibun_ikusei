# リリィデスクトップ TODO

仕様書: `spec/リリィデスクトップ仕様.md`

---

## Phase 1: スケルトン + キャラクター表示 -- 完了

### 1-1. プロジェクト初期化
- [x] `uv init` + `pyproject.toml` 作成（依存パッケージ定義）
- [x] `config.yaml` 設定ファイル作成
- [x] `main.py` エントリポイント作成
- [x] `core/config.py` YAML設定読み込み

### 1-2. 透過ウィンドウ + キャラクター表示
- [x] `ui/main_window.py` フレームレス透過ウィンドウ（画面右下配置）
- [x] `ui/character_widget.py` キャラクター画像表示（リリィ右、葉留佳左）
- [ ] リリィ立ち絵の透過版生成（gpt-image-1.5でキャラクターシートから生成）

### 1-3. システムトレイ
- [x] `ui/tray_icon.py` トレイアイコン（表示/非表示/終了）

---

## Phase 2: 吹き出し + テキスト入力 -- 完了

### 2-1. 吹き出し表示
- [x] `ui/balloon_widget.py` message_window.png を使った吹き出し
- [x] 書式: 1行目`【話者名】`、2行目以降`「セリフ」`
- [x] 自動非表示タイマー
- [x] メッセージキュー（複数メッセージの順次表示）
- [ ] 話者ごとの吹き出し位置（リリィ→右上、葉留佳→左上）

### 2-2. テキスト入力UI
- [x] `ui/input_widget.py` 最小限の入力バー
- [x] Enter送信、Escape非表示
- [x] キャラクリックで表示切り替え

### 2-3. イベントバス
- [x] `core/event_bus.py` QSignalベースのモジュール間通信

---

## Phase 3: AI会話 + DB連携 -- 完了

### 3-1. 認証 + APIクライアント
- [x] `api/auth.py` Cognito SRP認証（warrant-lite）
- [x] `api/api_client.py` REST APIクライアント（httpx）
- [x] トークン自動更新（50分ごと）

### 3-2. AI会話エンジン
- [x] `ai/openai_client.py` OpenAI Chat Completions APIラッパー
- [x] `ai/system_prompts.py` リリィ・葉留佳のシステムプロンプト構築
- [x] `ai/chat_engine.py` 会話オーケストレーション（ユーザー→リリィ応答→任意で葉留佳反応）
- [x] メッセージ履歴管理（直近30メッセージ制限）

### 3-3. Tool Search
- [x] `ai/tool_definitions.py` 7ツール定義移植
- [x] `ai/tool_executor.py` ツール実行（API経由）
  - [x] `get_browsing_times`
  - [x] `get_user_info`
  - [x] `get_quest_data`
  - [x] `get_skill_data`
  - [x] `get_messages_and_logs`
  - [x] `create_quest`
  - [x] `delete_quest`

### 3-4. セッション管理
- [x] `data/session_manager.py` セッション作成・切り替え・クラウド同期

### 3-5. ポーズ切り替え
- [x] `pose/pose_manager.py` pose_hintからの画像選択ロジック
- [x] `pose/lily_pose_map.json` リリィポーズマッピング
- [x] `pose/haruka_pose_map.json` 葉留佳ポーズマッピング（29枚）

---

## Phase 4: デスクトップ状況 + 雑談システム — 完了

> 仕様: セクション5, 6

### 4-1. デスクトップ状況取得
- [x] `core/active_window.py` アクティブウィンドウのアプリ名・タイトル取得
- [x] ブラウザ表示中ドメインの取得
- [x] 解析対象外ルール（メール、チャット、銀行、パスワードマネージャ、認証コード画面など）
- [x] 必要時のみのスクリーンショット取得
- [x] `core/desktop_context.py` ウィンドウ確認→スクリーンショット→解析の統括

### 4-2. 画面状況解析
- [x] `ai/screen_analyzer.py` スクリーンショット解析（gpt-5.4）
- [x] 状況要約生成（コーディング中、調べもの中、休憩中など）
- [x] 話題タグ生成
- [x] スクリーンショット画像は長期保存せず、要約とタグのみ保持
- [x] 右クリック「デバッグ」メニューから手動実行可能
- [x] 状況要約をログ出力 + 吹き出しにデバッグ表示

### 4-3. 雑談の種管理
- [x] `ai/talk_seed.py` 雑談の種カード生成・優先度判定
- [x] `ai/wikimedia_client.py` Wikimedia Feed API 連携
- [x] `ai/annict_client.py` Annict API 連携
- [x] デスクトップ状況 / Wikimedia / Annict の優先順位制御
- [x] 雑談の種のクールダウン・使用履歴管理（30分、直近10件）
- [x] `ai/auto_conversation.py` タイマー駆動の自動雑談（リリィ→葉留佳の掛け合い）
- [x] 右クリック「デバッグ」→「雑談を発火」で手動実行可能

---

## Phase 5: 相方システム（自動会話） — 完了

> 仕様: セクション3, 9

- [x] `ai/auto_conversation.py` タイマー駆動の自動会話（Phase 4で作成、Phase 5で拡張）
- [x] リリィ・葉留佳の掛け合い（3〜5往復 = 最大10ターン）
- [x] ユーザーが途中から会話に参加できる（割り込みで掛け合い中断→通常会話へ）
- [x] 相方のキャラクター設定ファイル管理（`sys/aikata.md`）
- [x] 話者に応じた吹き出し位置（リリィ→右、葉留佳→左）
- [x] 相方のポーズマップ（`pose/haruka_pose_map.json` 29枚）

---

## Phase 6: ポーズ生成システム — 完了

> 仕様: セクション8

### 6-1. AIレスポンスのJSON形式統一
- [x] 通常会話（`chat_engine.py`）のレスポンスをJSON形式に変更: `{"text": "...", "pose_category": "joy"}`
- [x] 自動雑談（`auto_conversation.py`）のpose_hintをpose_categoryに変更
- [x] リリィ用システムプロンプトにカテゴリ一覧（13種）を記載
- [x] 葉留佳用システムプロンプトにカテゴリ一覧（共通8種）を記載

### 6-2. ポーズマップ更新
- [x] `pose/lily_pose_map.json` をカテゴリベースに書き換え（カテゴリ→ファイル名リスト）
- [x] `pose/haruka_pose_map.json` を共通8カテゴリにリマッピング
- [x] `pose/pose_manager.py` をカテゴリベースの選択ロジックに書き換え
- [x] カテゴリ内の複数枚からランダム or 順番に選択

### 6-3. ポーズ生成（リリィのみ）
- [x] `pose/pose_generator.py` gpt-image-1.5でのポーズ画像生成
- [x] キャラクターシート（`lily_character_sheet.png`）参照での生成
- [x] 腰から上の構図で生成
- [x] 生成画像の透過背景処理（API側で`background: transparent`指定）
- [x] 生成画像を`lily_images/`に保存 + `lily_pose_map.json`に自動追記
- [x] 各カテゴリ5種まで生成（合計65枚）、揃ったら生成しない
- [x] AI応答時にバックグラウンドで不足ポーズを自動生成（`main.py`で`ensure_pose()`呼び出し）

### 6-4. ポーズカテゴリ定義
- 共通（8種）: default, joy, anger, sad, fun, shy, worried, surprised
- リリィ専用（5種）: proud, caring, serious, sleepy, playful
- 葉留佳はリリィ専用カテゴリ指定時、近い共通カテゴリにフォールバック

---

## Phase 7: 音声入力 — 完了

> 仕様: セクション4

- [x] `voice/audio_capture.py` マイク入力（sounddevice, 16kHz/mono/16bit）
- [x] `voice/vad.py` WebRTC VADゲート（webrtcvad-wheels, 30msフレーム）
- [x] `voice/speech_recognizer.py` Google Cloud Speech-to-Text REST API（httpx）
- [x] `voice/voice_pipeline.py` 統合パイプライン（別スレッド→asyncio→イベントバス）
- [x] `core/config.py` VoiceConfig（enabled, vad_aggressiveness, language, google_api_key）
- [x] トレイアイコンから音声入力ON/OFF切り替え
- [x] 60秒超の発話は強制分割（STT制限対応）
- [x] マイク選択サブメニュー（トレイアイコンからデバイス切り替え + config.yaml保存）
- [x] `voice/speaker_verifier.py` 話者照合（SpeechBrain ECAPA-TDNN）
- [x] `enroll_speaker.py` 話者プロファイル作成スクリプト
- [x] `record_voice.py` 音声録音スクリプト（config.yamlのマイク使用）
- [x] テスト: `tests/test_vad.py`, `tests/test_speech_recognizer.py`

---

## Phase 8: 音声合成 — 完了

> 仕様: セクション11

- [x] `voice/tts.py` TTSEngine（VOICEVOX HTTPクライアント + asyncio.Queueによるキュー順再生）
- [x] 音声再生（リリィ・葉留佳で別スピーカーID、sounddevice + soundfile）
- [x] 吹き出し表示と音声の同期（AI応答時にenqueue、掛け合い時はTTS完了待ち）
- [x] TTS再生中のマイク一時停止/再開（フィードバック防止）
- [x] ユーザー割り込み時のキュークリア + 再生停止
- [x] トレイメニューから読み上げON/OFF切り替え
- [x] VOICEVOX未起動時のgraceful degradation（警告ログのみ）
- [x] `start.bat` VOICEVOX起動→アプリ起動の一括スクリプト

---

## Phase 9: カメラシステム — 完了

> 仕様: セクション10

### 9-1. カメラ画像取得・分析
- [x] `core/camera.py` カメラデバイス列挙・画像キャプチャ（OpenCV + PnPデバイス名取得）
- [x] `ai/camera_analyzer.py` カメラ画像AI分析（gpt-5）
- [x] `core/config.py` CameraConfig（分析モデル・要約モデル・間隔を設定可能）
- [x] トレイアイコンからカメラ選択サブメニュー（デバイス一覧表示・切り替え + config.yaml保存）

### 9-2. 状況記録（ローカル）
- [x] `core/situation_logger.py` カメラ分析結果 + デスクトップ状況 + アクティブアプリを同時取得
- [x] 時刻とともにローカルJSONLに記録（`logs/situations/YYYY-MM-DD.jsonl`）

### 9-3. サーバー要約・同期
- [x] 30分おきに要約を生成（gpt-5.4、設定で変更可能）
- [x] `infra/lambda/situationLogHandler/index.mjs` GET/POST /situation-logs API
- [x] `api_client.py` get_situation_logs / post_situation_log
- [x] 30分要約をサーバーに自動送信（31日TTL）

### 9-4. Tool Search連携
- [x] `get_messages_and_logs` に `situation_logs` タイプ追加（desktop: tool_definitions.py + tool_executor.py）
- [x] webアプリからも `situation_logs` で参照可能（chat-tools.ts + api-client.ts）

### 9-5. 会話連携
- [x] `ai/talk_seed.py` の `select_best_seed` を3分岐に変更（デスクトップ25% / カメラ25% / その他50%）
- [x] カメラ用の `TalkSeed`（source: "camera"）を `TalkSeedManager` に追加
- [x] カメラ情報をもとに雑談の種として自動会話に組み込み

---

## 仕様対応状況サマリ

| 仕様セクション | 内容 | 状態 |
|---|---|---|
| 1. コンセプト | デスクトップマスコット表示 | **実装済み** (Phase 1) |
| 2. 表示・UI | 透過ウィンドウ、吹き出し、入力UI | **実装済み** (Phase 1-2) |
| 3. 会話 | テキスト会話、Tool Search | **実装済み** (Phase 3) |
| 4. 音声入力 | VAD + Google STT | **実装済み** (Phase 7) |
| 5. デスクトップ状況システム | 画面判定、スクリーンショット解析、状況要約 | **実装済み** (Phase 4) |
| 6. 雑談システム | Wikimedia / Annict / 画面状況の種管理 | **実装済み** (Phase 4) |
| 7. データ管理 | DB保存、Web連携、雑談種履歴管理 | **一部実装** (Phase 3, Phase 4未着手) |
| 8. ポーズ生成 | gpt-image-1.5生成、対応表管理 | **実装済み** (Phase 6) |
| 9. 相方システム | 葉留佳の立ち絵・設定管理 | **実装済み** (Phase 1, 5) |
| 10. カメラ | 定期撮影(3分)、AI分析(gpt-5)、ローカル記録、サーバー要約(30分)、tool search連携 | **実装済み** (Phase 9) |
| 11. 音声合成 | VOICEVOX TTS | **実装済み** (Phase 8) |
| 12. 技術 | PySide6, gpt-5.4 | **実装済み** (Phase 1-3) |
