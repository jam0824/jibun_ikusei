# タニタの体重・体脂肪率取得

https://www.healthplanet.jp/apis/api.html

実験で作成したデータ取得コード: `experiment/healthplanet.py`

## 目的

- リリィデスクトップ起動時にタニタの API から体重と体脂肪率を取得して DB に保存する
- リリィデスクトップ起動中は定期的に再同期し、新しい計測があれば取り込む
- リリィデスクトップおよび Web アプリで Tool Search から保存済みの体重・体脂肪率を参照できること

## 同期仕様

- 時刻の基準は JST とする
- Health Planet の同期は起動時に 1 回実行する
- 起動後は `lily_desktop/config.yaml` の `healthplanet.sync_interval_minutes` 間隔で再同期する
- `healthplanet.sync_interval_minutes` の既定値は 15 分とする
- 同一計測の重複判定は `date` + `time` で行い、既に `lily_desktop/logs/health/YYYY-MM-DD.jsonl` に保存済みのデータは再保存しない
- 同期中に複数の新規計測が見つかった場合でも、クエストイベント化の対象は JST 上で最新 1 件のみとする

## クエスト連動

- 新規計測が 1 件以上見つかったら、最新 1 件をきっかけに `体重計測クエストクリア` をユーザー発話としてデスクトップのリリィへ送る
- クエスト完了の実処理はその発話を受けた既存の会話フローに委ね、Health Planet 同期処理からは `complete_quest` を直接呼ばない
- この発話は通常のユーザー発話と同じ扱いとし、既存の吹き出し表示、チャット保存、AI 応答、読み上げフローに乗せる

## 認証と再認証

- 初回のみ OAuth 認証を行い、取得したアクセストークンを `.env` に保存する
- 起動時にトークンが無効なら OAuth ダイアログを表示する
- 定期同期ではトークンが無効な場合に OAuth ダイアログを連打せず、再認証待ちとして同期をスキップする
