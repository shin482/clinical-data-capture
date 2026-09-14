'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { appConfig } from '@/lib/app-config'

const guides = [
  { name: 'Dashboard', description: '등록 대상자 수와 Query, 데이터 입력 진행률을 확인합니다.' },
  { name: 'Subjects', description: '대상자별 연구 데이터를 입력하거나 수정합니다.' },
  { name: 'Queries', description: '발생한 Query를 확인하고 해당 입력 항목으로 이동합니다.' },
  { name: 'Export', description: '연구 데이터를 Excel 파일로 내보냅니다.' },
  { name: 'Rule Master', description: '데이터 검증 규칙을 관리합니다.', admin: true },
  { name: 'Audit Trail', description: '데이터 변경 이력을 확인합니다.', admin: true },
  { name: 'User Management', description: '사용자 및 권한 관리 메뉴입니다. 현재 준비 중입니다.', admin: true },
]

export function HelpModal({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => previous?.focus()
  }, [])
  return <dialog ref={dialog} className="modal help-dialog" aria-labelledby="help-title" aria-describedby="help-description"
    onCancel={onClose} onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className="panel-head"><div><h2 id="help-title">EDC Help</h2><p id="help-description">메뉴별 기능을 안내합니다.</p></div>
      <button autoFocus type="button" className="icon-btn" aria-label="Close Help" onClick={onClose}><X size={18} /></button>
    </div>
    <dl className="help-guides">{guides.map((guide) => <div key={guide.name}><dt>{guide.name} {guide.admin && <span className="status-pill neutral">Admin only</span>}</dt><dd>{guide.description}</dd></div>)}</dl>
    <dl className="help-system"><div><dt>EDC Version</dt><dd>{appConfig.version}</dd></div><div><dt>Site</dt><dd>{appConfig.site}</dd></div></dl>
  </dialog>
}
