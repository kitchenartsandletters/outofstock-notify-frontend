// transfersSearchApi.ts
// Search transferred books by title, ISBN, publisher, transfer number or location.
// Backs the book-history search on the Transfers workspace.
//
// Standalone for the same reason as returnsSearchApi.ts: the fetch helpers in
// supplyChainApi.ts are module-private, and exporting them meant rewriting a
// large file to add twenty lines.

const SC_BASE_URL = import.meta.env.VITE_SC_BASE_URL as string
const SC_TOKEN = import.meta.env.VITE_SC_ADMIN_TOKEN as string
if (!SC_BASE_URL) console.error('[transfersSearchApi] VITE_SC_BASE_URL is not set')

const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': SC_TOKEN }

async function sc<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SC_BASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } })
  if (!res.ok) {
    let detail = res.statusText
    try { const body = await res.json(); detail = body.detail ?? body.message ?? detail } catch {}
    throw new Error(`[${res.status}] ${detail}`)
  }
  return res.json()
}

/** One transfer a book moved on.
 *
 *  `decrement_applied` / `increment_applied` are the pair that matters:
 *  both true is a completed move; decrement true with increment false means
 *  stock left the source and never arrived at the destination — physically on a
 *  shelf somewhere, invisible to the system.
 *
 *  Quantities can be null on a line dispatched but not yet received. Render
 *  null as an em dash, never 0: a transfer in flight has not received nothing,
 *  it has not been received yet. */
export interface TransferAppearance {
  transfer_id: string
  transfer_number: string | null
  status: string
  line_status: string | null
  created_at: string
  received_at: string | null
  /** received_at when received, otherwise created_at. */
  date: string
  from_location: string | null
  to_location: string | null
  quantity_sent: number | null
  quantity_received: number | null
  quantity_damaged: number | null
  decrement_applied: boolean
  increment_applied: boolean
  is_test: boolean
}

export interface TransfersSearchHit {
  inventory_item_id: string
  isbn: string | null
  title: string | null
  /** Resolved publisher name, falling back to the legacy code when the vendor
   *  code has no party row (e.g. the SMP Small Press catch-all). */
  publisher: string | null
  vendor_code: string | null
  appearance_count: number
  total_sent: number | null
  total_received: number | null
  /** Lines where stock left but never arrived. Non-zero means units are
   *  physically somewhere the system cannot see. */
  stranded_lines: number
  last_moved_at: string
  appearances: TransferAppearance[]
}

export interface TransfersSearchResponse {
  query: string
  count: number
  truncated: boolean
  results: TransfersSearchHit[]
}

/**
 * Partial, case-insensitive match against title, ISBN, publisher name, legacy
 * vendor code, transfer number and location name.
 *
 * ISBNs match with or without hyphens: '9780714879338', '978-0-7148-7933-8'
 * and a partial '071487933' all find the same book.
 */
export async function searchTransfers(
  q: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<TransfersSearchResponse> {
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) })
  return sc(`/api/reporting/transfers-search?${params.toString()}`, { signal })
}
