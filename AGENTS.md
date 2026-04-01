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

### 例外

- 外部 API との通信など、UTC が明示的に要求される場合は UTC を使い、その箇所にコメントを残すこと
