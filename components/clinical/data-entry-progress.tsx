'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { getAggregateFieldProgress, completionVisits, type VisitProgress } from '@/lib/data-entry'
import type { Visit } from '@/lib/crf-metadata'
import { sortSubjectsNumerically } from '@/lib/clinical-utils'

type ProgressSubject = { subject_id: string; visit_progress: Record<Visit, VisitProgress> }
export function DataEntryProgress({ subjects, onOpen }: { subjects: ProgressSubject[]; onOpen: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const listId = useId()
  const selected = subjects.find((subject) => subject.subject_id === selectedId)
  const options = useMemo(() => sortSubjectsNumerically(subjects).filter((subject) => subject.subject_id.toLowerCase().includes(search.toLowerCase())), [subjects, search])
  const aggregate = useMemo(() => getAggregateFieldProgress(subjects), [subjects])
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, index, listId])
  const progress = selected?.visit_progress || aggregate
  const select = (subject: ProgressSubject) => { setSelectedId(subject.subject_id); setOpen(false); setSearch(''); setIndex(0) }
  return <section className="panel" style={{ alignSelf: 'start' }}>
    <div className="panel-head"><div><h2>Data Entry Progress</h2><p>{selected ? selected.subject_id : '전체 연구 필수 필드 입력 진행률'}</p></div></div>
    <div className="progress-controls">
      <div className="subject-combobox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
        <input role="combobox" aria-label="Select subject" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && options[index] ? `${listId}-${index}` : undefined}
          placeholder="Select subject..." value={search} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onChange={(event) => { setSearch(event.target.value); setIndex(0); setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { setOpen(false); return }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setIndex((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))); }
            if (event.key === 'Enter' && open && options[index]) { event.preventDefault(); select(options[index]) }
          }} />
        {open && <ul id={listId} role="listbox" aria-label="Subjects" className="subject-options">
          {!options.length && <li role="presentation">No matching subjects</li>}
          {options.map((subject, optionIndex) => <li key={subject.subject_id} id={`${listId}-${optionIndex}`} role="option" aria-selected={selectedId === subject.subject_id} className={index === optionIndex ? 'active-option' : ''}>
            <button type="button" onClick={() => select(subject)}>{subject.subject_id}</button>
          </li>)}
        </ul>}
      </div>
      {selected && <button type="button" className="outline-btn" onClick={() => { setSelectedId(null); setSearch(''); setOpen(false) }}>Clear</button>}
    </div>
    <div className="visit-bars aggregate-progress" aria-live="polite">
      {completionVisits.map((visit) => {
        const { completed, total, percentage } = progress[visit]
        return <div className="field-progress" key={visit}>
          <div><strong>{visit}</strong><span>{completed.toLocaleString()} / {total.toLocaleString()} fields ({percentage}%)</span></div>
          <div className="bar" role="progressbar" aria-label={`${selected?.subject_id || '전체 연구'} ${visit}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${completed} / ${total} fields (${percentage}%)`}><span style={{ width: `${percentage}%` }} /></div>
        </div>
      })}
      {selected && <button type="button" className="back-btn" onClick={() => onOpen(selected.subject_id)}>View Subject →</button>}
    </div>
  </section>
}
