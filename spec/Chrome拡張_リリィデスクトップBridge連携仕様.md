# Chrome拡張 と リリィデスクトップ Bridge 連携仕様

## 目的

- Chrome拡張の閲覧 XP イベントを、既存の Quest / Completion 同期とは別に、リリィデスクトップの会話入口へ best-effort で流す
- 閲覧クエスト達成やペナルティ発生時に、デスクトップ版リリィが自然文で反応できるようにする
- デスクトップ版リリィが起動していない場合でも、既存の閲覧クエスト経路を一切失敗させない

## 対象イベント

- `good_quest`
- `bad_quest`
- `warning`
- `chrome_audible_tabs`
- `browser_page_changed`
- `heartbeat`

## 送信タイミング

- `good_quest` / `bad_quest` / `warning` の評価は background の `periodic-sync` alarm で 1 分おきに行う
- Chrome拡張の `evaluateAndEnqueue()` 内で、既存の `syncQueue.enqueue()` 完了後に送信する
- Quest / Completion の同期が主経路、Bridge 送信は副次経路とする
- `warning` は `notificationsEnabled` が有効なときだけ、トースト送信と同じタイミングで送信する
- `chrome_audible_tabs` は service worker 起動時、可聴状態または URL 更新時、タブ close 時、30 秒 heartbeat 時に送信する
- `chrome_audible_tabs` は「現在可聴な HTTP(S) タブの full snapshot」を送る
- `browser_page_changed` は `tabs.onActivated`, アクティブタブの URL change, `window_focus` 復帰時に送信する
- `heartbeat` は `flush-tracker` alarm と `FLUSH_AND_GET_PROGRESS` の flush 経路で送信する

## 送信先

- URL は v1 では固定で `http://127.0.0.1:18765/v1/events`
- options UI やユーザー設定は増やさない

## リクエスト形式

- HTTP Method は `POST`
- `Content-Type` は `application/json`
- タイムアウトは `2秒`
- `AbortController` で timeout を管理する
- `occurredAt` は送らない
- `good_quest` / `bad_quest` / `warning` はユーザー発話ではないため `eventType` は `system_message` を使う
- `browser_page_changed` / `heartbeat` は行動ログ基盤向けイベントのため、JST の `occurredAt` を付けて送る

```json
{
  "eventType": "system_message",
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

`chrome_audible_tabs` の例:

```json
{
  "eventType": "chrome_audible_tabs",
  "source": "chrome_extension_audible_tabs",
  "eventId": "uuid",
  "payload": {
    "audibleTabs": [
      { "tabId": 101, "domain": "youtube.com" },
      { "tabId": 205, "domain": "netflix.com" }
    ]
  }
}
```

`browser_page_changed` の例:

```json
{
  "eventType": "browser_page_changed",
  "source": "chrome_extension",
  "eventId": "uuid",
  "occurredAt": "2026-04-17T21:15:00+09:00",
  "payload": {
    "tabId": 101,
    "url": "https://developer.mozilla.org/docs/Web",
    "domain": "developer.mozilla.org",
    "title": "MDN Web Docs"
  },
  "metadata": {
    "trigger": "tab_activated",
    "category": "学習",
    "isGrowth": true,
    "cacheKey": "developer.mozilla.org:/docs/Web"
  }
}
```

`heartbeat` の例:

```json
{
  "eventType": "heartbeat",
  "source": "chrome_extension",
  "eventId": "uuid",
  "occurredAt": "2026-04-17T21:15:30+09:00",
  "payload": {
    "tabId": 101,
    "url": "https://developer.mozilla.org/docs/Web",
    "domain": "developer.mozilla.org",
    "title": "MDN Web Docs"
  },
  "metadata": {
    "trigger": "flush",
    "elapsedSeconds": 30,
    "category": "学習",
    "isGrowth": true,
    "cacheKey": "developer.mozilla.org:/docs/Web"
  }
}
```

## 文面ルール

- 表示名は `suggestedQuestTitle || domain || "閲覧活動"` を使う
- 良い閲覧は `「{label}」で+{xp} XPをゲットしました。`
- バッド閲覧は `「{label}」で{xp} XPのペナルティとなりました。`
- 警告は `Lily: {domain} をあと10分見続けるとペナルティです。`
- 警告で `domain` が取れない場合は `Lily: もうすぐ1時間です。このまま続けるか、一度切り上げるか考えてみましょう。` にフォールバックする
- Quest 作成用のフォールバックタイトルが `game.com での閲覧` のような形式でも、Bridge 本文は `domain` を優先して自然な文面にする

## metadata

- `browsingType`: `good` / `bad` / `warning`
- `domain`: 判定対象ドメイン。なければ `null`
- `category`: 分類カテゴリ。なければ `null`
- `xp`: 付与または減算した XP
- `title`: AI 生成クエストタイトル。warning では常に `null`

## `chrome_audible_tabs` payload ルール

- `chrome.tabs.query({ audible: true })` で得られた可聴タブだけを対象にする
- `http:` / `https:` 以外の URL は送らない
- `domain` は hostname を小文字化し、先頭 `www.` は除去して送る
- payload は full snapshot とし、現在可聴タブがない場合は `audibleTabs: []` を送る
- 非空 snapshot の間は 30 秒ごとに heartbeat 送信する
- 非空から空へ遷移したときは、空 snapshot を 1 回送る

## `browser_page_changed` / `heartbeat` payload ルール

- `http:` / `https:` 以外の URL は送らない
- シークレット / プライベートブラウジング (`tab.incognito === true`) では送らない
- `title` は `PageInfo` キャッシュがあればそれを優先し、無ければ `tab.title`、どちらも無ければ `null`
- `category`, `isGrowth`, `cacheKey` は分類済みなら入れ、未分類なら `null` を許容する
- `heartbeat` は `elapsedSeconds > 0` のときだけ送る
- v1 の desktop 側 Local HTTP Bridge はまだ `browser_page_changed` / `heartbeat` を受理しないため、送信結果が `400 unsupported_event_type` でも通常系として扱う

## 失敗時の扱い

- Bridge 送信は best-effort とする
- fetch 失敗、接続拒否、タイムアウト、デスクトップリリィ未起動は通常系の一部として扱う
- 送信失敗時も Quest / Completion の生成、Sync Queue、XP 反映、トースト表示は継続する
- retry や永続キューは持たない
- `logError` には流さず、activity log の `system.error` も増やさない

## テスト観点

- helper 単体で good / bad / warning の本文生成を検証する
- helper 単体で good / bad / warning の `eventType=system_message` を検証する
- helper 単体で `chrome_audible_tabs` の body 生成を検証する
- helper 単体で `browser_page_changed` / `heartbeat` の body 生成と JST `occurredAt` を検証する
- title 不在時は `domain`、domain も不在時は `閲覧活動` にフォールバックする
- fetch 失敗時に throw せず `false` を返す
- timeout 時に `false` を返す
- tab activation, active URL change, window focus 復帰で `browser_page_changed` が送られる
- flush 経路で `heartbeat` が送られ、`elapsedSeconds` が含まれる
- シークレット / プライベートブラウジング中は `browser_page_changed` / `heartbeat` が送られない
- `alarm-handlers` から `good_quest` / `bad_quest` で localhost Bridge 呼び出しが 1 回発生する
- `alarm-handlers` から `warning` でも `notificationsEnabled` 有効時は localhost Bridge 呼び出しが 1 回発生する
- `notificationsEnabled` が `false` の場合、warning のトーストと Bridge 呼び出しはどちらも発生しない
- Bridge 送信失敗時も既存の Quest / Completion POST と日次進捗更新が成立する
- service worker 起動時に可聴タブ snapshot が送信される
- 可聴状態が消えたときに空 snapshot が送信される
- 30 秒 heartbeat 時に可聴タブ snapshot が再送される
