// returnsSearchApi.ts
// Search returned books by title, ISBN, or publisher.
// Backs the search field on the Publisher Returns workspace.
//
// Standalone rather than folded into returnsApi.ts: that module's `sc` and `qs`
// helpers are module-private, and exporting them meant rewriting a 300-line file
// inline to add twenty lines. The duplication below is deliberate and small; if
// a third returns module appears, lift both helpers into a shared client.

const SC_BASE_URL = import.meta.env.VITE_SC_BASE_URL as string
const SC_TOKEN = import.meta.env.VITE_SC_ADMIN_TOKEN as string
if (!SC_BASE_URL) console.error('[returnsSearchApi] VITE_SC_BASE_URL is not set')

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

/** One return a book appears on. Quantities are null until the return is picked
 *  or confirmed — null means "not yet known", never zero. Render null as an em
 *  dash; a draft that hasn't been picked is not a return of nothing. */
export interface ReturnAppearance {
  return_id: string
  return_number: string | null
  status: 'draft' | 'picking' | 'confirmed' | 'shipped' | 'cancelled'
  return_type: string | null
  created_at: string
  shipped_at: string | null
  /** shipped_at when shipped, otherwise created_at. */
  date: string
  quantity_requested: number | null
  quantity_picked: number | null
  quantity_confirmed: number | null
  notes: string | null
}

export interface ReturnsSearchHit {
  isbn: string | null
  title: string | null
  inventory_item_id: string | null
  publisher: string | null
  /** Legacy publisher code, e.g. 'PHAI'. Searchable. */
  returns_code: string | null
  appearance_count: number
  /** Sum of confirmed quantities across all returns. Null if none confirmed. */
  total_confirmed: number | null
  last_seen_at: string
  appearances: ReturnAppearance[]
}

export interface ReturnsSearchResponse {
  query: string
  count: number
  truncated: boolean
  results: ReturnsSearchHit[]
}

/**
 * Partial, case-insensitive match against title, ISBN, and publisher name,
 * legal name or legacy returns_code.
 *
 * ISBNs match with or without hyphens: '9780714879338', '978-0-7148-7933-8'
 * and a partial '071487933' all find the same book.
 */
export async function searchReturns(
  q: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<ReturnsSearchResponse> {
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit) })
  return sc(`/api/reporting/returns-search?${params.toString()}`, { signal })
}
