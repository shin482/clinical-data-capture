import { NextResponse } from 'next/server'
import { db, rowToVariable } from '@/lib/db'
import { studyVariables } from '@/lib/study-schema'
import { updateStudyVariableJson } from '@/lib/rule-sync'

export async function PATCH(request: Request, context: { params: Promise<{ variableKey: string }> }) {
  const { variableKey } = await context.params
  const input = await request.json() as Record<string, unknown>
  const canonical = studyVariables.find((variable) => variable.variableKey === variableKey)
  if (!canonical) return NextResponse.json({ error: 'Variable is not in the study schema' }, { status: 404 })
  for (const key of ['variableKey', 'label', 'timepointT1', 'timepointT2', 'timepointT3'] as const) {
    if (input[key] !== undefined && input[key] !== canonical[key]) return NextResponse.json({ error: 'Name, label and visits are defined by the authoritative Excel schema' }, { status: 409 })
  }
  const current = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=?').get(variableKey) as Record<string, unknown> | undefined
  if (!current) return NextResponse.json({ error: 'Variable not found' }, { status: 404 })
  const clinicalData = db().prepare('SELECT 1 FROM clinical_values WHERE variable_key=? LIMIT 1').get(variableKey)
  const nextKey = String(input.variableKey || variableKey).trim()
  if (clinicalData && nextKey !== variableKey) return NextResponse.json({ error: 'Variable key cannot change while clinical data exists' }, { status: 409 })
  const fields: Record<string, unknown> = { label: input.label, section: input.section, data_type: input.dataType, unit_or_format: input.unitOrFormat, category_options: input.categoryOptions, min_value: input.minValue === '' ? null : input.minValue, max_value: input.maxValue === '' ? null : input.maxValue, na_rule_raw: input.naRuleRaw, parents: input.parents, active_values: input.activeValues, allow_blank: input.allowBlank ? 1 : 0, allow_unknown_99: input.allowUnknown99 ? 1 : 0, group_name: input.groupName, group_type: input.groupType, group_parent: input.groupParent, group_active_value: input.groupActiveValue, enabled: input.enabled === false ? 0 : 1, timepoint_t1: input.timepointT1 === undefined ? undefined : input.timepointT1 ? 1 : 0, timepoint_t2: input.timepointT2 === undefined ? undefined : input.timepointT2 ? 1 : 0, timepoint_t3: input.timepointT3 === undefined ? undefined : input.timepointT3 ? 1 : 0, emr_location: input.emrLocation, input_guide: input.inputGuide, display_order: input.displayOrder }
  const updates = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (nextKey !== variableKey) updates.push(['variable_key', nextKey])
  const before = current
  try {
    db().prepare(`UPDATE variable_definitions SET ${updates.map(([key]) => `${key}=@${key}`).join(', ')} WHERE variable_key=@whereKey`).run(Object.fromEntries([...updates, ['whereKey', variableKey]]))
    const updatedRow = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=?').get(nextKey) as Record<string, unknown>
    const updated = rowToVariable(updatedRow)
    updateStudyVariableJson(variableKey, updated)
    return NextResponse.json(updated)
  } catch (error) {
    const columns = Object.keys(before)
    db().prepare(`UPDATE variable_definitions SET ${columns.map((key) => `${key}=@${key}`).join(', ')} WHERE id=@id`).run(before)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Rule synchronization failed' }, { status: 500 })
  }
}
