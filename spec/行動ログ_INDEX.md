# 行動ログ INDEX

行動ログまわりの spec は、この index から辿ることを正本にする。

## 正本

- [行動ログ基盤仕様_v_0_1.md](./行動ログ基盤仕様_v_0_1.md)
  - 行動ログ全体の型、保存単位、API、画面契約、desktop organizer 契約の正本
- [行動ログ実装TODO_v_0_1.md](./行動ログ実装TODO_v_0_1.md)
  - 行動ログ実装の進捗管理と受け入れ確認

## 補足

- [行動ログ_organizer_openai補足_2026-04-18.md](./行動ログ_organizer_openai補足_2026-04-18.md)
  - organizer の OpenAI 利用方針、batch / budget、fallback、言語制約の補足

## 関連資料

- [Chrome拡張_リリィデスクトップBridge連携仕様.md](./Chrome拡張_リリィデスクトップBridge連携仕様.md)
  - `browser_page_changed` / `heartbeat` / `chrome_audible_tabs` の送出契約
- [閲覧カテゴリ分類ガイド.md](./閲覧カテゴリ分類ガイド.md)
  - 行動ログと閲覧クエストで共有するカテゴリ判断基準
- [リリィデスクトップ仕様.md](./リリィデスクトップ仕様.md)
  - desktop 側の収集ホスト、sync、purge、deep link 導線
- [リリィ仕様.md](./リリィ仕様.md)
  - Lily が参照する `activity_logs` 契約

## 置き方のルール

- 恒久的な挙動や契約は `行動ログ基盤仕様_v_0_1.md` に寄せる。
- 実装進捗や完了条件は `行動ログ実装TODO_v_0_1.md` に置く。
- 一時的な調整メモや model tuning は、必要最小限だけ補足資料に置き、落ち着いたら正本へ吸収する。
