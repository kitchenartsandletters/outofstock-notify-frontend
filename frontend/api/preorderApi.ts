// preorderApi.ts
import {
  PreorderRow,
  ReleaseReviewRow,
  PreorderSummaryMetrics,
  ReportablePreorderRow
} from "../src/types/preorderTypes"

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------

const PREORDER_BASE_URL = import.meta.env.VITE_PREORDER_BASE_URL
const ADMIN_TOKEN = import.meta.env.VITE_PREORDER_ADMIN_TOKEN

const headers = {
  "Content-Type": "application/json",
  "X-Admin-Token": ADMIN_TOKEN
}

// -----------------------------------------------------------------------------
// API Response Types — aligned to Phase 3/5 view column names
// -----------------------------------------------------------------------------

type PreorderProductAPI = {
  product_id: number
  title: string | null
  isbn: string | null
  inventory: number | null
  live_presale_qty: number | null
  estimated_presale_qty: number | null
  total_presale_qty: number | null
  data_confidence: "verified" | "estimated"
  pub_date: string | null
  classification: string
  preorder_tag_present: boolean | null
  preorder_collection_present: boolean | null
  override_status: string | null
  anomaly_type: string | null
  arrival_timing: string | null
  arrival_record_is_live: boolean
  due_for_release_review: boolean
  early_stock_arrival: boolean
  already_reported: boolean
  last_updated: string | null
  first_positive_inventory_at: string | null
  lifecycle_closed: boolean
}

type ReleaseQueueAPI = PreorderProductAPI

type PreorderMetricsAPI = {
  active_preorders: number
  early_arrivals: number
  releases_due_for_review: number
  releases_this_week: number
  total_live_presold_units: number | string
  total_estimated_presold_units: number | string
  late_arrivals_unresolved: number
  no_arrival_count: number
  arrived_active_count: number
}

type ReportableAPI = ReportablePreorderRow

// -----------------------------------------------------------------------------
// Generic Fetch Helper
// -----------------------------------------------------------------------------

async function fetchFromService<T>(path: string): Promise<T> {
  const res = await fetch(`${PREORDER_BASE_URL}${path}`, { headers })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Preorder service error (${res.status}): ${text}`)
  }

  return res.json()
}

// -----------------------------------------------------------------------------
// Adapters (API → UI Types)
// -----------------------------------------------------------------------------

function adaptProductRow(row: PreorderProductAPI): PreorderRow {
  return {
    product_id: row.product_id,
    title: row.title,
    isbn: row.isbn,
    inventory: row.inventory ?? 0,
    live_presale_qty: row.live_presale_qty ?? 0,
    estimated_presale_qty: row.estimated_presale_qty ?? 0,
    total_presale_qty: row.total_presale_qty ?? 0,
    data_confidence: row.data_confidence ?? "estimated",
    classification: row.classification,
    anomaly_type: row.anomaly_type,
    pub_date: row.pub_date,
    arrival_timing: row.arrival_timing as PreorderRow["arrival_timing"],
    arrival_record_is_live: row.arrival_record_is_live ?? false,
    preorder_tag_present: row.preorder_tag_present,
    preorder_collection_present: row.preorder_collection_present,
    override_status: (row.override_status ?? "none") as PreorderRow["override_status"],
    due_for_release_review: row.due_for_release_review ?? false,
    early_stock_arrival: row.early_stock_arrival ?? false,
    already_reported: row.already_reported ?? false,
    last_updated: row.last_updated,
    first_positive_inventory_at: row.first_positive_inventory_at ?? null,
    lifecycle_closed: false,
  }
}

function adaptReleaseQueueRow(row: ReleaseQueueAPI): ReleaseReviewRow {
  return {
    product_id: row.product_id,
    title: row.title,
    isbn: row.isbn,
    live_presale_qty: row.live_presale_qty ?? 0,
    estimated_presale_qty: row.estimated_presale_qty ?? 0,
    total_presale_qty: row.total_presale_qty ?? 0,
    data_confidence: row.data_confidence ?? "estimated",
    classification: row.classification,
    pub_date: row.pub_date,
    arrival_timing: row.arrival_timing as ReleaseReviewRow["arrival_timing"],
    // Carry the live-arrival flag so the Releases Upcoming stock label can show
    // "Received · oversold" for arrived-but-negative titles. Without this the
    // field is dropped and the pill falls through to "Awaiting stock".
    arrival_record_is_live: row.arrival_record_is_live ?? false,
    due_for_release_review: row.due_for_release_review ?? false,
    early_stock_arrival: row.early_stock_arrival ?? false,
    anomaly_type: row.anomaly_type,
    override_status: (row.override_status ?? "none") as ReleaseReviewRow["override_status"],
    last_updated: row.last_updated,
    inventory: row.inventory ?? null,
  }
}

function adaptMetrics(row: PreorderMetricsAPI): PreorderSummaryMetrics {
  return {
    active_preorders: row.active_preorders ?? 0,
    early_arrivals: row.early_arrivals ?? 0,
    releases_due_for_review: row.releases_due_for_review ?? 0,
    releases_this_week: row.releases_this_week ?? 0,
    total_live_presold_units: Number(row.total_live_presold_units) ?? 0,
    total_estimated_presold_units: Number(row.total_estimated_presold_units) ?? 0,
    late_arrivals_unresolved: row.late_arrivals_unresolved ?? 0,
    no_arrival_count: row.no_arrival_count ?? 0,
    arrived_active_count: row.arrived_active_count ?? 0,
  }
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function fetchPreorderProducts(): Promise<PreorderRow[]> {
  const data = await fetchFromService<PreorderProductAPI[]>(
    "/admin/preorders/products"
  )
  return data.map(adaptProductRow)
}

export async function fetchPreorderReleaseQueue(): Promise<ReleaseReviewRow[]> {
  const data = await fetchFromService<ReleaseQueueAPI[]>(
    "/admin/preorders/release-queue"
  )
  return data.map(adaptReleaseQueueRow)
}

export async function fetchPreorderMetrics(): Promise<PreorderSummaryMetrics> {
  const data = await fetchFromService<PreorderMetricsAPI>(
    "/admin/preorders/metrics"
  )
  return adaptMetrics(data)
}

export async function reclassifyProduct(productId: number) {
  return fetchFromService(`/admin/preorders/reclassify/${productId}`)
}

export async function fetchUpcomingReleases(): Promise<ReleaseReviewRow[]> {
  const data = await fetchFromService<ReleaseQueueAPI[]>(
    "/admin/preorders/upcoming"
  )
  return data.map(adaptReleaseQueueRow)
}

export async function fetchReportablePreorders(): Promise<ReportablePreorderRow[]> {
  const data = await fetchFromService<ReportableAPI[]>(
    "/admin/preorders/reportable"
  )
  return data
}

export async function queueForReport(
  productIds: number[],
  weekAnchor: string
): Promise<{ marked: number; week_start: string; week_end: string }> {
  const res = await fetch(`${PREORDER_BASE_URL}/admin/preorders/mark-reported`, {
    method: "POST",
    headers,
    body: JSON.stringify({ product_ids: productIds, week_anchor: weekAnchor }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Queue for report failed (${res.status}): ${text}`)
  }
  return res.json()
}

// Backward compat alias if markReported is imported anywhere else
export const markReported = queueForReport

export async function generateReportPreview(
  productIds: number[],
  weekAnchor: string
): Promise<Blob> {
  const res = await fetch(`${PREORDER_BASE_URL}/admin/preorders/report/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ product_ids: productIds, week_anchor: weekAnchor }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Report preview failed (${res.status}): ${text}`)
  }
  return res.blob()
}

export async function fetchLateArrivals(): Promise<any[]> {
  const res = await fetch(`${PREORDER_BASE_URL}/admin/preorders/late-arrivals`, {
    headers,
  })
  if (!res.ok) throw new Error(`Late arrivals fetch failed (${res.status})`)
  return res.json()
}
