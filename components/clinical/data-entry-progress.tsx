'use client'

import { useMemo, useState } from 'react'
import { RecentSearchInput } from './recent-search-input'
import { getAggregateFieldProgress, completionVisits, type VisitProgress } from '@/lib/data-entry'
import type { Visit } from '@/lib/crf-metadata'

type ProgressSubject = { subject_id: string; visit_progress: Record<Visit, VisitProgress> }
export function DataEntryProgress({ subjects }: { subjects: ProgressSubject[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const selected = subjects.find((subject) => subject.subject_id === selectedId)
  const aggregate = useMemo(() => getAggregateFieldProgress(subjects), [subjects])
  const progress = selected?.visit_progress || aggregate
  return <section className="panel" style={{ alignSelf: 'start' }}>
    <div className="panel-head"><div><h2>Data Entry Progress</h2><p>{selected ? selected.subject_id : '전체 연구 필수 필드 입력 진행률'}</p></div></div>
    <div className="progress-controls">
      <RecentSearchInput storageKey="edc_recent_dashboard_subjects" placeholder="Subject ID 입력..." value={search} onChange={setSearch}
        onSearch={(term) => {
          if (!term) { setSelectedId(null); return '' }
          const exact = subjects.find((subject) => subject.subject_id.toLowerCase() === term.toLowerCase())
          const matches = subjects.filter((subject) => subject.subject_id.toLowerCase().includes(term.toLowerCase()))
          const found = exact || (matches.length === 1 ? matches[0] : undefined)
          if (!found) return false
          setSelectedId(found.subject_id)
          return found.subject_id
        }} />
      {selected && <button type="button" className="outline-btn" onClick={() => { setSelectedId(null); setSearch('') }}>Clear</button>}
    </div>
    <div className="visit-bars aggregate-progress" aria-live="polite">
      {completionVisits.map((visit) => {
        const { completed, total, percentage } = progress[visit]
        return <div className="field-progress" key={visit}>
          <div><strong>{visit}</strong><span>{completed.toLocaleString()} / {total.toLocaleString()} fields ({percentage}%)</span></div>
          <div className="bar" role="progressbar" aria-label={`${selected?.subject_id || '전체 연구'} ${visit}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${completed} / ${total} fields (${percentage}%)`}><span style={{ width: `${percentage}%` }} /></div>
        </div>
      })}
    </div>
  </section>
}
