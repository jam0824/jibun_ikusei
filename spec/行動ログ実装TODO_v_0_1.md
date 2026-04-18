# 行動ログ実装 TODO v0.1

更新日: 2026-04-18

関連仕様:
- [行動ログ_INDEX.md](./行動ログ_INDEX.md)
- [行動ログ基盤仕様_v_0_1.md](./行動ログ基盤仕様_v_0_1.md)
- [行動ログ_organizer_openai補足_2026-04-18.md](./行動ログ_organizer_openai補足_2026-04-18.md)
- [自分育成ゲームアプリ_仕様_v_0_3_local_first.md](./自分育成ゲームアプリ_仕様_v_0_3_local_first.md)
- [自分育成ゲーム_画面遷移図_v_0_1.md](./自分育成ゲーム_画面遷移図_v_0_1.md)
- [自分育成ゲーム_chrome_extention仕様.md](./自分育成ゲーム_chrome_extention仕様.md)
- [リリィデスクトップ仕様.md](./リリィデスクトップ仕様.md)
- [リリィデスクトップLocal_HTTP_Bridge仕様.md](./リリィデスクトップLocal_HTTP_Bridge仕様.md)
- [リリィ仕様.md](./リリィ仕様.md)

---

## 共通ルール

- [ ] 時刻・日付・日次区切り・週次区切りは JST を基準に実装する
- [ ] 仕様変更が入った場合は `spec` 配下の関連仕様へ必ず反映する
- [ ] すべてのフェーズを TDD で進める
- [ ] 各フェーズは `spec反映 -> failing test追加 -> 最小実装 -> 関連テスト実行 -> 自己レビュー -> TODO更新` の順で進める
- [ ] 各フェーズ完了時に必ず自己レビューを実施する
- [ ] Chrome のページ滞在時間の正本は Chrome Extension とし、desktop 側で別実装の再計測をしない
- [ ] 行動ログの閲覧 UI は PWA を正本とし、`lily_desktop` は収集と URL 起動のハブに徹する
- [x] 通常の整理系 AI は local `gemma4`、日次・週次まとめは `gpt-5.4` を使う
- [ ] `RawEvent` はサーバー TTL 前提、`ActivitySession` 以上は長期保持前提で進める
- [ ] `Phase 0: Mock` 完了後は必ず停止し、ユーザー確認が終わるまで次フェーズに進まない

## 共通の自己レビュー項目

- [ ] spec と実装のズレがないか
- [ ] JST 前提を壊していないか
- [ ] privacy 境界を破っていないか
- [ ] 既存の責務分離を壊していないか
- [ ] 不要な重複計測や二重保存がないか
- [ ] テストが対象範囲を十分にカバーしているか

## 実装対象インターフェース

- [ ] `RawEvent`
- [ ] `ActivitySession`
- [x] `DailyActivityLog`
- [x] `WeeklyActivityReview`
- [x] `Activity Capture Service`
- [ ] `Chrome Extension -> Desktop -> Server` のイベント流れ

---

## Phase 0: Mock

> [!WARNING]
> このフェーズの完了後は必ず停止すること。ユーザー確認が終わるまで Phase 1 以降へ進まない。

### 目的

- [x] PWA 上で行動ログ画面群の見た目と導線を先に確認できる状態を作る
- [x] `records/activity/...` の route を実 UI に先行してモックで確認できるようにする
- [x] desktop から開く URL 着地先を先に固める

### 実装対象

- [x] `RawEvent / ActivitySession / DailyActivityLog / WeeklyActivityReview` のダミーデータを用意する
- [x] `today / day / calendar / search / review/year / review/week` のモック画面を PWA 側に出す
- [x] `records/activity/...` の主要 route をモック画面へ接続する
- [x] desktop から開く前提の URL をモック画面で受けられるようにする
- [x] `gpt-5.4` / `gemma4` / 実収集 / 実同期はまだ接続しない

### 先に書く failing test

- [x] `records/activity/today` がモック画面を表示するテスト
- [x] `records/activity/day/:dateKey` が日別モック画面を表示するテスト
- [x] `records/activity/search` が検索モック画面を表示するテスト
- [x] `records/activity/review/year` が週次レビュー一覧のモック画面を表示するテスト
- [x] `records/activity/review/week` が週次レビュー詳細のモック画面を表示するテスト
- [x] モックデータでも `DailyActivityLog` と `WeeklyActivityReview` の表示枠が成立するテスト

### 実装メモ

- [x] public interface は本決めしすぎず、route・画面導線・モックデータ形状の確認までに留める
- [x] 既存の `records` 配下導線と衝突しないように配置する
- [x] 見た目確認に必要な最小限の状態だけを持つ
- [x] データ取得は固定モックまたは UI 層内の仮データ供給に留める

### 完了条件

- [x] `records/activity/...` の主要 route がモック表示できる
- [x] PWA 上で今日画面、検索画面、週次レビュー画面の見た目と導線が確認できる
- [x] desktop から開く想定 URL がモック画面に正しく着地する
- [x] モックデータでも `DailyActivityLog` と `WeeklyActivityReview` の表示枠が成立している
- [x] **STOP: ここで一度ストップし、ユーザー確認待ちに入る**

### 自己レビュー項目

- [x] spec とモック導線のズレがないか
- [x] route 命名が既存仕様と一致しているか
- [x] 実装が本番データ前提になっていないか
- [x] 後続フェーズで差し替えやすいモック境界になっているか
- [x] 関連テストが route と表示枠を十分にカバーしているか

---

## Phase 1: 共有契約と保存モデル

### 目的

- [x] 行動ログ全体で共通に使う型・保存単位・ API 契約を固める
- [x] `RawEvent` TTL と `ActivitySession` 以上の長期保持の前提をコードに落とす

### 実装対象

- [x] `RawEvent / ActivitySession / DailyActivityLog / WeeklyActivityReview / ManualNote / OpenLoop / PrivacyRule / Device` の型定義
- [x] サーバー保存モデルと API 契約の骨組み
- [x] privacy rule と storage mode の土台
- [x] `RawEvent` の TTL 既定値 30 日の扱い

### 先に書く failing test

- [x] 型変換・バリデーションのテスト
- [x] JST 基準の `dateKey / weekKey / occurredAt` の解釈テスト
- [x] `RawEvent.expiresAt` の計算テスト
- [x] privacy rule の適用優先順位テスト

### 実装メモ

- [x] route や UI と密結合しない共有契約として切り出す
- [x] URL 全文保存とドメインのみ保存の両モードを持てる形にする
- [x] 画像本文やキー入力本文は契約に含めない

### 完了条件

- [x] 行動ログ系の主要型が正本として定義されている
- [x] API 契約と保存モデルの責務分離が明確
- [x] TTL と privacy の前提がテストで担保されている

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか

---

## Phase 2: Chrome Extension 連携

### 目的
  
  - [x] ブラウザ時間の正本を Chrome Extension に保ったまま、行動ログ向けイベント送出を追加する
  - [x] 閲覧クエスト系と行動ログ系の住み分けをコード上でも明確にする

### 実装対象
  
  - [x] 行動ログ向けの `browser_page_changed / heartbeat` 送出
  - [x] `elapsedSeconds` などのブラウザ補助メタデータの送出
  - [x] extension から desktop へ渡すイベントのフォーマット整備
  - [x] extension 無効時の粗い fallback 文脈の整理
  - [x] シークレット / プライベートブラウジング時は行動ログイベントを送出しない

### 先に書く failing test
  
  - [x] タブ切り替え時に行動ログイベントが送出されるテスト
  - [x] heartbeat に必要なメタデータが含まれるテスト
  - [x] 閲覧クエスト用集計と行動ログ用送出が衝突しないテスト
  - [x] extension 無効時に正確な滞在時間正本へ降格しないことのテスト
  - [x] シークレット / プライベートブラウジング中は行動ログイベントを送出しないテスト

### 実装メモ
  
  - [x] 既存のブラウザ時間計測ロジックを書き換えすぎない
  - [x] 行動ログ側はページ滞在時間の一次正本ではなくイベント受領側であることを守る
  - [x] desktop が再計測しない前提をテストでも押さえる

### 完了条件
  
  - [x] extension から行動ログ向けイベントが安定して送れる
  - [x] 閲覧クエスト系の正本時間計測を壊していない
  - [x] 行動ログ側で必要なブラウザ文脈が取得できる
  - [x] シークレット / プライベートブラウジング除外が効いている

### 自己レビュー項目
  
  - [x] spec と実装のズレがないか
  - [x] JST 前提を壊していないか
  - [x] privacy 境界を破っていないか
  - [x] 既存の責務分離を壊していないか
  - [x] 不要な重複計測や二重保存がないか
  - [x] テストが対象範囲を十分にカバーしているか

---

## Phase 3: Lily Desktop Capture

### 目的

- [x] `lily_desktop` を正式ホストとして `Activity Capture Service` を組み込む
- [x] OS 側イベントと extension イベントを同じ内部イベント層へ統合する

### 実装対象

- [x] `Activity Capture Service` の土台
- [x] active window / idle の統合と、desktop 起点 file context は空許容で扱う整理
- [x] `Local HTTP Bridge` を capture service の入力アダプタとして接続
- [x] privacy rule 適用とローカル一時キュー
- [x] デバイス単位の `収集中 / 一時停止 / 無効` 制御
- [x] 収集機能のみを停止・再起動できる制御境界

### 先に書く failing test

- [x] active window 変更が `RawEvent` に変換されるテスト
- [x] idle 開始 / 終了のテスト
- [x] bridge から受けた browser event が正規化されるテスト
- [x] privacy rule によって除外されるテスト
- [x] `一時停止` 中は新規 `RawEvent` を生成しないテスト
- [x] `無効` 状態では収集が起動しないテスト

### 実装メモ

- [x] UI・会話処理と収集処理の責務境界を守る
- [x] v0.1 は同一プロセスでもよいが、将来サブプロセス化しやすい境界にする
- [x] ローカル一時保存は再送前提の spool として扱う
- [x] 収集機能障害時も `lily_desktop` の表示・会話は継続できる境界を保つ

### 完了条件

- [x] desktop 側の主要イベントが `RawEvent` として統一形式で扱える
- [x] bridge 経由の browser event が capture service に統合される
- [x] privacy rule と一時キューが機能する
- [x] `収集中 / 一時停止 / 無効` のデバイス状態が機能する

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか

---

## Phase 4: サーバ保存と同期

### 目的

- [x] 行動ログの正本保存と端末同期の基盤を作る
- [x] `RawEvent` の短期保持と `ActivitySession` 以上の長期保持をサーバー側に反映する

### 実装対象

- [x] `RawEvent` 保存 API
- [x] `ActivitySession / DailyActivityLog / WeeklyActivityReview` 保存 API
- [x] `RawEvent` TTL 設定と `expiresAt` 反映
- [x] デバイスごとの送信・再送・重複防止

### 先に書く failing test

- [x] `RawEvent` 保存と TTL フィールド設定のテスト
- [x] session 以上の長期保存テスト
- [x] 同一イベントの重複送信抑止テスト
- [ ] オフライン復帰後の再送テスト

### 実装メモ

- [x] `RawEvent` の長期参照を前提にしない
- [x] `ActivitySession` 以上を UI と Lily の正本参照に使う
- [x] storage 層で privacy 境界を破らない

### 完了条件

- [x] サーバーに保存すべき単位が仕様どおり保存される
- [x] TTL と長期保持の住み分けが正しく機能する
- [ ] 端末同期と再送の基本ケースが通る

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [ ] テストが対象範囲を十分にカバーしているか

---

## Phase 5: セッション化と local gemma4

### 目的

- [x] 生イベントから人が読める作業単位を作る
- [x] local `gemma4` を使った通常整理処理を組み込む

### 実装対象

- [x] `RawEvent -> ActivitySession` のセッション化
- [x] セッション名付け
- [x] primary category と activity kind の分類
- [x] OpenLoop 抽出
- [x] 検索補助インデックス生成

### 先に書く failing test

- [x] 近接イベントが同一 session に束ねられるテスト
- [x] idle やアプリ切り替えで session が分かれるテスト
- [x] local `gemma4` 結果の保存テスト
- [x] local AI 不可時にルールベース fallback へ落ちるテスト

### 実装メモ

- [x] local `gemma4` は整理用であり、日次・週次まとめには使わない
- [x] LLM 入力は必要最小限の構造化データに絞る
- [x] fallback 時も UI が壊れない形にする
- [x] v0.1 ではセッション手動分割を持たず、自動セッション化の安定性を優先する

### 完了条件

- [x] session タイトル・カテゴリ・OpenLoop が生成される
- [x] local `gemma4` が通常整理処理に使われる
- [x] fallback 時も最低限の session 生成が成立する

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか

---

## Phase 6: PWA 本実装
### 目的
- [x] `mock` 画面を本実装へ置き換え、PWA 上で行動ログを読める状態にする
- [x] `/records` を route hub にして、最後に見ていた `records` 配下 route を復元できるようにする

### 実装対象

- [x] `/records` route hub
- [x] `/records/quests?range=today|week|all`
- [x] `/records/activity/today?view=session|event`
- [x] `/records/activity/day/:dateKey?view=session|event`
- [x] `/records/activity/calendar?month=YYYY-MM`
- [x] `/records/activity/search`
- [x] `/records/activity/review/year?year=YYYY`
- [x] `/records/activity/review/week?weekKey=YYYY-Www`
- [x] `records` 配下 route の localStorage 復元
- [x] `event / session` view query の保持
- [x] `calendar` の `month` query 保持
- [x] `calendar` の `前月` / `次月` / `年月ピッカー`
- [x] `review/year` の `year` query 保持
- [x] `review/year` の `前年` / `次年` / `年ピッカー`
- [x] `review/year` から `review/week` 詳細への遷移
- [x] `RecordsScreen` を `/records/quests` 配下へ移設
- [x] `DailyActivityLog` を timeline より先に表示
- [x] `today / day` の `session / event` timeline は新しい時刻を上に表示
- [x] `ManualNote` の表示枠だけ残す
- [ ] `ManualNote` の追加・保存

### 先に書く failing test

- [x] `/records` が最後に見た child route を復元する
- [x] 初回または復元不能時に `/records/quests?range=today` を開く
- [x] `/records/quests?range=week|all|today` で既存の記録画面が表示される
- [x] `today` が JST 当日を使う
- [x] `day/:dateKey` が指定日を表示する
- [x] `view=session|event` で表示が切り替わる
- [x] `today` の `session` timeline は新しい時刻が上に来る
- [x] `day` の `event` timeline は新しい時刻が上に来る
- [x] `DailyActivityLog` が timeline より先に表示される
- [x] `month` 未指定時に JST 当月を表示する
- [x] `month=YYYY-MM` 指定時に対象月を表示する
- [x] `前月` / `次月` / `年月ピッカー` で `month` query が更新される
- [x] 日付セル押下で `day/:dateKey` へ遷移する
- [x] `year` 未指定時に JST 当年を表示する
- [x] `year=YYYY` 指定時に対象年を表示する
- [x] `前年` / `次年` / `年ピッカー` で `year` query が更新される
- [x] 年一覧から `review/week?weekKey=YYYY-Www` へ遷移する
- [x] `review/week` が指定週の詳細を表示する
- [x] 期間とキーワードで `ActivitySession` / `OpenLoop` が client-side filter される
- [x] 空結果時の empty state が出る
- [x] `home-screen` からの `records` 導線が壊れていない
- [x] `weekly-reflection-screen` からの `records` 導線が壊れていない

### 実装メモ

- [x] PWA を唯一の正式 UI として扱う
- [x] `records` の復元先は `localStorage` の UI 専用キーで持つ
- [x] quest 記録は既存の `RecordsScreen` を維持したまま `/records/quests` に寄せる
- [x] 行動ログ画面は action-log API の実データを使って描画する
- [x] カレンダーは 1 か月単位表示を正本にする
- [x] 週次レビュー一覧は 1 年単位表示を正本にする
- [x] `review/week` は週詳細 route として扱う
- [x] 最小検索は `ActivitySession` と `OpenLoop` の client-side filter に留める
- [x] Phase 6 では `ManualNote` の保存 UI は実装しない

### 完了条件

- [x] 主 route が `mock` ではなく action-log API の実データで表示される
- [x] `/records` の復元導線が動く
- [x] PC / スマホの両方で route ベースの閲覧が成立する
- [x] deep link URL と PWA 内導線が一致している
- [x] カレンダーが 1 画面 1 か月で表示され、前月 / 次月 / 年月ピッカーで移動できる
- [x] 週次レビュー一覧が 1 画面 1 年で表示され、前年 / 次年 / 年ピッカーで移動できる
- [x] 年一覧から週詳細へ遷移できる
- [x] 手動メモ未実装でも UI が壊れず、表示枠だけ残る

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか
---

## Phase 7: gpt-5.4 日次・週次まとめ

### 目的

- [x] `DailyActivityLog` と `WeeklyActivityReview` の生成を本実装する
- [x] 日次・週次まとめを `gpt-5.4` へ接続する

### 実装対象

- [x] `/records/activity/today` では当日 `DailyActivityLog` を生成しない
- [x] `/records/activity/day/:dateKey` で JST 前日だけ `DailyActivityLog` を生成する
- [x] Web 側は JST 月曜日の週次画面で前週 `WeeklyActivityReview` だけを生成する
- [x] `lily_desktop` 起動時に前日 `DailyActivityLog` を補完する
- [x] `lily_desktop` 起動時に前週 `WeeklyActivityReview` を補完する
- [x] `gpt-5.4` 失敗時のテンプレート fallback
- [x] `ActivitySession` ベースの整形済み入力生成
- [x] リリィがユーザーの観察日記を書いたような文体ガイドを prompt / fallback へ組み込む

### 先に書く failing test

- [x] `/records/activity/today` では `DailyActivityLog` を生成しないテスト
- [x] `/records/activity/day/:yesterday` で missing daily が生成されるテスト
- [x] `/records/activity/day/:older` では missing daily でも生成しないテスト
- [x] 月曜日の `/records/activity/review/year` で前週 missing weekly だけ生成するテスト
- [x] 月曜日の `/records/activity/review/week` で前週 missing weekly だけ生成するテスト
- [x] Web 側では前週以外の週を生成しないテスト
- [x] `lily_desktop` 起動時に missing な前日 daily を生成するテスト
- [x] `lily_desktop` 起動時に missing な前週 weekly を生成するテスト
- [x] 既存の前日 daily / 前週 weekly を再生成しないテスト
- [x] `gpt-5.4` 失敗時にテンプレート fallback するテスト
- [x] 日次まとめ prompt がリリィ観察日記トーンを要求するテスト
- [x] 週次まとめ prompt がリリィ観察日記トーンを要求するテスト
- [x] fallback 文も観察日記風の地の文になるテスト

### 実装メモ

- [x] raw event 全文やスクリーンショット本体は `gpt-5.4` に送らない
- [x] `/records/activity/today` は read-only にし、日次まとめ PUT を行わない
- [x] `DailyActivityLog` は JST 前日だけ未生成時に作る
- [x] Web 側の `WeeklyActivityReview` は JST 月曜日の前週対象だけ未生成時に作る
- [x] desktop 側 summary backfill は raw sync -> organizer -> summary backfill の順で動かす
- [x] local `gemma4` と責務を混ぜない
- [x] 直接話しかけるチャット口調ではなく、リリィがそっと見守って書いた観察日記風の地の文を正本にする
- [x] 提案や励ましは補足に留め、本文は観察記述を主にする

### 完了条件

- [x] 日次・週次まとめが `gpt-5.4` で生成される
- [x] 失敗時の fallback がある
- [x] `/records/activity/today` では当日まとめを生成しない
- [x] Web 側は前日 day 画面と月曜日の前週週次画面だけで補完する
- [x] desktop 起動時に前日 / 前週が未生成なら補完する
- [x] PC / スマホの Web 閲覧起点で挙動が揃っている
- [x] 日次・週次まとめの文体がリリィ観察日記トーンで揃っている

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか

---

## Phase 8: Lily / Desktop 連携

### 目的

- [x] Lily が行動ログ正本を仕様どおり参照できるようにする
- [x] `lily_desktop` の `Web を開く` 契約を仕様どおり実装する

### 実装対象

- [x] Web 側 Lily の `activity_logs` 参照を action-log API へ切り替える
- [x] desktop 側 Lily の `activity_logs` 参照を action-log API へ切り替える
- [x] `activity_logs` 参照で `ActivitySession / DailyActivityLog / OpenLoop` を優先して返す
- [x] `RawEvent` を Lily の既定の長期参照対象にしない
- [x] 非表示セッションを Lily 会話コンテキストから除外する
- [x] `web.base_url` + deep link path を使った既定ブラウザ起動
- [x] `今日の行動ログ / 行動ログカレンダー / 行動ログ検索 / 週次行動レビュー` を含む右クリックメニュー導線
- [x] 認証切れ時にログイン後、元の URL へ戻す導線

### 先に書く failing test

- [x] Web 側 Lily の `activity_logs` が `ActivitySession / DailyActivityLog / OpenLoop` を返すテスト
- [x] desktop 側 Lily の `activity_logs` が `ActivitySession / DailyActivityLog / OpenLoop` を返すテスト
- [x] `RawEvent` 全文を既定で返さないテスト
- [x] 非表示セッションが Lily 会話コンテキストから除外されるテスト
- [x] `web.base_url` を使って既定ブラウザ起動 URL を組み立てるテスト
- [x] 右クリックメニュー各項目が正しい deep link path を開くテスト
- [x] 認証後に元 URL へ戻る導線テスト

### 実装メモ

- [x] Lily の通常参照は長期保持データを正本にする
- [x] desktop 側は閲覧 UI を持たず、Web 起動のハブに留める
- [x] deep link は一時 state に依存しすぎない安定 path を優先する
- [x] tray icon ではなくキャラクター右クリックメニューだけを対象にする

### 完了条件

- [x] Lily が行動ログを仕様どおり参照できる
- [x] 非表示セッションが Lily に流れない
- [x] desktop の `Web を開く` が仕様どおり動作する
- [x] Web の deep link ログイン復帰が仕様どおり動作する

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか

---

## Phase 9: 仕上げ

### 目的

- [x] privacy・削除・非表示・設定・検索精度を整え、v0.1 として閉じる
- [x] 運用面の漏れを仕上げる

### 実装対象

- [x] `/settings` に行動ログ設定セクションを追加する
- [x] device ごとの `captureState(active / paused / disabled)` を保存できるようにする
- [x] 除外アプリ / 除外ドメインを `PrivacyRule` として保存できるようにする
- [x] URL 保存粒度を `default_url_storage` rule に正規化して保存する
- [x] AI 利用範囲を `default_ai_handling` rule に正規化して保存する
- [x] desktop が起動時と 30 秒 sync tick ごとに server の device / privacy 設定を取り込む
- [x] desktop が purge request を処理し、local spool と `sync_state.json` を更新して ack する
- [x] `today / day / search` で session を非表示にできる
- [x] `day / search` で hidden session を再表示できる
- [x] search に `keyword / from / to / categories / apps / domains / includeOpenLoops / includeHidden` を追加する
- [x] search から action-log 専用 JSON export を行えるようにする
- [x] search から action-log 専用の期間削除を行えるようにする
- [x] 削除した期間が raw sync / organizer で復活しないよう purge queue を入れる
- [ ] `ManualNote` の追加・保存

### 先に書く failing test

- [x] settings の行動ログセクションが device / privacy rule を読み込めるテスト
- [x] app / domain exclusion, URL storage, AI handling を保存できるテスト
- [x] session の非表示 / 再表示が day / search で効くテスト
- [x] search の厳密 filter が効くテスト
- [x] action-log export が現在の期間指定で JSON bundle を作るテスト
- [x] `to > yesterday` では delete できないテスト
- [x] desktop が device state / privacy rules を取り込むテスト
- [x] purge request を受けると local spool と sync_state を更新して ack するテスト
- [x] `PUT /action-log/sessions/{id}/hidden` が対象 session だけ更新するテスト
- [x] `DELETE /action-log/range` が purge request を作るテスト
- [x] deletion request list / ack が動くテスト

### 実装メモ

- [x] settings は local draft + 明示 Save で動かし、`putActionLogDevice()` と `putActionLogPrivacyRules()` に分離して保存する
- [x] `hidden=true` session は既定の一覧と Lily 会話コンテキストから除外し、明示的に含めたときだけ表示する
- [x] export は client-side bundle とし、`rawEvents / sessions / dailyLogs / weeklyReviews / openLoops / meta` を含める
- [x] delete は action-log entity だけを対象にし、quests / completions / messages などは対象外のまま維持する
- [x] `getDayKey()` / `getWeekKey()` は host timezone に依存させず JST 固定で算出する
- [x] organizer 再実行で session id が変わっても hidden session を再流入させない
- [x] `PUT /action-log/sessions` は `dateKeys` 指定で empty date を full-replace できる

### 完了条件

- [x] privacy と削除導線が仕様どおり機能する
- [x] 非表示・検索・設定が一通り揃う
- [x] 関連仕様とテストが更新済みである

### 自己レビュー項目

- [x] spec と実装のズレがないか
- [x] JST 前提を壊していないか
- [x] privacy 境界を破っていないか
- [x] 既存の責務分離を壊していないか
- [x] 不要な重複計測や二重保存がないか
- [x] テストが対象範囲を十分にカバーしているか

---

## Phase 9 follow-up: 日次ログ3段化と30分まとめ統合

### 目的

- [ ] `DailyActivityLog` を `その日のまとめ / クエストクリア状況まとめ / 健康状況まとめ` の 3 本立てへ拡張する
- [ ] `session` 表示で 30 分まとめを `DailyActivityLog` の下、session timeline の上に統合する
- [ ] `situation_logs` を長期保存対象へ切り替える

### 実装対象

- [ ] `DailyActivityLog` に `questSummary` と `healthSummary` を追加する
- [ ] `today/day` の `session` 表示で `SituationLog` を最新順に表示する
- [ ] `today/day` の `event` 表示では `SituationLog` を出さない
- [ ] `today/day` で `OpenLoop` 表示を外す
- [ ] カレンダーセルは `DailyActivityLog.summary` だけを表示する
- [ ] `situation_logs` の TTL を撤廃する
- [ ] export bundle に `situationLogs` を含める
- [ ] 期間 delete で `SituationLog` も削除対象に含める

### 先に書く failing test

- [ ] `DailyActivityLog` の 3 本まとめが `summary -> questSummary -> healthSummary` の順で表示されるテスト
- [ ] `session` 表示で `SituationLog` が `timestamp` 降順に出るテスト
- [ ] `event` 表示では `SituationLog` が出ないテスト
- [ ] `today/day` で `OpenLoop` が表示されないテスト
- [ ] カレンダーセルに `DailyActivityLog.summary` だけが出るテスト
- [ ] export bundle に `situationLogs` が含まれるテスト
- [ ] `DELETE /action-log/range` が `SituationLog` も削除対象に含めるテスト

### 実装メモ

- [ ] `summary`, `questSummary`, `healthSummary` はすべて JST 同日データを入力にし、`gpt-5.4` で生成する
- [ ] `questSummary` は `QuestCompletion` と関連 `Quest` 情報、`healthSummary` は `health-data` を主入力にする
- [ ] 3 本ともリリィ観察日記風の地の文でそろえる
- [ ] `mainThemes` / `reviewQuestions` は保持してもよいが、day 画面の必須表示にはしない

### 完了条件

- [ ] day 画面の表示順が仕様どおりに揃う
- [ ] event 画面に 30 分まとめが混ざらない
- [ ] `situation_logs` が期間削除・export の対象まで含めて長期保存仕様に沿う

### 自己レビュー項目

- [ ] spec と TODO と実装方針にズレがないか
- [ ] JST 基準の日付集計が `questSummary` / `healthSummary` でも守られているか
- [ ] `situation_logs` の保持変更が privacy 導線と矛盾していないか

---

## 最終チェック

- [x] Phase 0 完了後に停止するルールが TODO に明記されている
- [x] 各フェーズに `目的 / 実装対象 / 先に書く failing test / 実装メモ / 完了条件 / 自己レビュー項目` が揃っている
- [x] `RawEvent / ActivitySession / DailyActivityLog / WeeklyActivityReview / SituationLog / Activity Capture Service` が明記されている
- [x] `Chrome Extension -> Desktop -> Server` の責務分離が TODO に反映されている
- [x] PWA 正本 / desktop ハブの方針が TODO に反映されている
