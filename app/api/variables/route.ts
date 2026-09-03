import { NextResponse } from 'next/server'
import { db, rowToVariable } from '@/lib/db'
import '@/lib/db/seed'

export function GET() {
  const rows = db().prepare('SELECT * FROM variable_definitions ORDER BY display_order').all() as Record<string, unknown>[]
  return NextResponse.json(rows.map(rowToVariable))
}

export async function POST(request: Request) {
  try {
    const input = await request.json() as Record<string, unknown>
    const key = String(input.variableKey || '').trim()
    const label = String(input.label || '').trim()
    if (!key || !label) return NextResponse.json({ error: 'variableKey and label are required' }, { status: 400 })
    db().prepare(`INSERT INTO variable_definitions (variable_key,label,section,data_type,unit_or_format,category_options,min_value,max_value,na_rule_raw,parents,active_values,allow_blank,allow_unknown_99,group_name,group_type,group_parent,group_active_value,enabled,timepoint_t1,timepoint_t2,timepoint_t3,emr_location,input_guide,display_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT MAX(display_order)+1 FROM variable_definitions),0))`).run(key, label, input.section || '기타', input.dataType || 'character', input.unitOrFormat || '', input.categoryOptions || '', input.minValue === '' ? null : input.minValue ?? null, input.maxValue === '' ? null : input.maxValue ?? null, input.naRuleRaw || '', input.parents || '', input.activeValues || '', input.allowBlank ? 1 : 0, input.allowUnknown99 ? 1 : 0, input.groupName || '', input.groupType || '', input.groupParent || '', input.groupActiveValue || '', input.enabled === false ? 0 : 1, input.timepointT1 === false ? 0 : 1, input.timepointT2 === false ? 0 : 1, input.timepointT3 === false ? 0 : 1, input.emrLocation || '', input.inputGuide || '')
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create variable' }, { status: 400 })
  }
}