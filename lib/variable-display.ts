export function variableDisplay(rule: { variableKey: string; label: string; section: string }) {
  const codeFirst = rule.section === '검사결과' || ['bmi', 'sbp', 'dbp', 'pta'].includes(rule.variableKey)
  const note = rule.variableKey === 'pta' ? rule.label.match(/\([^)]*T1[^)]*\)/)?.[0] || '' : ''
  return { primary: codeFirst ? rule.variableKey : rule.label, secondary: codeFirst ? rule.label.replace(note, '').trim() : rule.variableKey, note }
}

export function orderedGroups(groups: string[]) {
  return [...groups.filter((group) => group !== '기타'), ...groups.filter((group) => group === '기타')]
}
