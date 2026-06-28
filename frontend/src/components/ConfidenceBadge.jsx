import { CONF_META } from '../utils/constants'

export default function ConfidenceBadge({ confidence, size = 'md', pulse = true }) {
  const meta = CONF_META[confidence] || CONF_META.low
  const dotSize = size === 'sm' ? 7 : 8

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      fontSize: size === 'sm' ? 10 : 11,
      fontWeight: 700, letterSpacing: '.08em',
      color: meta.color,
      border: `1px solid ${meta.color}44`,
      background: `${meta.color}18`,
      padding: size === 'sm' ? '3px 8px' : '5px 11px',
      borderRadius: 999,
    }}>
      <span style={{
        width: dotSize, height: dotSize, borderRadius: '50%',
        background: meta.color,
        boxShadow: `0 0 8px ${meta.color}`,
        display: 'inline-block',
        flexShrink: 0,
        ...(pulse ? { animation: 'pulseGlow 2s ease-in-out infinite' } : {})
      }} />
      {meta.text}
    </span>
  )
}
