'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { displayVersion, parseUpdateStatus, type UpdateStatus } from '@/lib/update-status'

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
  const [updateState, setUpdateState] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'ready'; status: UpdateStatus }
    | { kind: 'updating'; version: string }
    | { kind: 'success'; version: string; connectionLost: boolean }
    | { kind: 'error'; reason: 'check' | 'auth' | 'unavailable' | 'current' | 'in_progress' | 'update' }
  >({ kind: 'idle' })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => previous?.focus()
  }, [])

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
    updateRequestInFlight.current = true
    setUpdateState({ kind: 'updating', version: status.latestVersion })
    try {
      const response = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: status.latestVersion }),
      })
      const body = await response.json().catch(() => null) as { error?: string; version?: string } | null
      if (response.ok && body?.version === status.latestVersion) {
        setUpdateState({ kind: 'success', version: status.latestVersion, connectionLost: false })
        return
      }
      updateRequestInFlight.current = false
      const error = body?.error
      if (error === 'AGENT_AUTHENTICATION_FAILED') setUpdateState({ kind: 'error', reason: 'auth' })
      else if (error === 'AGENT_UNAVAILABLE') setUpdateState({ kind: 'error', reason: 'unavailable' })
      else if (error === 'VERSION_NOT_NEWER') setUpdateState({ kind: 'error', reason: 'current' })
      else if (error === 'UPDATE_IN_PROGRESS') setUpdateState({ kind: 'error', reason: 'in_progress' })
      else setUpdateState({ kind: 'error', reason: 'update' })
    } catch {
      // The EDC process can disconnect while its container is being replaced.
      setUpdateState({ kind: 'success', version: status.latestVersion, connectionLost: true })
    }
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
      {updateState.kind === 'ready' && !updateState.status.updateAvailable && <div className="help-update-result good">
        <span>최신 버전 {displayVersion(updateState.status.latestVersion)}</span>
        <strong>최신 버전을 사용하고 있습니다.</strong>
      </div>}
      {updateState.kind === 'ready' && updateState.status.updateAvailable && <div className="help-update-result available">
        <span>최신 버전 {displayVersion(updateState.status.latestVersion)}</span>
        <strong>새로운 버전이 있습니다: {displayVersion(updateState.status.latestVersion)}</strong>
        <button type="button" className="primary-btn" onClick={() => void startUpdate(updateState.status)}>업데이트</button>
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
  </dialog>
}
