import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE } from '../utils/constants'

export function useApi(endpoint) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!endpoint) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}${endpoint}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [endpoint])

  return { data, loading, error }
}

export function useUpcomingFilms() {
  return useApi('/films/upcoming')
}

export function useFilmDetail(tmdbId) {
  return useApi(tmdbId ? `/films/${tmdbId}` : null)
}

export function useSearch(query) {
  const [result, setResult]   = useState(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    if (!query || query.trim().length < 2) { setResult(null); return }

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setLoading(true)

      fetch(`${API_BASE}/films/search?q=${encodeURIComponent(query.trim())}`, { signal: abortRef.current.signal })
        .then(r => r.json())
        .then(d => { setResult(d); setLoading(false) })
        .catch(e => { if (e.name !== 'AbortError') { setResult(null); setLoading(false) } })
    }, 350)

    return () => { clearTimeout(timerRef.current); abortRef.current?.abort() }
  }, [query])

  return { result, loading }
}

export function useRefresh() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback((tmdbId) => {
    setLoading(true)
    fetch(`${API_BASE}/films/${tmdbId}/refresh`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return { data, loading, refresh }
}
