// returnsApi.ts
// HTTP calls for the Publisher Returns workspace (reporting.returns_* endpoints
// on supply-chain-service). Same auth/env pattern as reviewReportApi.
const SC_BASE_URL = import.meta.env.VITE_SC_BASE_URL as string
const SC_TOKEN = import.meta.env.VITE_SC_ADMIN_TOKEN as string
if (!SC_BASE_URL) console.error('[returnsApi] VITE_SC_BASE_URL is not set')

const headers = { 'Content-Type': 'application/json', 'X-Admin-Token': SC_TOKEN }

async function sc<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SC_BASE_URL}${path}`, { ...options, headers: { ...headers, ...options.headers } })
  if (!res.ok) {
    let detail = res.statusText
    try { const body = await res.json(); detail = body.detail ?? body.message ?? detail } catch {}
    throw new Error(`[${res.status}] ${detail}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

export type ReturnStatus = 'draft' | 'picking' | 'confirmed' | 'shipped' | 'cancelled'
export type ReturnReason = 'overstock' | 'overstock_author_event'

// Carriers we can link a tracking number for. Anything else is allowed and
// simply shown as text — recording what happened matters more than a tidy list.
export const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'Other'] as const

const TRACKING_URLS: Record<string, string> = {
  UPS: 'https://www.ups.com/track?tracknum={n}',
  FEDEX: 'https://www.fedex.com/fedextrack/?trknbr={n}',
  USPS: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={n}',
  DHL: 'https://www.dhl.com/us-en/home/tracking.html?tracking-id={n}',
}

/** Tracking link for a carrier, or null when we have no URL pattern for it. */
export function trackingUrl(carrier?: string | null, number?: string | null): string | null {
  if (!carrier || !number) return null
  const tpl = TRACKING_URLS[carrier.trim().toUpperCase()]
  return tpl ? tpl.replace('{n}', encodeURIComponent(number.trim())) : null
}

// --- Suggestion side (tiles + per-publisher suggested lines) ---------------

export interface ReturnsPublisherTile {
  publisher_party_id: string
  publisher_name: string | null
  publisher_notes: string | null
  payment_terms: string | null
  default_return_address: string | null
  default_return_recipient: string | null
  default_return_account: string | null
  titles: number
  titles_with_excess: number
  on_hand_units: number
  on_hand_value: number
  return_units: number
  return_value_list: number
  never_sold_titles: number
}

export interface ReturnsWorksheetRow {
  inventory_item_id: string
  variant_id: string | null
  isbn: string | null
  title: string | null
  author: string | null
  price: number | null
  on_hand: number
  available: number | null
  on_order: number
  sales_12mo: number
  sales_24mo: number
  last_sold_at: string | null
  months_since_last_sold: number | null
  never_sold_ever: boolean
  publisher_party_id: string
  publisher_name: string | null
  keep_qty: number
  suggested_return: number
  suggested_return_value: number
}

export interface ReturnsWorksheetResponse {
  publisher: ReturnsPublisherTile | null
  rows: ReturnsWorksheetRow[]
  total: number
  limit: number
  offset: number
  sort: string
  order: 'asc' | 'desc'
  /** When the on-hand snapshot last ran; on_hand is not a live read. */
  snapshot_as_of?: string | null
  source?: string
}

export async function fetchReturnsPublishers(): Promise<ReturnsPublisherTile[]> {
  return sc('/api/reporting/returns/publishers')
}

export async function fetchReturnsWorksheet(
  publisherId: string,
  opts: { limit?: number; excessOnly?: boolean; search?: string; includeZeroStock?: boolean } = {},
): Promise<ReturnsWorksheetResponse> {
  return sc(`/api/reporting/returns/worksheet${qs({
    publisher_id: publisherId,
    limit: opts.limit ?? 1000,
    excess_only: opts.excessOnly || undefined,
    include_zero_stock: opts.includeZeroStock || undefined,
    search: opts.search,
  })}`)
}

// --- Persistence side (saved returns) --------------------------------------

export interface ReturnIndexRow {
  id: string
  supplier_party_id: string
  publisher_name: string | null
  status: ReturnStatus
  return_type: string | null
  return_number: string | null
  account_number: string | null
  ship_to_name: string | null
  ship_to_address: string | null
  notes: string | null
  created_at: string
  updated_at: string
  shipped_at: string | null
  line_count: number
  requested_units: number
  picked_units: number
  confirmed_units: number
  requested_value: number
  confirmed_value: number
  carrier: string | null
  tracking_number: string | null
}

export interface ReturnLine {
  id: string
  return_id: string
  inventory_item_id: string
  variant_id: string | null
  isbn: string | null
  title: string | null
  list_price: number | null
  quantity_requested: number | null
  quantity_picked: number | null
  quantity_confirmed: number | null
  extended_value: number | null
  inventory_adjusted: boolean | null
  notes: string | null
}

export interface ReturnDetail {
  return: ReturnIndexRow
  lines: ReturnLine[]
  tracking_url?: string | null
}

export interface LineInput {
  inventory_item_id: string
  variant_id?: string | null
  isbn?: string | null
  title?: string | null
  list_price?: number | null
  quantity_requested: number
}

export interface CreateReturnInput {
  publisher_id: string
  reason?: ReturnReason
  account_number?: string
  notes?: string
  seed?: boolean
  excess_only?: boolean
}

export interface SaveReturnInput {
  notes?: string | null
  account_number?: string | null
  reason?: ReturnReason
  ship_to_name?: string | null
  ship_to_address?: string | null
  lines?: LineInput[]
}

export async function fetchReturnsList(status?: ReturnStatus): Promise<ReturnIndexRow[]> {
  return sc(`/api/reporting/returns${qs({ status })}`)
}

export async function fetchReturn(id: string): Promise<ReturnDetail> {
  return sc(`/api/reporting/returns/${id}`)
}

export async function createReturn(body: CreateReturnInput): Promise<ReturnDetail> {
  return sc('/api/reporting/returns', { method: 'POST', body: JSON.stringify(body) })
}

export async function saveReturn(id: string, body: SaveReturnInput): Promise<ReturnDetail> {
  return sc(`/api/reporting/returns/${id}`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function deleteReturn(id: string): Promise<{ deleted: boolean; id: string }> {
  return sc(`/api/reporting/returns/${id}`, { method: 'DELETE' })
}

// --- Fulfillment (pull sheet -> manifest -> shipped) -----------------------

export interface ManifestDelta {
  title: string | null
  isbn: string | null
  inventory_item_id: string
  delta: number
  already_adjusted: boolean
}

export interface ManifestSummary {
  return_id: string
  titles: number
  units: number
  value: number
  location_id: string
  deltas: ManifestDelta[]
}

export interface PackingListItem {
  title: string | null
  isbn: string | null
  list_price: number | null
  quantity: number
}

export interface PackingList {
  return_number: string | null
  publisher_name: string | null
  account_number: string | null
  reason: string | null
  ship_to_name: string | null
  ship_to_address: string | null
  status: ReturnStatus
  created_at: string
  shipped_at: string | null
  carrier?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  items: PackingListItem[]
  total_units: number
  total_value: number
}

export interface ManifestResult {
  status: ReturnStatus
  inventory: { applied: number; failed: number; skipped: number }
  errors: string[]
  summary: ManifestSummary
  packing_list: PackingList
}

export interface PickLineInput {
  line_id: string
  quantity_picked: number
}

export interface ShippingInput {
  carrier?: string | null
  tracking_number?: string | null
  shipped_at?: string | null
}

export async function startPick(id: string): Promise<ReturnDetail> {
  return sc(`/api/reporting/returns/${id}/start-pick`, { method: 'POST' })
}

export async function savePick(id: string, lines: PickLineInput[]): Promise<ReturnDetail> {
  return sc(`/api/reporting/returns/${id}/pick`, { method: 'PUT', body: JSON.stringify({ lines }) })
}

export async function manifestPreview(id: string): Promise<{ dry_run: true; summary: ManifestSummary }> {
  return sc(`/api/reporting/returns/${id}/manifest`, { method: 'POST', body: JSON.stringify({ dry_run: true }) })
}

export async function manifestReturn(id: string): Promise<ManifestResult> {
  return sc(`/api/reporting/returns/${id}/manifest`, { method: 'POST', body: JSON.stringify({ dry_run: false }) })
}

/** Record carrier + tracking on a confirmed return; moves it to shipped. */
export async function setShipping(id: string, body: ShippingInput): Promise<ReturnDetail> {
  return sc(`/api/reporting/returns/${id}/shipping`, { method: 'PUT', body: JSON.stringify(body) })
}

export async function fetchPackingList(id: string): Promise<PackingList> {
  return sc(`/api/reporting/returns/${id}/packing-list`)
}

export async function cancelReturn(id: string): Promise<{ cancelled: boolean; id: string }> {
  return sc(`/api/reporting/returns/${id}/cancel`, { method: 'POST' })
}
