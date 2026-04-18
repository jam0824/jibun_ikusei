# 自分育成アプリ 開発ルール

## タイムゾーン

**特別な理由がない限り、時間はすべて JST（日本標準時, UTC+9）で実装すること。**

### フロントエンド (TypeScript)

- 表示・保存ともに JST を基準にする
- `new Date().toISOString()` は UTC になるため **使わない**
- ローカル時刻を取得するには `getFullYear()`, `getMonth()`, `getDate()`, `getHours()`, `getMinutes()` 等を使う
- UTC の ISO 文字列を表示する場合は JST に変換してから表示する

```typescript
// UTC ISO文字列 → JST 'YYYY-MM-DD HH:MM'
function toJst(isoUtc: string): string {
  const d = new Date(isoUtc)
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 16).replace('T', ' ')
}
```

### バックエンド / デスクトップアプリ (Python)

- 表示・ログ出力は JST で行う
- `datetime.utcnow()` は使わない。`datetime.now(tz=JST)` を使う
- UTC で保存された値を表示する際は JST に変換する

```python
from datetime import datetime, timedelta, timezone
JST = timezone(timedelta(hours=9))

# 現在時刻 (JST)
now_jst = datetime.now(tz=JST)

# UTC ISO文字列 → JST 'YYYY-MM-DD HH:MM'
def to_jst(iso_utc: str) -> str:
    d = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
    return d.astimezone(JST).strftime("%Y-%m-%d %H:%M")
```

## 文字コード

- 特別な理由がない限り、文字列とテキストファイルは UTF-8 で扱うこと
- 新規作成・更新する `md`, `ts`, `tsx`, `js`, `json`, `py`, `yml`, `yaml` などのテキストファイルは UTF-8 を使うこと
- 既存ファイルが UTF-8 でない場合は、内容を壊さないよう現在の文字コードを確認してから編集すること
- 文字化けやエンコーディング混在を見つけた場合は、修正可能であれば UTF-8 に統一すること
- 外部仕様や外部システムの制約で UTF-8 以外が必要な場合は、その理由をコメントや仕様書に明記すること

## 仕様管理

- 仕様の追加や変更があった場合は、`spec` フォルダ内の関連仕様書にも必ず同内容の追加・変更を反映すること

## テスト

- 開発プロセスは TDD で行うこと
- 実装前に、追加・変更する仕様に対するテストを先に作成すること
- まず失敗するテストを書き、そのテストが失敗することを確認してから実装を始めること
- 実装は、追加したテストを通すための最小限の変更から行うこと
- テストが通った後に、必要最小限のリファクタリングを行い、再度テストを通すこと
- 機能追加・仕様変更の完了条件は、対象テストがすべて成功していることとする
- バグ修正の場合も、先に不具合を再現するテストを追加してから修正すること
- 変更内容に関連する既存テストと、新規追加したテストは作業完了前に必ず実行すること
- ログインが必要なテストの認証情報は、ルートフォルダの `.env` を参照すること
- メールアドレスは `LILY_TEST_USER_EMAIL`、パスワードは `LILY_TEST_USER_PASSWORD` を使うこと

### 例外

- 外部 API との通信など、UTC が明示的に要求される場合は UTC を使い、その箇所にコメントを残すこと
