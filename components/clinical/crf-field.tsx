'use client'

import { categoryChoices, type FieldMetadata } from '@/lib/crf-metadata'
import { handleFieldEnter } from '@/lib/field-navigation'

export function CrfField({ rule, cellKey, value, hasQuery, queryId, onChange, disabled = false, readOnly = false }: {
  rule: FieldMetadata; cellKey: string; value: string;
  disabled?: boolean; readOnly?: boolean;
  hasQuery: boolean; queryId?: string; onChange: (value: string) => void;
}) {
  const choices = categoryChoices(rule)
  const numeric = ['integer', 'real'].includes(rule.dataType) || (rule.dataType === 'character' && (rule.minValue != null || rule.maxValue != null))
  const placeholder = numeric
    ? rule.inputGuide.trim() || (rule.minValue != null || rule.maxValue != null
      ? `${rule.minValue ?? '제한 없음'}–${rule.maxValue ?? '제한 없음'}${rule.unitOrFormat ? ` ${rule.unitOrFormat}` : ''}`
      : rule.dataType === 'integer' ? '정수 입력' : '숫자 입력')
    : undefined
  const shared = {
    'data-crf-entry': true,
    disabled, readOnly,
    id: cellKey, name: rule.variableKey, className: 'value-input', value,
    'aria-label': `${rule.label} ${cellKey.slice(-2)}`, 'aria-invalid': hasQuery,
    'aria-describedby': hasQuery ? queryId : undefined,
  }
  return <div className="crf-field">
    {rule.dataType === 'categorical' ? <select {...shared} onChange={(event) => onChange(event.target.value)}>
      <option value="">선택</option>
      {value && !choices.some((choice) => choice.code === value) && <option value={value} disabled>기존 값: {value} (확인 필요)</option>}
      {choices.map(({ code, label }) => <option key={code} value={code}>{code} = {label}</option>)}
    </select> : <input {...shared} onKeyDown={handleFieldEnter} type={rule.dataType === 'datetime' ? 'date' : numeric ? 'number' : 'text'}
      min={numeric ? rule.minValue ?? undefined : undefined} max={numeric ? rule.maxValue ?? undefined : undefined}
      placeholder={placeholder} step={rule.dataType === 'integer' ? 1 : 'any'} onChange={(event) => onChange(event.target.value)} />}
  </div>
}
