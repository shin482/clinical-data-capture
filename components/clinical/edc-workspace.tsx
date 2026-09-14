'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeft, Check, ChevronRight, Download, FileClock, HelpCircle, LayoutDashboard, MoreHorizontal, Plus, Search, Settings, SlidersHorizontal, UserCog, Users } from 'lucide-react'

import { inputGuide, sampleVisitDates, type MissingReason, type Visit } from '@/lib/crf-metadata'
import { sortSubjectsNumerically, getOpenQueryCount, getSubjectQueryStatus, emrReference } from '@/lib/clinical-utils'
import { getDataEntrySummary, type VisitCompletion } from '@/lib/data-entry'
import { emptyPageAccess, isProtectedPage, pageSessionKeys, readPageAccess, type ProtectedPage } from '@/lib/page-access'
import { CrfField } from './crf-field'
type SaveStatus = 'saving' | 'saved' | 'failed'

type Rule = {
  variableKey: string
  label: string
  section: string
  dataType: string
  unitOrFormat: string
  categoryOptions: string
  minValue: number | null
  maxValue: number | null
  parents: string
  activeValues: string
  allowBlank: boolean
  allowUnknown99: boolean
  enabled: boolean
  inputGuide: string
  emrLocation: string
}

type Subject = { subject_id: string; updated_at: string; open_queries: number; visit_completion: VisitCompletion }
type VisitData = { id: number; timepoint: Visit; visitDate: string | null; name?: string }
type QueryRow = {
  form_name: string
  variable_name: string
  subject_id: string
  timepoint: Visit
  variable_key: string
  query_type: string
  message: string
  current_value: string
  status: string
  detected_at: string
  resolved_at: string | null
}
type AuditLogRow = {
  id: number
  subject_id: string | null
  timepoint: string | null
  variable_key: string | null
  previous_value: string | null
  new_value: string | null
  modified_by: string | null
  modified_at: string
  action: string
}

const allVisits = ['T1', 'T2', 'T3'] as Visit[]

const emptyRule = {
  variableKey: '',
  label: '',
  section: '기타',
  dataType: 'character',
  unitOrFormat: '',
  categoryOptions: '',
  minValue: '',
  maxValue: '',
  parents: '',
  activeValues: '',
  allowBlank: false,
  allowUnknown99: false,
  enabled: true,
  inputGuide: '',
  emrLocation: '',
}

const nav = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Subjects', icon: Users },
  { label: 'Queries', icon: HelpCircle },
  { label: 'Rule Master', icon: SlidersHorizontal },
  { label: 'Export', icon: Download },
]

const adminNav = [
  { label: 'Audit Trail', icon: FileClock },
  { label: 'User Management', icon: UserCog },
  { label: 'Settings / Backup', icon: Settings },
]

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'neutral' }) {
  return <span className={`status-pill ${tone}`}>{children}</span>
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

function ruleFromApi(rule: any): Rule {
  return {
    variableKey: rule.variableKey,
    label: rule.label,
    section: rule.section,
    dataType: rule.dataType,
    unitOrFormat: rule.unitOrFormat || '',
    categoryOptions: rule.categoryOptions || '',
    minValue: rule.minValue,
    maxValue: rule.maxValue,
    parents: rule.parents || '',
    activeValues: rule.activeValues || '',
    allowBlank: Boolean(rule.allowBlank),
    allowUnknown99: Boolean(rule.allowUnknown99),
    enabled: Boolean(rule.enabled),
    inputGuide: rule.inputGuide || '',
    emrLocation: rule.emrLocation || '',
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function EdcWorkspace() {
  const [active, setActive] = useState('Dashboard')
  const [subject, setSubject] = useState('')
  const [rules, setRules] = useState<Rule[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [databaseConnected, setDatabaseConnected] = useState(false)
  const [toast, setToast] = useState('')
  const [queryOnly, setQueryOnly] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [visits, setVisits] = useState<VisitData[]>([])
  const [queries, setQueries] = useState<QueryRow[]>([])
  const [saved, setSaved] = useState<SaveStatus>('saved')
  const [lastSaved, setLastSaved] = useState('')
  const [missing, setMissing] = useState<Record<string, MissingReason | undefined>>({})
  const pendingSaves = useRef(new Map<string, number>())
  const failedSaves = useRef(new Set<string>())
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const drafts = useRef(new Map<string, { value: string; missingReason?: MissingReason }>())
  const [detailLoading, setDetailLoading] = useState(false)
  const selectedSubject = useRef(subject)
  selectedSubject.current = subject
  const [pageAccess, setPageAccess] = useState(emptyPageAccess)
  const timers = useRef<Record<string, number>>({})

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const refreshRules = async () => {
    const response = await fetch('/api/variables')
    const data = await response.json()
    setRules(data.map(ruleFromApi))
    await refreshSubjects()
  }

  const refreshSubjects = async () => {
    const response = await fetch('/api/subjects')
    const data = await response.json()
    setSubjects(sortSubjectsNumerically(data))
  }

  const refreshQueries = async () => {
    const response = await fetch('/api/queries')
    const data = await response.json()
    setQueries(data)
    return data as QueryRow[]
  }

  const [adminTarget, setAdminTarget] = useState<ProtectedPage | null>(null)
  const [queryTarget, setQueryTarget] = useState<QueryRow | null>(null)
  const refreshAdminStatus = async () => {
    try { setPageAccess(readPageAccess(sessionStorage)) } catch { setPageAccess(emptyPageAccess) }
  }

  const loadSubjectDetail = async (targetSubject: string) => {
    if (!targetSubject) return
    setDetailLoading(true)
    try {
      const response = await fetch(`/api/subjects/${encodeURIComponent(targetSubject)}`)
      if (!response.ok) {
        notify('Subject 데이터를 불러오지 못했습니다.')
        return
      }

      const data = await response.json()
      const restored: Record<string, string> = {}
      const restoredMissing: Record<string, MissingReason> = {}

      data.values.forEach((item: any) => {
        const visit = data.visits.find((candidate: VisitData) => candidate.id === item.visitId)
        if (visit) {
          restored[`${item.variableKey}-${visit.timepoint}`] = item.value ?? ''
          if (item.missingReason) restoredMissing[`${item.variableKey}-${visit.timepoint}`] = item.missingReason
        }
      })

      if (selectedSubject.current !== targetSubject) return
      for (const [key, draft] of drafts.current) {
        const prefix = `${targetSubject}-`
        if (key.startsWith(prefix)) {
          restored[key.slice(prefix.length)] = draft.value
          if (draft.missingReason) restoredMissing[key.slice(prefix.length)] = draft.missingReason
          else delete restoredMissing[key.slice(prefix.length)]
        }
      }
      setValues(restored)
      setMissing(restoredMissing)
      setVisits(data.visits)
      setDetailLoading(false)
    } catch {
      notify('Subject 데이터를 불러오지 못했습니다.')
    }
  }

  const openSubject = async (id: string, target: QueryRow | null = null) => {
    setQueryTarget(target)
    const response = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId: id }),
    })

    if (!response.ok) {
      notify('Subject 생성 실패')
      return
    }

    selectedSubject.current = id
    setSubject(id)
    setValues({})
    setMissing({})
    setVisits([])
    setDetailLoading(true)
    setLastSaved('')
    setSaved([...failedSaves.current].some((key) => key.startsWith(`${id}-`)) ? 'failed' : [...pendingSaves.current.keys()].some((key) => key.startsWith(`${id}-`)) ? 'saving' : 'saved')
    setQueryOnly(false)
    setActive('Subject detail')
    await refreshSubjects()
  }

  const update = (key: string, value: string, missingReason?: MissingReason) => {
    setValues((current) => ({ ...current, [key]: value }))
    setMissing((current) => ({ ...current, [key]: missingReason }))
    setSaved('saving')
    const separator = key.lastIndexOf('-')
    const variableKey = key.slice(0, separator)
    const timepoint = key.slice(separator + 1)
    const targetSubject = subject
    const timerKey = `${subject}-${key}`
    drafts.current.set(timerKey, { value, missingReason })
    const revision = (pendingSaves.current.get(timerKey) || 0) + 1
    pendingSaves.current.set(timerKey, revision)
    failedSaves.current.delete(timerKey)
    window.clearTimeout(timers.current[timerKey])
    timers.current[timerKey] = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          const response = await fetch(`/api/subjects/${encodeURIComponent(targetSubject)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variableKey, timepoint, value: missingReason ? null : value, missingReason: missingReason || null, modifiedBy: 'local-user' }),
          })
          if (!response.ok) throw new Error('save failed')
          if (pendingSaves.current.get(timerKey) === revision) {
            pendingSaves.current.delete(timerKey)
            failedSaves.current.delete(timerKey)
          }
          if (selectedSubject.current === targetSubject) setLastSaved(new Date().toLocaleTimeString('ko-KR', { hour12: false }))
        } catch {
          if (pendingSaves.current.get(timerKey) === revision) {
            pendingSaves.current.delete(timerKey)
            failedSaves.current.add(timerKey)
          }
        }
        if (selectedSubject.current === targetSubject) {
          const prefix = `${targetSubject}-`
          setSaved([...failedSaves.current].some((key) => key.startsWith(prefix)) ? 'failed' : [...pendingSaves.current.keys()].some((key) => key.startsWith(prefix)) ? 'saving' : 'saved')
        }
        try { await refreshQueries(); await refreshSubjects() } catch { notify('목록 갱신 실패') }
      })
    }, 400)
  }

  const subjectQueries = useMemo(() => queries.filter((query) => query.subject_id === subject), [queries, subject])

  const visibleRules = useMemo(
    () =>
      rules.filter((rule) => {
        if (!rule.enabled) return false
        if (!queryOnly) return true
        return subjectQueries.some((query) => query.variable_key === rule.variableKey && query.status === 'OPEN')
      }),
    [rules, queryOnly, subjectQueries],
  )

  const handleNavClick = (label: string) => {
    if (isProtectedPage(label) && !pageAccess[label]) { setAdminTarget(label); return }
    setActive(label)
  }

  useEffect(() => {
    ;(async () => {
      try {
        const health = await fetch('/api/health')
        const healthData = await health.json()
        setDatabaseConnected(Boolean(healthData.connected))
      } catch {
        setDatabaseConnected(false)
      }

      await refreshRules()
      await refreshQueries()
      await refreshAdminStatus()
    })()
  }, [])

  useEffect(() => {
    if (active !== 'Subject detail' || !subject) return
    void loadSubjectDetail(subject)
  }, [active, subject])

  const breadcrumbs = [
    { label: 'Study workspace', target: 'Dashboard' },
    ...(active === 'Dashboard'
      ? []
      : active === 'Subjects' || active === 'Subject detail'
        ? [{ label: 'Subjects', target: 'Subjects' }]
        : active === 'Queries'
          ? [{ label: 'Queries', target: 'Queries' }]
          : active === 'Rule Master'
            ? [{ label: 'Rule Master', target: 'Rule Master' }]
            : active === 'Export'
              ? [{ label: 'Export', target: 'Export' }]
              : active === 'Audit Trail'
                ? [{ label: 'Audit Trail', target: 'Audit Trail' }]
                : []),
  ]

  const content =
    active === 'Dashboard' ? (
      <Dashboard
        subjects={subjects}
        queries={queries}
        onOpen={(id) => openSubject(id)}
        onOpenQueries={() => setActive('Queries')}
      />
    ) : active === 'Subjects' ? (
      <Subjects subjects={subjects} onOpen={openSubject} />
    ) : active === 'Subject detail' ? (
      <Detail
        key={`${subject}-${queryTarget?.variable_key || ''}-${queryTarget?.timepoint || ''}`}
        target={queryTarget}
        subject={subject}
        rules={visibleRules}
        values={values}
        visits={visits}
        queries={subjectQueries}
        saved={saved}
        lastSaved={lastSaved}
        missing={missing}
        loading={detailLoading}
        update={update}
        queryOnly={queryOnly}
        setQueryOnly={setQueryOnly}
        onBack={() => setActive('Subjects')}
      />
    ) : active === 'Queries' ? (
      <Queries queries={queries} subjects={subjects} onOpen={(query) => { void openSubject(query.subject_id, query) }} />
    ) : active === 'Rule Master' ? (
      pageAccess['Rule Master'] ? <Rules rules={rules} refresh={refreshRules} notify={notify} /> : null
    ) : active === 'Export' ? (
      <Export subject={subject} subjects={subjects} />
    ) : active === 'Audit Trail' ? (
      pageAccess['Audit Trail'] ? <AuditTrail subjects={subjects} /> : null
    ) : (
      <AdminPage title={active} />
    )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Activity size={19} />
          </div>
          <div>
            <strong>
              CLINICAL
              <br />
              DATA CAPTURE
            </strong>
            <span>LOCAL EDC · v1.0</span>
          </div>
        </div>

        <div className="site-switcher">
          <span className="site-dot" />
          <div>
            <span className="eyebrow">CURRENT SITE</span>
            <strong>EWH · 이화의료원</strong>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(({ label, icon: Icon }) => (
            <button key={label} type="button" className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => handleNavClick(label)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="nav-label admin-label">ADMINISTRATION</div>
        <nav>
          {adminNav.map(({ label, icon: Icon }) => (
            <button key={label} type="button" className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => handleNavClick(label)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="live-dot" />
            <div>
              <strong>Local only</strong>
              <span>Data stays on this device</span>
            </div>
          </div>
          <div className="user-card">
            <div className="avatar">MJ</div>
            <div>
              <strong>Minji Jung</strong>
              <span>{pageAccess['Rule Master'] ? 'Rule Master access' : pageAccess['Audit Trail'] ? 'Audit Trail access' : 'Data Entry'}</span>
            </div>
            <MoreHorizontal size={17} />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="crumb">
            {breadcrumbs.map((item, index) => (
              <div key={item.target} className="crumb-item">
                {index > 0 && <ChevronRight size={14} />}
                <button type="button" className={index === breadcrumbs.length - 1 ? 'active-crumb' : ''} onClick={() => handleNavClick(item.target)}>
                  {item.label}
                </button>
              </div>
            ))}
          </div>

          <div className="top-actions">
            <span className="connection">
              <span className={`live-dot ${databaseConnected ? '' : 'disconnected'}`} />
              Local database {databaseConnected ? 'connected' : 'disconnected'}
            </span>
            <button className="icon-btn" type="button">
              <HelpCircle size={18} />
            </button>
            <button className="avatar small" type="button">
              MJ
            </button>
          </div>
        </header>

        {content}
        {adminTarget && <AdminAccessModal target={adminTarget} onCancel={() => setAdminTarget(null)} onSuccess={() => {
          try { sessionStorage.setItem(pageSessionKeys[adminTarget], 'true') } catch {}
          setPageAccess((current) => ({ ...current, [adminTarget]: true })); setActive(adminTarget); setAdminTarget(null)
        }} />}
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  )
}

function Dashboard({ subjects, queries, onOpen, onOpenQueries }: { subjects: Subject[]; queries: QueryRow[]; onOpen: (subjectId: string) => void; onOpenQueries: () => void }) {
  const summary = getDataEntrySummary(subjects)
  const openQueryCount = getOpenQueryCount(queries)
  const actions = subjects.map((item) => ({ ...item, open_queries: getOpenQueryCount(queries.filter((q) => q.subject_id === item.subject_id)) })).filter((item) => item.open_queries > 0)

  return (
    <div className="content dashboard-content">
      <PageHeading
        eyebrow="STUDY OVERVIEW"
        title="Clinical workspace"
        subtitle="Local SQLite study overview"
      />

      <div className="metrics">
        <div className="metric">
          <div className="metric-mark teal" />
          <div>
            <p className="eyebrow">ENROLLED SUBJECTS</p>
            <p className="metric-value">{subjects.length}</p>
            <p className="metric-detail">Local database</p>
          </div>
        </div>

        <button type="button" className="metric metric-button" onClick={onOpenQueries}>
          <div className="metric-mark amber" />
          <div>
            <p className="eyebrow">OPEN QUERY COUNT</p>
            <p className="metric-value">{openQueryCount}</p>
            <p className="metric-detail">Current unresolved queries</p>
          </div>
        </button>
        <div className="metric"><div className="metric-mark teal" /><div><p className="eyebrow">DATA ENTRY COMPLETE</p><p className="metric-value">{summary.complete}</p><p className="metric-detail">All required visits entered</p></div></div>
        <div className="metric"><div className="metric-mark slate" /><div><p className="eyebrow">DATA ENTRY INCOMPLETE</p><p className="metric-value">{summary.incomplete}</p><p className="metric-detail">Required entries remaining</p></div></div>
      </div>

      <div className="dashboard-grid operations-grid">
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Action Required</h2>
            <p>Subjects with open queries</p>
          </div>
        </div>
        <div className="mini-table">
          {!actions.length && <p className="crf-empty">All subjects are up to date</p>}
          {actions.map((item) => (
            <button className="mini-row" key={item.subject_id} type="button" onClick={() => onOpen(item.subject_id)}>
              <strong>{item.subject_id}</strong>
              <span>{item.updated_at}</span>
              <StatusPill tone={item.open_queries ? 'warn' : 'good'}>{item.open_queries ? `Open Queries: ${item.open_queries}` : 'Up to date'}</StatusPill>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Data Entry Progress</h2><p>Required entries completed per visit</p></div></div>
        <div className="visit-bars">
          {summary.visits.map(({ visit, completed, total, percentage }) => <div className="visit-row entry-progress-row" key={visit}>
            <span className="visit-label">{visit}</span>
            <div className="bar" role="progressbar" aria-label={`${visit} data entry completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={`${completed} / ${total} (${percentage}%)`}><span style={{ width: `${percentage}%` }} /></div>
            <strong>{completed} / {total} ({percentage}%)</strong>
          </div>)}
        </div>
      </section>
      </div>
    </div>
  )
}

function Subjects({ subjects, onOpen }: { subjects: Subject[]; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('')
  const [newId, setNewId] = useState<string | null>(null)

  const create = () => {
    if (newId?.trim()) onOpen(newId.trim())
  }

  return (
    <div className="content">
      <PageHeading
        eyebrow="SUBJECT MANAGEMENT"
        title="Subjects"
        subtitle={`${subjects.length} subjects in local database`}
        action={
          <button className="primary-btn" type="button" onClick={() => setNewId('')}>
            <Plus size={16} /> New subject
          </button>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input placeholder="Search Subject ID" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>

      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>SUBJECT ID</th>
              <th>OPEN QUERIES</th>
              <th>LAST UPDATED</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {subjects
              .filter((item) => item.subject_id.toLowerCase().includes(search.toLowerCase()))
              .map((item) => (
                <tr key={item.subject_id} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item.subject_id) }} onClick={() => onOpen(item.subject_id)}>
                  <td>
                    <strong className="subject-id">{item.subject_id}</strong>
                  </td>
                  <td>{item.open_queries || '—'}</td>
                  <td className="muted">{item.updated_at}</td>
                  <td>
                    <ChevronRight size={16} className="muted" />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {newId !== null && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(event) => {
              event.preventDefault()
              create()
            }}
          >
            <div className="panel-head">
              <div>
                <h2>New subject</h2>
                <p>Subject ID is unique and stored in SQLite.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setNewId(null)}>
                ×
              </button>
            </div>
            <label>
              Subject ID
              <input autoFocus value={newId} onChange={(event) => setNewId(event.target.value)} />
            </label>
            <div className="detail-actions">
              <button type="button" className="outline-btn" onClick={() => setNewId(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-btn">
                <Check size={15} /> Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Detail({
  target,
  subject,
  rules,
  values,
  visits,
  queries,
  saved,
  lastSaved,
  missing,
  loading,
  update,
  queryOnly,
  setQueryOnly,
  onBack,
}: {
  target: QueryRow | null
  subject: string
  rules: Rule[]
  values: Record<string, string>
  visits: VisitData[]
  queries: QueryRow[]
  saved: SaveStatus
  lastSaved: string
  missing: Record<string, MissingReason | undefined>
  loading: boolean
  update: (key: string, value: string, missingReason?: MissingReason) => void
  queryOnly: boolean
  setQueryOnly: (value: boolean) => void
  onBack: () => void
}) {
  const [showEmr, setShowEmr] = useState(true)
  const [sort, setSort] = useState('default')
  const [form, setForm] = useState(target?.form_name || '')
  const [visitFilter, setVisitFilter] = useState<string>(target?.timepoint || '')
  const [highlight, setHighlight] = useState('')
  const shownVisits = allVisits.filter((visit) => !visitFilter || visit === visitFilter)
  const shownRules = rules.filter((rule) => !form || rule.section === form).sort((a, b) => sort === 'default' ? 0 : emrReference(a).localeCompare(emrReference(b), 'en', { numeric: true }) * (sort === 'desc' ? -1 : 1))
  useEffect(() => {
    if (loading || !target || target.subject_id !== subject) return
    const id = `${target.variable_key}-${target.timepoint}`
    const timer = window.setTimeout(() => { const el = document.getElementById(id); el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); el?.focus({ preventScroll: true }); setHighlight(target.variable_key) }, 100)
    const clear = window.setTimeout(() => setHighlight(''), 3500)
    return () => { clearTimeout(timer); clearTimeout(clear) }
  }, [target, subject, loading])
  const visitDates = Object.fromEntries(allVisits.map((visit) => [visit, values[`vdt-${visit}`] ?? visits.find((item) => item.timepoint === visit)?.visitDate ?? '']))
  const saveDate = (visit: Visit, value: string) => update(`vdt-${visit}`, value)

  return (
    <div className="detail-content">
      <div className="detail-heading">
        <div>
          <button className="back-btn" type="button" onClick={onBack}>
            <ArrowLeft size={15} /> Subjects
          </button>
          <div className="subject-title">
            <span className="subject-badge">SUBJECT</span>
            <h1>{subject}</h1>
            <StatusPill tone="good">Active</StatusPill>
          </div>
          <p>Local SQLite clinical record</p>
        </div>

        <div className="detail-actions">
          <span role="status" aria-live="polite" className={`save-state ${saved}`}>
            <span /> {saved === 'saved' ? 'Saved' : saved === 'saving' ? 'Saving...' : 'Save failed · 변경한 항목을 다시 입력해 주세요'}{lastSaved && ` · ${lastSaved}`}
          </span>
        </div>
      </div>

      <div className="subject-strip">
        <div>
          <span className="eyebrow">CURRENT SUBJECT</span>
          <strong>Subject {subject}</strong>
        </div>

        {allVisits.map((visit) => (
          <div className="strip-visit" key={visit}>
            <span>{visit} / {visitDates[visit] || sampleVisitDates[visit]}</span>
            <input disabled={loading} aria-label={`${visit} 방문일`} type="date" value={visitDates[visit] || ''} onChange={(event) => saveDate(visit, event.target.value)} />
          </div>
        ))}

        <button type="button" className="strip-query" aria-label="Open Query 있는 항목만 보기" aria-pressed={queryOnly} onClick={() => setQueryOnly(!queryOnly)}>
          <span className="eyebrow">OPEN</span>
          <strong>{queries.filter((query) => query.status === 'OPEN').length}</strong>
        </button>
      </div>

      <div className="crf-toolbar">
        <label className="field-label">Sort by<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="default">Default</option><option value="asc">EMR Reference A to Z</option><option value="desc">EMR Reference Z to A</option></select></label>
        <label className="field-label">Form<select value={form} onChange={(e) => setForm(e.target.value)}><option value="">All forms</option>{Array.from(new Set(rules.map((r) => r.section))).map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="field-label">Visit<select value={visitFilter} onChange={(e) => setVisitFilter(e.target.value)}><option value="">All visits</option>{allVisits.map((v) => <option key={v}>{v}</option>)}</select></label>
        <label className="check-control">
          <input type="checkbox" checked={queryOnly} onChange={(event) => setQueryOnly(event.target.checked)} />
          Query 있는 항목만 보기
        </label>
      </div>

      <label className="check-control"><input type="checkbox" checked={showEmr} onChange={(event) => setShowEmr(event.target.checked)} /> EMR Reference 표시</label>
      {loading && <p role="status">대상자 데이터를 불러오는 중입니다. 로드되지 않으면 Subjects에서 다시 열어 주세요.</p>}
      <section className="crf-table-panel" inert={loading} aria-busy={loading} tabIndex={0} aria-label="대상자 CRF 입력 표">
        <table>
          <thead>
            <tr>
              <th>VARIABLE</th>
              <th>INPUT GUIDE</th>
              {showEmr && <th>EMR REFERENCE</th>}
              {shownVisits.map((visit) => <th key={visit}>{visit}<small className="variable-subtitle">{visitDates[visit] || sampleVisitDates[visit]}</small></th>)}
              <th>QUERY</th>
            </tr>
          </thead>
          <tbody>
            {!shownRules.length && <tr><td colSpan={shownVisits.length + (showEmr ? 4 : 3)} className="crf-empty">{queryOnly ? '현재 열린 Query가 없습니다.' : '표시할 항목이 없습니다.'}</td></tr>}
            {shownRules.map((rule) => {
              const openForRule = queries.filter((query) => query.subject_id === subject && query.variable_key === rule.variableKey && query.status === 'OPEN').sort((a, b) => a.timepoint.localeCompare(b.timepoint))

              return (
                <tr key={rule.variableKey} className={`${openForRule.length ? "queried-row" : ""} ${highlight === rule.variableKey ? "query-highlight" : ""}`}>
                  <td>
                    <strong className="variable-main">{rule.label}</strong>
                    <small className="variable-subtitle">{rule.variableKey}</small>
                  </td>
                  <td className="input-guide"><span title={inputGuide(rule)}>{inputGuide(rule)}</span></td>
                  {showEmr && <td className="emr-reference">{!rule.emrLocation && <small className="mock-label">Sample</small>}{emrReference(rule)}</td>}

                  {shownVisits.map((visit) => {
                    const currentKey = `${rule.variableKey}-${visit}`
                    const currentValue = values[currentKey] ?? ''

                    return (
                      <td key={currentKey}>
                        <CrfField rule={rule} cellKey={currentKey} value={currentValue} missingReason={missing[currentKey]}
                          hasQuery={openForRule.some((query) => query.timepoint === visit)} queryId={`query-${rule.variableKey}`}
                          onChange={(value, reason) => update(currentKey, value, reason)} />
                      </td>
                    )
                  })}

                  <td>
                    {openForRule.length ? (
                      <span className="query-message" id={`query-${rule.variableKey}`}>
                        {openForRule.map((query) => `${query.timepoint}: ${query.message}`).join(' • ')}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Queries({ queries, subjects, onOpen }: { queries: QueryRow[]; subjects: Subject[]; onOpen: (query: QueryRow) => void }) {
  const [statusFilter, setStatusFilter] = useState('Open')
  const summary = useMemo(() => sortSubjectsNumerically(subjects.map((subject) => {
    const items = queries.filter((q) => q.subject_id === subject.subject_id)
    const open = getOpenQueryCount(items)
    return { subject_id: subject.subject_id, total: items.length, open, closed: items.length - open, latestDate: items.map((q) => q.resolved_at || q.detected_at).sort().at(-1) || '', latestStatus: getSubjectQueryStatus(items) }
  })).filter((item) => statusFilter === 'All' || (statusFilter === 'Open' ? item.open > 0 : item.open === 0 && item.total > 0)), [queries, subjects, statusFilter])

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  useEffect(() => { if (!summary.some((item) => item.subject_id === selectedSubject)) setSelectedSubject(summary[0]?.subject_id || null) }, [summary, selectedSubject])
  const selectedQueries = selectedSubject ? queries.filter((query) => query.subject_id === selectedSubject) : []

  return (
    <div className="content">
      <PageHeading eyebrow="DATA QUALITY" title="Query management" subtitle="All Query history stored in local SQLite" />
      <label className="field-label toolbar">Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>{['All', 'Open', 'Resolved'].map((status) => <option key={status}>{status}</option>)}</select></label>

      <section className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>SUBJECT</th>
              <th>QUERY COUNT</th>
              <th>OPEN</th>
              <th>CLOSED</th>
              <th>LATEST DATE</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((item) => (
              <tr key={item.subject_id} className={selectedSubject === item.subject_id ? "selected-subject" : ""} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedSubject(item.subject_id) }} onClick={() => setSelectedSubject(item.subject_id)}>
                <td>
                  <strong className="subject-id">{item.subject_id}</strong>
                </td>
                <td>{item.total}</td>
                <td>{item.open}</td>
                <td>{item.closed}</td>
                <td>{formatDateTime(item.latestDate)}</td>
                <td>
                  <StatusPill tone={item.latestStatus === 'OPEN' ? 'warn' : 'good'}>{item.latestStatus}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selectedSubject && (
        <section className="panel table-panel" style={{ marginTop: 20 }}>
          <div className="panel-head">
            <div>
              <h2>{selectedSubject} Query history</h2>
              <p>Current and prior queries for this subject</p>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>VISIT</th>
                <th>FORM</th>
                <th>VARIABLE</th>
                <th>TYPE</th>
                <th>MESSAGE</th>
                <th>STATUS</th>
                <th>UPDATED</th>
              </tr>
            </thead>
            <tbody>
              {selectedQueries.map((query) => (
                <tr key={`${query.subject_id}-${query.timepoint}-${query.variable_key}-${query.query_type}`} tabIndex={0} onClick={() => onOpen(query)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(query) }}>
                  <td>{query.timepoint}</td>
                  <td>{query.form_name}</td><td><button className="back-btn" onClick={(e) => { e.stopPropagation(); onOpen(query) }}>{query.variable_name || query.variable_key}</button></td>
                  <td>{query.query_type}</td>
                  <td>{query.message}</td>
                  <td>
                    <StatusPill tone={query.status === 'OPEN' ? 'warn' : 'good'}>{query.status}</StatusPill>
                  </td>
                  <td>{formatDateTime(query.resolved_at || query.detected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Rules({ rules, refresh, notify }: { rules: Rule[]; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<any>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload = {
      ...editing,
      minValue: editing.minValue === '' ? null : Number(editing.minValue),
      maxValue: editing.maxValue === '' ? null : Number(editing.maxValue),
    }

    const response = await fetch(editing._new ? '/api/variables' : `/api/variables/${encodeURIComponent(editing.variableKey)}`, {
      method: editing._new ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      notify(body.error || '저장 실패')
      return
    }

    setEditing(null)
    await refresh()
    notify('Rule saved')
  }

  return (
    <div className="content">
      <PageHeading
        eyebrow="CONFIGURATION"
        title="Rule master"
        subtitle="Variable definitions from local SQLite"
        action={
          <button className="primary-btn" type="button" onClick={() => setEditing({ ...emptyRule, _new: true })}>
            <Plus size={16} /> Add variable
          </button>
        }
      />

      <section className="panel table-panel">
        <div className="panel-head">
          <div>
            <h2>Variable dictionary</h2>
            <p>Changes apply immediately to dynamic Subject entry.</p>
          </div>
          <div className="search-box compact">
            <Search size={15} />
            <input placeholder="Search variables" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>VARIABLE</th>
              <th>LABEL</th>
              <th>TYPE</th>
              <th>RANGE / VALUES</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules
              .filter((rule) => `${rule.variableKey} ${rule.label}`.toLowerCase().includes(search.toLowerCase()))
              .map((rule) => (
                <tr key={rule.variableKey}>
                  <td>
                    <span>{rule.variableKey}</span>
                  </td>
                  <td>
                    <strong>{rule.label}</strong>
                  </td>
                  <td>{rule.dataType}</td>
                  <td className="muted">{rule.categoryOptions || `${rule.minValue ?? ''}–${rule.maxValue ?? ''}`}</td>
                  <td>
                    <StatusPill tone={rule.enabled ? 'good' : 'neutral'}>{rule.enabled ? 'Enabled' : 'Disabled'}</StatusPill>
                  </td>
                  <td>
                    <button type="button" className="text-btn" onClick={() => setEditing(rule)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {editing && (
        <div className="modal-backdrop">
          <form className="modal modal-wide" onSubmit={submit}>
            <div className="panel-head">
              <div>
                <h2>{editing._new ? 'Add variable' : 'Edit variable'}</h2>
                <p>Rule Master changes are protected by admin access.</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>

            <div className="modal-grid">
              <label>
                Variable key
                <input value={editing.variableKey} onChange={(event) => setEditing({ ...editing, variableKey: event.target.value })} />
              </label>
              <label>
                Label
                <input value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} />
              </label>
              <label>
                Section
                <input value={editing.section} onChange={(event) => setEditing({ ...editing, section: event.target.value })} />
              </label>
              <label>
                Data type
                <select value={editing.dataType} onChange={(event) => setEditing({ ...editing, dataType: event.target.value })}>
                  <option value="character">character</option>
                  <option value="integer">integer</option>
                  <option value="real">real</option>
                  <option value="categorical">categorical</option>
                  <option value="datetime">datetime</option>
                </select>
              </label>
              <label>
                Unit / format
                <input value={editing.unitOrFormat} onChange={(event) => setEditing({ ...editing, unitOrFormat: event.target.value })} />
              </label>
              <label>
                Category options
                <input value={editing.categoryOptions} onChange={(event) => setEditing({ ...editing, categoryOptions: event.target.value })} />
              </label>
              <label>
                Min value
                <input value={editing.minValue} onChange={(event) => setEditing({ ...editing, minValue: event.target.value })} />
              </label>
              <label>
                Max value
                <input value={editing.maxValue} onChange={(event) => setEditing({ ...editing, maxValue: event.target.value })} />
              </label>
              <label>
                Input guide
                <input value={editing.inputGuide} onChange={(event) => setEditing({ ...editing, inputGuide: event.target.value })} />
              </label>
              <label>
                EMR reference
                <input value={editing.emrLocation} onChange={(event) => setEditing({ ...editing, emrLocation: event.target.value })} />
              </label>
              <label className="check-control">
                <input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} />
                Enabled
              </label>
              <label className="check-control">
                <input type="checkbox" checked={editing.allowBlank} onChange={(event) => setEditing({ ...editing, allowBlank: event.target.checked })} />
                Allow blank
              </label>
              <label className="check-control">
                <input type="checkbox" checked={editing.allowUnknown99} onChange={(event) => setEditing({ ...editing, allowUnknown99: event.target.checked })} />
                Allow unknown 99
              </label>
            </div>

            <div className="detail-actions" style={{ padding: '0 20px 20px' }}>
              <button type="button" className="outline-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-btn">
                <Check size={15} /> Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function Export({ subject, subjects }: { subject: string; subjects: Subject[] }) {
  const [selectedSubject, setSelectedSubject] = useState(subject || '')
  const [selectedVisit, setSelectedVisit] = useState('ALL')
  const [history, setHistory] = useState<{ id: number; exported_at: string; user_name: string; subject_id: string | null; visit: string | null; file_name: string; export_type: string; status: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshHistory = async () => {
    const response = await fetch('/api/export?history=1', { cache: 'no-store' })
    if (!response.ok) throw new Error('Export history could not be loaded')
    setHistory(await response.json())
  }
  useEffect(() => { void refreshHistory().catch((e) => setError(e.message)) }, [])
  const download = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(exportQuery, { cache: 'no-store' })
      if (!response.ok) throw new Error('Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'edc-export.xlsx'
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      await refreshHistory()
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed') } finally { setBusy(false) }
  }

  const exportQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (selectedSubject) params.set('subject', selectedSubject)
    if (selectedVisit !== 'ALL') params.set('visit', selectedVisit)
    return `/api/export${params.size ? `?${params.toString()}` : ''}`
  }, [selectedSubject, selectedVisit])

  return (
    <div className="content">
      <PageHeading eyebrow="DATA OPERATIONS" title="Export center" subtitle="Create local Excel workbooks" />

      <section className="panel" style={{ padding: 24 }}>
        <div className="export-grid">
          <div className="export-card">
            <div className="export-icon">
              <Download size={18} />
            </div>
            <div>
              <h2>Export selection</h2>
              <p>Choose all subjects, a specific subject, or a specific visit.</p>
            </div>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          <label className="field-label">
            Subject
            <select value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>
              <option value="">All subjects</option>
              {subjects.map((item) => (
                <option key={item.subject_id} value={item.subject_id}>
                  {item.subject_id}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Visit
            <select value={selectedVisit} onChange={(event) => setSelectedVisit(event.target.value)}>
              <option value="ALL">All visits</option>
              {allVisits.map((visit) => (
                <option key={visit} value={visit}>
                  {visit}
                </option>
              ))}
            </select>
          </label>

          <button className="primary-btn" disabled={busy} onClick={() => void download()}><Download size={15} /> {busy ? 'Exporting...' : 'Download .xlsx'}</button>
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
      <section className="panel table-panel export-history" style={{ marginTop: 20 }}>
        <div className="panel-head"><h2>Export History</h2></div>
        <table><thead><tr>{['Export date/time', 'User', 'Subject', 'Visit', 'File name', 'Export type', 'Status'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{history.map((row) => <tr key={row.id}><td>{formatDateTime(row.exported_at)}</td><td>{row.user_name}</td><td>{row.subject_id || 'All subjects'}</td><td>{row.visit || 'All visits'}</td><td>{row.file_name}</td><td>{row.export_type}</td><td><StatusPill tone="good">{row.status}</StatusPill></td></tr>)}{!history.length && <tr><td colSpan={7}>No exports yet</td></tr>}</tbody>
        </table>
      </section>
    </div>
  )
}

function AdminAccessModal({ target, onSuccess, onCancel }: { target: string; onSuccess: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const mounted = useRef(true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => { const previous = document.activeElement as HTMLElement; mounted.current = true; dialog.current?.showModal(); return () => { mounted.current = false; previous?.focus() } }, [])
  return <dialog ref={dialog} className="modal admin-dialog" onCancel={onCancel} aria-labelledby="admin-title">
    <form onSubmit={async (event) => {
      event.preventDefault(); setLoading(true); setError('')
      try {
        const response = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
        if (!mounted.current) return
        if (response.ok) onSuccess(); else setError('Incorrect password')
      } catch { setError('Unable to authenticate. Please try again.') } finally { setLoading(false) }
    }}>
      <div className="panel-head"><h2 id="admin-title">{target} / Administrator Access</h2></div>
      <label className="field-label">Password<input autoFocus required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="rule-master-login-error">{error}</p>}
      <div className="detail-actions"><button type="button" className="outline-btn" onClick={onCancel}>Cancel</button><button className="primary-btn" disabled={loading}>Continue</button></div>
    </form>
  </dialog>
}

function AuditTrail({ subjects }: { subjects: Subject[] }) {
  const [rows, setRows] = useState<AuditLogRow[]>([])
  const [filters, setFilters] = useState({
    subjectId: '',
    from: '',
    to: '',
    user: '',
    visit: '',
    variable: '',
    action: '',
  })

  const loadAuditTrail = async (clear = false) => {
    const params = new URLSearchParams()
    if (filters.subjectId) params.set('subjectId', filters.subjectId)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.user) params.set('user', filters.user)
    if (filters.visit) params.set('visit', filters.visit)
    if (filters.variable) params.set('variable', filters.variable)
    if (filters.action) params.set('action', filters.action)

    const response = await fetch(`/api/audit${!clear && params.size ? `?${params.toString()}` : ''}`)
    const data = await response.json()
    setRows(data)
  }

  useEffect(() => {
    void loadAuditTrail()
  }, [])

  return (
    <div className="content">
      <PageHeading eyebrow="ADMINISTRATION" title="Audit Trail" subtitle="Search and review data change history" />

      <section className="panel" style={{ padding: 20 }}>
        <div className="filter-grid audit-filter-grid">
          <label className="field-label">
            Subject ID
            <select value={filters.subjectId} onChange={(event) => setFilters((current) => ({ ...current, subjectId: event.target.value }))}><option value="">All subjects</option>{subjects.map((s) => <option key={s.subject_id}>{s.subject_id}</option>)}</select>
          </label>
          <label className="field-label">
            From
            <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
          </label>
          <label className="field-label">
            To
            <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
          </label>
          <label className="field-label">
            User
            <input value={filters.user} onChange={(event) => setFilters((current) => ({ ...current, user: event.target.value }))} />
          </label>

          <label className="field-label">
            Visit
            <select value={filters.visit} onChange={(event) => setFilters((current) => ({ ...current, visit: event.target.value }))}>
              <option value="">All</option>
              {allVisits.map((visit) => (
                <option key={visit} value={visit}>
                  {visit}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Variable
            <input value={filters.variable} onChange={(event) => setFilters((current) => ({ ...current, variable: event.target.value }))} />
          </label>

          <label className="field-label">
            Change type
            <select value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}>
              <option value="">All</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="VALUE_CHANGE">Data Change</option><option value="QUERY">Query</option><option value="STATUS_CHANGE">Status Change</option><option value="USER_ACTION">User Action</option><option value="EXPORT">Export</option>
            </select>
          </label>

          <div className="filter-actions">
            <button type="button" className="primary-btn" onClick={() => void loadAuditTrail()}>
              Apply filters
            </button><button type="button" className="outline-btn" onClick={() => { setFilters({ subjectId: '', from: '', to: '', user: '', visit: '', variable: '', action: '' }); void loadAuditTrail(true) }}>Clear filters</button>
          </div>
        </div>
      </section>

      <section className="panel table-panel" style={{ marginTop: 20 }}>
        <table>
          <thead>
            <tr>
              <th>DATE</th>
              <th>USER</th>
              <th>SUBJECT</th>
              <th>VISIT</th>
              <th>VARIABLE</th>
              <th>BEFORE</th>
              <th>AFTER</th>
              <th>TYPE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.modified_at)}</td>
                <td>{row.modified_by || '—'}</td>
                <td>{row.subject_id || '—'}</td>
                <td>{row.timepoint || '—'}</td>
                <td>{row.variable_key || '—'}</td>
                <td>{row.previous_value || '—'}</td>
                <td>{row.new_value || '—'}</td>
                <td>
                  <StatusPill tone={row.action === 'UPDATE' ? 'warn' : 'good'}>{row.action}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function AdminPage({ title }: { title: string }) {
  return (
    <div className="content">
      <PageHeading eyebrow="ADMINISTRATION" title={title} subtitle="Local-only study configuration" />
      <section className="panel empty-state">
        <h2>{title} workspace</h2>
        <p>Administration controls are reserved for the next implementation phase.</p>
      </section>
    </div>
  )
}
