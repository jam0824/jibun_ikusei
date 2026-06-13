# 自分育成ゲームアプリ 仕様 v0.3（サーバー実装反映版）

更新日: 2026-04-16

## 0. この版の位置づけ

この仕様書は、現在のリポジトリ実装を基準に整理した版である。

現行実装は、初期案だった「完全ローカル完結」ではなく、次の構成になっている。

- UX の基本方針はローカルファースト
- 認証は Amazon Cognito
- アプリデータの永続化先は DynamoDB
- クライアントは localStorage をローカルキャッシュ兼オフライン用ストレージとして利用
- クラウド同期は API Gateway + Lambda の個別 API で行う
- AI / TTS 呼び出しは引き続きクライアントから外部 API に直接送る

このため、本書では「ローカルファーストなクラウド同期型 Web アプリ」として仕様を定義する。

---

## 1. プロダクト概要

### 1-1. コンセプト

- 操作感は TODO 管理アプリ
- 意味づけは RPG 育成ゲーム
- ユーザーは自分でクエストを登録し、実行したら自己申告でクリアする
- クリアに応じて「ユーザーLv」と「スキルLv」が上がる
- Lily が結果を言語化し、成長感を与える

### 1-2. MVP の目的

- 毎日の行動を「完了」ではなく「成長」として感じられること
- 1日 1〜5 回の軽い利用が自然に続くこと
- 行動ログがそのまま「自分が育っている証拠」になること
- あとで見返したい記事 URL をスクラップ記事として保存できること
- 同一アカウントで複数端末から再開しやすいこと

### 1-3. 非目的

- 厳密な不正防止
- SNS 的な競争
- AI が何でも勝手に決める全自動運用
- 公開サインアップ導線
- 高度な競合解決つきリアルタイム同期

---

## 2. 設計原則

### 2-1. 体験原則

- 入力は最小
- 完了時の気持ちよさは最大
- 管理より「成長の可視化」を優先
- 日々の操作は軽く、振り返りは深く

### 2-2. UI 原則

- 基本骨格は TODO アプリ
- ホーム、クリア演出、Lily 周辺だけ RPG 的にする
- 日常操作に不要な演出は増やしすぎない
- 目安として `70% 実用 UI / 30% ゲーム演出`

### 2-3. 実装原則

- ローカル状態を先に更新して体感速度を優先する
- クラウド同期はバックグラウンドで行う
- API / AI が失敗しても主要な記録機能は止めない
- オフラインでも主要画面は使えるようにする
- 同期競合は完全解決よりも「updatedAt の新しい方を優先」で単純化する

---

## 3. 対象ユーザー

### 3-1. メインターゲット

- 管理感が強いタスクアプリは続かない人
- ゲーム的な成長表現が好きな人
- 学習、運動、仕事、生活習慣を横断的に育てたい人

### 3-2. 利用前提

- 個人利用
- スマホ中心
- 1回あたりの操作時間は 5〜30 秒が中心
- アカウントにログインして利用する

---

## 4. プラットフォーム構成

### 4-1. クライアント

- 配布形態: PWA 対応 Web アプリ
- フレームワーク: React + TypeScript + Vite
- 状態管理: Zustand
- ルーティング: React Router
- ローカル保存: `localStorage`
- オフライン再訪: Service Worker
- 補助クライアントとして Windows 常駐の `lily_desktop` を持ち、行動ログ収集と Web deep link 起動を担当する
- `lily_desktop` は閲覧 UI を持たず、内部の `Activity Capture Service` が行動ログ収集を担当する。収集専用の別デスクトップアプリは v0.1 では設けない
- Android では PWA の Web Share Target API により、共有メニューから記事 URL をスクラップ記事として保存できる
- iOS では v0.1 時点で共有メニューからの PWA 直接保存は対象外とし、Web アプリ内の手動追加を正規導線とする

### 4-2. 認証

- 認証基盤: Amazon Cognito User Pool
- ログイン方式: メールアドレス + パスワード
- 自己サインアップ: 無効
- 初回ログイン時に `NEW_PASSWORD_REQUIRED` チャレンジへ対応
- API 呼び出し時は Cognito ID トークンを `Authorization: Bearer <token>` で送る

### 4-3. バックエンド

- API: API Gateway HTTP API
- 実装: AWS Lambda
- データベース: DynamoDB シングルテーブル
- リージョン: `ap-northeast-1`
- CORS: `*` 許可、`Content-Type` / `Authorization` を許可
- Lambda ランタイム: Node.js 24.x

### 4-4. AI / TTS

- OpenAI: テキスト生成・スキル分類
- Gemini: テキスト生成・スキル分類・TTS
- AI 呼び出しはクライアントから外部 API へ直接送信する
- TTS は Gemini TTS を使用する

### 4-5. ローカルキャッシュとクラウド同期

- 起動時はまず localStorage を読み込み、画面を即時表示する
- その後、クラウドの各 API を並列取得し、ローカル状態とマージする
- エンティティ配列は `updatedAt` または `createdAt` が新しい方を優先する
- 起動時マージでは、ローカルで自動生成された `seed` / `system` quest と `seed` skill をクラウド既存データへ寄せる
- `seed` quest は title 完全一致、`system` quest は `systemKey` 一致で重複判定する
- 旧データ互換として、source 未設定でもサンプル quest title 完全一致なら `seed` とみなす
- `aiConfig` と `meta` は起動時マージでローカル値を優先する
- 各操作後のクラウド反映はベストエフォートで行う
- API 失敗時の自動再送キューは未実装

### 4-6. 旧同期 API

移行用として旧 `/sync` API と `migrateState` Lambda を残す。

- `/sync` GET: `STATE#full` から一括取得
- `/sync` PUT: `STATE#full` へ一括保存
- `migrateState`: 旧 `STATE#full` を新しい分割エンティティへ移行

現行クライアントは `/sync` を使用せず、個別 API を使用する。

---

## 5. 主要用語

### Account

Cognito で認証される利用アカウント。アプリのデータ分離単位でもある。

### Quest

ユーザーが自分で登録する行動単位。

例: `読書する`, `エアロバイクを漕ぐ`, `企画メモを2ページ書く`

### Completion

クエストをクリアした 1 回の記録。

### User Level

全クエストの累積経験値で上がる総合レベル。

### Skill

抽象化された成長項目。

例: `読書`, `有酸素運動`, `文書作成`, `タスク管理`

### Skill Level

特定スキルの累積経験値で上がる分野別レベル。

### Lily

アプリ内ナビゲーター。短いコメント、振り返り、音声読み上げを担当。

### Meta

サンプルデータ投入済みフラグ、日次サマリー実行日、通知権限状態などの内部メタ情報。

---

## 6. 情報設計と画面構成

### 6-1. 画面一覧

- ログイン
- ホーム
- ステータス
- クエスト一覧
- クエスト作成 / 編集
- スキル一覧
- 記録
- 設定
- クリア演出

### 6-2. グローバルナビゲーション

下タブは以下の 5 つ。

1. ホーム
2. クエスト
3. 追加
4. スキル
5. 記録

設定はホーム右上から遷移する。
ステータス画面はホームのレベルカードから遷移する。

### 6-3. 主要ルート

- `/`
  - ホーム
- `/status`
  - ステータス
- `/quests`
  - クエスト一覧
- `/quests/new`
  - クエスト作成
- `/skills`
  - スキル一覧
- `/records`
  - 記録系の入口
  - 直近に見ていた `records` 配下の route を復元し、未保存時は `/records/quests?range=today` へ遷移する
- `/records/quests?range=today|week|all`
  - 成長記録
- `/records/activity/today?view=session|event`
  - 今日の行動ログ
- `/records/activity/day/:dateKey?view=session|event`
  - 任意日の行動ログ詳細
- `/records/activity/calendar?month=YYYY-MM`
  - 行動ログカレンダー
- `/records/activity/review/year?year=YYYY`
  - 週次行動レビュー一覧
- `/records/activity/search`
  - 行動ログ検索
- `/records/activity/review/week?weekKey=YYYY-Www`
  - 週次行動レビュー詳細
- `/weekly-reflection`
  - 既存の週次ふりかえり
- `/lily`
  - リリィチャット
- `/settings`
  - 設定

#### deep link の扱い

- 認証前に deep link へアクセスした場合、ログイン完了後に元の URL へ戻す。
- `pathname` または `search` が変わる遷移は、`画面遷移スクロール仕様_2026-04-12.md` のスクロールリセット対象とする。

---

## 7. 画面仕様

### 7-1. ログイン

#### 目的

- 認証済みユーザーだけがアプリ本体を利用できるようにする
- 初回ログイン時のパスワード変更にも対応する

#### 表示要素

- メールアドレス入力
- パスワード入力
- ログインボタン
- エラー文言

#### 初回ログイン時

- Cognito が `NEW_PASSWORD_REQUIRED` を返した場合は新しいパスワード設定画面へ遷移する
- 新パスワードは 8 文字以上

### 7-2. ホーム

#### 目的

- 今の成長状態を一目で把握させる
- 今日やることへ最短で入れる
- Lily の存在を感じさせる

#### 表示要素

1. レベルカード
   - 現在 Lv
   - 現在総 XP
   - 次レベルまでの残 XP
   - XP バー
   - タップでステータス画面へ遷移
2. 今日の成長サマリー
   - 今日のクリア数
   - 今日の獲得 XP
   - 今日よく伸びたスキル上位
3. Lily カード
   - 今日のひとこと
   - 再生ボタン
   - AI 未設定時はテンプレート文にフォールバック
4. 今日のクエスト
   - 優先順で最大 5 件
   - `クリア` ボタン付き
5. クイックアクション
   - クエスト追加
   - 今日の記録を見る
   - スキルを見る

#### 導線

- `今日の記録を見る` は `/records` へ遷移する。
- `/records` は前回見ていた記録系 route を復元する。初回は `/records/quests?range=today` を開く。

#### 補足

- 総合的な自己状態を RPG 風に一覧表示する詳細画面は別紙 `自分ステータス画面仕様_v_0_1.md` を参照する

#### 空状態

- 初回利用時は「最初のクエストを作る」導線を中央表示
- サンプルクエスト 3 件を自動投入する

### 7-3. クエスト一覧

#### タブ

- デイリー
- 繰り返し
- 単発
- すべて
- 完了済み
- アーカイブ

#### クエストカード項目

- タイトル
- XP バッジ
- スキル表示
  - 固定スキル名
  - AI 自動
  - 未設定
- 種別バッジ
  - デイリー / 繰り返し / 単発
- 状態表示
  - クリア可能
  - クールダウン中
  - 本日上限到達
  - 期限切れ
  - クリア済み
- 右端アクション
  - `クリア`
  - `詳細`

### 7-4. クエスト作成 / 編集

#### 入力項目

- タイトル
  - 必須
  - 60 文字以内
- 説明
  - 任意
  - 240 文字以内
- XP
  - 必須
  - 1〜100
- 種別
  - `repeatable`
  - `one_time`
- デイリー設定
  - `repeatable` のときのみ設定可能
  - ON のクエストは一覧の `デイリー` タブに表示
- スキル付与方法
  - `fixed`
  - `ai_auto`
  - `ask_each_time`
- カテゴリ
  - `学習 / 運動 / 仕事 / 生活 / 対人 / 創作 / その他`
- プライバシー設定
  - `normal`
  - `no_ai`
- クールダウン
- 1日上限
- 期限
- リマインド時刻
- ピン留め

#### 非 AI モード

- クエスト文面は外部 AI に送らない
- 固定スキルまたはルールベース推定のみ利用する
- Lily はテンプレート発話にフォールバックする

#### 削除条件

- active な completion が 0 件なら削除可能
- 取り消し済み completion のみ残る場合は削除可能
- active な completion が 1 件以上ある場合は削除不可
- 削除時は同クエストの completion と関連 assistant message をローカルから除去する
- クラウド側は `DELETE /quests/{id}` のみ実装済みで、関連 completion 一括削除 API はない

### 7-5. クエストクリアモーダル

#### 項目

- クエスト名
- XP 獲得予定
- メモ欄
  - 任意
  - 120 文字以内
- 実行日時
  - 今
  - 5 分前
  - 30 分前
  - カスタム

#### クリア後の流れ

1. ローカル状態を即時更新
2. `+XP` アニメーション
3. User Lv バー更新
4. Skill Lv 反映
5. Lily の短文表示
6. バックグラウンドで completion / user / quest / skill をクラウド同期

#### スキル解決分岐

- 固定スキル: 即時反映
- `ai_auto` かつ `defaultSkillId` あり: 前回結果を再利用
- AI 高信頼: 即時反映
- AI 中信頼: 候補 3 件を表示してユーザー確認
- AI 低信頼: `未分類`

### 7-6. スキル画面

#### 一覧表示項目

- スキル名
- カテゴリ
- 現在 Lv
- 現在 XP
- 次 Lv までの XP バー
- 直近 7 日での増加量

#### 操作

- スキル詳細を開く
- スキル統合を行う

### 7-7. 記録画面

#### タブ

- `quests`
  - 既存の成長記録を表示する
- `activity`
  - PC 行動ログ・日記を表示する
  - 正本仕様は `spec/行動ログ基盤仕様_v_0_1.md` とする

#### 入口 route

- BottomNav の `記録` は `/records` を開く。
- `/records` は直近に見ていた `records` 配下 route を復元する。
- 初回または復元不可時は `/records/quests?range=today` を開く。

#### 正式 route

- `quests`
  - `/records/quests?range=today|week|all`
- `activity`
  - `/records/activity/today?view=session|event`
  - `/records/activity/day/:dateKey?view=session|event`
  - `/records/activity/calendar?month=YYYY-MM`
  - `/records/activity/review/year?year=YYYY`
  - `/records/activity/search`
  - `/records/activity/review/week?weekKey=YYYY-Www`

#### `quests` タブのフィルタ

- `today`
- `week`
- `all`

#### `quests` タブの表示内容

- `today`
  - クリア履歴一覧のみ表示する
- `week`
  - 件数ヘッダーの下に `今週のクリア回数上位10位` を表示する
  - ランキングはクエストごとに集計し、各行で `今週 X回 / 先週 Y回` を比較表示する
- `all`
  - 件数ヘッダーの下に `累計クリア回数上位10位` を表示する
  - ランキングはクエストごとの累計クリア回数を表示する
- 時刻
- クエスト名
- `+User XP`
- `+Skill XP`
- 紐づいたスキル名
- Lily コメント有無
- メモ

#### `quests` タブの操作

- クリアから 10 分以内なら `取り消し`
- 候補状態の completion に対してスキル確定

#### `activity` タブの表示内容

- タイムライン
- `today/day` のタイムラインは `session` / `event` とも server の paged read を使い、active view の最新 `50件` だけを初回表示する。残りは `さらに50件表示` で次ページを取得する
- `today/day` では `session` / `event` の page state を分け、初回は現在の view だけを取得し、もう片方は最初の切り替え時に初回 fetch する
- `today/day` では総件数を表示せず、`さらに50件表示` は `nextCursor` がある時だけ出す
- `today/day` の `Target` カードでは、モバイルでも `対象日` と `session / event` 切り替えを同じ行に配置する
- デイリーログ
- 検索導線
- 週次行動レビュー導線
- 手動メモ導線と hidden session の検索導線

#### `activity` タブ内の通常導線

- `行動ログ` タブを開くと `/records/activity/today` へ遷移する。
- `成長記録 / 行動ログ` タブと、行動ログ内の `今日 / カレンダー / 検索 / 週次レビュー` pill ナビは、選択中に文字色・アイコン色のコントラストを十分に確保し、暗色背景では白文字を使って背景に埋もれない見た目を保つ。
- `today/day` のセッションカードでは直接 `非表示 / 再表示` ボタンを出さず、右上は時刻アイコン中心の軽い表示にする。
- `今日` から特定日へ移動する時は `/records/activity/day/:dateKey` を使う。
- `カレンダー` は `/records/activity/calendar?month=YYYY-MM`
- `検索` は `/records/activity/search`
- `週次レビュー` は `/records/activity/review/year`
- `session` / `event` 切り替えは `view` query で表現する。
- `calendar` は `month` query を持てる。未指定時は JST 基準の当月を表示する。
- `calendar` では 1 か月分を表示し、`前月` / `次月` / `年月ピッカー` で移動できる。
- `review/year` は `year` query を持てる。未指定時は JST 基準の当年、または直近の利用可能年を表示する。
- `review/year` では 1 年分の週次レビュー一覧を表示し、`前年` / `次年` / `年ピッカー` で移動できる。
- `review/year` の各週カードの導線ラベルは `詳細` とし、モバイルでは本文と衝突しないよう縦積み配置を許容する。
- `review/year` の各週を押すと `/records/activity/review/week?weekKey=YYYY-Www` の詳細へ遷移する。
- `review/week` は個別週の詳細 route として扱い、本文、カテゴリ比率、よく使ったアプリ / ドメインを表示する。

#### `activity` タブの補足

- 行動ログは `quests` / `completions` と別レイヤーの記録である。
- 同一行動が成長記録と行動ログの両方に現れることはある。
- `RawEvent` は最近の詳細確認用データとして短期保持し、既定では 30 日で自動削除する。
- 長期的に見返す正本は `ActivitySession`, `DailyActivityLog`, `WeeklyActivityReview` とする。

### 7-8. 設定画面

#### App

- PWA インストール導線
- オフライン状態表示

#### Lily Voice

- 音声 ON/OFF
- 自動再生
  - `on`
  - `tap_only`
  - `off`

#### Notifications

- 通知 ON/OFF
- 通知時刻

#### AI

- AI 利用 ON/OFF
- アクティブプロバイダ
  - `openai`
  - `gemini`
  - `none`
- OpenAI API Key 入力 / 表示切替 / 接続テスト / 消去
- Gemini API Key 入力 / 表示切替 / 接続テスト / 消去
- モデル名表示
- Gemini Speaker 選択

#### Data

- JSON Export
- JSON Import
  - `merge`
  - `replace`
- ローカルデータ削除

#### Account

- ログイン中メールアドレス表示
- ログアウト

#### 補足

- `ローカルデータ削除` は localStorage のみ削除する
- クラウドデータ削除 API は未実装
- ログアウト時もクラウドデータは残る

### 7-9. クリア演出

#### 表示内容

- 完了クエスト名
- 獲得 User XP
- スキル反映結果
- Lily コメント
- 再生ボタン
- ユーザー / スキルの進捗バー

---

## 8. クエスト・進行仕様

### 8-1. クエスト種別

#### 定常クエスト

- 複数回クリア可能
- クールダウンあり
- 1日上限あり
- 通常は `active` のまま

#### 単発クエスト

- 1 回クリアしたら `completed`
- 再オープンで `active` に戻せる

#### デイリー設定

- `repeatable` クエストにのみ付与できる
- 表示分類のみを変える設定で、クールダウンや 1 日上限の挙動は変えない
- 既存の繰り返しクエストは未設定のまま保持する

### 8-2. 状態

- `active`
- `completed`
- `archived`

### 8-3. クールダウン

- 最小 `0`
- 最大 `1440`
- デフォルト `30`

### 8-4. 1 日上限

- 最小 `1`
- 最大 `10`
- デフォルト `1`

### 8-5. 重複送信防止

- クライアントは `clientRequestId` を発行する
- 同一クエストの 2.5 秒以内の連打を抑止する
- サーバー側に厳密な冪等制御は未実装

---

## 9. レベル・経験値仕様

### 9-1. ユーザー XP

- クエスト報酬 XP をそのまま加算
- クリア時点で即時反映
- サーバーの completion API でも User XP を再計算して保存する

### 9-2. ユーザーレベル

```txt
nextUserLevelXp = 100
```

- `Math.floor(totalXp / 100) + 1`

### 9-3. スキル XP

- 基本は `questXp`
- 1 回のスキル加算上限は `20`

```txt
skillXpAwarded = min(questXp, 20)
```

### 9-4. スキルレベル

```txt
nextSkillLevelXp = 50
```

- `Math.floor(totalXp / 50) + 1`

---

## 10. スキル仕様

### 10-1. カテゴリ

- 学習
- 運動
- 仕事
- 生活
- 対人
- 創作
- その他

### 10-2. 初期シードスキル

- 学習: 読書 / 学習習慣 / 情報整理 / 調査
- 運動: 有酸素運動 / 筋力トレーニング / ストレッチ
- 仕事: 文書作成 / タスク管理 / 集中作業 / 企画設計
- 生活: 家事 / 健康管理 / 睡眠習慣
- 対人: コミュニケーション / 傾聴 / 気配り
- 創作: ライティング / デザイン / 発想力

### 10-3. 命名原則

- 具体クエスト名ではなく抽象スキル名にする
- 正規化名を内部保持する
- active skill は同一 `normalizedName` で重複生成しない
- 統合済みスキルは `status = merged` とし、参照先を保持する

### 10-4. スキル統合

- sourceSkill を `merged` にする
- `mergedIntoSkillId` に target を保持する
- quest / completion / dictionary の参照を target に寄せる
- クラウド同期は関連エンティティごとに個別 API を呼ぶ

---

## 11. スキル抽象化仕様

### 11-1. 優先順位

1. 固定スキル
2. クエストの `defaultSkillId`
3. 個人辞書
4. 既存スキル
5. シードスキル
6. 新規スキル提案
7. 未分類

### 11-2. 入力

- quest.title
- quest.description
- completion.note
- quest.category
- existingSkills[]
- seedSkills[]
- userDictionary[]

### 11-3. AI 出力 JSON

```json
{
  "action": "assign_existing",
  "skillName": "有酸素運動",
  "category": "運動",
  "confidence": 0.94,
  "reason": "エアロバイクは運動系の既存スキルに一致するため",
  "candidateSkills": ["有酸素運動", "筋力トレーニング", "ストレッチ"]
}
```

### 11-4. 信頼度ルール

- `0.80 以上`: 自動適用
- `0.55 以上 0.80 未満`: 候補提示
- `0.55 未満`: `unclassified`

### 11-5. フォールバック

以下の場合はルールベース推定へフォールバックする。

- AI 利用 OFF
- `activeProvider = none`
- API Key 未設定
- オフライン
- `privacyMode = no_ai`
- 外部 API エラー

---

## 12. Lily 仕様

### 12-1. キャラクター

- 名前: Lily
- 役割: ナビゲーター
- トーン: 明るい、親しみやすい、少しゲーム風

### 12-2. 発話トリガー

- `quest_completed`
- `user_level_up`
- `skill_level_up`
- `daily_summary`
- `weekly_reflection`
- `nudge`

### 12-3. フォールバック

AI が使えない場合はテンプレート文を使う。

例:

- `ナイスです。経験値が 5 増えました。`
- `読書スキルが伸びています。いい流れです。`
- `今日も 1 件クリアです。少しずつ前進しています。`

### 12-4. 保存

- Lily メッセージは `assistantMessages` に保存する
- completion 由来のメッセージは `completionId` で関連づける

---

## 13. AI / TTS 仕様

### 13-1. AI の役割

- スキル抽象化
- Lily 発話テキスト生成
- 接続テスト

### 13-2. 利用プロバイダ

- OpenAI
  - text model: `gpt-5.4`
- Gemini
  - text model: `gemini-2.5-flash`
  - tts model: `gemini-2.5-flash-preview-tts`

### 13-3. Structured Output

- OpenAI / Gemini とも JSON Schema ベースで構造化出力を要求する
- UI へ自由文をそのまま流さず、必ず JSON を検証してから使う

### 13-4. TTS

- TTS は Gemini のみを使用する
- voice 候補:
  - Zephyr
  - Puck
  - Kore
  - Aoede
  - Charon
  - Callirrhoe
  - Fenrir
  - Leda
  - Orus

### 13-5. 音声再生

- 音声はメモリキャッシュする
- キャッシュ済み音声があれば再利用する
- 失敗時はテキスト表示を継続する

---

## 14. 認証・同期・データ管理仕様

### 14-1. 認証フロー

1. アプリ起動
2. Cognito セッション確認
3. 未ログインならログイン画面を表示
4. ログイン成功後にストアを初期化
5. localStorage を即時ロード
6. クラウド API を並列取得してマージ

### 14-2. 同期方針

- 読み込み
  - localStorage を先に使う
  - その後クラウドを読み込む
- 書き込み
  - まず localStorage を更新
  - その後 API をバックグラウンドで呼ぶ
- 競合
  - エンティティ単位で `updatedAt` / `createdAt` の新しい方を優先
- 失敗時
  - 画面操作は継続
  - 自動再送キューはない

### 14-3. ローカルストレージキー

```txt
app.user
app.settings
app.quests
app.completions
app.skills
app.assistantMessages
app.personalSkillDictionary
app.aiConfig
app.meta
```

### 14-4. JSON Import / Export

- Export は現在のローカル状態を JSON 化して出力する
- Import は `merge` または `replace`
- Import 後はローカル状態を更新し、クラウドへベストエフォート同期する
- `replace` でもクラウド側の削除同期は未実装

### 14-5. ローカルデータ削除

- localStorage のみ削除する
- クラウドデータは削除しない
- 再ログインまたは再初期化時にクラウドから復元されうる

---

## 15. API 仕様

### 15-1. 認証共通

- すべての API は Cognito JWT 認証必須
- ユーザー識別子は JWT claim の `sub`

### 15-2. エンドポイント一覧

| パス | メソッド | 用途 |
|---|---|---|
| `/sync` | GET | 旧一括取得 |
| `/sync` | PUT | 旧一括保存 |
| `/quests` | GET | クエスト一覧 |
| `/quests` | POST | クエスト作成 |
| `/quests/{id}` | PUT | クエスト更新 |
| `/quests/{id}` | DELETE | クエスト削除 |
| `/completions` | GET | 完了一覧 |
| `/completions` | POST | 完了作成 + XP 反映 |
| `/completions/{id}` | PUT | 完了更新 |
| `/skills` | GET | スキル一覧 |
| `/skills` | POST | スキル作成 |
| `/skills/{id}` | PUT | スキル更新 |
| `/user` | GET / PUT | ユーザー情報 |
| `/settings` | GET / PUT | 設定 |
| `/ai-config` | GET / PUT | AI 設定 |
| `/meta` | GET / PUT | メタ情報 |
| `/messages` | GET / POST | Lily メッセージ |
| `/dictionary` | GET / POST | 個人辞書 |
| `/dictionary/{id}` | PUT | 辞書更新 |

### 15-3. 代表レスポンス

#### `POST /completions`

```json
{
  "completionId": "completion_xxx",
  "userXpAwarded": 5,
  "totalXp": 105,
  "level": 2,
  "userLevelUp": true,
  "skillLevelUp": false
}
```

- `POST /completions` は保存済み `USER#profile.totalXp` / `SKILL#*.totalXp` への単純加算ではなく、active completion の集合を正本として `user` / `skills` を再集計した結果を返す
- 既存の集計値がずれていても、同 API 実行時に対象ユーザーの `user` / `skills` は completion 由来の値へ自己修復される

#### `PUT /user` / `PUT /settings` / `PUT /ai-config` / `PUT /meta`

```json
{
  "updated": true
}
```

#### `DELETE /quests/{id}`

```json
{
  "deleted": "quest_xxx"
}
```

### 15-4. 更新 API の扱い

- `POST /skills` は active な同名 `normalizedName` の skill が既に存在する場合、既存 skill を `200` で返し、新規作成しない
- `POST /quests` は `seed` / `system` quest のみ重複防止対象とし、既存 quest があれば `200` で返し、新規作成しない
- `POST /quests` の重複判定は `systemKey`、または旧サンプル互換の title 完全一致で行う
- 既存の重複データは自動クリーンアップしない
- `PUT /completions/{id}` は既存データを読み込んでマージする
- `PUT /completions/{id}` 実行後は、active completion の集合を正本として `USER#profile.totalXp` / `level` と既存 `SKILL#*` の `totalXp` / `level` を再集計する
- この再集計は AI 再判定による `resolvedSkillId` / `skillXpAwarded` の後付け、手動スキル確定、undo の `undoneAt` 更新、skill merge に伴う `resolvedSkillId` の付け替えに共通で適用する
- `PUT /quests/{id}` は現実装ではフルオブジェクト置換に近い
- `PUT /skills/{id}` も現実装ではフルオブジェクト置換に近い
- `PUT /dictionary/{id}` も現実装ではフルオブジェクト置換に近い
- クライアント実装では一部部分更新も行っているため、今後は API 契約の整理が必要

---

## 16. DynamoDB データ構造

### 16-1. シングルテーブル設計

パーティションキー:

```txt
PK = user#<cognito-sub>
```

ソートキー:

- `USER#profile`
- `SETTINGS#main`
- `AICONFIG#main`
- `META#main`
- `QUEST#<id>`
- `COMPLETION#<id>`
- `SKILL#<id>`
- `MSG#<id>`
- `DICT#<id>`
- `STATE#full` 旧方式

### 16-2. 特徴

- 1 ユーザーの全データを同一 PK 配下に置く
- 一覧取得は `begins_with(SK, prefix)` で取得する
- GET API は `PK` / `SK` をレスポンスから除去する

---

## 17. データモデル

```ts
type QuestSource = "manual" | "browsing" | "seed" | "system"
type QuestType = "repeatable" | "one_time"
type SkillMappingMode = "fixed" | "ai_auto" | "ask_each_time"
type PrivacyMode = "normal" | "no_ai"
type QuestStatus = "active" | "completed" | "archived"
type SkillResolutionStatus = "not_needed" | "pending" | "resolved" | "needs_confirmation" | "unclassified"
type AiProvider = "openai" | "gemini" | "none"
type ProviderStatus = "unverified" | "verified" | "invalid"
type SkillSource = "manual" | "ai" | "seed"
type SkillStatus = "active" | "merged"
type TriggerType = "quest_completed" | "user_level_up" | "skill_level_up" | "daily_summary" | "weekly_reflection" | "nudge"
type MessageMood = "bright" | "calm" | "playful" | "epic"

interface LocalUser {
  id: "local_user"
  level: number
  totalXp: number
  createdAt: string
  updatedAt: string
}

interface ProviderConfig {
  apiKey?: string
  status?: ProviderStatus
  updatedAt: string
  model: string
  ttsModel?: string
  voice?: string
}

interface AiConfig {
  activeProvider: AiProvider
  providers: {
    openai: ProviderConfig
    gemini: ProviderConfig
  }
}

interface UserSettings {
  lilyVoiceEnabled: boolean
  lilyAutoPlay: "on" | "tap_only" | "off"
  defaultPrivacyMode: PrivacyMode
  reminderTime?: string
  aiEnabled: boolean
  voiceCharacter: string
  notificationsEnabled: boolean
  createdAt: string
  updatedAt: string
}

interface Quest {
  id: string
  title: string
  description?: string
  questType: QuestType
  isDaily?: boolean
  xpReward: number
  category?: string
  skillMappingMode: SkillMappingMode
  fixedSkillId?: string
  defaultSkillId?: string
  cooldownMinutes?: number
  dailyCompletionCap?: number
  dueAt?: string
  reminderTime?: string
  status: QuestStatus
  privacyMode: PrivacyMode
  pinned: boolean
  source?: QuestSource
  systemKey?: "meal_register"
  createdAt: string
  updatedAt: string
}

interface QuestCompletion {
  id: string
  questId: string
  clientRequestId: string
  completedAt: string
  note?: string
  userXpAwarded: number
  skillXpAwarded?: number
  resolvedSkillId?: string
  skillResolutionStatus: SkillResolutionStatus
  candidateSkillIds?: string[]
  resolutionReason?: string
  assistantMessageId?: string
  undoneAt?: string
  createdAt: string
}

interface Skill {
  id: string
  name: string
  normalizedName: string
  category: string
  level: number
  totalXp: number
  source: SkillSource
  status: SkillStatus
  mergedIntoSkillId?: string
  createdAt: string
  updatedAt: string
}

interface PersonalSkillDictionary {
  id: string
  phrase: string
  mappedSkillId: string
  createdBy: "user_override" | "system"
  createdAt: string
}

interface AssistantMessage {
  id: string
  triggerType: TriggerType
  mood: MessageMood
  text: string
  audioUrl?: string
  completionId?: string
  createdAt: string
}

interface AppMeta {
  schemaVersion: number
  seededSampleData: boolean
  lastDailySummaryDate?: string
  lastWeeklyReflectionWeek?: string
  lastNotificationCheckDate?: string
  notificationPermission?: "default" | "granted" | "denied" | "unsupported"
}

interface PersistedAppState {
  user: LocalUser
  settings: UserSettings
  aiConfig: AiConfig
  quests: Quest[]
  completions: QuestCompletion[]
  skills: Skill[]
  personalSkillDictionary: PersonalSkillDictionary[]
  assistantMessages: AssistantMessage[]
  meta: AppMeta
}
```

---

## 18. 業務ルール・例外処理

### 18-1. クールダウン中

- クリアは失敗扱い
- `次回可能時刻` を表示する

### 18-2. 単発クエスト再クリア

- `completed` 状態では失敗
- UI 上は `再オープン` 導線を出す

### 18-3. 取り消し

- クリアから 10 分以内のみ可能
- `undoneAt` を付与する
- 単発クエストは `active` に戻す
- クラウド側では `PUT /completions/{id}` と必要に応じて `PUT /quests/{id}` を呼ぶ
- `PUT /completions/{id}` 後は active completion を基準に user XP / skill XP を再集計し、取り消した completion ぶんの増分をクラウド集計から除外する

### 18-4. API 失敗時

- ローカル処理は成立させる
- エラーで UI 全体を止めない
- 自動再送はしない

### 18-5. AI 失敗時

- スキル解決はフォールバックする
- Lily はテンプレート文へフォールバックする
- クリア自体は成立する

### 18-6. オフライン時

- クエスト管理、スキル、記録、設定、JSON Import / Export は利用可能
- AI 接続テスト、Lily メッセージ生成、音声再生は停止する
- 変更は localStorage に残る
- クラウドへの反映は次回の操作または将来の再同期処理に依存する

---

## 19. 通知仕様

### 19-1. 実装方式

- ブラウザ通知を使用する
- サーバープッシュは未実装

### 19-2. 条件

- 通知権限が `granted`
- `notificationsEnabled = true`
- リマインド時刻を過ぎている

### 19-3. 現状の位置づけ

- 主要導線はあくまでアプリ内
- 通知は補助機能

---

## 20. 非機能要件

### 20-1. パフォーマンス

- localStorage からの初回描画は即時
- クエストクリアの体感反映は 200ms 以内を目標
- クラウド同期は非同期で許容

### 20-2. 可用性

- AI 失敗時でもクエストクリアは成立
- TTS 失敗時でもテキスト表示は継続
- API 失敗時でもローカル利用は継続

### 20-3. セキュリティ

- アプリデータ API は JWT 認証を必須とする
- AI API Key はクライアント入力で管理する
- 現行実装では `aiConfig` をクラウド保存しているため、ローカルのみ保存ではない
- 本番運用時は AI キー管理方針の再設計を検討する

### 20-4. データ保全

- 重要操作ごとに localStorage を更新する
- クラウドはエンティティ単位で保存する
- ローカル削除とクラウド削除は別操作である

---

## 21. MVP に含めるもの

- Cognito ログイン
- クエスト登録 / 編集 / アーカイブ / 削除
- デイリー / 繰り返し / 単発
- 自己申告クリア
- User Lv / Skill Lv
- 固定スキル / AI 自動スキル / 候補確認
- Lily 短文
- Gemini TTS 再生
- 活動ログ
- スキル統合
- 10 分以内取り消し
- AI 設定画面
- localStorage キャッシュ
- DynamoDB 永続化
- 個別 API 同期
- JSON Export / Import

---

## 22. MVP で含めないもの

- 公開サインアップ
- 他ユーザーとの共有
- ランキング
- リアルタイム共同編集
- 自動再送キュー
- 完全な双方向差分同期
- クラウドデータ削除 UI
- AI 代理実行サーバー

---

## 23. 受け入れ条件

- ログインに成功するとホームへ入れる
- 起動時に localStorage の内容で画面がすぐ開く
- クラウドデータが存在すればバックグラウンドで取り込まれる
- ユーザーが `読書する: XP5` を作れる
- 一覧から `クリア` を押すと User XP が増える
- `読書` スキルに XP が入る
- 一定 XP で User Lv が上がる
- スキル XP でスキル Lv が上がる
- ホームで進捗が見える
- デイリー設定した繰り返しクエストがクエスト一覧の `デイリー` タブに表示される
- デイリー設定していない繰り返しクエストが `繰り返し` タブに表示される
- Lily が結果を話す
- 同じ定常クエストをクールダウン中に連打できない
- 単発クエストは 1 回で完了済みになる
- ログアウトしてもクラウドデータは保持される
- 再ログイン後に継続できる
- AI API Key を設定画面から保存できる
- API / AI が失敗しても主要機能は止まらない

---

## 24. 現状の実装上の注意点

- 同期はベストエフォートであり、再送キューは未実装
- `PUT /quests` / `PUT /skills` / `PUT /dictionary` は部分更新 API としては不完全
- `ローカルデータ削除` はクラウド削除ではない
- `/sync` と `STATE#full` は移行用として残存している
- AI キーはローカルだけでなくクラウドにも保存される実装になっている

---

## 25. この仕様の核

1. クエストの操作感は TODO
2. 成長の見せ方は RPG
3. ローカル即時反映を優先する
4. 認証とクラウド保存で継続利用しやすくする
5. AI は補助に徹し、失敗しても主要導線は止めない
