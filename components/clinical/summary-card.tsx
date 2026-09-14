export function SummaryCard({ label, value, detail, tone = 'teal', onClick }: {
  label: string; value: number; detail: string; tone?: string; onClick?: () => void;
}) {
  const content = <><div className={`metric-mark ${tone}`} /><div><p className="eyebrow">{label}</p><p className="metric-value">{value}</p><p className="metric-detail">{detail}</p></div></>
  return onClick ? <button type="button" className="metric summary-card metric-button" onClick={onClick}>{content}</button>
    : <div className="metric summary-card">{content}</div>
}
