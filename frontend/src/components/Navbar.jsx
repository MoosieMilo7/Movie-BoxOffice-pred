import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { MARKETS_ORDER, MARKET_META, CONF_META } from '../utils/constants'
import { posterUrl, fmtRange } from '../utils/format'
import { useSearch } from '../hooks/useApi'

const PILLS = [{ k: 'ALL', l: 'ALL' }, ...MARKETS_ORDER.map(m => ({ k: m.toUpperCase(), l: MARKET_META[m].label }))]

export default function Navbar({ activeMarket, setMarket, onFilmClick }) {
  const [query, setQuery]       = useState('')
  const [focused, setFocused]   = useState(false)
  const [imgErrors, setImgErrors] = useState({})
  const inputRef  = useRef(null)
  const dropRef   = useRef(null)

  const { result, loading } = useSearch(query)
  const showDrop = focused && (query.trim().length >= 2)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (!dropRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) {
        setFocused(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (tmdbId) => {
    setQuery(''); setFocused(false)
    onFilmClick(tmdbId)
  }

  const resultFilm = result?.film
  const conf = resultFilm ? (CONF_META[result.prediction?.confidence] || CONF_META.low) : null
  const market = resultFilm ? (MARKET_META[resultFilm.market] || MARKET_META.hollywood) : null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: 62, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 20, padding: '0 28px',
      background: 'linear-gradient(180deg, rgba(10,10,15,.96), rgba(10,10,15,.72))',
      backdropFilter: 'blur(20px)',
      borderBottom: '1px solid rgba(42,42,58,.6)',
    }}>

      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        fontWeight: 800, fontSize: 14, letterSpacing: '.18em',
        flexShrink: 0, cursor: 'pointer', userSelect: 'none',
        color: '#fff',
      }}>
        CINEMETRIC
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E50914', marginLeft: 2, marginTop: 2, display: 'inline-block' }} />
      </div>

      {/* Search bar */}
      <div style={{ flex: 1, maxWidth: 560, position: 'relative', margin: '0 auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          background: '#13131A',
          border: `1px solid ${focused ? '#4D8DFF66' : '#2A2A3A'}`,
          borderRadius: 10, height: 40,
          transition: 'border-color .2s',
          boxShadow: focused ? '0 0 0 3px #4D8DFF18' : 'none',
        }}>
          <Search size={16} style={{ marginLeft: 14, color: '#6B6B7B', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search any film..."
            style={{
              flex: 1, height: '100%', background: 'transparent',
              border: 'none', outline: 'none', color: '#fff',
              fontSize: 14, padding: '0 12px', fontFamily: 'inherit',
            }}
          />
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.focus() }}
              style={{ padding: '0 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#6B6B7B' }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* Dropdown */}
        <AnimatePresence>
          {showDrop && (
            <motion.div
              ref={dropRef}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.16 }}
              style={{
                position: 'absolute', top: 48, left: 0, right: 0,
                background: '#15151F',
                border: '1px solid #2A2A3A',
                borderRadius: 14, overflow: 'hidden',
                boxShadow: '0 28px 80px rgba(0,0,0,.7)',
                zIndex: 100,
              }}
            >
              {loading && (
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, color: '#A0A0B0', fontSize: 13 }}>
                  <span style={{ animation: 'spin 1.1s linear infinite', display: 'inline-block' }}>◷</span>
                  Analyzing <strong style={{ color: '#fff' }}>{query}</strong>...
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      height: 8, width: 60 + i * 20, background: '#22222E',
                      borderRadius: 4, marginTop: 4,
                      animation: 'pulseSkeleton 1.2s ease-in-out infinite',
                    }} />
                  ))}
                </div>
              )}

              {!loading && resultFilm && (
                <DropResult
                  film={resultFilm}
                  prediction={result.prediction}
                  conf={conf}
                  market={market}
                  onSelect={() => handleSelect(resultFilm.tmdb_id)}
                  imgErrors={imgErrors}
                  setImgErrors={setImgErrors}
                />
              )}

              {/* TMDB search fallback */}
              <div
                onClick={() => { /* trigger fresh search */ if (resultFilm) handleSelect(resultFilm.tmdb_id) }}
                style={{
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  color: '#A0A0B0', fontSize: 13, cursor: 'pointer',
                  borderTop: resultFilm ? '1px solid #2A2A3A' : 'none',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#1C1C26'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Search size={14} />
                {!loading && !resultFilm
                  ? <>Search TMDB for <strong style={{ color: '#fff', marginLeft: 4 }}>"{query}"</strong></>
                  : <span style={{ color: '#6B6B7B' }}>Press Enter to fetch from TMDB</span>
                }
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Market pills */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {PILLS.map(p => {
          const on = activeMarket === p.k
          const mcolor = p.k === 'ALL' ? '#4D8DFF' : MARKET_META[p.k.toLowerCase()]?.color || '#4D8DFF'
          return (
            <button key={p.k} onClick={() => setMarket(p.k)}
              style={{
                padding: '6px 12px', borderRadius: 999,
                fontSize: 10, fontWeight: 700, letterSpacing: '.09em',
                cursor: 'pointer', border: `1px solid ${on ? mcolor : '#2A2A3A'}`,
                background: on ? `${mcolor}22` : 'transparent',
                color: on ? mcolor : '#6B6B7B',
                transition: 'all .18s', whiteSpace: 'nowrap',
              }}>
              {p.l}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DropResult({ film, prediction, conf, market, onSelect, imgErrors, setImgErrors }) {
  const poster = !imgErrors[film.tmdb_id] && film.poster_path
    ? posterUrl(film.poster_path, 'w92')
    : null
  const ow = prediction?.opening_weekend
  const owGlobal = ow?.global
  const owMid = owGlobal?.mid_usd ?? film.global_ow_mid

  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', gap: 12, alignItems: 'center',
        padding: '12px 16px', cursor: 'pointer',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#1C1C26'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Poster thumb */}
      <div style={{
        width: 36, height: 52, borderRadius: 6, flexShrink: 0, overflow: 'hidden',
        background: `linear-gradient(145deg, ${market?.color}33, #0A0A0F)`,
        border: '1px solid rgba(255,255,255,.07)',
      }}>
        {poster && (
          <img src={poster} alt="" onError={() => setImgErrors(p => ({...p, [film.tmdb_id]: true}))}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {film.title}
          {film.release_date && (
            <span style={{ color: '#6B6B7B', fontWeight: 400, marginLeft: 6 }}>
              {new Date(film.release_date).getFullYear()}
            </span>
          )}
        </div>
        {owMid && (
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 700, color: '#4D8DFF', marginTop: 2 }}>
            {`$${(owGlobal?.low_usd || owMid * 0.75).toFixed(0)}–$${(owGlobal?.high_usd || owMid * 1.25).toFixed(0)}M`}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
        {market && (
          <span style={{
            fontSize: 8, fontWeight: 800, letterSpacing: '.1em',
            color: market.color, border: `1px solid ${market.color}44`,
            background: market.bg, padding: '3px 7px', borderRadius: 5,
          }}>
            {market.label}
          </span>
        )}
        {conf && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: conf.color, boxShadow: `0 0 8px ${conf.color}`,
          }} />
        )}
      </div>
    </div>
  )
}
