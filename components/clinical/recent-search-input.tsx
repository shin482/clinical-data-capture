'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { readRecentSearches, updateRecentSearches, writeRecentSearches } from '@/lib/recent-searches'

type Props = {
  storageKey: string
  value: string
  onChange: (value: string) => void
  onSearch: (value: string) => string | false | Promise<string | false>
  placeholder: string
}

export function RecentSearchInput({ storageKey, value, onChange, onSearch, placeholder }: Props) {
  const [history, setHistory] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const messageId = useId()
  useEffect(() => {
    setHistory(readRecentSearches(storageKey))
    const sync = (event: Event) => {
      const { key, values } = (event as CustomEvent<{ key: string; values: string[] }>).detail
      if (key === storageKey) setHistory(values)
    }
    window.addEventListener('edc-recent-searches', sync)
    return () => window.removeEventListener('edc-recent-searches', sync)
  }, [storageKey])
  const save = (next: string[]) => { setHistory(next); writeRecentSearches(storageKey, next) }
  const search = async (term: string) => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const result = await onSearch(term.trim())
      if (result === false) { setError('검색 결과가 없습니다. 정확한 ID 또는 검색어를 확인해 주세요.'); return }
      if (result) save(updateRecentSearches(history, result))
      onChange(result)
      inputRef.current?.focus()
      setOpen(false)
    } catch { setError('검색하지 못했습니다. 다시 시도해 주세요.') } finally { setBusy(false) }
  }
  return <div className="recent-search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <input ref={inputRef} type="search" aria-label={placeholder} placeholder={placeholder} value={value} autoComplete="off" aria-describedby={error ? messageId : undefined}
      onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setError(''); setOpen(true) }}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search(value) } if (event.key === 'Escape') setOpen(false) }} />
    {open && <div className="recent-search-history"><small>최근 검색</small>
      {!history.length && <p>최근 검색 기록이 없습니다.</p>}
      {history.map((term) => <div className="recent-search-row" key={term}>
        <button type="button" disabled={busy} onClick={() => void search(term)}>{term}</button>
        <button type="button" aria-label={`${term} 검색 기록 삭제`} onClick={(event) => { event.stopPropagation(); save(updateRecentSearches(history, term, true)); inputRef.current?.focus() }}>×</button>
      </div>)}
    </div>}
    {error && <small id={messageId} role="alert" className="recent-search-error">{error}</small>}
  </div>
}
