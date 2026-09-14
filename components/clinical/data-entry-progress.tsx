'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { getAggregateFieldProgress, completionVisits, type VisitProgress } from '@/lib/data-entry'
import type { Visit } from '@/lib/crf-metadata'
import { sortSubjectsNumerically } from '@/lib/clinical-utils'

type ProgressSubject = { subject_id: string; visit_progress: Record<Visit, VisitProgress> }
export function DataEntryProgress({ subjects }: { subjects: ProgressSubject[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const selected = subjects.find((subject) => subject.subject_id === selectedId)
  const options = useMemo(() => sortSubjectsNumerically(subjects).filter((subject) => subject.subject_id.toLowerCase().includes(search.toLowerCase())), [subjects, search])
  const aggregate = useMemo(() => getAggregateFieldProgress(subjects), [subjects])
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, index, listId])
  const progress = selected?.visit_progress || aggregate
  const close = () => { setOpen(false); triggerRef.current?.focus() }
  const select = (subject: ProgressSubject) => { setSelectedId(subject.subject_id); close(); setSearch(''); setIndex(0) }
  return <section className="panel" style={{ alignSelf: 'start' }}>
    <div className="panel-head"><div><h2>Data Entry Progress</h2><p>{selected ? selected.subject_id : '전체 연구 필수 필드 입력 진행률'}</p></div></div>
    <div className="progress-controls">
      <div className="subject-combobox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
        <button ref={triggerRef} type="button" className="subject-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
          onClick={() => { setSearch(''); setIndex(0); setOpen(!open) }}
          onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSearch(''); setIndex(0); setOpen(true) } }}>
          <span>{selected?.subject_id || 'Select subject...'}</span><ChevronDown size={16} aria-hidden="true" />
        </button>
        {open && <div className="subject-dropdown">
        <input autoFocus role="combobox" aria-label="Search subjects" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && options[index] ? `${listId}-${index}` : undefined}
          placeholder="Search subjects..." value={search}
          onChange={(event) => { setSearch(event.target.value); setIndex(0); setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setIndex((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))); }
            if (event.key === 'Enter' && open && options[index]) { event.preventDefault(); select(options[index]) }
          }} />
        <ul id={listId} role="listbox" aria-label="Subjects" className="subject-options">
          {!options.length && <li role="presentation">No matching subjects</li>}
          {options.map((subject, optionIndex) => <li key={subject.subject_id} id={`${listId}-${optionIndex}`} role="option" aria-selected={selectedId === subject.subject_id} className={index === optionIndex ? 'active-option' : ''}>
            <button type="button" onClick={() => select(subject)}>{subject.subject_id}{selectedId === subject.subject_id && <Check size={14} aria-hidden="true" />}</button>
          </li>)}
        </ul></div>}
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
    </div>
  </section>
}
