import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { MARKET_META, CONF_META, ACCENT } from '../utils/constants'
import { fmtRange, fmtDate, posterUrl, daysUntil } from '../utils/format'
import ConfidenceBadge from './ConfidenceBadge'
import ScoreBar from './ScoreBar'

export default function Hero({ featuredFilm, featuredPrediction, onFilmClick }) {
  const [imgLoaded, setImgLoaded] = useState(false)

  if (!featuredFilm) return <HeroSkeleton />

  const film       = featuredFilm
  const prediction = featuredPrediction
  const market     = MARKET_META[film.market?.toLowerCase()] || MARKET_META.hollywood
  const conf       = CONF_META[prediction?.confidence] || CONF_META.low
  const ow         = prediction?.opening_weekend
  const owGlobal   = ow?.global
  const scores     = prediction?.score_breakdown
  const days       = daysUntil(film.release_date)
  const genres     = Array.isArray(film.genres) ? film.genres : []

  const bgPoster = film.poster_path ? posterUrl(film.poster_path, 'original') : null

  return (
    <div style={{ position: 'relative', height: '100vh', minHeight: 660, overflow: 'hidden' }}>

      {/* Background */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(80% 60% at 25% 20%, ${market.color}44, transparent 60%),
                     radial-gradient(60% 80% at 80% 80%, ${market.color}28, transparent 55%),
                     linear-gradient(180deg, #191926, #0A0A0F)`,
      }} />

      {/* Blurred poster if available */}
      {bgPoster && (
        <img
          src={bgPoster}
          alt=""
          onLoad={() => setImgLoaded(true)}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'cover',
            filter: 'blur(18px) brightness(0.28) saturate(1.4)',
            transform: 'scale(1.08)',
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 1s ease',
          }}
        />
      )}

      {/* Gradient overlays */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(10,10,15,.28) 0%, rgba(10,10,15,0) 25%, rgba(10,10,15,.55) 60%, #0A0A0F 100%)',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, rgba(10,10,15,.8) 0%, rgba(10,10,15,0) 50%)',
      }} />

      {/* Huge ghosted title right side */}
      <div style={{
        position: 'absolute', right: '3%', top: '14%',
        fontSize: 'clamp(100px, 13vw, 200px)',
        fontWeight: 900, letterSpacing: '-.04em', lineHeight: .9,
        color: 'rgba(255,255,255,.03)', textTransform: 'uppercase',
        textAlign: 'right', maxWidth: '60%', pointerEvents: 'none',
      }}>
        {film.title}
      </div>

      {/* Main content — bottom left */}
      <div style={{
        position: 'absolute', left: 48, bottom: 60, maxWidth: 620, zIndex: 2,
      }}>
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .1, duration: .6 }}>
          {/* Label */}
          <div style={{ fontSize: 11, letterSpacing: '.26em', fontWeight: 700, color: '#A0A0B0', marginBottom: 14 }}>
            MOST ANTICIPATED
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 'clamp(46px, 5.5vw, 78px)',
            fontWeight: 900, lineHeight: .95, letterSpacing: '-.028em',
            margin: '0 0 16px', textShadow: '0 4px 40px rgba(0,0,0,.5)',
          }}>
            {film.title}
          </h1>

          {/* Meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#A0A0B0', fontSize: 14, marginBottom: 14 }}>
            {film.release_date && <span>{fmtDate(film.release_date)}</span>}
            {film.runtime      && <><span style={{ opacity: .3 }}>·</span><span>{film.runtime}m</span></>}
            {film.mpaa_rating  && <><span style={{ opacity: .3 }}>·</span><span style={{ border: '1px solid #3A3A4E', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>{film.mpaa_rating}</span></>}
            {days !== null && days > 0 && <><span style={{ opacity: .3 }}>·</span><span>{days} days out</span></>}
          </div>

          {/* Genre pills */}
          {genres.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
              {genres.slice(0, 4).map(g => (
                <span key={g} style={{
                  fontSize: 12, fontWeight: 600,
                  border: '1px solid rgba(255,255,255,.15)',
                  borderRadius: 999, padding: '5px 14px', color: '#E6E6F0',
                  background: 'rgba(19,19,26,.6)',
                  backdropFilter: 'blur(8px)',
                }}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {/* OW Projection */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: '.22em', fontWeight: 700, color: '#A0A0B0', marginBottom: 8 }}>
              PROJECTED OPENING WEEKEND
            </div>
            {owGlobal ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: .4 }}
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: 'clamp(38px, 4.5vw, 58px)',
                  fontWeight: 700, letterSpacing: '-.02em',
                  color: ACCENT, lineHeight: 1, marginBottom: 10,
                }}
              >
                {fmtRange(owGlobal.low_usd, owGlobal.high_usd)}
              </motion.div>
            ) : (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 48, color: '#3A3A4E', marginBottom: 10 }}>
                Analyzing...
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <span style={{ fontSize: 14, color: '#A0A0B0' }}>Global</span>
              <span style={{ opacity: .3 }}>·</span>
              <ConfidenceBadge confidence={prediction?.confidence} />
            </div>
          </div>

          {/* CTA */}
          <motion.button
            onClick={() => onFilmClick(film.tmdb_id)}
            whileHover={{ scale: 1.03, boxShadow: `0 16px 48px ${ACCENT}55` }}
            whileTap={{ scale: 0.97 }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 9,
              background: ACCENT, color: '#fff',
              fontWeight: 700, fontSize: 14, letterSpacing: '.04em',
              padding: '14px 28px', borderRadius: 12, border: 'none', cursor: 'pointer',
              boxShadow: `0 10px 36px ${ACCENT}44`,
              fontFamily: 'inherit',
            }}
          >
            VIEW FULL ANALYSIS <ChevronRight size={18} />
          </motion.button>
        </motion.div>
      </div>

      {/* Signal index — bottom right */}
      {scores && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: .5, duration: .6 }}
          style={{
            position: 'absolute', right: 48, bottom: 60, width: 260, zIndex: 2,
            background: 'rgba(19,19,26,.55)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(42,42,58,.65)',
            borderRadius: 14, padding: '18px 22px',
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: '.2em', color: '#6B6B7B', fontWeight: 700, marginBottom: 16 }}>
            SIGNAL INDEX
          </div>
          {[
            ['STRUCTURAL', scores.structural, 0],
            ['SENTIMENT',  scores.sentiment,  100],
            ['MOMENTUM',   scores.momentum,   200],
          ].map(([label, val, delay]) => (
            <ScoreBar key={label} label={label} value={val} delay={delay} height={5} />
          ))}
        </motion.div>
      )}
    </div>
  )
}

function HeroSkeleton() {
  return (
    <div style={{ height: '100vh', minHeight: 660, background: 'linear-gradient(180deg,#191926,#0A0A0F)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ padding: '0 48px 60px', width: 600 }}>
        {[180, 280, 140, 320, 60].map((w, i) => (
          <div key={i} style={{
            height: i === 1 ? 56 : i === 3 ? 48 : 14,
            width: w, background: '#22222E', borderRadius: 8, marginBottom: 18,
            animation: 'pulseSkeleton 1.4s ease-in-out infinite',
          }} />
        ))}
      </div>
    </div>
  )
}
