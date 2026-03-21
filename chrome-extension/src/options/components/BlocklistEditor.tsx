import { useState } from 'react'

interface Props {
  blocklist: string[]
  onSave: (blocklist: string[]) => void
}

export function BlocklistEditor({ blocklist, onSave }: Props) {
  const [domains, setDomains] = useState(blocklist)
  const [newDomain, setNewDomain] = useState('')

  const handleAdd = () => {
    const domain = newDomain.trim().toLowerCase()
    if (domain && !domains.includes(domain)) {
      const updated = [...domains, domain]
      setDomains(updated)
      onSave(updated)
      setNewDomain('')
    }
  }

  const handleRemove = (domain: string) => {
    const updated = domains.filter((d) => d !== domain)
    setDomains(updated)
    onSave(updated)
  }

  return (
    <div>
      <h3>ブロックリスト</h3>
      <p style={{ fontSize: 13, color: '#666' }}>
        注意が必要なドメインを登録すると、60分以上の閲覧で-5 XPのペナルティが発生します。
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="例: twitter.com"
          style={{ flex: 1, padding: 6 }}
        />
        <button onClick={handleAdd} style={{ padding: '6px 16px' }}>
          追加
        </button>
      </div>

      {domains.length === 0 ? (
        <div style={{ color: '#999', fontSize: 13 }}>ブロックリストは空です</div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {domains.map((domain) => (
            <li
              key={domain}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <span>{domain}</span>
              <button
                onClick={() => handleRemove(domain)}
                style={{ color: '#e53935', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
