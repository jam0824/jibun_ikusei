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

## Phase 4: デスクトップ状況 + 雑談システム — 未実装

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
- [ ] `ai/talk_seed_manager.py` 雑談の種カード生成・優先度判定
- [ ] `ai/wikimedia_client.py` Wikimedia Feed API 連携
- [ ] `ai/annict_client.py` Annict API 連携
- [ ] デスクトップ状況 / Wikimedia / Annict の優先順位制御
- [ ] 雑談の種のクールダウン・使用履歴管理
- [ ] デスクトップ状況と外部話題の橋渡しロジック

---

## Phase 5: 相方システム（自動会話） — 未実装

> 仕様: セクション3, 9

- [ ] `ai/auto_conversation.py` タイマー駆動の自動会話
- [ ] リリィ・葉留佳の掛け合い（〜10ターン）
- [ ] ユーザーが途中から会話に参加できる
- [ ] 相方のキャラクター設定ファイル管理（`sys/aikata.md`）

---

## Phase 6: ポーズ生成 — 未実装

> 仕様: セクション8

- [ ] `pose/pose_generator.py` gpt-image-1.5での新規ポーズ生成
- [ ] キャラクターシート参照での生成
- [ ] 生成画像の透過背景処理
- [ ] 対応関係ファイルへの自動追記

---

## Phase 7: 音声入力 — 未実装

> 仕様: セクション4

- [ ] `voice/voice_input.py` マイク入力 + WebRTC VAD
- [ ] `voice/speech_to_text.py` Google Cloud Speech-to-Text
- [ ] VADゲート（常時受付、発話検出時のみ認識）

---

## Phase 8: 音声合成 — 未実装

> 仕様: セクション11

- [ ] `voice/voicevox_tts.py` VOICEVOX HTTPクライアント
- [ ] 音声再生（リリィ・葉留佳で別スピーカーID）
- [ ] 吹き出し表示と音声の同期

---

## Phase 9: カメラシステム — 未実装

> 仕様: セクション10

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
| 4. 音声入力 | VAD + Google STT | 未実装 (Phase 7) |
| 5. デスクトップ状況システム | 画面判定、スクリーンショット解析、状況要約 | 未実装 (Phase 4) |
| 6. 雑談システム | Wikimedia / Annict / 画面状況の種管理 | 未実装 (Phase 4) |
| 7. データ管理 | DB保存、Web連携、雑談種履歴管理 | **一部実装** (Phase 3, Phase 4未着手) |
| 8. ポーズ生成 | gpt-image-1.5生成、対応表管理 | 未実装 (Phase 6) |
| 9. 相方システム | 葉留佳の立ち絵・設定管理 | **一部実装** (Phase 1, Phase 5未着手) |
| 10. カメラ | 定期撮影、AI分析、話しかけ | 未実装 (Phase 9) |
| 11. 音声合成 | VOICEVOX TTS | 未実装 (Phase 8) |
| 12. 技術 | PySide6, gpt-5.4 | **実装済み** (Phase 1-3) |
