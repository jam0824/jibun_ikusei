# Fitbitデータ取得・保存仕様（改訂版）

## 目的

リリィデスクトップの起動時に Fitbit API から直近3日分のデータを取得し、アプリで利用しやすい日次サマリーとして DB に保存する。

## 想定ユースケース

* アプリ起動時に最新の Fitbit データを自動取得したい
* 当日だけでなく、前日・前々日も再同期して欠損や遅延反映を吸収したい
* 取得したデータをリリィから利用しやすい形で保持したい

## 資料
* token取得の実験スクリプト : experiment/fitbit_get_token.py
* データ取得の実験スクリプト : experiment/fitbit_get_data.py
* 実験用に作ったfitbit_config(使用可能) : experiment/fitbit_config.json.py
* ドキュメント : https://dev.fitbit.com/build/reference/web-api/explore/

## スコープ

本仕様では以下を対象とする。

* アプリ起動時の Fitbit API 呼び出し
* 直近3日分のデータ取得
* access token の期限切れ時の refresh 処理
* 取得データの summary 化
* summary データの DB 保存
* エラー時の基本動作
* ログ出力

## 保存対象日

起動日を基準として、以下の3日分を保存対象とする。

* 当日
* 前日
* 前々日

各日を独立した処理単位として取得・summary 化・保存する。

## タイムゾーン

日付の基準は JST とする。

* 対象日の算出は JST 基準で行う
* Fitbit API に渡す日付も JST 基準の日付文字列とする
* DB に保存する日付も JST 基準の日付とする

## 取得対象データ

各対象日について、以下の Fitbit データを取得する。

### 心拍系

* resting_heart_rate
* heart_zones
* heart intraday の件数

### Active Zone Minutes

* intraday_points
* minutes_total_estimate
* summary_rows

### 睡眠系

* date_of_sleep
* start_time
* end_time
* minutes_asleep
* minutes_awake
* time_in_bed
* deep_minutes
* light_minutes
* rem_minutes
* wake_minutes

### 活動系

* steps
* distance
* calories
* very_active_minutes
* fairly_active_minutes
* lightly_active_minutes
* sedentary_minutes

## 保存方針

API の生レスポンス全体ではなく、アプリで利用する summary データを DB 保存する。
デバッグ用に raw JSON をローカルのファイルに別保存できるようにする。

* DB 保存対象は summary のみとする
* intraday の生データは DB 保存しない
* intraday は summary 生成の補助情報として扱う

## DB 方針

保存先 DB は DynamoDB とする。

* 1日につき 1 レコードを保存する
* 同日に再取得した場合は upsert する
* DB 設計の詳細は、本仕様および既存設計方針を踏まえて実装者が設計する

## 値の型方針

DB には数値型で保存する。

例:

* `steps`: integer
* `distance`: float
* `calories`: integer
* 各 active minutes 系: integer
* 心拍数: integer
* 睡眠 minutes 系: integer

表示用途で文字列化が必要な場合は、取得後または表示時に変換する。

## 睡眠データの日付の扱い

深夜をまたぐ睡眠でも、日次レコードは対象日ベースで1件とする。

* DB の `date` は API に問い合わせた対象日を採用する
* `sleep.main_sleep.date_of_sleep` は Fitbit API から返ってきた値をそのまま保持する
* Fitbit API の返却内容は、summary 化時に必要最小限の整形のみ行い、意味解釈による日付の補正は行わない

## 当日データの扱い

当日データは未確定値として扱う。

* 当日の歩数、消費カロリー、睡眠などは起動時点で途中値である可能性がある
* 再取得時は常に最新の summary で上書きする
* 前日・前々日も再同期対象に含める
* これにより、反映遅延や後追い更新を吸収する

## Active Zone Minutes の扱い

Active Zone Minutes は、0 と未取得を明確に区別して扱う。

* `0` は「取得できた結果として0分」を意味する
* `null` は「API仕様上またはレスポンス上、確定値を取得できなかった」ことを意味する
* `summary_rows = 0` は元データが存在しなかったことを示す補助情報として扱う

## Upsert 方針

* 同日のデータが既にある場合は更新する
* 再取得時は最新の summary で上書きする
* upsert は日単位で行う

## 日次 summary の想定構造

```json
{
  "date": "2026-04-04",
  "heart": {
    "resting_heart_rate": 62,
    "heart_zones": [
      {
        "name": "Out of Range",
        "min": 30,
        "max": 91,
        "minutes": 1200,
        "calories_out": 1300.5
      }
    ],
    "intraday_points": 1440
  },
  "active_zone_minutes": {
    "raw_type": "dict",
    "intraday_points": 0,
    "minutes_total_estimate": null,
    "summary_rows": 0
  },
  "sleep": {
    "main_sleep": {
      "date_of_sleep": "2026-04-04",
      "start_time": "2026-04-03T23:41:00.000",
      "end_time": "2026-04-04T06:58:00.000",
      "duration_ms": 26220000,
      "minutes_asleep": 397,
      "minutes_awake": 40,
      "time_in_bed": 437,
      "deep_minutes": 72,
      "light_minutes": 220,
      "rem_minutes": 105,
      "wake_minutes": 40
    },
    "all_sleep_count": 1
  },
  "activity": {
    "steps": 8234,
    "distance": 5.91,
    "calories": 2143,
    "very_active_minutes": 12,
    "fairly_active_minutes": 18,
    "lightly_active_minutes": 167,
    "sedentary_minutes": 843
  }
}
```

## 処理フロー

1. アプリ起動時に Fitbit 設定ファイルを読み込む
2. JST 基準で当日・前日・前々日の3日分の対象日を決定する
3. 各対象日について Fitbit API を呼び出す
4. API 応答が 401 の場合のみ token refresh を実行する
5. refresh 成功時は access_token と refresh_token を設定ファイルへ上書き保存する
6. refresh 後に対象日の Fitbit API を再実行する
7. 各対象日ごとにレスポンスを summary に整形する
8. 対象日ごとに DB へ upsert 保存する
9. 日ごとの結果と実行全体の結果をログ出力する

## 設定ファイル

設定ファイル名は `fitbit_config.json` とする。

### 想定項目

* client_id
* access_token
* refresh_token

### 補足

* refresh 成功時は access_token と refresh_token を設定ファイルへ上書き保存する
* client_secret は現行フローでは不要な前提とする

## エラー時の動作

### 設定ファイル読み込み失敗

* 起動時エラーとして扱う
* ユーザーに設定ファイル不備を通知する
* 3日分すべての DB 保存を行わない

### token refresh 失敗

* API 取得失敗として扱う
* ユーザーに再認証が必要であることを通知する
* その回の3日分取得処理を打ち切る
* DB 保存は行わない

### 一部 API のみ失敗

* ある1日分の summary 生成に必要な API が欠けた場合は、その日だけ保存しない
* 他の日の処理は継続する
* 実行全体としては部分成功を許可する

### summary 化失敗

* 異常レスポンスとして扱う
* 該当日の raw JSON をログまたはローカルファイルに残す
* 該当日だけ DB 保存を行わない
* 他の日の処理は継続する

## ログ出力

ログは最低限、実行単位および日単位で出力する。

### 実行単位ログ

* 実行ID
* 起動時刻
* 取得対象日一覧
* token refresh 実行有無
* 実行全体の成功 / 部分成功 / 失敗

### 日単位ログ

* 実行ID
* 対象日
* API取得成功 / 失敗
* summary 化成功 / 失敗
* upsert 成功 / 失敗

## 実装上の補足

* 複数日をまとめて1回で処理するのではなく、日ごとに独立して処理する
* 日ごとに取得・summary 化・保存を分離することで、失敗時の影響範囲を限定する
* 将来的に取得対象日数を増やす場合も、対象日リストを変更するだけで拡張しやすい構成とする
* DB 設計や内部クラス設計などの実装詳細は、実装者が既存仕様との整合を見て決定する

---

## Tool Search 仕様

チャット（デスクトップ・Web）から Fitbit データを参照できる `get_fitbit_data` ツールを提供する。

### ツール名

`get_fitbit_data`

### 説明

Fitbitの心拍・睡眠・活動データを取得する。
期間や日付を指定して、指定したデータ種別のサマリーをテキストで返す。

### パラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| period | string | 任意 | `"today"` / `"week"` / `"month"`（デフォルト: `"week"`） |
| date | string | 任意 | 単一日 `"YYYY-MM-DD"`（period より優先） |
| fromDate | string | 任意 | 範囲開始 `"YYYY-MM-DD"` |
| toDate | string | 任意 | 範囲終了 `"YYYY-MM-DD"` |
| data_type | string | 任意 | `"heart"` / `"sleep"` / `"activity"` / `"azm"` / `"all"`（デフォルト: `"all"`） |

日付指定の優先順位: `date` > `fromDate + toDate` > `period`

### 返却形式

テキスト形式（LLM が解析しやすいプレーンテキスト）

#### 例: data_type="sleep"

```
【2026-03-29 〜 2026-04-04 の睡眠サマリー】取得件数: 7件
- 2026-04-04: 就寝23:41 起床06:58 睡眠397分 (深72 / 浅220 / REM105 / 覚醒40)
- 2026-04-03: 就寝00:12 起床07:05 睡眠382分 (深65 / 浅198 / REM98 / 覚醒38)
```

#### 例: data_type="activity"

```
【2026-03-29 〜 2026-04-04 の活動サマリー】取得件数: 7件
- 2026-04-04: 歩数8234 距離5.91km 消費2143kcal 高活動12分 中活動18分
- 2026-04-03: 歩数7810 距離5.61km 消費2098kcal 高活動8分 中活動22分
```

#### 例: data_type="heart"

```
【2026-03-29 〜 2026-04-04 の心拍サマリー】取得件数: 7件
- 2026-04-04: 安静時心拍62bpm イントラデイ1440点
- 2026-04-03: 安静時心拍64bpm イントラデイ1440点
```

#### データなし時

```
2026-03-29 〜 2026-04-04 のFitbitデータはありません。
```

### 実装箇所

| レイヤー | ファイル |
|---------|---------|
| デスクトップ ツール定義 | `lily_desktop/ai/tool_definitions.py` |
| デスクトップ ツール実行 | `lily_desktop/ai/tool_executor.py` |
| デスクトップ API クライアント | `lily_desktop/api/api_client.py` |
| Web ツール | `src/lib/chat-tools.ts` |
| Web API クライアント | `src/lib/api-client.ts` |
| Lambda | `infra/lambda/fitbitDataHandler/index.mjs` |

### DynamoDB スキーマ

```
PK: user#${userId}
SK: FITBIT#${date}
属性: date, heart, active_zone_minutes, sleep, activity, createdAt, updatedAt
```

GET エンドポイント: `GET /fitbit-data?from=YYYY-MM-DD&to=YYYY-MM-DD`
