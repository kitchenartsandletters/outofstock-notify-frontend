// src/supply-chain/transfers/TransfersSearch.tsx
// Book-history search for the Transfers workspace: find a title and see every
// transfer it moved on, with per-leg application status.
//
// Distinct from the search box beside the filter tabs. That one narrows which
// transfer rows are listed. This one is book-centric — one result per title,
// every move nested underneath — and surfaces the condition a list filter
// cannot show: a line whose decrement applied but whose increment did not,
// meaning stock left one location and never arrived at the other.
//
// Self-contained: input, results and modal in one component.

import { useEffect, useRef, useState } from 'react'
import {
  searchTransfers, TransfersSearchHit, TransferAppearance,
} from '../../api/transfersSearchApi'

const MIN_CHARS = 2
const DEBOUNCE_MS = 250

const shortDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Unknown is not zero. A line dispatched but not yet received has no received
// quantity, and rendering that as 0 would read as "none arrived" rather than
// "it has not been received yet".
const qty = (v: number | null | undefined) => (v == null ? '—' : String(v))

/** Short location label — the full Shopify names are long enough to wrap. */
const place = (v: string | null) => {
  if (!v) return '—'
  if (/food stories/i.test(v)) return '111 Broadway'
  if (/kitchen arts/i.test(v)) return 'Lexington'
  return v
}

/** What actually happened to this line, in words. The two booleans are the
 *  whole point of this search, so they get stated rather than shown raw. */
function legVerdict(a: TransferAppearance): { label: string; tone: string } {
  if (a.decrement_applied && a.increment_applied)
    return { label: 'Both legs applied', tone: 'text-green-600 dark:text-green-400' }
  if (a.decrement_applied && !a.increment_applied)
    return { label: 'Left source, never arrived', tone: 'text-red-600 dark:text-red-400 font-semibold' }
  if (!a.decrement_applied && a.increment_applied)
    return { label: 'Arrived, never left source', tone: 'text-amber-600 dark:text-amber-400 font-semibold' }
  return { label: 'Neither leg applied', tone: 'text-gray-400 dark:text-gray-500' }
}

export default function TransfersSearch() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<TransfersSearchHit[]>([])
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState<TransfersSearchHit | null>(null)
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

      searchTransfers(needle, 50, controller.signal)
        .then(res => {
          setHits(res.results); setTruncated(res.truncated); setSearched(true)
        })
        .catch(e => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          // A failed lookup must not render as an empty result set — "never
          // transferred" and "the search broke" are different answers.
          setError(e instanceof Error ? e.message : 'Search failed')
          setHits([]); setSearched(false)
        })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
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
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
        <label className="block text-sm font-medium mb-2 text-gray-900 dark:text-gray-100" htmlFor="transfers-search">
          Find a book's transfer history
        </label>
        <div className="flex items-center gap-2">
          <input
            id="transfers-search"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Title, ISBN, publisher, transfer #, or location"
            className="flex-1 px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="text-sm px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Clear
            </button>
          )}
        </div>
        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Every move for one title, and whether both legs of each landed. Partial matches work; ISBNs match with or without hyphens.
        </div>

        {error && (
          <div className="mt-3 text-sm rounded-md border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2">
            {error}
          </div>
        )}

        {searching && <div className="mt-3 text-sm text-gray-400">Searching…</div>}

        {!searching && !error && searched && hits.length === 0 && (
          <div className="mt-3 text-sm text-gray-400 dark:text-gray-500 px-3 py-3 border rounded-md border-dashed dark:border-gray-700">
            Nothing found for “{q.trim()}”. That means this title has never moved between
            locations — not that it has nothing on hand.
          </div>
        )}

        {!searching && !error && hits.length > 0 && (
          <div className="mt-3 border dark:border-gray-700 rounded-md overflow-hidden max-h-80 overflow-y-auto">
            {hits.map(h => (
              <button
                key={h.inventory_item_id}
                onClick={() => setSelected(h)}
                className="w-full text-left grid grid-cols-12 gap-2 items-center px-3 py-2 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm last:border-b-0"
              >
                <span className="col-span-5 font-medium truncate text-gray-900 dark:text-gray-100">
                  {h.title ?? '—'}
                </span>
                <span className="col-span-2 font-mono text-xs text-gray-400">{h.isbn ?? '—'}</span>
                <span className="col-span-2 truncate text-xs text-gray-500 dark:text-gray-400">
                  {h.publisher ?? '—'}
                </span>
                <span className="col-span-1 text-right text-xs tabular-nums text-gray-500">
                  {h.appearance_count}×
                </span>
                <span className="col-span-2 text-right text-xs tabular-nums">
                  {h.stranded_lines > 0 ? (
                    <span className="text-red-600 dark:text-red-400 font-semibold">
                      {h.stranded_lines} stranded
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      {qty(h.total_sent)} sent
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {truncated && hits.length > 0 && (
          <div className="mt-2 text-xs text-gray-400">
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
            className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-semibold truncate text-gray-900 dark:text-gray-100">
                  {selected.title ?? '—'}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  <span className="font-mono">{selected.isbn ?? '—'}</span>
                  {' · '}{selected.publisher ?? '—'}
                  {selected.vendor_code && ` (${selected.vendor_code})`}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 shrink-0"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-4 py-2 text-sm border-b border-gray-100 dark:border-gray-800 text-gray-600 dark:text-gray-400">
              {selected.appearance_count} move{selected.appearance_count === 1 ? '' : 's'}
              {' · '}{qty(selected.total_sent)} sent, {qty(selected.total_received)} received
              {selected.stranded_lines > 0 && (
                <span className="ml-2 text-red-600 dark:text-red-400 font-semibold">
                  · {selected.stranded_lines} line{selected.stranded_lines === 1 ? '' : 's'} left the source and never arrived
                </span>
              )}
            </div>

            <div className="overflow-y-auto">
              {selected.appearances.map(a => {
                const verdict = legVerdict(a)
                return (
                  <div
                    key={a.transfer_id}
                    className="grid grid-cols-12 gap-2 items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800 text-sm last:border-b-0"
                  >
                    <div className="col-span-3 font-mono text-xs text-gray-700 dark:text-gray-300">
                      {a.transfer_number ?? '—'}
                      {a.is_test && (
                        <span className="ml-1 text-[9px] font-bold px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 uppercase">
                          Test
                        </span>
                      )}
                    </div>
                    <div className="col-span-3 text-xs text-gray-500 dark:text-gray-400">
                      {place(a.from_location)} &rarr; {place(a.to_location)}
                      <span className="block text-gray-400">{shortDate(a.date)}</span>
                    </div>
                    <div className="col-span-2 text-right tabular-nums text-xs">
                      {qty(a.quantity_sent)} sent
                      <span className="block text-gray-400">{qty(a.quantity_received)} received</span>
                    </div>
                    <div className={`col-span-4 text-xs text-right ${verdict.tone}`}>
                      {verdict.label}
                      {!!a.quantity_damaged && (
                        <span className="block text-amber-600 dark:text-amber-400">
                          {a.quantity_damaged} damaged
                        </span>
                      )}
                    </div>
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
