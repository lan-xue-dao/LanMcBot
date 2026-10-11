export function formatKickReason(reason) {
  if (typeof reason === 'string') return reason
  if (Array.isArray(reason)) return reason.map(formatKickReason).join(' | ')
  if (reason && typeof reason === 'object') {
    const extras = reason.extra
    if (Array.isArray(extras)) return formatKickReason(extras)
    return reason.text || JSON.stringify(reason)
  }
  return String(reason)
}
