# Chrome拡張 と リリィデスクトップ Bridge 連携仕様

## 目的

- Chrome拡張の閲覧 XP イベントを、既存の Quest / Completion 同期とは別に、リリィデスクトップの会話入口へ best-effort で流す
- 閲覧クエスト達成やペナルティ発生時に、デスクトップ版リリィが自然文で反応できるようにする
- デスクトップ版リリィが起動していない場合でも、既存の閲覧クエスト経路を一切失敗させない

## 対象イベント

- `good_quest`
- `bad_quest`

`warning` はこの連携の対象外とする。

## 送信タイミング

- Chrome拡張の `evaluateAndEnqueue()` 内で、既存の `syncQueue.enqueue()` 完了後に送信する
- Quest / Completion の同期が主経路、Bridge 送信は副次経路とする

## 送信先

- URL は v1 では固定で `http://127.0.0.1:18765/v1/events`
- options UI やユーザー設定は増やさない

## リクエスト形式

- HTTP Method は `POST`
- `Content-Type` は `application/json`
- タイムアウトは `2秒`
- `AbortController` で timeout を管理する
- `occurredAt` は送らない

```json
{
  "eventType": "user_message",
  "source": "chrome_extension_browsing",
  "eventId": "uuid",
  "payload": {
    "text": "「Reactチュートリアルを見る」で+2 XPをゲットしました。"
  },
  "metadata": {
    "browsingType": "good",
    "domain": "react.dev",
    "category": "学習",
    "xp": 2,
    "title": "Reactチュートリアルを見る"
  }
}
```

## 文面ルール

- 表示名は `suggestedQuestTitle || domain || "閲覧活動"` を使う
- 良い閲覧は `「{label}」で+{xp} XPをゲットしました。`
- バッド閲覧は `「{label}」で{xp} XPのペナルティとなりました。`
- Quest 作成用のフォールバックタイトルが `game.com での閲覧` のような形式でも、Bridge 本文は `domain` を優先して自然な文面にする

## metadata

- `browsingType`: `good` または `bad`
- `domain`: 判定対象ドメイン。なければ `null`
- `category`: 分類カテゴリ。なければ `null`
- `xp`: 付与または減算した XP
- `title`: AI 生成クエストタイトル。なければ `null`

## 失敗時の扱い

- Bridge 送信は best-effort とする
- fetch 失敗、接続拒否、タイムアウト、デスクトップリリィ未起動は通常系の一部として扱う
- 送信失敗時も Quest / Completion の生成、Sync Queue、XP 反映、トースト表示は継続する
- retry や永続キューは持たない
- `logError` には流さず、activity log の `system.error` も増やさない

## テスト観点

- helper 単体で good / bad の本文生成を検証する
- title 不在時は `domain`、domain も不在時は `閲覧活動` にフォールバックする
- fetch 失敗時に throw せず `false` を返す
- timeout 時に `false` を返す
- `alarm-handlers` から `good_quest` / `bad_quest` で localhost Bridge 呼び出しが 1 回発生する
- `warning` では Bridge 呼び出しが発生しない
- Bridge 送信失敗時も既存の Quest / Completion POST と日次進捗更新が成立する
