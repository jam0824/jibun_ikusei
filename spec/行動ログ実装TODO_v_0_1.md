# 行動ログ実装 TODO v0.1

更新日: 2026-04-17

関連仕様:
- [行動ログ基盤仕様_v_0_1.md](./行動ログ基盤仕様_v_0_1.md)
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
- [ ] 通常の整理系 AI は local `gemma4`、日次・週次まとめは `gpt-5.4` を使う
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
- [ ] `DailyActivityLog`
- [ ] `WeeklyActivityReview`
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

- [ ] モック画面を本実装へ差し替え、行動ログ閲覧体験を完成させる
- [ ] route ごとの役割を PWA 側で安定させる

### 実装対象

- [ ] `/records/activity/today`
- [ ] `/records/activity/day/:dateKey`
- [ ] `/records/activity/calendar?month=YYYY-MM`
- [ ] `/records/activity/review/year?year=YYYY`
- [ ] `/records/activity/search`
- [ ] `/records/activity/review/week?weekKey=YYYY-Www`
- [ ] `records` 内導線と desktop deep link の整合
- [ ] `event / session` view query の反映
- [ ] `calendar` の `month` query 反映
- [ ] `calendar` の `前月` / `次月` / `年月ピッカー`
- [ ] `review/year` の `year` query 反映
- [ ] `review/year` の `前年` / `次年` / `年ピッカー`
- [ ] `review/year` から `review/week` 詳細への遷移
- [ ] `records` 配下 route の復元と既定 route 制御
- [ ] `DailyActivityLog` の手動メモ表示と追加

### 先に書く failing test

- [ ] 各 route のデータ表示テスト
- [ ] event view / session view 切り替えテスト
- [ ] `month` 未指定時に JST 基準の当月を表示するカレンダーテスト
- [ ] `month=YYYY-MM` 指定時に対象月を表示するカレンダーテスト
- [ ] `前月` / `次月` 操作で `month` query が更新されるテスト
- [ ] `年月ピッカー` 変更で `month` query が更新されるテスト
- [ ] `year` 未指定時に JST 基準の当年または直近の利用可能年を表示する週次レビュー一覧テスト
- [ ] `year=YYYY` 指定時に対象年を表示する週次レビュー一覧テスト
- [ ] `前年` / `次年` 操作で `year` query が更新されるテスト
- [ ] `年ピッカー` 変更で `year` query が更新されるテスト
- [ ] 年一覧の週カードから `review/week?weekKey=YYYY-Www` へ遷移するテスト
- [ ] `weekKey=YYYY-Www` 指定時に対象週を表示するテスト
- [ ] 検索条件の反映テスト
- [ ] desktop からの URL 着地テスト
- [ ] `/records` から最後に見ていた `records` 配下 route を復元するテスト
- [ ] 初回または復元不能時は `/records/quests?range=today` を開くテスト
- [ ] 手動メモの追加 / 表示テスト

### 実装メモ

- [ ] PWA を唯一の正式 UI として育てる
- [ ] PC とスマホで同じ route を使えるようにする
- [ ] UI 層で本来の storage 境界を崩さない
- [ ] カレンダーは 1 画面 1 か月分表示を正本にする
- [ ] `month` query がなくても JST 基準の当月に着地できるようにする
- [ ] 週次レビューの主入口は 1 画面 1 年分の一覧表示を正本にする
- [ ] `year` query がなくても JST 基準の当年または直近の利用可能年に着地できるようにする
- [ ] `review/week` は個別週の詳細 route として扱う
- [ ] 手動操作は `ActivitySession / DailyActivityLog / ManualNote` の責務を越えないようにする
- [ ] v0.1 の手動補正は非表示・手動メモに留める

### 完了条件

- [ ] 主要 route が本データで表示される
- [ ] PC / スマホの両方で主要閲覧導線が成立する
- [ ] desktop deep link と PWA 導線が一致している
- [ ] カレンダーが 1 か月単位で安定表示され、前月 / 次月 / 年月ピッカーで移動できる
- [ ] 週次レビュー一覧が 1 年単位で安定表示され、前年 / 次年 / 年ピッカーで移動できる
- [ ] 年一覧から週詳細へ安定して遷移できる
- [ ] 手動メモの導線が成立する

### 自己レビュー項目

- [ ] spec と実装のズレがないか
- [ ] JST 前提を壊していないか
- [ ] privacy 境界を破っていないか
- [ ] 既存の責務分離を壊していないか
- [ ] 不要な重複計測や二重保存がないか
- [ ] テストが対象範囲を十分にカバーしているか

---

## Phase 7: gpt-5.4 日次・週次まとめ

### 目的

- [ ] `DailyActivityLog` と `WeeklyActivityReview` の生成を本実装する
- [ ] 日次・週次まとめを `gpt-5.4` へ接続する

### 実装対象

- [ ] 当日画面初回オープン時の `DailyActivityLog` 生成
- [ ] 週次レビュー生成
- [ ] `gpt-5.4` 失敗時のテンプレート fallback
- [ ] `ActivitySession` ベースの整形済み入力生成
- [ ] リリィがユーザーの観察日記を書いたような文体ガイドを prompt / fallback へ組み込む

### 先に書く failing test

- [ ] 当日画面初回表示で日次まとめが生成されるテスト
- [ ] PC / スマホのどちらから開いても同じ生成条件になるテスト
- [ ] 週次レビュー生成テスト
- [ ] `gpt-5.4` 失敗時にテンプレート fallback するテスト
- [ ] 日次まとめ prompt がリリィ観察日記トーンを要求するテスト
- [ ] 週次まとめ prompt がリリィ観察日記トーンを要求するテスト
- [ ] fallback 文も観察日記風の地の文になるテスト

### 実装メモ

- [ ] raw event 全文やスクリーンショット本体は `gpt-5.4` に送らない
- [ ] `DailyActivityLog` は未生成時のみ作る
- [ ] local `gemma4` と責務を混ぜない
- [ ] 直接話しかけるチャット口調ではなく、リリィがそっと見守って書いた観察日記風の地の文を正本にする
- [ ] 提案や励ましは補足に留め、本文は観察記述を主にする

### 完了条件

- [ ] 日次・週次まとめが `gpt-5.4` で生成される
- [ ] 失敗時の fallback がある
- [ ] PC / スマホの閲覧起点で挙動が揃っている
- [ ] 日次・週次まとめの文体がリリィ観察日記トーンで揃っている

### 自己レビュー項目

- [ ] spec と実装のズレがないか
- [ ] JST 前提を壊していないか
- [ ] privacy 境界を破っていないか
- [ ] 既存の責務分離を壊していないか
- [ ] 不要な重複計測や二重保存がないか
- [ ] テストが対象範囲を十分にカバーしているか

---

## Phase 8: Lily / Desktop 連携

### 目的

- [ ] Lily が行動ログ正本を仕様どおり参照できるようにする
- [ ] `lily_desktop` の `Web を開く` 契約を仕様どおり実装する

### 実装対象

- [ ] `activity_logs` 参照で `ActivitySession / DailyActivityLog / OpenLoop` を優先して返す
- [ ] `RawEvent` を Lily の既定の長期参照対象にしない
- [ ] 非表示セッションを Lily 会話コンテキストから除外する
- [ ] `web.base_url` + deep link path を使った既定ブラウザ起動
- [ ] `今日の行動ログ / 行動ログカレンダー / 行動ログ検索 / 週次行動レビュー` の右クリックメニュー導線
- [ ] 認証切れ時にログイン後、元の URL へ戻す導線

### 先に書く failing test

- [ ] Lily の `activity_logs` が `ActivitySession / DailyActivityLog / OpenLoop` を返すテスト
- [ ] `RawEvent` 全文を既定で返さないテスト
- [ ] 非表示セッションが Lily 会話コンテキストから除外されるテスト
- [ ] `web.base_url` を使って既定ブラウザ起動 URL を組み立てるテスト
- [ ] 右クリックメニュー各項目が正しい deep link path を開くテスト
- [ ] 認証後に元 URL へ戻る導線テスト

### 実装メモ

- [ ] Lily の通常参照は長期保持データを正本にする
- [ ] desktop 側は閲覧 UI を持たず、Web 起動のハブに留める
- [ ] deep link は一時 state に依存しすぎない安定 path を優先する

### 完了条件

- [ ] Lily が行動ログを仕様どおり参照できる
- [ ] 非表示セッションが Lily に流れない
- [ ] desktop の `Web を開く` が仕様どおり動作する

### 自己レビュー項目

- [ ] spec と実装のズレがないか
- [ ] JST 前提を壊していないか
- [ ] privacy 境界を破っていないか
- [ ] 既存の責務分離を壊していないか
- [ ] 不要な重複計測や二重保存がないか
- [ ] テストが対象範囲を十分にカバーしているか

---

## Phase 9: 仕上げ

### 目的

- [ ] privacy・削除・非表示・設定・検索精度を整え、v0.1 として閉じる
- [ ] 運用面の漏れを仕上げる

### 実装対象

- [ ] 除外アプリ / 除外ドメイン設定
- [ ] URL 保存粒度設定
- [ ] AI 利用範囲 / 匿名化設定
- [ ] デバイス単位の `収集中 / 一時停止 / 無効` 設定 UI
- [ ] ログ削除 / 期間削除 / エクスポート
- [ ] 非表示化
- [ ] 検索精度改善
- [ ] 監査観点のチェック

### 先に書く failing test

- [ ] 除外設定の反映テスト
- [ ] URL 保存粒度切り替えテスト
- [ ] AI 利用範囲 / 匿名化設定テスト
- [ ] デバイス状態設定 UI テスト
- [ ] 削除・エクスポートテスト
- [ ] 非表示セッションの UI 反映テスト
- [ ] 検索絞り込みの回帰テスト

### 実装メモ

- [ ] v0.1 の安心して止められる・消せる体験を優先する
- [ ] 監査系の確認は UI と保存の両方を見る
- [ ] ドキュメント・設定・テストの最終整合を取る

### 完了条件

- [ ] privacy と削除導線が仕様どおり機能する
- [ ] 非表示・検索・設定が一通り揃う
- [ ] 関連仕様とテストが更新済みである

### 自己レビュー項目

- [ ] spec と実装のズレがないか
- [ ] JST 前提を壊していないか
- [ ] privacy 境界を破っていないか
- [ ] 既存の責務分離を壊していないか
- [ ] 不要な重複計測や二重保存がないか
- [ ] テストが対象範囲を十分にカバーしているか

---

## 最終チェック

- [ ] Phase 0 完了後に停止するルールが TODO に明記されている
- [ ] 各フェーズに `目的 / 実装対象 / 先に書く failing test / 実装メモ / 完了条件 / 自己レビュー項目` が揃っている
- [ ] `RawEvent / ActivitySession / DailyActivityLog / WeeklyActivityReview / Activity Capture Service` が明記されている
- [ ] `Chrome Extension -> Desktop -> Server` の責務分離が TODO に反映されている
- [ ] PWA 正本 / desktop ハブの方針が TODO に反映されている
