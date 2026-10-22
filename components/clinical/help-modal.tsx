'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { displayVersion, parseCoordinatorJobStatus, parseUpdateStatus, type UpdateStatus } from '@/lib/update-status'
import { parseUpdateHistoryPage, type UpdateHistoryItem, type UpdateHistoryState } from '@/lib/update-history'

const coordinatorUiEnabled = process.env.NEXT_PUBLIC_UPDATE_COORDINATOR_ENABLED === 'true'
const coordinatorSessionKey = 'edc-update-coordinator-job-v1'
const pollIntervalMs = 2000
const maxPollAttempts = 150

const guides = [
  { name: 'Dashboard', description: '등록 대상자 수와 Query, 데이터 입력 진행률을 확인합니다.' },
  { name: 'Subjects', description: '대상자별 연구 데이터를 입력하거나 수정합니다.' },
  { name: 'Queries', description: '발생한 Query를 확인하고 해당 입력 항목으로 이동합니다.' },
  { name: 'Export', description: '연구 데이터를 Excel 파일로 내보냅니다.' },
  { name: 'Rule Master', description: '데이터 검증 규칙을 관리합니다.', admin: true },
  { name: 'Audit Trail', description: '데이터 변경 이력을 확인합니다.', admin: true },
  { name: 'User Management', description: '사용자 및 권한 관리 메뉴입니다. 현재 준비 중입니다.', admin: true },
]

export function HelpModal({ onClose, version, site }: { onClose: () => void; version: string; site: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const updateRequestInFlight = useRef(false)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAttempts = useRef(0)
  const [updateState, setUpdateState] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'ready'; status: UpdateStatus }
    | { kind: 'updating'; version: string }
    | { kind: 'success'; version: string; connectionLost: boolean }
    | { kind: 'recovery'; version: string }
    | { kind: 'error'; reason: 'check' | 'auth' | 'unavailable' | 'current' | 'in_progress' | 'update' | 'disabled' }
  >({ kind: 'idle' })
  const [historyState, setHistoryState] = useState<
    | { kind: 'idle' | 'loading' | 'unavailable' | 'error' }
    | { kind: 'ready'; page: number; pageSize: number; total: number; items: UpdateHistoryItem[] }
  >({ kind: 'idle' })
  const [selectedHistory, setSelectedHistory] = useState<UpdateHistoryItem | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    if (coordinatorUiEnabled) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(coordinatorSessionKey) || 'null') as { jobId?: string; version?: string } | null
        const requestHint = saved as { jobId?: string; requestId?: string; version?: string } | null
        if (requestHint?.jobId && requestHint.version) void pollCoordinatorJob(requestHint.jobId, requestHint.version, requestHint.requestId)
      } catch { /* A damaged browser hint is not trusted as job state. */ }
    }
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); previous?.focus() }
  }, [])

  async function pollCoordinatorJob(jobId: string, targetVersion: string, requestId?: string) {
    setUpdateState({ kind: 'updating', version: targetVersion })
    try {
      let response = await fetch(`/api/update/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      let status = parseCoordinatorJobStatus(await response.json().catch(() => null))
      if ((!response.ok || !status) && requestId) {
        response = await fetch(`/api/update/requests/${encodeURIComponent(requestId)}`, { cache: 'no-store' })
        status = parseCoordinatorJobStatus(await response.json().catch(() => null))
      }
      if (response.status === 401 || response.status === 403) {
        updateRequestInFlight.current = false
        setUpdateState({ kind: 'error', reason: 'auth' })
        return
      }
      if (!response.ok || !status || status.jobId !== jobId || (requestId && status.requestId !== requestId)) throw new Error('Job status unavailable')
      if (status.state === 'COMPLETED') {
        sessionStorage.removeItem(coordinatorSessionKey)
        updateRequestInFlight.current = false
        setUpdateState({ kind: 'success', version: targetVersion, connectionLost: false })
        return
      }
      if (status.state === 'RECOVERY_REQUIRED' || status.state === 'BLOCKED' || status.state === 'UNKNOWN') {
        updateRequestInFlight.current = false
        setUpdateState({ kind: 'recovery', version: targetVersion })
        return
      }
      if (status.state === 'FAILED_SAFE' || status.state === 'CANCELLED') {
        updateRequestInFlight.current = false
        setUpdateState({ kind: 'error', reason: 'update' })
        return
      }
    } catch {
      // A transport failure is never update success. Keep the durable job hint for reconnect.
    }
    pollAttempts.current += 1
    if (pollAttempts.current >= maxPollAttempts) {
      updateRequestInFlight.current = false
      setUpdateState({ kind: 'recovery', version: targetVersion })
      return
    }
    pollTimer.current = setTimeout(() => void pollCoordinatorJob(jobId, targetVersion, requestId), pollIntervalMs)
  }

  async function checkForUpdates() {
    setUpdateState({ kind: 'checking' })
    try {
      const response = await fetch('/api/update/status', { cache: 'no-store' })
      if (!response.ok) throw new Error('Update status unavailable')
      const status = parseUpdateStatus(await response.json())
      if (!status) throw new Error('Invalid update status')
      setUpdateState({ kind: 'ready', status })
    } catch {
      setUpdateState({ kind: 'error', reason: 'check' })
    }
  }

  async function startUpdate(status: UpdateStatus) {
    if (!status.updateAvailable || updateRequestInFlight.current) return
    if (!coordinatorUiEnabled) { setUpdateState({ kind: 'error', reason: 'disabled' }); return }
    updateRequestInFlight.current = true
    pollAttempts.current = 0
    setUpdateState({ kind: 'updating', version: status.latestVersion })
    const requestId = crypto.randomUUID()
    try {
      const response = await fetch('/api/update/coordinator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: status.latestVersion, requestId }),
      })
      const body = await response.json().catch(() => null) as { error?: string; jobId?: string; requestId?: string } | null
      if (response.status === 202 && body?.jobId && body.requestId === requestId) {
        sessionStorage.setItem(coordinatorSessionKey, JSON.stringify({ jobId: body.jobId, requestId, version: status.latestVersion }))
        await pollCoordinatorJob(body.jobId, status.latestVersion, requestId)
        return
      }
      updateRequestInFlight.current = false
      const error = body?.error
      if (error === 'AGENT_AUTHENTICATION_FAILED') setUpdateState({ kind: 'error', reason: 'auth' })
      else if (error === 'AGENT_UNAVAILABLE') setUpdateState({ kind: 'error', reason: 'unavailable' })
      else if (error === 'VERSION_NOT_NEWER') setUpdateState({ kind: 'error', reason: 'current' })
      else if (error === 'UPDATE_IN_PROGRESS') setUpdateState({ kind: 'error', reason: 'in_progress' })
      else setUpdateState({ kind: 'error', reason: 'update' })
    } catch { updateRequestInFlight.current = false; setUpdateState({ kind: 'error', reason: 'unavailable' }) }
  }

  async function loadHistory(page = 1) {
    setHistoryState({ kind: 'loading' })
    try {
      const response = await fetch(`/api/update/history?page=${page}&pageSize=5`, { cache: 'no-store' })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (response.status === 503 && body?.error === 'HISTORY_UNAVAILABLE') {
        setSelectedHistory(null)
        setHistoryState({ kind: 'unavailable' })
        return
      }
      const history = response.ok ? parseUpdateHistoryPage(body) : null
      if (!history) throw new Error('History unavailable')
      setSelectedHistory((current) => history.items.find((item) => item.jobId === current?.jobId) || null)
      setHistoryState({ kind: 'ready', ...history })
    } catch { setHistoryState({ kind: 'error' }) }
  }

  async function downloadDiagnostic(job: UpdateHistoryItem) {
    try {
      const response = await fetch(`/api/update/jobs/${encodeURIComponent(job.jobId)}/diagnostic`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Diagnostic unavailable')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'edc-update-diagnostic.json'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch { setHistoryState({ kind: 'error' }) }
  }

  function historyLabel(state: UpdateHistoryState) {
    return ({ PENDING: '대기', RUNNING: '진행 중', BLOCKED: '차단됨', RECOVERY_REQUIRED: '복구 확인 필요',
      FAILED_SAFE: '안전 중단', COMPLETED: '완료', CANCELLED: '취소', UNKNOWN: '상태 불명' })[state]
  }

  return <dialog ref={dialog} className="modal help-dialog" aria-labelledby="help-title" aria-describedby="help-description"
    onCancel={onClose} onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className="panel-head"><div><h2 id="help-title">EDC Help</h2><p id="help-description">메뉴별 기능을 안내합니다.</p></div>
      <button autoFocus type="button" className="icon-btn" aria-label="Close Help" onClick={onClose}><X size={18} /></button>
    </div>
    <dl className="help-guides">{guides.map((guide) => <div key={guide.name}><dt>{guide.name} {guide.admin && <span className="status-pill neutral">관리자 전용</span>}</dt><dd>{guide.description}</dd></div>)}</dl>
    <dl className="help-system"><div><dt>EDC Version</dt><dd>{version}</dd></div><div><dt>Site</dt><dd>{site}</dd></div></dl>
    <section className="help-update" aria-live="polite" aria-label="EDC 업데이트 상태">
      <div className="help-update-heading">
        <div><strong>업데이트 상태</strong></div>
        <button type="button" className="outline-btn" disabled={updateState.kind === 'checking' || updateState.kind === 'updating'} onClick={() => void checkForUpdates()}>
          {updateState.kind === 'checking' ? '확인 중...' : '업데이트 확인'}
        </button>
      </div>
      {updateState.kind === 'idle' && <p>필요할 때 최신 EDC 버전을 확인할 수 있습니다.</p>}
      {updateState.kind === 'checking' && <p>업데이트 확인 중...</p>}
      {updateState.kind === 'error' && updateState.reason === 'check' && <p className="help-update-error">업데이트 정보를 확인할 수 없습니다.</p>}
      {updateState.kind === 'error' && updateState.reason === 'auth' && <p className="help-update-error">업데이트 서버 인증에 실패했습니다.</p>}
      {updateState.kind === 'error' && updateState.reason === 'unavailable' && <p className="help-update-error">업데이트 서버에 연결할 수 없습니다.</p>}
      {updateState.kind === 'error' && updateState.reason === 'current' && <p>이미 최신 버전을 사용하고 있습니다.</p>}
      {updateState.kind === 'error' && updateState.reason === 'in_progress' && <p>이미 업데이트가 진행 중입니다.</p>}
      {updateState.kind === 'error' && updateState.reason === 'update' && <p className="help-update-error">업데이트를 시작하지 못했습니다.<br />잠시 후 다시 시도해 주세요.</p>}
      {updateState.kind === 'error' && updateState.reason === 'disabled' && <p className="help-update-error">안전한 업데이트 Coordinator가 아직 활성화되지 않았습니다.</p>}
      {updateState.kind === 'recovery' && <p className="help-update-error">업데이트 상태를 자동 확정할 수 없습니다. 관리자 복구 검토가 필요하며 자동 재시도하지 않습니다.</p>}
      {updateState.kind === 'ready' && !updateState.status.updateAvailable && <div className="help-update-result good">
        <span>최신 버전 {displayVersion(updateState.status.latestVersion)}</span>
        <strong>최신 버전을 사용하고 있습니다.</strong>
      </div>}
      {updateState.kind === 'ready' && updateState.status.updateAvailable && <div className="help-update-result available">
        <span>최신 버전 {displayVersion(updateState.status.latestVersion)}</span>
        <strong>새로운 버전이 있습니다: {displayVersion(updateState.status.latestVersion)}</strong>
        <button type="button" className="primary-btn" disabled={!coordinatorUiEnabled} onClick={() => void startUpdate(updateState.status)}>업데이트</button>
      </div>}
      {updateState.kind === 'updating' && <div className="help-update-result available">
        <strong>업데이트 중...</strong>
        <span>{displayVersion(updateState.version)} 업데이트를 준비하고 있습니다.</span>
        <button type="button" className="primary-btn" disabled>업데이트</button>
      </div>}
      {updateState.kind === 'success' && <div className="help-update-result good">
        <strong>업데이트를 시작했습니다.</strong>
        <span>잠시 후 EDC가 새 버전 {displayVersion(updateState.version)}으로 다시 시작됩니다.</span>
        {updateState.connectionLost && <small>업데이트 요청 후 서버 연결이 끊겼습니다. 이는 재시작 과정에서 발생할 수 있습니다.</small>}
        <small>잠시 후 페이지를 새로고침하거나 다시 접속해 주세요.</small>
        <button type="button" className="outline-btn" onClick={() => window.location.reload()}>페이지 새로고침</button>
      </div>}
    </section>
    <section className="help-update update-history" aria-live="polite" aria-label="Update History">
      <div className="help-update-heading">
        <div><strong>Update History</strong><small>현재 병원의 영속 작업 기록만 표시합니다.</small></div>
        <button type="button" className="outline-btn" disabled={historyState.kind === 'loading'} onClick={() => void loadHistory(1)}>
          {historyState.kind === 'loading' ? '조회 중...' : '기록 조회'}
        </button>
      </div>
      {historyState.kind === 'idle' && <p>관리자 권한으로 업데이트 작업 기록을 조회할 수 있습니다.</p>}
      {historyState.kind === 'unavailable' && <p className="help-update-error">운영 Journal 조회 기능이 아직 연결되지 않았습니다. Mock 기록은 표시하지 않습니다.</p>}
      {historyState.kind === 'error' && <p className="help-update-error">기록을 안전하게 확인할 수 없습니다. 업데이트 결과로 해석하지 않습니다.</p>}
      {historyState.kind === 'ready' && historyState.items.length === 0 && <p>확인된 업데이트 기록이 없습니다.</p>}
      {historyState.kind === 'ready' && historyState.items.length > 0 && <div className="update-history-list">
        {historyState.items.map((job) => <button type="button" key={job.jobId}
          className={`update-history-row${selectedHistory?.jobId === job.jobId ? ' selected' : ''}`}
          onClick={() => setSelectedHistory(job)}>
          <span><strong>{job.jobId.slice(0, 12)}</strong><small>{new Date(job.requestedAt).toLocaleString('ko-KR')}</small></span>
          <span>{job.previousVersion || '미확인'} → {job.targetVersion}</span>
          <span className={`status-pill history-${job.state.toLowerCase()}`}>{historyLabel(job.state)}</span>
        </button>)}
        <div className="update-history-pages">
          <button type="button" className="outline-btn" disabled={historyState.page <= 1} onClick={() => void loadHistory(historyState.page - 1)}>이전</button>
          <span>{historyState.page} / {Math.max(1, Math.ceil(historyState.total / historyState.pageSize))}</span>
          <button type="button" className="outline-btn" disabled={historyState.page * historyState.pageSize >= historyState.total} onClick={() => void loadHistory(historyState.page + 1)}>다음</button>
        </div>
      </div>}
      {selectedHistory && <div className="update-history-detail">
        <div><strong>작업 상세</strong><span>{selectedHistory.hospital} · {historyLabel(selectedHistory.state)}</span></div>
        {selectedHistory.errorCode && <p>오류 코드: <code>{selectedHistory.errorCode}</code></p>}
        {selectedHistory.manualReviewRequired && <p className="help-update-error">관리자 확인이 필요합니다. 자동 재시도하지 않습니다.</p>}
        {selectedHistory.stages.length === 0 ? <p>Journal에 기록된 단계 정보가 없습니다.</p>
          : <ol>{selectedHistory.stages.map((stage, index) => <li key={`${stage.code}-${index}`}>
            <span>{stage.code}</span><strong>{stage.status}</strong>{stage.at && <small>{new Date(stage.at).toLocaleString('ko-KR')}</small>}
          </li>)}</ol>}
        <button type="button" className="outline-btn" onClick={() => void downloadDiagnostic(selectedHistory)}>진단 JSON 내보내기</button>
      </div>}
    </section>
  </dialog>
}
