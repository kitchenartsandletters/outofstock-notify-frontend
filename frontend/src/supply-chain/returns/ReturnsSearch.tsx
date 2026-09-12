// src/supply-chain/returns/ReturnsSearch.tsx
// Search field for the Publisher Returns workspace: find a book by title, ISBN
// or publisher and see every return it appears on.
//
// Built for location reconciliation. When a title's count looks wrong, the first
// question is usually whether some of it went back to the publisher, and until
// now answering that meant opening returns one at a time.
//
// Self-contained on purpose — input, results and modal in one component — so
// mounting it costs the workspace two lines.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  searchReturns, ReturnsSearchHit, ReturnAppearance,
} from '../../api/returnsSearchApi'

const MIN_CHARS = 2
const DEBOUNCE_MS = 250

const STATUS_STYLE: Record<ReturnAppearance['status'], string> = {
  draft: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  picking: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  confirmed: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  shipped: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
}

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—')

// Unknown is not zero. A draft that has not been picked has no confirmed
// quantity, and rendering that as 0 would read as "we returned none of it"
// rather than "we have not counted yet".
const qty = (v: number | null | undefined) => (v == null ? '—' : String(v))

/** The quantity that actually went back, with its provenance. Confirmed beats
 *  picked beats requested, and we say which one we are showing rather than
 *  silently presenting an intention as an outcome. */
function settledQuantity(a: ReturnAppearance): { value: string; basis: string } {
  if (a.quantity_confirmed != null) return { value: String(a.quantity_confirmed), basis: 'confirmed' }
  if (a.quantity_picked != null) return { value: String(a.quantity_picked), basis: 'picked' }
  if (a.quantity_requested != null) return { value: String(a.quantity_requested), basis: 'requested' }
  return { value: '—', basis: 'not yet counted' }
}

export default function ReturnsSearch() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<ReturnsSearchHit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<ReturnsSearchHit | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const needle = q.trim()
    if (needle.length < MIN_CHARS) {
      abortRef.current?.abort()
      setHits([]); setSearched(false); setError(null); setSearching(false)
      return
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setSearching(true); setError(null)

      searchReturns(needle, 50, controller.signal)
        .then(res => {
          setHits(res.results)
          setTruncated(res.truncated)
          setSearched(true)
        })
        .catch(e => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          // A failed search must not render as an empty result set — "no
          // matches" and "the lookup broke" are different answers.
          setError(e instanceof Error ? e.message : 'Search failed')
          setHits([]); setSearched(false)
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [q])

  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  return (
    <>
      <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
        <label className="block text-sm font-medium mb-2" htmlFor="returns-search">
          Find a book in returns
        </label>
        <div className="flex items-center gap-2">
          <input
            id="returns-search"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Title, ISBN, or publisher — e.g. Jewish Cookbook, 978-0-7148-7933-8, Phaidon, PHAI"
            className="flex-1 px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="text-sm px-3 py-2 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs opacity-60 mt-1">
          Partial matches work. ISBNs match with or without hyphens.
        </div>

        {error && (
          <div className="mt-3 text-sm rounded border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-700 text-red-700 dark:text-red-300 px-3 py-2">
            {error}
          </div>
        )}

        {searching && <div className="mt-3 text-sm opacity-70">Searching…</div>}

        {!searching && !error && searched && hits.length === 0 && (
          <div className="mt-3 text-sm opacity-60 px-3 py-3 border rounded border-dashed">
            No returns found for “{q.trim()}”. That means this title has never been
            put on a return — not that it has nothing on hand.
          </div>
        )}

        {!searching && !error && hits.length > 0 && (
          <div className="mt-3 border rounded-md overflow-hidden max-h-80 overflow-y-auto">
            {hits.map(h => (
              <button
                key={`${h.isbn ?? h.title}`}
                onClick={() => setSelected(h)}
                className="w-full text-left grid grid-cols-12 gap-2 items-center px-3 py-2 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm last:border-b-0"
              >
                <span className="col-span-5 font-medium truncate">{h.title ?? '—'}</span>
                <span className="col-span-3 font-mono text-xs opacity-70">{h.isbn ?? '—'}</span>
                <span className="col-span-2 truncate text-xs opacity-80">
                  {h.publisher ?? '—'}
                  {h.returns_code && <span className="opacity-60"> · {h.returns_code}</span>}
                </span>
                <span className="col-span-1 text-right tabular-nums text-xs">
                  {h.appearance_count}×
                </span>
                <span className="col-span-1 text-right tabular-nums text-xs">
                  {qty(h.total_confirmed)}
                </span>
              </button>
            ))}
          </div>
        )}

        {truncated && hits.length > 0 && (
          <div className="mt-2 text-xs opacity-60">
            Showing the first {hits.length}. Narrow the search to see the rest.
          </div>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold truncate">{selected.title ?? '—'}</div>
                <div className="text-xs opacity-70 mt-0.5">
                  <span className="font-mono">{selected.isbn ?? '—'}</span>
                  {' · '}
                  {selected.publisher ?? '—'}
                  {selected.returns_code && ` (${selected.returns_code})`}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 shrink-0"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-4 py-2 text-sm border-b border-gray-100 dark:border-gray-700 opacity-80">
              On {selected.appearance_count} return{selected.appearance_count === 1 ? '' : 's'}
              {selected.total_confirmed != null
                ? ` · ${selected.total_confirmed} confirmed returned in total`
                : ' · nothing confirmed returned yet'}
            </div>

            <div className="overflow-y-auto">
              {selected.appearances.map(a => {
                const settled = settledQuantity(a)
                return (
                  <div
                    key={a.return_id}
                    className="grid grid-cols-12 gap-2 items-center px-4 py-3 border-b border-gray-100 dark:border-gray-700 text-sm last:border-b-0"
                  >
                    <div className="col-span-3 font-mono text-xs">
                      {a.return_number ?? '—'}
                    </div>
                    <div className="col-span-2">
                      <span className={`text-[11px] uppercase px-2 py-0.5 rounded ${STATUS_STYLE[a.status]}`}>
                        {a.status}
                      </span>
                    </div>
                    <div className="col-span-2 text-xs opacity-80">
                      {day(a.date)}
                      <span className="block opacity-60">
                        {a.shipped_at ? 'shipped' : 'created'}
                      </span>
                    </div>
                    <div className="col-span-2 text-right tabular-nums">
                      {settled.value}
                      <span className="block text-[11px] opacity-60">{settled.basis}</span>
                    </div>
                    <div className="col-span-2 text-right text-[11px] opacity-60 tabular-nums">
                      req {qty(a.quantity_requested)} · pick {qty(a.quantity_picked)}
                    </div>
                    <div className="col-span-1 text-right">
                      <button
                        onClick={() => { setSelected(null); navigate(`/supply-chain/returns/${a.return_id}`) }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Open
                      </button>
                    </div>
                    {a.notes && (
                      <div className="col-span-12 text-xs opacity-60 pt-1">{a.notes}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
