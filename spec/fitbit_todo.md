# Fitbit 実装 TODO

仕様: [fitbit_データ取得仕様.md](./fitbit_データ取得仕様.md)

---

## Phase 1: 設定・基盤 ✅

- [x] `spec/fitbit_データ取得仕様.md` に Tool Search セクションを追加
- [x] `lily_desktop/core/config.py` に `FitbitConfig` dataclass を追加
  - `enabled: bool = False`
  - `config_file: str = "fitbit_config.json"`
- [x] `lily_desktop/config.yaml` に `fitbit:` セクションを追加
- [x] `.gitignore` に `lily_desktop/fitbit_config.json` を追加
- [x] `lily_desktop/fitbit/__init__.py` を作成
- [x] `lily_desktop/tests/test_config.py` に FitbitConfig のデフォルト値テストを追加（TDD）

---

## Phase 2: Fitbit API クライアント + サマライザー（TDD） ✅

`experiment/fitbit_get_data.py` の実装を流用する。

### 2-a: サマライザー（`lily_desktop/fitbit/fitbit_summarizer.py`）

- [x] `lily_desktop/tests/fitbit/test_fitbit_summarizer.py` を先に書く（RED）
  - `summarize_heart()`: 正常系・zones空・intraday空
  - `summarize_azm()`: dict型・list型・空
  - `summarize_sleep()`: isMainSleep あり/なし・sleep空
  - `summarize_activity()`: 正常系・値なし
  - 型変換: steps/calories → int, distance → float
- [x] `lily_desktop/fitbit/fitbit_summarizer.py` を実装（GREEN）

### 2-b: API クライアント（`lily_desktop/fitbit/fitbit_client.py`）

- [x] `lily_desktop/tests/fitbit/test_fitbit_client.py` を先に書く（RED）
  - 401 時のみ refresh が実行されること
  - refresh 後に `fitbit_config.json` が上書き保存されること
  - 各エンドポイントが日付付き URL を正しく呼ぶこと
- [x] `lily_desktop/fitbit/fitbit_client.py` を実装（GREEN）
  - `FitbitClient(config_path)` クラス
  - `_api_get(url)` — 401 時のみ refresh → 再試行
  - `_refresh_token()` — config ファイル上書き保存
  - `get_heart_rate(date_str)`
  - `get_active_zone_minutes(date_str)`
  - `get_sleep(date_str)`
  - `get_activity(date_str)` — steps / distance / calories / active minutes

---

## Phase 3: バックエンド Lambda + DynamoDB ✅

- [x] `infra/lambda/fitbitDataHandler/index.mjs` を新規作成
  - `POST /fitbit-data` — upsert (PutCommand)
    - PK: `user#${userId}`, SK: `FITBIT#${date}`
    - `createdAt`（初回のみ）+ `updatedAt`
  - `GET /fitbit-data?from=YYYY-MM-DD&to=YYYY-MM-DD` — 期間クエリ
    - SK `BETWEEN "FITBIT#${from}" AND "FITBIT#${to}~"`
  - `GET /fitbit-data?date=YYYY-MM-DD` — 単一日取得
- [x] `infra/lambda/__tests__/fitbitDataHandler.test.mjs` を新規作成（8テスト GREEN）
- [x] `infra/lib/jibun-ikusei-stack.ts` にルートを追加（GET/POST /fitbit-data）
- [ ] CDK デプロイ・動作確認（実環境への反映は手動で実行）

---

## Phase 4: Tool Search 統合（TDD） ✅

デスクトップ・Web の両方に `get_fitbit_data` ツールを追加する。

### 4-a: デスクトップ（Python）

- [x] `lily_desktop/tests/fitbit/test_fitbit_tool.py` を先に書く（RED）
  - 日付フィルタが正しく解析されること
  - `data_type` で返却テキストの内容が変わること
  - データなし時に適切なメッセージが返ること
- [x] `lily_desktop/api/api_client.py` に `get_fitbit_data(from_date, to_date)` を追加
- [x] `lily_desktop/ai/tool_definitions.py` に `get_fitbit_data` ツール定義を追加
  - parameters: `period`, `date`, `fromDate`, `toDate`, `data_type`
- [x] `lily_desktop/ai/tool_executor.py` に `_fitbit_data()` を追加（GREEN）
  - `_resolve_jst_date_filter(args, "week")` を使用
  - `api.get_fitbit_data()` 呼び出し
  - `data_type` に応じてテキスト整形

### 4-b: Web アプリ（TypeScript）

- [x] `src/lib/api-client.ts` に `getFitbitData(from, to)` を追加
- [x] `src/lib/chat-tools.ts` に `get_fitbit_data` ツール定義を追加（Python 側と同一スキーマ）
- [x] `src/lib/chat-tools.ts` の `executeTool()` に分岐追加
- [x] `executeGetFitbitData()` 関数を実装

---

## Phase 5: 同期オーケストレーター（TDD） ✅

- [x] `lily_desktop/tests/fitbit/test_fitbit_sync.py` を先に書く（RED）
  - 3日分のループが実行されること
  - 1日分の API 失敗時に他の日が継続されること
  - summary 化失敗時に raw JSON がファイルに保存されること
  - 全件失敗でも例外が上がらないこと
- [x] `lily_desktop/fitbit/fitbit_sync.py` を実装（GREEN）
  - `FitbitSync(client, api_client)` クラス
  - `run()` — JST 基準で当日・前日・前々日を決定、日ごとに独立処理
  - 日ごと: API 取得 → summary 化 → `api_client.post_fitbit_data()`
  - デバッグ用 raw JSON: `logs/fitbit/fitbit_raw_{date}.json`
  - 実行単位ログ・日単位ログ出力

---

## Phase 6: 起動統合 ✅

- [x] `lily_desktop/api/api_client.py` に `post_fitbit_data()` / `get_fitbit_data()` を追加
- [x] `lily_desktop/main.py` の `App.__init__()` で `FitbitSync` を初期化
  - `config.fitbit.enabled` が `true` かつ `fitbit_config.json` が存在する場合のみ
- [x] `async_init()` 内に `fitbit_sync.run()` を追加
  - 失敗しても起動を止めない（`try/except`、エラーログのみ）

---

## 検証チェックリスト

- [ ] `uv run pytest tests/fitbit/ -v` — 新規テスト全パス
- [ ] `uv run pytest tests/ -v` — 既存テストに影響なし
- [ ] `fitbit_config.json` を `lily_desktop/` に配置してアプリ起動
- [ ] `logs/fitbit/` に raw JSON が保存されること（summary化失敗時のみ保存される）
- [ ] DynamoDB コンソールで `SK=FITBIT#YYYY-MM-DD` レコード確認
- [ ] 2 回目起動で upsert（`updatedAt` が更新）されること
- [ ] チャットで「昨日の睡眠は？」と入力し `get_fitbit_data` が呼ばれること

---

## 主要ファイル一覧

| ファイル | 変更種別 |
|---------|---------|
| `spec/fitbit_データ取得仕様.md` | 変更済み（Tool Search セクション追加） |
| `spec/fitbit_todo.md` | このファイル |
| `lily_desktop/fitbit/__init__.py` | 新規 |
| `lily_desktop/fitbit/fitbit_client.py` | 新規 |
| `lily_desktop/fitbit/fitbit_summarizer.py` | 新規（experiment より移植） |
| `lily_desktop/fitbit/fitbit_sync.py` | 新規 |
| `lily_desktop/tests/fitbit/test_fitbit_summarizer.py` | 新規 |
| `lily_desktop/tests/fitbit/test_fitbit_client.py` | 新規 |
| `lily_desktop/tests/fitbit/test_fitbit_sync.py` | 新規 |
| `lily_desktop/tests/fitbit/test_fitbit_tool.py` | 新規 |
| `lily_desktop/core/config.py` | 変更（FitbitConfig 追加） |
| `lily_desktop/config.yaml` | 変更（fitbit セクション追加） |
| `lily_desktop/api/api_client.py` | 変更（get_fitbit_data 追加） |
| `lily_desktop/ai/tool_definitions.py` | 変更（get_fitbit_data 追加） |
| `lily_desktop/ai/tool_executor.py` | 変更（_fitbit_data 追加） |
| `lily_desktop/main.py` | 変更（FitbitSync 組み込み） |
| `src/lib/api-client.ts` | 変更（getFitbitData 追加） |
| `src/lib/chat-tools.ts` | 変更（get_fitbit_data 追加） |
| `infra/lambda/fitbitDataHandler/index.mjs` | 新規 |
| `infra/cdk/lib/*-stack.ts` | 変更（ルート追加） |
| `.gitignore` | 変更（fitbit_config.json 追加） |
