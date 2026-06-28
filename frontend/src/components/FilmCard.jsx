import { useState } from 'react'
import { motion } from 'framer-motion'
import { MARKET_META, CONF_META } from '../utils/constants'
import { fmtRange, posterUrl } from '../utils/format'

export default function FilmCard({ film, onClick }) {
  const [imgError, setImgError] = useState(false)
  const market = film.market?.toLowerCase()
  const meta   = MARKET_META[market] || MARKET_META.hollywood
  const conf   = CONF_META[film.confidence] || CONF_META.low
  const poster = !imgError && film.poster_path ? posterUrl(film.poster_path, 'w342') : null
  const owLow  = film.global_ow_low  ?? film.opening_weekend?.global?.low_usd
  const owHigh = film.global_ow_high ?? film.opening_weekend?.global?.high_usd

  return (
    <motion.div
      onClick={onClick}
      whileHover={{ y: -8, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      style={{ flexShrink: 0, width: 175, cursor: 'pointer', scrollSnapAlign: 'start' }}
    >
      {/* Poster */}
      <motion.div
        whileHover={{ boxShadow: `0 24px 56px ${meta.color}55` }}
        style={{
          width: 175, height: 263, borderRadius: 12,
          overflow: 'hidden', position: 'relative',
          border: '1px solid rgba(255,255,255,.07)',
          background: poster ? '#0A0A0F' : `linear-gradient(145deg, ${meta.color}33 0%, #0A0A0F 100%)`,
        }}
      >
        {poster && (
          <img
            src={poster}
            alt={film.title}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}

        {/* Market badge */}
        <div style={{
          position: 'absolute', top: 10, left: 10,
          fontSize: 8, fontWeight: 800, letterSpacing: '.12em',
          background: 'rgba(0,0,0,.55)',
          border: `1px solid ${meta.color}66`,
          color: meta.color,
          padding: '3px 7px', borderRadius: 5,
        }}>
          {meta.label}
        </div>

        {/* Bottom gradient overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,.85) 100%)',
        }} />

        {/* Confidence dot bottom-right */}
        <div style={{
          position: 'absolute', bottom: 11, right: 11,
          width: 9, height: 9, borderRadius: '50%',
          background: conf.color,
          boxShadow: `0 0 10px ${conf.color}`,
          animation: 'pulseGlow 2s ease-in-out infinite',
        }} />
      </motion.div>

      {/* Below poster */}
      <div style={{ padding: '10px 2px 0' }}>
        <div style={{
          fontSize: 13, fontWeight: 600, lineHeight: 1.3,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          color: '#E6E6F0',
        }}>
          {film.title}
        </div>
        <div style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12, fontWeight: 700,
          color: owLow ? '#4D8DFF' : '#6B6B7B',
          marginTop: 4,
        }}>
          {owLow ? fmtRange(owLow, owHigh) : 'Projection pending'}
        </div>
      </div>
    </motion.div>
  )
}
