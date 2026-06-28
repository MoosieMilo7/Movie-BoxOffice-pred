import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, RefreshCw, ExternalLink, Play, ShoppingCart, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { MARKET_META, CONF_META, ACCENT } from '../utils/constants'
import { fmtM, timeAgo, posterUrl } from '../utils/format'
import { useFilmDetail, useRefresh } from '../hooks/useApi'
import ConfidenceBadge from './ConfidenceBadge'
import ScoreBar from './ScoreBar'

export default function FilmDetail({ tmdbId, onBack }) {
  const { data, loading, error } = useFilmDetail(tmdbId)
  const { data: refreshData, loading: refreshLoading, refresh } = useRefresh()

  const activeData  = refreshData || data
  const film        = activeData?.film
  const prediction  = activeData?.prediction
  const sentPending = activeData?.sentiment_pending
  const isReleased  = activeData?.mode === 'released'

  if (loading) return <DetailSkeleton onBack={onBack} />
  if (error || !film) return <DetailError onBack={onBack} error={error} />

  return (
    <motion.div
      initial={{ opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 48 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0A0A0F', display: 'flex', overflow: 'hidden' }}
    >
      {/* LEFT — Poster panel */}
      <PosterPanel film={film} />

      {/* RIGHT — Scrollable content */}
      <div
        className="no-scrollbar"
        style={{ flex: 1, overflowY: 'auto', padding: '24px 52px 100px' }}
      >
        {/* Back + refresh */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <button onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, background: 'none',
              border: 'none', color: '#A0A0B0', cursor: 'pointer', fontSize: 13,
              fontWeight: 600, fontFamily: 'inherit', padding: 0,
              transition: 'color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#A0A0B0'}
          >
            <ArrowLeft size={16} /> Back
          </button>

          <button
            onClick={() => refresh(tmdbId)}
            disabled={refreshLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'none', border: '1px solid #2A2A3A',
              color: '#A0A0B0', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              padding: '7px 14px', borderRadius: 8, transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#4D8DFF' }}
            onMouseLeave={e => { e.currentTarget.style.color = '#A0A0B0'; e.currentTarget.style.borderColor = '#2A2A3A' }}
          >
            <RefreshCw size={13} style={{ animation: refreshLoading ? 'spin 1.2s linear infinite' : 'none' }} />
            {refreshLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* ── RELEASED FILM branch ─────────────────────────────── */}
        {isReleased ? (
          <>
            <FilmHeader film={film} />
            <ReleasedBanner />
            <ReleasedStatsCard prediction={prediction} film={film} />
            {prediction?.analyst_report && (
              <PerformanceAnalysis report={prediction.analyst_report} tier={prediction.performance_tier} />
            )}
            <WatchProviders providers={activeData?.watch_providers} />
            <DataFreshness film={film} prediction={null} onRefresh={() => refresh(tmdbId)} refreshLoading={refreshLoading} />
          </>
        ) : (
          /* ── UPCOMING / FRESH-RELEASE branch ─────────────────── */
          <>
            {activeData?.mode === 'fresh_release' && (
              <div style={{
                background: 'rgba(255,179,0,.1)', border: '1px solid rgba(255,179,0,.3)',
                color: '#FFB300', fontSize: 13, fontWeight: 600,
                padding: '11px 16px', borderRadius: 10, marginBottom: 22,
              }}>
                🎬 Just Released · Revenue data pending — prediction shown as estimate
              </div>
            )}
            <FilmHeader film={film} />
            <ProjectionCard prediction={prediction} sentPending={sentPending} />
            {prediction?.analyst_report && (
              <AnalystReport report={prediction.analyst_report} />
            )}
            {prediction?.score_breakdown && (
              <ScoreBreakdown scores={prediction.score_breakdown} />
            )}
            {prediction?.comp_films?.length > 0 && (
              <CompFilms comps={prediction.comp_films} />
            )}
            {(prediction?.key_drivers?.length > 0 || prediction?.risk_factors?.length > 0) && (
              <DriversRisks drivers={prediction.key_drivers} risks={prediction.risk_factors} />
            )}
            <SentimentSection film={film} prediction={prediction} pending={sentPending} />
            <DataFreshness film={film} prediction={prediction} onRefresh={() => refresh(tmdbId)} refreshLoading={refreshLoading} />
          </>
        )}
      </div>
    </motion.div>
  )
}

/* ─── Poster Panel ────────────────────────────────────────────── */
function PosterPanel({ film }) {
  const [loaded, setLoaded] = useState(false)
  const market = MARKET_META[film.market?.toLowerCase()] || MARKET_META.hollywood
  const poster = film.poster_path ? posterUrl(film.poster_path, 'w780') : null

  return (
    <div style={{ width: '38%', flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
      {/* Background gradient */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(70% 60% at 30% 25%, ${market.color}40, transparent 65%),
                     radial-gradient(50% 70% at 75% 80%, ${market.color}28, transparent 55%),
                     linear-gradient(180deg, #191926, #0A0A0F)`,
      }} />

      {/* Poster image */}
      {poster && (
        <img
          src={poster}
          alt={film.title}
          onLoad={() => setLoaded(true)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center top',
            opacity: loaded ? 1 : 0, transition: 'opacity .8s ease',
          }}
        />
      )}

      {/* Right fade overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, transparent 50%, rgba(10,10,15,.6) 78%, #0A0A0F 100%)',
      }} />

      {/* Bottom info */}
      <div style={{ position: 'absolute', left: 32, right: 28, bottom: 44, zIndex: 2 }}>
        <div style={{
          fontSize: 8, fontWeight: 800, letterSpacing: '.14em',
          background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(8px)',
          border: `1px solid ${market.color}66`, color: market.color,
          display: 'inline-block', padding: '4px 9px', borderRadius: 5, marginBottom: 14,
        }}>
          {market.label}
        </div>
        <div style={{
          fontSize: 'clamp(32px, 3.5vw, 48px)', fontWeight: 900,
          lineHeight: .97, letterSpacing: '-.025em',
          textShadow: '0 3px 24px rgba(0,0,0,.8)', textTransform: 'uppercase',
        }}>
          {film.title}
        </div>
      </div>
    </div>
  )
}

/* ─── Film Header ─────────────────────────────────────────────── */
function FilmHeader({ film }) {
  const genres  = Array.isArray(film.genres)   ? film.genres   : []
  const cast5   = Array.isArray(film.cast_top5) ? film.cast_top5 : []
  const dirName = film.director?.name

  return (
    <div style={{ marginBottom: 28 }}>
      <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.022em', lineHeight: 1.02, margin: '0 0 10px' }}>
        {film.title}
      </h1>

      <div style={{ color: '#A0A0B0', fontSize: 14, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {film.release_date && <span>{new Date(film.release_date).getFullYear()}</span>}
        {film.market && <><span style={{ opacity: .35 }}>·</span><span style={{ textTransform: 'capitalize' }}>{film.market}</span></>}
        {film.runtime && <><span style={{ opacity: .35 }}>·</span><span>{film.runtime}m</span></>}
        {film.mpaa_rating && <><span style={{ opacity: .35 }}>·</span><span>{film.mpaa_rating}</span></>}
      </div>

      {genres.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          {genres.map(g => (
            <span key={g} style={{
              fontSize: 12, fontWeight: 600,
              border: '1px solid #2A2A3A', borderRadius: 999,
              padding: '5px 14px', color: '#E6E6F0',
            }}>{g}</span>
          ))}
        </div>
      )}

      {dirName && (
        <div style={{ fontSize: 14, color: '#A0A0B0', marginBottom: 6 }}>
          <span style={{ color: '#6B6B7B', marginRight: 12, width: 60, display: 'inline-block' }}>Director</span>
          {dirName}
        </div>
      )}
      {cast5.length > 0 && (
        <div style={{ fontSize: 14, color: '#A0A0B0', marginBottom: 6 }}>
          <span style={{ color: '#6B6B7B', marginRight: 12, width: 60, display: 'inline-block' }}>Cast</span>
          {cast5.map(c => c.name).join(' · ')}
        </div>
      )}
    </div>
  )
}

/* ─── Projection Card ─────────────────────────────────────────── */
function ProjectionCard({ prediction, sentPending }) {
  const ow      = prediction?.opening_weekend
  const origin  = ow?.origin_market
  const global_ = ow?.global
  const conf    = CONF_META[prediction?.confidence] || CONF_META.low
  const days    = prediction?.days_until_release

  return (
    <div style={{
      background: '#13131A',
      border: `1px solid #2A2A3A`,
      borderLeft: `4px solid ${ACCENT}`,
      borderRadius: 16, padding: '26px 30px', marginBottom: 24,
    }}>
      <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0', marginBottom: 24 }}>
        OPENING WEEKEND PROJECTION
      </div>

      {ow ? (
        <div style={{ display: 'flex', gap: 52, flexWrap: 'wrap' }}>
          {/* Origin market */}
          {origin && (
            <div>
              <div style={{ fontSize: 11, color: '#6B6B7B', fontWeight: 700, letterSpacing: '.1em', marginBottom: 4 }}>
                ORIGIN MARKET
              </div>
              <div style={{ fontSize: 13, color: '#A0A0B0', marginBottom: 12 }}>{origin.country}</div>
              <div style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 'clamp(24px, 3vw, 34px)',
                fontWeight: 700, color: '#fff', letterSpacing: '-.02em', lineHeight: 1,
              }}>
                {fmtM(origin.low_usd)} <span style={{ color: '#444', fontSize: '60%' }}>–</span> {fmtM(origin.high_usd)}
              </div>
            </div>
          )}

          {/* Global */}
          {global_ && (
            <div>
              <div style={{ fontSize: 11, color: '#6B6B7B', fontWeight: 700, letterSpacing: '.1em', marginBottom: 4 }}>
                GLOBAL
              </div>
              <div style={{ fontSize: 13, color: '#A0A0B0', marginBottom: 12 }}>Worldwide</div>
              <div style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 'clamp(24px, 3vw, 34px)',
                fontWeight: 700, color: ACCENT, letterSpacing: '-.02em', lineHeight: 1,
              }}>
                {fmtM(global_.low_usd)} <span style={{ color: '#2f4d7d', fontSize: '60%' }}>–</span> {fmtM(global_.high_usd)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 34, color: '#2A2A3A' }}>
          {sentPending ? 'Analyzing...' : 'No projection available'}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 18,
        marginTop: 24, paddingTop: 20, borderTop: '1px solid #2A2A3A',
        flexWrap: 'wrap', fontSize: 13, color: '#A0A0B0',
      }}>
        <ConfidenceBadge confidence={prediction?.confidence} />
        {days !== null && days > 0 && <span>{days} days until release</span>}
        {days !== null && days <= 0 && <span style={{ color: conf.color }}>In theaters now</span>}
        {prediction?.generated_at && (
          <span style={{ color: '#6B6B7B' }}>Updated {timeAgo(prediction.generated_at)}</span>
        )}
      </div>

      {prediction?.confidence_reason && (
        <div style={{ marginTop: 14, fontSize: 12, color: '#6B6B7B', lineHeight: 1.5 }}>
          {prediction.confidence_reason}
        </div>
      )}
    </div>
  )
}

/* ─── Analyst Report ──────────────────────────────────────────── */
function AnalystReport({ report }) {
  return (
    <div style={{
      background: '#13131A', border: '1px solid #2A2A3A',
      borderRadius: 16, padding: '28px 32px 26px',
      marginBottom: 24, position: 'relative',
    }}>
      <div style={{
        fontSize: 68, lineHeight: .6, color: ACCENT, fontWeight: 900,
        position: 'absolute', top: 28, left: 26, fontFamily: 'Georgia, serif',
        opacity: .9,
      }}>"</div>
      <div style={{ paddingLeft: 44 }}>
        <div style={{ fontSize: 17, lineHeight: 1.68, color: '#E6E6F0' }}>
          {report}
        </div>
        <div style={{ fontSize: 12, color: '#6B6B7B', marginTop: 18, fontWeight: 600, letterSpacing: '.06em' }}>
          — CineMetric AI Analysis
        </div>
      </div>
    </div>
  )
}

/* ─── Score Breakdown ─────────────────────────────────────────── */
function ScoreBreakdown({ scores }) {
  const rows = [
    ['STRUCTURAL',  scores.structural,  0],
    ['SENTIMENT',   scores.sentiment,   80],
    ['MOMENTUM',    scores.momentum,    160],
    ['MARKET',      scores.market,      240],
    ['COMP ANCHOR', scores.comps,       320],
  ]

  return (
    <div style={{
      background: '#13131A', border: '1px solid #2A2A3A',
      borderRadius: 16, padding: '24px 28px', marginBottom: 24,
    }}>
      <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0', marginBottom: 22 }}>
        PREDICTION FACTORS
      </div>

      {rows.map(([label, val, delay]) => (
        <ScoreBar key={label} label={label} value={val} delay={delay} height={7} />
      ))}

      <div style={{ paddingTop: 16, marginTop: 6, borderTop: '1px solid #2A2A3A' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 118, fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: '#fff' }}>
            FINAL SCORE
          </span>
          <div style={{ flex: 1, height: 8, background: '#22222E', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${Math.round((scores.final || 0) * 100)}%`,
              background: ACCENT, borderRadius: 4,
              transformOrigin: 'left',
              animation: 'barFill 1.1s cubic-bezier(.2,.8,.2,1) .4s both',
            }} />
          </div>
          <span style={{ width: 42, textAlign: 'right', fontFamily: 'ui-monospace, monospace', fontSize: 15, fontWeight: 800, color: ACCENT }}>
            {(scores.final || 0).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ─── Comp Films ──────────────────────────────────────────────── */
function CompFilms({ comps }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0', marginBottom: 16 }}>
        COMPARABLE FILMS
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {comps.slice(0, 5).map((c, i) => {
          const sim = Math.min(5, Math.max(1, Math.round(5 - i * 0.6)))
          return (
            <div key={i} style={{
              flex: '1 1 190px', maxWidth: 240,
              background: '#13131A', border: '1px solid #2A2A3A',
              borderRadius: 13, padding: '14px 16px',
              display: 'flex', gap: 12, alignItems: 'center',
            }}>
              <div style={{
                width: 46, height: 64, borderRadius: 7, flexShrink: 0,
                background: `linear-gradient(145deg, ${ACCENT}30, #0A0A0F)`,
                border: '1px solid rgba(255,255,255,.07)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20,
              }}>🎬</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.title}
                </div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#A0A0B0', marginTop: 5 }}>
                  OW: <span style={{ color: '#fff', fontWeight: 600 }}>{fmtM(c.actual_ow_global_usd)}</span> global
                </div>
                <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
                  {[...Array(5)].map((_, j) => (
                    <span key={j} style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: j < sim ? ACCENT : '#2A2A3A',
                    }} />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Drivers & Risks ─────────────────────────────────────────── */
function DriversRisks({ drivers = [], risks = [] }) {
  return (
    <div style={{ display: 'flex', gap: 18, marginBottom: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 240px', background: '#13131A', border: '1px solid #2A2A3A', borderRadius: 14, padding: '22px 24px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: '#00C853', marginBottom: 16 }}>
          KEY DRIVERS ↑
        </div>
        {drivers.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 11, fontSize: 14, color: '#E6E6F0' }}>
            <span style={{ color: '#00C853', fontWeight: 700, flexShrink: 0 }}>✓</span>
            <span>{d}</span>
          </div>
        ))}
        {drivers.length === 0 && <div style={{ color: '#6B6B7B', fontSize: 13 }}>None identified</div>}
      </div>

      <div style={{ flex: '1 1 240px', background: '#13131A', border: '1px solid #2A2A3A', borderRadius: 14, padding: '22px 24px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', color: '#FFB300', marginBottom: 16 }}>
          RISK FACTORS ↓
        </div>
        {risks.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 11, fontSize: 14, color: '#E6E6F0' }}>
            <span style={{ color: '#FFB300', flexShrink: 0 }}>⚠</span>
            <span>{r}</span>
          </div>
        ))}
        {risks.length === 0 && <div style={{ color: '#6B6B7B', fontSize: 13 }}>None identified</div>}
      </div>
    </div>
  )
}

/* ─── Sentiment Section ───────────────────────────────────────── */
function SentimentSection({ film, prediction, pending }) {
  const sentScore = prediction?.sentiment_score
  const SENT_META = {
    5: { label: 'BLAZING 🔥', color: '#FF3B3B' },
    4: { label: 'HOT 🔥', color: '#FF6B35' },
    3: { label: 'WARM', color: '#FFB300' },
    2: { label: 'COOL', color: '#5AA9FF' },
    1: { label: 'QUIET', color: '#7A7A8C' },
    0: { label: 'DEAD', color: '#3A3A4E' },
  }
  const raw    = sentScore ? Math.round(sentScore * 5) : null
  const sLabel = raw !== null ? SENT_META[raw] || SENT_META[3] : null

  const momentum  = prediction?.momentum_score

  return (
    <div style={{ background: '#13131A', border: '1px solid #2A2A3A', borderRadius: 16, padding: '26px 28px', marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0', marginBottom: 20 }}>
        MARKET SENTIMENT
      </div>

      {pending ? (
        <div style={{ textAlign: 'center', padding: '18px 0 26px' }}>
          <div style={{ fontSize: 15, color: '#A0A0B0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
            <span style={{ animation: 'spin 1.2s linear infinite', display: 'inline-block' }}>⟳</span>
            Scraping social data...
          </div>
          <div style={{ height: 14, width: 180, background: '#22222E', borderRadius: 7, margin: '16px auto 0', animation: 'pulseSkeleton 1.2s ease-in-out infinite' }} />
        </div>
      ) : sLabel ? (
        <>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 52, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1 }}>
              {(sentScore * 5).toFixed(0)} / 5
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.12em', color: sLabel.color, marginTop: 7 }}>
              {sLabel.label}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <InfoBox label="Sentiment Score" value={`${((sentScore || 0) * 100).toFixed(0)}%`} />
            <InfoBox label="Momentum Score" value={`${((momentum || 0) * 100).toFixed(0)}%`} />
            <InfoBox label="Social Signal" value={film.trailer_url ? 'YouTube · TMDB' : 'TMDB Reviews'} />
          </div>
        </>
      ) : (
        <div style={{ color: '#6B6B7B', fontSize: 14 }}>
          No sentiment data available yet
        </div>
      )}
    </div>
  )
}

function InfoBox({ label, value }) {
  return (
    <div style={{ flex: '1 1 140px', background: '#0A0A0F', border: '1px solid #2A2A3A', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#6B6B7B', marginBottom: 7 }}>{label}</div>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

/* ─── Data Freshness ──────────────────────────────────────────── */
function DataFreshness({ film, prediction, onRefresh, refreshLoading }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#6B6B7B', paddingTop: 8 }}>
      <span>TMDB sync: {timeAgo(film.last_tmdb_sync)}</span>
      <span style={{ opacity: .4 }}>·</span>
      <span>Sentiment: {film.last_apify_sync ? timeAgo(film.last_apify_sync) : 'pending'}</span>
      <span style={{ opacity: .4 }}>·</span>
      <span>v{prediction?.methodology_version || '2.0'}</span>
      <button
        onClick={onRefresh}
        disabled={refreshLoading}
        style={{
          marginLeft: 'auto', background: 'none', border: 'none',
          color: ACCENT, fontWeight: 600, cursor: 'pointer', fontSize: 12,
          display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
          opacity: refreshLoading ? .5 : 1,
        }}
      >
        <RefreshCw size={12} /> Refresh prediction
      </button>
    </div>
  )
}

/* ─── Released Film Components ───────────────────────────────── */

function ReleasedBanner() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: 'rgba(0,200,83,.08)', border: '1px solid rgba(0,200,83,.3)',
      color: '#00C853', fontSize: 12, fontWeight: 700, letterSpacing: '.08em',
      padding: '7px 14px', borderRadius: 8, marginBottom: 22,
    }}>
      ✓ RELEASED · Actual box office data
    </div>
  )
}

function ReleasedStatsCard({ prediction }) {
  if (!prediction) return null

  const ww      = prediction.actual_worldwide_gross_millions
  const budget  = prediction.budget_millions
  const roi     = prediction.roi_percent
  const owG     = prediction.opening_weekend?.global
  const owO     = prediction.opening_weekend?.origin_market
  const tier    = prediction.performance_tier

  const TIER_STYLE = {
    hit:          { icon: TrendingUp,   color: '#00C853', label: 'BOX OFFICE HIT' },
    moderate_hit: { icon: TrendingUp,   color: '#FFB300', label: 'SOLID PERFORMER' },
    moderate:     { icon: Minus,        color: '#A0A0B0', label: 'MODERATE PERFORMER' },
    miss:         { icon: TrendingDown, color: '#E50914', label: 'UNDERPERFORMED' },
  }
  const ts = TIER_STYLE[tier] || TIER_STYLE.moderate
  const Icon = ts.icon

  return (
    <div style={{
      background: '#13131A', border: `1px solid #2A2A3A`,
      borderLeft: `4px solid ${ts.color}`, borderRadius: 16,
      padding: '26px 30px', marginBottom: 24,
    }}>
      {/* Performance tier badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 }}>
        <Icon size={16} color={ts.color} />
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.18em', color: ts.color }}>
          {ts.label}
        </span>
      </div>

      {/* Main revenue figures */}
      <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, color: '#6B6B7B', fontWeight: 700, letterSpacing: '.1em', marginBottom: 5 }}>
            WORLDWIDE REVENUE
          </div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 36, fontWeight: 700, color: ts.color, lineHeight: 1 }}>
            {ww ? fmtM(ww) : '—'}
          </div>
          <div style={{ fontSize: 12, color: '#6B6B7B', marginTop: 5 }}>Total theatrical gross</div>
        </div>

        {budget && (
          <div>
            <div style={{ fontSize: 11, color: '#6B6B7B', fontWeight: 700, letterSpacing: '.1em', marginBottom: 5 }}>
              PRODUCTION BUDGET
            </div>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 36, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
              {fmtM(budget)}
            </div>
            {roi !== null && (
              <div style={{ fontSize: 12, marginTop: 5, fontWeight: 700, color: roi >= 0 ? '#00C853' : '#E50914' }}>
                {roi >= 0 ? '+' : ''}{roi}% ROI
              </div>
            )}
          </div>
        )}
      </div>

      {/* OW estimates */}
      {(owG || owO) && (
        <>
          <div style={{ fontSize: 11, color: '#6B6B7B', fontWeight: 700, letterSpacing: '.12em', marginBottom: 14, paddingTop: 18, borderTop: '1px solid #2A2A3A' }}>
            EST. OPENING WEEKEND
          </div>
          <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
            {owG && (
              <div>
                <div style={{ fontSize: 11, color: '#6B6B7B', marginBottom: 4 }}>Global</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 24, fontWeight: 700, color: ACCENT }}>
                  {fmtM(owG.low_usd)} – {fmtM(owG.high_usd)}
                </div>
              </div>
            )}
            {owO && (
              <div>
                <div style={{ fontSize: 11, color: '#6B6B7B', marginBottom: 4 }}>{owO.country}</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 24, fontWeight: 700, color: '#fff' }}>
                  {fmtM(owO.low_usd)} – {fmtM(owO.high_usd)}
                </div>
              </div>
            )}
          </div>
          {prediction.note && (
            <div style={{ fontSize: 11, color: '#6B6B7B', marginTop: 12, fontStyle: 'italic' }}>
              * {prediction.note}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PerformanceAnalysis({ report, tier }) {
  const color = tier === 'hit' ? '#00C853' : tier === 'miss' ? '#E50914' : '#FFB300'
  return (
    <div style={{
      background: '#13131A', border: '1px solid #2A2A3A',
      borderRadius: 16, padding: '26px 30px', marginBottom: 24, position: 'relative',
    }}>
      <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0', marginBottom: 18 }}>
        PERFORMANCE ANALYSIS
      </div>
      <div style={{ fontSize: 68, lineHeight: .6, color, fontWeight: 900, position: 'absolute', top: 52, left: 26, fontFamily: 'Georgia, serif', opacity: .7 }}>
        "
      </div>
      <div style={{ paddingLeft: 44 }}>
        <div style={{ fontSize: 16, lineHeight: 1.7, color: '#E6E6F0' }}>{report}</div>
        <div style={{ fontSize: 12, color: '#6B6B7B', marginTop: 14, fontWeight: 600, letterSpacing: '.05em' }}>
          — CineMetric Box Office Analysis
        </div>
      </div>
    </div>
  )
}

function WatchProviders({ providers }) {
  if (!providers) {
    return (
      <div style={{ background: '#13131A', border: '1px solid #2A2A3A', borderRadius: 16, padding: '24px 28px', marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0', marginBottom: 14 }}>WHERE TO WATCH</div>
        <div style={{ color: '#6B6B7B', fontSize: 14 }}>Streaming availability not found for this title.</div>
      </div>
    )
  }

  const { flatrate = [], rent = [], buy = [], link } = providers
  const hasAny = flatrate.length + rent.length + buy.length > 0

  return (
    <div style={{ background: '#13131A', border: '1px solid #2A2A3A', borderRadius: 16, padding: '24px 28px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: '.2em', fontWeight: 700, color: '#A0A0B0' }}>WHERE TO WATCH</div>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: ACCENT, textDecoration: 'none', fontWeight: 600 }}>
            All options <ExternalLink size={12} />
          </a>
        )}
      </div>

      {!hasAny ? (
        <div style={{ color: '#6B6B7B', fontSize: 14 }}>
          Not currently available for streaming or rental in {providers.country || 'your region'}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {flatrate.length > 0 && (
            <ProviderSection
              icon={<Play size={14} />}
              label="Streaming Included"
              providers={flatrate}
              accentColor="#00C853"
            />
          )}
          {rent.length > 0 && (
            <ProviderSection
              icon={<ExternalLink size={14} />}
              label="Rent"
              providers={rent}
              accentColor={ACCENT}
            />
          )}
          {buy.length > 0 && (
            <ProviderSection
              icon={<ShoppingCart size={14} />}
              label="Buy"
              providers={buy}
              accentColor="#FFB300"
            />
          )}
        </div>
      )}
    </div>
  )
}

function ProviderSection({ icon, label, providers, accentColor }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, color: accentColor, fontSize: 11, fontWeight: 700, letterSpacing: '.1em' }}>
        {icon} {label}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {providers.map(p => (
          <div key={p.provider_id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#0A0A0F', border: '1px solid #2A2A3A',
            borderRadius: 10, padding: '10px 14px',
            minWidth: 140,
          }}>
            {p.logo_url ? (
              <img
                src={p.logo_url}
                alt={p.provider_name}
                style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                onError={e => { e.target.style.display = 'none' }}
              />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${accentColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                ▶
              </div>
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{p.provider_name}</div>
              <div style={{ fontSize: 10, color: accentColor, fontWeight: 700, marginTop: 2, letterSpacing: '.06em' }}>
                {label === 'Streaming Included' ? 'INCLUDED' : label.toUpperCase()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Loading / Error states ──────────────────────────────────── */
function DetailSkeleton({ onBack }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0A0A0F', display: 'flex' }}>
      <div style={{ width: '38%', background: '#13131A', animation: 'pulseSkeleton 1.4s ease-in-out infinite' }} />
      <div style={{ flex: 1, padding: '24px 52px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#A0A0B0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontFamily: 'inherit', marginBottom: 28 }}>
          <ArrowLeft size={16} /> Back
        </button>
        {[300, 200, 400, 160, 500].map((w, i) => (
          <div key={i} style={{ height: i === 1 ? 44 : 14, width: w, background: '#22222E', borderRadius: 8, marginBottom: 20, animation: 'pulseSkeleton 1.4s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  )
}

function DetailError({ onBack, error }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0A0A0F', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Failed to load film</div>
      <div style={{ color: '#6B6B7B', fontSize: 14 }}>{error || 'Unknown error'}</div>
      <button onClick={onBack} style={{ marginTop: 16, padding: '12px 24px', background: ACCENT, border: 'none', color: '#fff', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14 }}>
        ← Go back
      </button>
    </div>
  )
}
