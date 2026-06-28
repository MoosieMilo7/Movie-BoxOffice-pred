export function fmtM(val) {
  if (val == null) return '—'
  if (val >= 1000) return `$${(val / 1000).toFixed(2)}B`
  if (val >= 1)    return `$${val.toFixed(0)}M`
  return `$${(val * 1000).toFixed(0)}K`
}

export function fmtRange(low, high) {
  if (low == null || high == null) return '—'
  return `${fmtM(low)} – ${fmtM(high)}`
}

export function fmtDate(str) {
  if (!str) return 'TBD'
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtNum(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString()
}

export function daysUntil(str) {
  if (!str) return null
  return Math.ceil((new Date(str) - Date.now()) / 86_400_000)
}

export function timeAgo(str) {
  if (!str) return '—'
  const diff = Date.now() - new Date(str)
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function posterUrl(path, size = 'w500') {
  if (!path) return null
  return `https://image.tmdb.org/t/p/${size}${path}`
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}
