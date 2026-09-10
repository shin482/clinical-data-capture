'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeft, Check, ChevronDown, ChevronRight, Download, FileClock, HelpCircle, LayoutDashboard, MoreHorizontal, Plus, Search, Settings, SlidersHorizontal, UserCog, Users } from 'lucide-react'

type Visit = 'T1' | 'T2' | 'T3'

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

type Subject = { subject_id: string; updated_at: string; open_queries: number }
type VisitData = { id: number; timepoint: Visit; visitDate: string | null }
type QueryRow = {
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
  const [saved, setSaved] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const timers = useRef<Record<string, number>>({})

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  const refreshRules = async () => {
    const response = await fetch('/api/variables')
    const data = await response.json()
    setRules(data.map(ruleFromApi))
  }

  const refreshSubjects = async () => {
    const response = await fetch('/api/subjects')
    const data = await response.json()
    setSubjects(data)
  }

  const refreshQueries = async () => {
    const response = await fetch('/api/queries')
    const data = await response.json()
    setQueries(data)
    return data as QueryRow[]
  }

  const refreshAdminStatus = async () => {
    try {
      const response = await fetch('/api/admin/status')
      const data = await response.json()
      setIsAdmin(Boolean(data.isAdmin))
    } catch {
      setIsAdmin(false)
    }
  }

  const loadSubjectDetail = async (targetSubject: string) => {
    if (!targetSubject) return

    try {
      const response = await fetch(`/api/subjects/${encodeURIComponent(targetSubject)}`)
      if (!response.ok) {
        notify('Subject 데이터를 불러오지 못했습니다.')
        return
      }

      const data = await response.json()
      const restored: Record<string, string> = {}

      data.values.forEach((item: any) => {
        const visit = data.visits.find((candidate: VisitData) => candidate.id === item.visitId)
        if (visit) restored[`${item.variableKey}-${visit.timepoint}`] = item.value || ''
      })

      setValues(restored)
      setVisits(data.visits)
    } catch {
      notify('Subject 데이터를 불러오지 못했습니다.')
    }
  }

  const openSubject = async (id: string) => {
    const response = await fetch('/api/subjects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId: id }),
    })

    if (!response.ok) {
      notify('Subject 생성 실패')
      return
    }

    setSubject(id)
    setQueryOnly(false)
    setActive('Subject detail')
    await refreshSubjects()
    await loadSubjectDetail(id)
  }

  const update = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setSaved(false)

    const separator = key.lastIndexOf('-')
    const variableKey = key.slice(0, separator)
    const timepoint = key.slice(separator + 1)
    const timerKey = `${subject}-${key}`

    window.clearTimeout(timers.current[timerKey])
    timers.current[timerKey] = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/subjects/${encodeURIComponent(subject)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variableKey, timepoint, value, modifiedBy: 'local-user' }),
        })

        if (!response.ok) {
          throw new Error('save failed')
        }

        setSaved(true)
        await refreshQueries()
        await refreshSubjects()
      } catch {
        setSaved(false)
        notify('저장 실패')
      }
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

  const handleNavClick = async (label: string) => {
    if ((label === 'Rule Master' || label === 'Audit Trail') && !isAdmin) {
      const password = window.prompt('관리자 비밀번호를 입력하세요.')
      if (!password) return

      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        notify('관리자 인증에 실패했습니다.')
        return
      }

      setIsAdmin(true)
    }

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
      await refreshSubjects()
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
        onOpenSubjects={() => setActive('Subjects')}
      />
    ) : active === 'Subjects' ? (
      <Subjects subjects={subjects} onOpen={openSubject} />
    ) : active === 'Subject detail' ? (
      <Detail
        subject={subject}
        rules={visibleRules}
        values={values}
        visits={visits}
        queries={subjectQueries}
        saved={saved}
        update={update}
        queryOnly={queryOnly}
        setQueryOnly={setQueryOnly}
        onBack={() => setActive('Subjects')}
      />
    ) : active === 'Queries' ? (
      <Queries queries={queries} />
    ) : active === 'Rule Master' ? (
      <Rules rules={rules} refresh={refreshRules} notify={notify} />
    ) : active === 'Export' ? (
      <Export subject={subject} subjects={subjects} />
    ) : active === 'Audit Trail' ? (
      <AuditTrail />
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
          <ChevronDown size={15} />
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
              <span>{isAdmin ? 'Site Admin' : 'Data Entry'}</span>
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
        {toast && <div className="toast">{toast}</div>}
      </main>
    </div>
  )
}

function Dashboard({ subjects, queries, onOpen, onOpenQueries, onOpenSubjects }: { subjects: Subject[]; queries: QueryRow[]; onOpen: (subjectId: string) => void; onOpenQueries: () => void; onOpenSubjects: () => void }) {
  const openQueryCount = queries.filter((query) => query.status === 'OPEN').length

  return (
    <div className="content">
      <PageHeading
        eyebrow="STUDY OVERVIEW"
        title="Clinical workspace"
        subtitle="Local SQLite study overview"
        action={
          <button className="primary-btn" type="button" onClick={onOpenSubjects}>
            <Plus size={16} /> Open subject
          </button>
        }
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
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Recent subjects</h2>
            <p>Latest activity at this site</p>
          </div>
        </div>
        <div className="mini-table">
          {subjects.map((item) => (
            <button className="mini-row" key={item.subject_id} type="button" onClick={() => onOpen(item.subject_id)}>
              <strong>{item.subject_id}</strong>
              <span>{item.updated_at}</span>
              <StatusPill tone={item.open_queries ? 'warn' : 'good'}>{item.open_queries ? `${item.open_queries} queries` : 'Up to date'}</StatusPill>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </section>
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
                <tr key={item.subject_id} onClick={() => onOpen(item.subject_id)}>
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
  subject,
  rules,
  values,
  visits,
  queries,
  saved,
  update,
  queryOnly,
  setQueryOnly,
  onBack,
}: {
  subject: string
  rules: Rule[]
  values: Record<string, string>
  visits: VisitData[]
  queries: QueryRow[]
  saved: boolean
  update: (key: string, value: string) => void
  queryOnly: boolean
  setQueryOnly: (value: boolean) => void
  onBack: () => void
}) {
  const [visitDates, setVisitDates] = useState<Record<string, string>>({})

  useEffect(() => {
    setVisitDates(Object.fromEntries(visits.map((visit) => [visit.timepoint, visit.visitDate || ''])))
  }, [visits])

  const saveDate = (visit: Visit, value: string) => {
    setVisitDates((current) => ({ ...current, [visit]: value }))
    update(`vdt-${visit}`, value)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, key: string) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') return

    event.preventDefault()
    const root = event.currentTarget.closest('table')
    const inputs = Array.from(root?.querySelectorAll<HTMLInputElement>('input[data-cell-key]') ?? [])
    const currentIndex = inputs.findIndex((input) => input.dataset.cellKey === key)
    const target = inputs[currentIndex + 1] || inputs[0]
    if (target) target.focus()
  }

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
          <span className={`save-state ${saved ? 'saved' : 'saving'}`}>
            <span /> {saved ? 'Saved' : 'Saving...'}
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
            <span>{visit}</span>
            <input type="date" value={visitDates[visit] || ''} onChange={(event) => saveDate(visit, event.target.value)} />
          </div>
        ))}

        <div className="strip-query">
          <span className="eyebrow">OPEN</span>
          <strong>{queries.filter((query) => query.status === 'OPEN').length}</strong>
        </div>
      </div>

      <div className="crf-toolbar">
        <label className="check-control">
          <input type="checkbox" checked={queryOnly} onChange={(event) => setQueryOnly(event.target.checked)} />
          Query only
        </label>
      </div>

      <section className="crf-table-panel">
        <table>
          <thead>
            <tr>
              <th>VARIABLE</th>
              <th>INPUT GUIDE</th>
              <th>EMR REFERENCE</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
              <th>QUERY</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const openForRule = queries.filter((query) => query.subject_id === subject && query.variable_key === rule.variableKey && query.status === 'OPEN')

              return (
                <tr key={rule.variableKey}>
                  <td>
                    <strong>{rule.variableKey}</strong>
                    <small>{rule.label}</small>
                  </td>
                  <td>{rule.inputGuide || '—'}</td>
                  <td>{rule.emrLocation || '—'}</td>

                  {allVisits.map((visit) => {
                    const currentKey = `${rule.variableKey}-${visit}`
                    const currentValue = values[currentKey] ?? ''

                    return (
                      <td key={currentKey}>
                        <input
                          className="value-input"
                          data-cell-key={currentKey}
                          type={rule.dataType === 'datetime' ? 'date' : 'text'}
                          value={currentValue}
                          onChange={(event) => update(currentKey, event.target.value)}
                          onKeyDown={(event) => handleInputKeyDown(event, currentKey)}
                        />
                      </td>
                    )
                  })}

                  <td>
                    {openForRule.length ? (
                      <span className="query-message">
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

function Queries({ queries }: { queries: QueryRow[] }) {
  const summary = useMemo(() => {
    const map = new Map<string, { subject_id: string; total: number; open: number; closed: number; latestDate: string; latestStatus: string }>()

    queries.forEach((query) => {
      const row = map.get(query.subject_id) || { subject_id: query.subject_id, total: 0, open: 0, closed: 0, latestDate: '', latestStatus: '' }
      row.total += 1
      row.open += query.status === 'OPEN' ? 1 : 0
      row.closed += query.status !== 'OPEN' ? 1 : 0
      row.latestDate = query.detected_at
      row.latestStatus = query.status
      map.set(query.subject_id, row)
    })

    return Array.from(map.values()).sort((a, b) => b.latestDate.localeCompare(a.latestDate))
  }, [queries])

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const selectedQueries = selectedSubject ? queries.filter((query) => query.subject_id === selectedSubject) : []

  return (
    <div className="content">
      <PageHeading eyebrow="DATA QUALITY" title="Query management" subtitle="All Query history stored in local SQLite" />

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
              <tr key={item.subject_id} onClick={() => setSelectedSubject(item.subject_id)}>
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
                <th>VARIABLE</th>
                <th>TYPE</th>
                <th>MESSAGE</th>
                <th>STATUS</th>
                <th>UPDATED</th>
              </tr>
            </thead>
            <tbody>
              {selectedQueries.map((query) => (
                <tr key={`${query.subject_id}-${query.timepoint}-${query.variable_key}-${query.detected_at}`}>
                  <td>{query.timepoint}</td>
                  <td>{query.variable_key}</td>
                  <td>{query.query_type}</td>
                  <td>{query.message}</td>
                  <td>
                    <StatusPill tone={query.status === 'OPEN' ? 'warn' : 'good'}>{query.status}</StatusPill>
                  </td>
                  <td>{formatDateTime(query.detected_at)}</td>
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

          <a className="primary-btn" href={exportQuery}>
            <Download size={15} /> Download .xlsx
          </a>
        </div>
      </section>
    </div>
  )
}

function AuditTrail() {
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

  const loadAuditTrail = async () => {
    const params = new URLSearchParams()
    if (filters.subjectId) params.set('subjectId', filters.subjectId)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.user) params.set('user', filters.user)
    if (filters.visit) params.set('visit', filters.visit)
    if (filters.variable) params.set('variable', filters.variable)
    if (filters.action) params.set('action', filters.action)

    const response = await fetch(`/api/audit${params.size ? `?${params.toString()}` : ''}`)
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
        <div className="filter-grid">
          <label className="field-label">
            Subject ID
            <input value={filters.subjectId} onChange={(event) => setFilters((current) => ({ ...current, subjectId: event.target.value }))} />
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
              <option value="VALUE_CHANGE">Value change</option>
            </select>
          </label>

          <div className="filter-actions">
            <button type="button" className="primary-btn" onClick={() => void loadAuditTrail()}>
              Apply filters
            </button>
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