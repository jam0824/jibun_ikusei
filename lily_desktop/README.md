# リリィデスクトップ

Windowsデスクトップ右下にリリィと葉留佳が常駐するマスコットアプリ。リリィと会話したり、自分育成アプリのデータを参照できる。

---

## セットアップ

### 1. 必要なもの

- Python 3.11 以上
- [uv](https://docs.astral.sh/uv/) (`pip install uv` または公式インストーラー)
- OpenAI API キー

### 2. 認証情報を設定する

プロジェクトルート（`自分育成アプリ/`）の `.env` を開き、以下の3行を埋める：

```
OPENAI_API_KEY=sk-...          # OpenAI APIキー
COGNITO_EMAIL=you@example.com  # 自分育成アプリのログインメールアドレス
COGNITO_PASSWORD=your-password # 自分育成アプリのパスワード
```

> Cognito認証情報を設定するとWebアプリのデータ（クエスト・スキル・会話履歴）を参照・共有できる。未設定でも起動は可能だがAI会話のDB保存・Tool Searchは使えない。

### 3. モデルや表示設定を変更したい場合

`lily_desktop/config.yaml` を編集する：

```yaml
openai:
  chat_model: "gpt-5.4"      # 会話AIモデル
  image_model: "gpt-image-1.5"  # ポーズ生成モデル（Phase 5以降）

display:
  lily_scale: 0.3    # リリィの表示サイズ（1.0 = 元サイズ）
  haruka_scale: 0.7  # 葉留佳の表示サイズ
  user_balloon_display_seconds: 8.0  # 手入力/音声認識の表示秒数（再起動後に反映）
```

### 4. 起動する

```bash
cd lily_desktop
uv run python main.py
```

---

## 使い方

### キャラクターをクリック

リリィまたは葉留佳をクリックするとテキスト入力バーが表示される。

### メッセージを送る

- 入力バーにメッセージを入力して **Enter** で送信
- **Escape** で入力バーを閉じる
- リリィが返答し、吹き出しに表示される

### トレイアイコン

タスクバー右下のトレイアイコンを右クリックするとメニューが出る：

| メニュー | 動作 |
|---|---|
| 非表示 / 表示 | キャラクターを隠す / 再表示 |
| 終了 | アプリを終了 |

---

## できること（実装済み）

| 機能 | 説明 |
|---|---|
| デスクトップ常駐 | 透過ウィンドウで自由に配置（位置保存） |
| テキスト会話 | リリィにメッセージを送ると返答 |
| 音声入力 | マイクで話しかけ（VAD + Google STT + 話者照合） |
| 音声合成 | VOICEVOX でセリフを読み上げ |
| 掛け合い | リリィと葉留佳が自動で会話する |
| Tool Search | 「最近何やった？」などのデータ参照質問に対応 |
| DB連携 | 会話がWebアプリと共有される |
| ポーズ切り替え | 発言の内容に応じてキャラの表情が変わる |
| ポーズ自動生成 | 不足ポーズをgpt-image-1.5で自動生成 |
| 自動雑談 | 画面状況・Wikimedia・Annictをもとに話しかける |

### Tool Search で聞けること

- クエストや完了記録（「今週何のクエストをやった？」）
- スキルの状況（「一番XPが高いスキルは？」）
- Web閲覧時間（「今日どのサイトを見てた？」）
- クエストの作成・削除（「筋トレクエスト作って」）

---

## 未実装（今後のPhase）

| Phase | 機能 |
|---|---|
| Phase 9 | カメラ連携（3分ごとに外の様子をAIが分析） |

詳細は `TODO.md` を参照。

---

## 話者照合（声の登録）

音声入力時に本人以外の声を無視する機能。以下の手順で設定する。

### 1. 声を録音する

```bash
cd lily_desktop
uv run python record_voice.py
```

対話モードが起動する。Enterで録音開始、4秒間の録音を繰り返し、`q` で終了。
3〜5ファイル程度録音するのがおすすめ。

```bash
# オプション指定も可能
uv run python record_voice.py --out me01.wav          # ファイル名を指定
uv run python record_voice.py --out me01.wav --sec 5   # 録音秒数を指定
```

> config.yaml の `voice.device_name` に設定されたマイクが自動的に使われる。

### 2. 話者プロファイルを作成する

録音した WAV ファイルから声の特徴を抽出し、プロファイルを作成する。

```bash
uv run python enroll_speaker.py --refs voice_01.wav voice_02.wav voice_03.wav --out speaker_profile.pt
```

初回実行時に SpeechBrain モデル（約300MB）が自動ダウンロードされる。

### 3. config.yaml で有効化する

```yaml
voice:
  speaker_verification_enabled: true
  speaker_profile_path: speaker_profile.pt
  speaker_verification_threshold: 0.40
```

- `speaker_verification_threshold`: コサイン類似度の閾値（0〜1）。低いほど緩い判定。認識されにくい場合は値を下げる。

---

## ファイル構成

```
lily_desktop/
├── main.py              # エントリポイント
├── config.yaml          # モデル名・表示設定
├── TODO.md              # 実装進捗
├── core/                # 設定・定数・イベントバス
├── ui/                  # GUIウィジェット
├── ai/                  # 会話エンジン・Tool Search
├── api/                 # Cognito認証・REST APIクライアント
├── data/                # セッション管理
├── pose/                # ポーズマッピング
└── sys/                 # キャラクター画像・設定ファイル
    ├── lily_images/     # リリィの立ち絵
    ├── aikata_images/   # 葉留佳の立ち絵（29種）
    ├── sys_images/      # 吹き出し画像
    └── aikata.md        # 葉留佳のキャラクター設定
```
