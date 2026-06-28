import { useState, useCallback, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import Navbar     from './components/Navbar'
import Hero       from './components/Hero'
import FilmRows   from './components/FilmRows'
import FilmDetail from './components/FilmDetail'
import { useUpcomingFilms } from './hooks/useApi'
import { MARKETS_ORDER } from './utils/constants'

export default function App() {
  const [view, setView]           = useState('home')   // 'home' | 'detail'
  const [selectedId, setSelectedId] = useState(null)
  const [activeMarket, setActiveMarket] = useState('ALL')

  const { data, loading } = useUpcomingFilms()
  const allFilms = data?.films || []

  // Pick the highest-confidence film for the hero
  const { heroFilm, heroPrediction } = useMemo(() => {
    if (!allFilms.length) return { heroFilm: null, heroPrediction: null }
    const confOrder = { very_high: 0, high: 1, medium: 2, low: 3 }
    const sorted = [...allFilms].sort((a, b) => {
      const ac = confOrder[a.confidence] ?? 99
      const bc = confOrder[b.confidence] ?? 99
      if (ac !== bc) return ac - bc
      return (b.popularity || 0) - (a.popularity || 0)
    })
    const hero = sorted[0]
    return {
      heroFilm: hero,
      heroPrediction: hero ? {
        confidence: hero.confidence,
        days_until_release: hero.release_date
          ? Math.ceil((new Date(hero.release_date) - Date.now()) / 86_400_000)
          : null,
        opening_weekend: (hero.global_ow_low && hero.global_ow_high) ? {
          global: { low_usd: hero.global_ow_low, mid_usd: hero.global_ow_mid, high_usd: hero.global_ow_high },
        } : null,
        score_breakdown: hero.final_score ? {
          structural: hero.final_score * 1.1, sentiment: hero.final_score * 0.8,
          momentum:   hero.final_score * 0.7, market: hero.final_score * 1.2,
          comps:      hero.final_score * 0.9, final: hero.final_score,
        } : null,
        generated_at: hero.pred_date,
        analyst_report: hero.analyst_report,
      } : null,
    }
  }, [allFilms])

  const openDetail = useCallback((tmdbId) => {
    setSelectedId(tmdbId)
    setView('detail')
  }, [])

  const goHome = useCallback(() => {
    setView('home')
    setSelectedId(null)
  }, [])

  return (
    <div style={{ background: '#0A0A0F', minHeight: '100vh', color: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <AnimatePresence mode="wait">
        {view === 'detail' ? (
          <FilmDetail
            key="detail"
            tmdbId={selectedId}
            onBack={goHome}
            onFilmClick={openDetail}
          />
        ) : (
          <div key="home">
            <Navbar
              activeMarket={activeMarket}
              setMarket={setActiveMarket}
              onFilmClick={openDetail}
            />
            <div style={{ paddingTop: 62 }}>
              <Hero
                featuredFilm={heroFilm}
                featuredPrediction={heroPrediction}
                onFilmClick={openDetail}
              />
              <FilmRows
                allFilms={allFilms}
                activeMarket={activeMarket}
                loading={loading}
                onFilmClick={openDetail}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
