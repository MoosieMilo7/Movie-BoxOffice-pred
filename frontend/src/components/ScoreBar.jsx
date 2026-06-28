import { useEffect, useRef, useState } from 'react'
import { ACCENT } from '../utils/constants'

export default function ScoreBar({ label, value, color = ACCENT, delay = 0, showVal = true, height = 7 }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true) }, { threshold: 0.1 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const pct = Math.round((value || 0) * 100)

  return (
    <div ref={ref} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: '#A0A0B0' }}>{label}</span>
        {showVal && (
          <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700, color: '#fff' }}>
            {(value || 0).toFixed(2)}
          </span>
        )}
      </div>
      <div style={{ height, background: '#22222E', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: 4,
          transformOrigin: 'left',
          transition: visible ? `transform 1s cubic-bezier(.2,.8,.2,1) ${delay}ms` : 'none',
          transform: visible ? 'scaleX(1)' : 'scaleX(0)',
        }} />
      </div>
    </div>
  )
}
