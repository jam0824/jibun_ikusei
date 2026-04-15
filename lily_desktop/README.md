# リリィデスクトップ

Windowsデスクトップ右下にリリィと葉留佳が常駐するマスコットアプリ。リリィと会話したり、自分育成アプリのデータを参照できる。

---

## セットアップ

### 1. 必要なもの

- Python 3.11 以上
- [uv](https://docs.astral.sh/uv/) (`pip install uv` または公式インストーラー)
- OpenAI API キー
- 楽天ウェブサービスのアプリID / Access Key（本雑談を有効にしたい場合のみ）

### 2. 認証情報を設定する

プロジェクトルート（`自分育成アプリ/`）の `.env` を開き、以下を設定する：

```
OPENAI_API_KEY=sk-...          # OpenAI APIキー
COGNITO_EMAIL=you@example.com  # 自分育成アプリのログインメールアドレス
COGNITO_PASSWORD=your-password # 自分育成アプリのパスワード
RAKUTEN_APPLICATION_ID=your-app-id   # 任意: 本雑談に使う楽天アプリID
RAKUTEN_ACCESS_KEY=your-access-key   # 任意: 本雑談に使うAccess Key
RAKUTEN_ORIGIN=https://example.com   # 任意: 楽天APIへ送るOrigin。Application URLのオリジン部分
```

> Cognito認証情報を設定するとWebアプリのデータ（クエスト・スキル・会話履歴）を参照・共有できる。未設定でも起動は可能だがAI会話のDB保存・Tool Searchは使えない。
> 楽天の2つのキーを設定すると、楽天Books の売れ筋本を使った雑談カテゴリが有効になる。未設定でも起動は可能で、本カテゴリだけ自動的に無効になる。
> 楽天アプリを `API/Backend Service` で登録している場合は、`RAKUTEN_ORIGIN` に Application URL のオリジンを設定する。たとえば `https://jam0824.github.io/jibun_ikusei/` なら `https://jam0824.github.io` を入れる。

#### タニタ体重計（Health Planet）を連携する（任意）

体重・体脂肪率をリリィが参照できるようになる。

**1. Health Planet の開発者登録**

https://www.healthplanet.jp/apis/api.html でアプリを登録し、Client ID と Client Secret を取得する。

**2. `.env` に追記**

```
HEALTHPLANET_CLIENT_ID=your-client-id
HEALTHPLANET_CLIENT_SECRET=your-client-secret
```

**3. 初回認証（トークン取得）**

```bash
cd lily_desktop
uv run python setup_healthplanet.py
```

実行するとブラウザが自動で開くので Health Planet にログイン・許可する。リダイレクト後の URL（`https://jam0824.github.io/?code=XXXX`）をそのままターミナルに貼り付けて Enter。アクセストークンが自動的に `.env` に保存される。

> トークンの有効期限は30日。期限切れ後は同じコマンドを再実行する。

**4. 以降の動作**

lily_desktop 起動時に自動で過去30日分のデータを取得・保存する。起動後も `healthplanet.sync_interval_minutes` ごとに再同期し、既定値は15分。データは `lily_desktop/logs/health/YYYY-MM-DD.jsonl` に日別で蓄積される（重複なし）。

新規計測が見つかった場合は、JST の `date` + `time` で最新1件だけを対象に、ユーザー発話 `体重計測クエストクリア` をデスクトップのリリィへ送る。クエスト完了判定やリリィの応答は既存の会話フローが担当する。

起動時にトークンが無効なら OAuth ダイアログを表示する。定期同期ではダイアログを連打せずスキップするので、期限切れ後は手順3を再実行する。

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

desktop:
  level_watch_interval_minutes: 10  # 起動時に1回比較用スナップショットを作り、その後はこの分間隔でレベル監視

healthplanet:
  sync_interval_minutes: 15  # 起動時に即時同期し、その後はこの分間隔で再同期

voice:
  pause_during_tts: true
  speaker_verification_recording_enabled: true
  speaker_verification_recording_threshold: 0.25
```

`desktop.level_watch_interval_minutes` の既定値は 10 分。起動時は user / skills を 1 回取得して比較用スナップショットだけを保存し、通知は出さない。以後はこの間隔ごとに前回との差分を比較し、ユーザーレベルや既知スキルのレベルが上がっていれば 1 件の `system_message` として既存の会話フローへ流す。スナップショットは `lily_desktop/logs/level_watch/last_snapshot.json` に JST タイムスタンプ付きで保存される。

### 4. 起動する

```bash
cd lily_desktop
uv run python main.py
```

起動中の実行ログは `lily_desktop/logs/runtime/YYYY-MM-DD.log` に JST で追記される。

---

## 使い方

### キャラクターをクリック

リリィまたは葉留佳をクリックするとテキスト入力バーが表示される。

### メッセージを送る

- 入力バーにメッセージを入力して **Enter** で送信
- **Escape** で入力バーを閉じる
- リリィが返答し、吹き出しに表示される

### キャラクターを右クリック

- **デバッグ > 掛け合い雑談を開始** で通常の自動雑談を手動発火できる
- **デバッグ > 楽天Books雑談を開始** で本カテゴリだけを手動発火できる
- **デバッグ > 今日のクエスト雑談を開始** で `quest_today` カテゴリだけを手動発火できる
- **デバッグ > 週次クエスト雑談を開始** で `quest_weekly` カテゴリだけを手動発火できる
- `RAKUTEN_APPLICATION_ID` / `RAKUTEN_ACCESS_KEY` が未設定、または本候補が取れない場合は本雑談をスキップする

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
| 体重計連携 | タニタ（Health Planet）の体重・体脂肪率をリリィが参照 |
| DB連携 | 会話がWebアプリと共有される |
| ポーズ切り替え | 発言の内容に応じてキャラの表情が変わる |
| ポーズ自動生成 | 不足ポーズをgpt-image-1.5で自動生成 |
| 自動雑談 | 画面状況・Wikimedia・Annict・今日/週次クエスト状況などをもとに話しかける |

### Tool Search で聞けること

- クエストや完了記録（「今週何のクエストをやった？」）
- スキルの状況（「一番XPが高いスキルは？」）
- Web閲覧時間（「今日どのサイトを見てた？」）
- クエストの作成・削除（「筋トレクエスト作って」）
- 体重・体脂肪率（「最近の体重教えて」「今月の体脂肪率の推移は？」）

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
# または、指定フォルダ直下の WAV をまとめて使う
uv run python enroll_speaker.py --dir recorded_voices --out speaker_profile.pt
```

初回実行時に SpeechBrain モデル（約300MB）が自動ダウンロードされる。

- `--refs` と `--dir` は排他的で、どちらか片方を必ず指定する。
- `--dir` は指定フォルダ直下の `*.wav` をファイル名昇順で読み込む。サブフォルダ内の WAV は対象外。
- 指定フォルダが存在しない、フォルダではない、または直下に WAV がない場合はエラーを表示し、プロファイルは保存しない。

### 3. config.yaml で有効化する

```yaml
voice:
  speaker_verification_enabled: true
  speaker_profile_path: speaker_profile.pt
  speaker_verification_threshold: 0.40
  speaker_verification_recording_enabled: true
  speaker_verification_recording_threshold: 0.25
```

- `speaker_verification_threshold`: コサイン類似度の閾値（0〜1）。低いほど緩い判定。認識されにくい場合は値を下げる。
- `speaker_verification_recording_enabled`: `true` の間、話者照合スコアが `speaker_verification_recording_threshold` 以上の音声を学習用WAVとして保存する。
- `speaker_verification_recording_threshold`: 学習用録音を保存する最小スコア。既定値は `0.25`。この値は保存条件であり、ファイル名には入りません。
- 保存先は `lily_desktop/logs/speaker_verification/`。
- ファイル名は `speaker_verified_score0.43_YYYYMMDD_HHMMSS.wav` の形式で、実際の照合スコアと JST の日時を含みます。

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
