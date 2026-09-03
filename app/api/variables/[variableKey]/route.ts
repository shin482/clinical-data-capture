import { NextResponse } from 'next/server'
import { db, rowToVariable } from '@/lib/db'

export async function PATCH(request: Request, context: { params: Promise<{ variableKey: string }> }) {
  const { variableKey } = await context.params
  const input = await request.json() as Record<string, unknown>
  const current = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=?').get(variableKey) as Record<string, unknown> | undefined
  if (!current) return NextResponse.json({ error: 'Variable not found' }, { status: 404 })
  const clinicalData = db().prepare('SELECT 1 FROM clinical_values WHERE variable_key=? LIMIT 1').get(variableKey)
  const nextKey = String(input.variableKey || variableKey).trim()
  if (clinicalData && nextKey !== variableKey) return NextResponse.json({ error: 'Variable key cannot change while clinical data exists' }, { status: 409 })
  const fields: Record<string, unknown> = { label: input.label, section: input.section, data_type: input.dataType, unit_or_format: input.unitOrFormat, category_options: input.categoryOptions, min_value: input.minValue === '' ? null : input.minValue, max_value: input.maxValue === '' ? null : input.maxValue, na_rule_raw: input.naRuleRaw, parents: input.parents, active_values: input.activeValues, allow_blank: input.allowBlank ? 1 : 0, allow_unknown_99: input.allowUnknown99 ? 1 : 0, group_name: input.groupName, group_type: input.groupType, group_parent: input.groupParent, group_active_value: input.groupActiveValue, enabled: input.enabled === false ? 0 : 1, timepoint_t1: input.timepointT1 === false ? 0 : 1, timepoint_t2: input.timepointT2 === false ? 0 : 1, timepoint_t3: input.timepointT3 === false ? 0 : 1, emr_location: input.emrLocation, input_guide: input.inputGuide, display_order: input.displayOrder }
  const updates = Object.entries(fields).filter(([, value]) => value !== undefined)
  if (nextKey !== variableKey) updates.push(['variable_key', nextKey])
  db().prepare(`UPDATE variable_definitions SET ${updates.map(([key]) => `${key}=@${key}`).join(', ')} WHERE variable_key=@whereKey`).run(Object.fromEntries([...updates, ['whereKey', variableKey]]))
  const updated = db().prepare('SELECT * FROM variable_definitions WHERE variable_key=?').get(nextKey) as Record<string, unknown>
  return NextResponse.json(rowToVariable(updated))
}