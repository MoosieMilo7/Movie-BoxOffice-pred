import { ChevronRight } from 'lucide-react'
import { MARKETS_ORDER, MARKET_META } from '../utils/constants'
import FilmCard from './FilmCard'

export default function FilmRows({ allFilms, activeMarket, loading, onFilmClick }) {

  if (loading) return <RowsSkeleton />

  if (!allFilms || allFilms.length === 0) {
    return (
      <div style={{ padding: '80px 48px', textAlign: 'center', color: '#6B6B7B' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>No films in database yet</div>
        <div style={{ fontSize: 14, marginTop: 8 }}>
          Run <code style={{ background: '#1C1C26', padding: '2px 8px', borderRadius: 4 }}>node backend/db/seed.js</code> to populate the database
        </div>
      </div>
    )
  }

  // Group films by market
  const byMarket = {}
  for (const f of allFilms) {
    const m = f.market?.toLowerCase()
    if (!byMarket[m]) byMarket[m] = []
    byMarket[m].push(f)
  }

  const marketsToShow = activeMarket === 'ALL'
    ? MARKETS_ORDER
    : [activeMarket.toLowerCase()]

  return (
    <div style={{ padding: '40px 0 90px' }}>
      {marketsToShow.map(market => {
        const films = byMarket[market] || []
        const meta  = MARKET_META[market]
        if (!meta) return null

        return (
          <div key={market} style={{ marginBottom: 52 }}>
            {/* Row header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '0 48px', marginBottom: 20,
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: 3,
                background: meta.color, display: 'inline-block',
                boxShadow: `0 0 12px ${meta.color}88`,
              }} />
              <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '.01em' }}>
                {meta.label}
              </span>
              <span style={{ fontSize: 13, color: '#6B6B7B', fontWeight: 500 }}>
                {films.length} films
              </span>
            </div>

            {/* Horizontal scroll */}
            {films.length === 0 ? (
              <div style={{ padding: '20px 48px', color: '#6B6B7B', fontSize: 14 }}>
                No {meta.label} upcoming films in database
              </div>
            ) : (
              <div
                className="no-scrollbar"
                style={{
                  display: 'flex', gap: 16, overflowX: 'auto',
                  padding: '8px 48px 20px',
                  scrollSnapType: 'x mandatory',
                }}
              >
                {films.map(film => (
                  <FilmCard
                    key={film.tmdb_id || film.id}
                    film={film}
                    onClick={() => onFilmClick(film.tmdb_id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function RowsSkeleton() {
  return (
    <div style={{ padding: '40px 0 90px' }}>
      {[...Array(3)].map((_, ri) => (
        <div key={ri} style={{ marginBottom: 52 }}>
          <div style={{ display: 'flex', gap: 12, padding: '0 48px', marginBottom: 20, alignItems: 'center' }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: '#22222E', animation: 'pulseSkeleton 1.4s ease-in-out infinite' }} />
            <div style={{ width: 120, height: 18, background: '#22222E', borderRadius: 6, animation: 'pulseSkeleton 1.4s ease-in-out infinite' }} />
          </div>
          <div style={{ display: 'flex', gap: 16, padding: '0 48px' }}>
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ flexShrink: 0, width: 175 }}>
                <div style={{
                  width: 175, height: 263, borderRadius: 12,
                  background: '#13131A', animation: `pulseSkeleton 1.4s ease-in-out ${i * 80}ms infinite`,
                }} />
                <div style={{ width: 140, height: 12, background: '#13131A', borderRadius: 4, marginTop: 10, animation: 'pulseSkeleton 1.4s ease-in-out infinite' }} />
                <div style={{ width: 90, height: 10, background: '#13131A', borderRadius: 4, marginTop: 6, animation: 'pulseSkeleton 1.4s ease-in-out infinite' }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
