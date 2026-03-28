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

## Phase 4: 相方システム（自動会話） — 未実装

> 仕様: セクション3, 6

- [ ] `ai/auto_conversation.py` タイマー駆動の自動会話
- [ ] リリィ・葉留佳の掛け合い（〜10ターン）
- [ ] ユーザーが途中から会話に参加できる
- [ ] 相方のキャラクター設定ファイル管理（`sys/aikata.md`）

---

## Phase 5: ポーズ生成 — 未実装

> 仕様: セクション5

- [ ] `pose/pose_generator.py` gpt-image-1.5での新規ポーズ生成
- [ ] キャラクターシート参照での生成
- [ ] 生成画像の透過背景処理
- [ ] 対応関係ファイルへの自動追記

---

## Phase 6: 音声入力 — 未実装

> 仕様: セクション3（音声入力）

- [ ] `voice/voice_input.py` マイク入力 + WebRTC VAD
- [ ] `voice/speech_to_text.py` Google Cloud Speech-to-Text
- [ ] VADゲート（常時受付、発話検出時のみ認識）

---

## Phase 7: 音声合成 — 未実装

> 仕様: セクション8

- [ ] `voice/voicevox_tts.py` VOICEVOX HTTPクライアント
- [ ] 音声再生（リリィ・葉留佳で別スピーカーID）
- [ ] 吹き出し表示と音声の同期

---

## Phase 8: カメラシステム — 未実装

> 仕様: セクション7

- [ ] `ai/camera_analyzer.py` カメラ画像取得（3分間隔）
- [ ] 画像分析（gpt-5.4）
- [ ] 分析結果をもとにリリィが話しかけ
- [ ] 相方も会話に参加
- [ ] 分析AIモデルの設定変更対応

---

## 仕様対応状況サマリ

| 仕様セクション | 内容 | 状態 |
|---|---|---|
| 1. コンセプト | デスクトップマスコット表示 | **実装済み** (Phase 1) |
| 2. 表示・UI | 透過ウィンドウ、吹き出し、入力UI | **実装済み** (Phase 1-2) |
| 3. 会話 | テキスト会話、Tool Search | **実装済み** (Phase 3) |
| 3. 会話（自動） | 掛け合い、途中参加 | 未実装 (Phase 4) |
| 3. 音声入力 | VAD + Google STT | 未実装 (Phase 6) |
| 4. データ管理 | DB保存、Web連携 | **実装済み** (Phase 3) |
| 5. ポーズ生成 | gpt-image-1.5生成、対応表管理 | 未実装 (Phase 5) |
| 6. 相方システム | 葉留佳の立ち絵・設定管理 | **一部実装** (Phase 1, 4未着手) |
| 7. カメラ | 定期撮影、AI分析、話しかけ | 未実装 (Phase 8) |
| 8. 音声合成 | VOICEVOX TTS | 未実装 (Phase 7) |
| 9. 技術 | PySide6, gpt-5.4 | **実装済み** (Phase 1-3) |
