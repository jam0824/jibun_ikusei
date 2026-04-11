# リリィデスクトップ Local HTTP Bridge 仕様

## 1. 目的
- リリィデスクトップに、同一PC上のローカルクライアントからイベントを渡すための HTTP 受け口を提供する。
- v1 の責務は「外部イベントを既存の会話入口へ流し込むこと」に限定する。
- Quest / Completion の直接永続化は行わず、既存の会話フロー・保存フロー・吹き出し・読み上げを再利用する。

## 2. 前提
- 待ち受け先は `127.0.0.1` 固定とする。
- 認証は設けない。
- 同一PC内からの loopback 接続のみを想定する。
- 時刻の基準は JST（UTC+9）とする。

## 3. 設定
`lily_desktop/config.yaml` に以下を追加する。

```yaml
http_bridge:
  enabled: true
  port: 18765
```

- `http_bridge.enabled`
  - 既定値は `true`
- `http_bridge.port`
  - 既定値は `18765`
  - `0` 以下、`65535` 超、不正値は `18765` にフォールバックする

## 4. 公開 Endpoint

### 4-1. Endpoint
- `POST /v1/events`

### 4-2. 受付条件
- `127.0.0.1:{port}` で待ち受ける
- リクエスト本文は JSON オブジェクトとする
- `Content-Type` は MIME type として `application/json` を受け付ける
  - `application/json; charset=utf-8` も `application/json` として扱う

### 4-3. 未対応アクセス
- `POST /v1/events` 以外の path は `404`
- `/v1/events` に対する `POST` 以外の method は `405`

## 5. 共通 JSON 形式

### 5-1. 共通フィールド
- 必須
  - `eventType`: イベント種別
  - `source`: 送信元識別子
  - `payload`: イベント本体
- 任意
  - `eventId`: 送信側イベントID
  - `occurredAt`: 発生時刻
  - `metadata`: 補足情報

### 5-2. 共通バリデーション
- `eventType` は非空文字列であること
- `source` は非空文字列であること
- `payload` は JSON object であること
- `eventId` は指定時のみ非空文字列であること
- `metadata` は指定時のみ JSON object であること
- リクエスト本文は UTF-8 系の JSON とし、v1 実装では先頭に BOM を含む JSON は `invalid_json` として扱う
- `occurredAt` は指定時のみ JST の RFC3339 文字列であること
  - 例: `2026-04-04T21:15:00+09:00`
  - `Z` は不許可
  - `+00:00` など JST 以外の offset は不許可
- `occurredAt` が未指定の場合、受信時刻（JST）をサーバー側で補う

## 6. 対応イベント

### 6-1. `user_message`
任意のユーザー発話を、そのまま既存の会話入口へ流す。

#### payload
- 必須
  - `text`: 非空文字列

#### リクエスト例
```json
{
  "eventType": "user_message",
  "source": "chrome_extension",
  "eventId": "evt-user-001",
  "occurredAt": "2026-04-04T21:15:00+09:00",
  "payload": {
    "text": "今の集中クエストをクリアしたよ"
  },
  "metadata": {
    "tabUrl": "https://example.com"
  }
}
```

#### 内部変換
- `payload.text` をそのまま内部のユーザー発話に使う

#### `curl` による動作確認例
Windows PowerShell では `curl` が `Invoke-WebRequest` の alias であることがあるため、`curl.exe` を使う。

```powershell
$tmp = Join-Path $env:TEMP 'lily-http-bridge-user-message.json'
Set-Content -LiteralPath $tmp -Value '{"eventType":"user_message","source":"curl_test","payload":{"text":"HTTPからこんにちは"}}' -Encoding Ascii -NoNewline
curl.exe -s -S -D - -X POST http://127.0.0.1:18765/v1/events -H "Content-Type: application/json" --data-binary "@$tmp"
```

成功時のレスポンス例:

```json
{
  "ok": true,
  "status": "accepted",
  "eventType": "user_message",
  "eventId": null,
  "receivedAt": "2026-04-04T20:30:39+09:00"
}
```

補足:
- PowerShell で `Set-Content -Encoding UTF8` を使うと BOM 付きファイルになる環境があり、v1 実装では `invalid_json` になることがある
- Windows での疎通確認は `-Encoding Ascii` または BOM なし UTF-8 を推奨する

### 6-2. `quest_completed`
外部のクエスト完了イベントを、自然文の内部発話へ変換して既存の会話入口へ流す。

#### payload
- 必須
  - `title`: 非空文字列
- 任意
  - `xp`: 数値
  - `category`: 非空文字列
  - `note`: 非空文字列

#### リクエスト例
```json
{
  "eventType": "quest_completed",
  "source": "chrome_extension",
  "eventId": "evt-quest-001",
  "occurredAt": "2026-04-04T21:30:00+09:00",
  "payload": {
    "title": "Reactチュートリアルを見る",
    "xp": 2,
    "category": "学習",
    "note": "初回30分到達"
  },
  "metadata": {
    "domain": "react.dev"
  }
}
```

#### 内部変換ルール
- 基本文
  - `クエスト「{title}」をクリアしたよ。`
- `xp` がある場合
  - `XPは{符号付き数値}だよ。`
  - 例: `+2`, `-5`
- `category` がある場合
  - `カテゴリは「{category}」だよ。`
- `note` がある場合
  - `メモは「{note}」だよ。`

#### 変換例
```text
クエスト「Reactチュートリアルを見る」をクリアしたよ。XPは+2だよ。カテゴリは「学習」だよ。メモは「初回30分到達」だよ。
```

### 6-3. `chrome_audible_tabs`
Chrome 拡張から、現在可聴状態にある HTTP(S) タブの full snapshot を受け取る。

#### payload
- 必須
  - `audibleTabs`: 配列
- `audibleTabs[]` の必須フィールド
  - `tabId`: 整数
  - `domain`: 非空文字列

#### リクエスト例
```json
{
  "eventType": "chrome_audible_tabs",
  "source": "chrome_extension_audible_tabs",
  "eventId": "evt-audible-001",
  "payload": {
    "audibleTabs": [
      { "tabId": 101, "domain": "youtube.com" },
      { "tabId": 205, "domain": "netflix.com" }
    ]
  }
}
```

#### 内部処理
- このイベントは `user_message_received` 経路へは流さない
- 受信時刻（JST）と `audibleTabs` の full snapshot を直近状態として保持する
- 定期自動雑談の実行直前に、保持中 snapshot の鮮度が 90 秒以内で、かつ `chat.auto_talk_skip_audible_domains` に一致する domain が含まれていれば、その回の雑談をスキップする
- `audibleTabs` が空配列の場合は「現在可聴タブなし」の snapshot として保持し、以前の可聴状態をクリアする

## 7. 内部処理
- `user_message` / `quest_completed` は受信後に既存の `user_message_received` 経路へ流す
- これにより以下を既存実装で処理する
  - ユーザー吹き出し表示
  - 会話保存
  - リリィの応答生成
  - 読み上げ
- `chrome_audible_tabs` は内部発話を生成せず、可聴タブ状態の更新だけを行う
- `source` と `metadata` はログには残すが、内部発話文には混ぜない

## 8. レスポンス

### 8-1. 成功
- HTTP status: `202 Accepted`

```json
{
  "ok": true,
  "status": "accepted",
  "eventType": "quest_completed",
  "eventId": "evt-quest-001",
  "receivedAt": "2026-04-04T21:30:02+09:00"
}
```

### 8-2. エラー
- エラー本文は JSON とする
- エラーコードは以下に固定する
  - `invalid_json`
  - `invalid_payload`
  - `unsupported_event_type`
  - `invalid_occurred_at`
  - `not_found`
  - `method_not_allowed`

```json
{
  "ok": false,
  "error": {
    "code": "invalid_occurred_at",
    "message": "occurredAt must use a JST (+09:00) offset."
  }
}
```

## 9. ログ方針
- 実行ログは既存の runtime log を使う
- 受信成功・受信拒否の両方を JST で記録する
- 最低限以下をログに含める
  - `eventType`
  - `source`
  - `eventId`
  - `receivedAt`
  - `result`
- 拒否時は追加で `code` を含める

## 10. 例外と障害時の扱い
- ポート競合などで Local HTTP Bridge の起動に失敗しても、リリィデスクトップ本体は継続起動する
- 起動失敗時は runtime log に警告を残し、bridge のみ無効状態とする
- アプリ終了時は bridge を明示的に停止する

## 11. 将来拡張方針
- v1 は `user_message`、`quest_completed`、`chrome_audible_tabs` を対象とする
- v1 では共有シークレット、重複排除、Quest / Completion の直接永続化は実装しない
- 将来的にイベント種別を増やす場合も、まずは「構造化イベントを既存の会話入口へ変換する」方針を優先する
