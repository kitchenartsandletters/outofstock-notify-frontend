// PreorderSummaryCards.tsx
import React, { useState, useEffect } from "react"
import { PreorderSummaryMetrics } from "../../types/preorderTypes"
import { formatDate } from "../../utils/tableUtils"
import ConfirmModal from "../ConfirmModal"

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface LateArrival {
  product_id: number
  title: string
  isbn: string | null
  pub_date: string
  first_positive_inventory_at: string
}

interface NoArrivalTitle {
  product_id: number
  title: string
  isbn: string | null
  pub_date: string
  classification: string
}

interface ArrivedActiveTitle {
  product_id: number
  title: string
  isbn: string | null
  pub_date: string | null
  first_positive_inventory_at: string | null
}

interface PubDateDiscrepancy {
  id: number
  product_id: number
  isbn13: string
  title: string
  shopify_pub_date: string
  edelweiss_pub_date: string
  delta_days: number       // positive = slipped, negative = moved earlier
  detected_at: string
  status: "open" | "resolved" | "dismissed"
}

interface PreorderSummaryCardsProps {
  metrics: PreorderSummaryMetrics
  loading?: boolean
  onFetchLateArrivals: () => Promise<any[]>
  onMetricsRefresh?: () => void
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const PREORDER_SERVICE_URL = import.meta.env.VITE_PREORDER_BASE_URL
const EDELWEISS_SERVICE_URL = import.meta.env.VITE_EDELWEISS_SERVICE_URL
const PREORDER_TOKEN = import.meta.env.VITE_PREORDER_ADMIN_TOKEN
const EDELWEISS_KEY  = import.meta.env.VITE_EDELWEISS_ADMIN_KEY

const preorderHeaders = () => ({
  "Content-Type": "application/json",
  "X-Admin-Token": PREORDER_TOKEN,
})

const edelweissHeaders = () => ({
  "Content-Type": "application/json",
  "x-admin-key": EDELWEISS_KEY,
})

// ──────────────────────────────────────────────
// Dismiss reasons
// ──────────────────────────────────────────────

const LATE_ARRIVAL_REASONS = [
  "All presale orders fulfilled",
  "Vendor contacted — resolution pending",
  "Manual resolution — orders handled",
  "Other",
]

const NO_ARRIVAL_REASONS = [
  "Vendor contacted — shipment expected",
  "Title cancelled by publisher",
  "Orders refunded — no longer needed",
  "Other",
]

const PUBDATE_DISMISS_REASONS = [
  "Pub date updated in Shopify",
  "Publisher confirmed original date stands",
  "Title cancelled — no action needed",
  "Other",
]

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

const MetricCard = ({ label, value, sub }: {
  label: string
  value: number | string
  sub?: string
}) => (
  <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-md p-3 sm:p-4 shadow-sm transition-colors">
    <div className="text-[9px] sm:text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold truncate">
      {label}
    </div>
    <div className="text-xl sm:text-2xl font-bold mt-1 sm:mt-2 text-gray-900 dark:text-white font-mono">
      {typeof value === "number" ? value.toLocaleString() : value}
    </div>
    {sub && (
      <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{sub}</div>
    )}
  </div>
)

const MetricCardSkeleton = () => (
  <div className="bg-white dark:bg-gray-900 border dark:border-gray-700 rounded-md p-3 sm:p-4 shadow-sm">
    <div className="h-2.5 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-3" />
    <div className="h-7 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
  </div>
)

function currentWeekLabel(): string {
  const today = new Date()
  const dow = today.getDay()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - dow)
  const saturday = new Date(sunday)
  saturday.setDate(sunday.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${fmt(sunday)} – ${fmt(saturday)}`
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function deltaBadge(days: number): string {
  if (days > 0) return `+${days}d later`
  return `${days}d earlier`
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

const PreorderSummaryCards: React.FC<PreorderSummaryCardsProps> = ({
  metrics,
  loading = false,
  onFetchLateArrivals,
  onMetricsRefresh,
}) => {
  // Late arrivals
  const [lateArrivals, setLateArrivals] = useState<LateArrival[]>([])
  const [showLateArrivals, setShowLateArrivals] = useState(false)
  const [loadingLate, setLoadingLate] = useState(false)

  // No-arrival titles
  const [noArrivals, setNoArrivals] = useState<NoArrivalTitle[]>([])
  const [showNoArrivals, setShowNoArrivals] = useState(false)
  const [loadingNoArrivals, setLoadingNoArrivals] = useState(false)

  // Arrived-but-still-active titles (stock received, oversold into negative)
  const [arrivedActive, setArrivedActive] = useState<ArrivedActiveTitle[]>([])
  const [showArrivedActive, setShowArrivedActive] = useState(false)
  const [loadingArrivedActive, setLoadingArrivedActive] = useState(false)

  // Pub date discrepancies
  const [discrepancies, setDiscrepancies] = useState<PubDateDiscrepancy[]>([])
  const [discrepancyCount, setDiscrepancyCount] = useState<number | null>(null)
  const [showDiscrepancies, setShowDiscrepancies] = useState(false)
  const [loadingDiscrepancies, setLoadingDiscrepancies] = useState(false)

  // Fetch discrepancy count on mount — determines whether to show the alert bar
  useEffect(() => {
    fetch(`${EDELWEISS_SERVICE_URL}/discrepancies`, { headers: edelweissHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setDiscrepancyCount(data.count ?? 0) })
      .catch(() => setDiscrepancyCount(0))
  }, [])

  // Dismiss state
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({})
  const [dismissModal, setDismissModal] = useState<{
    open: boolean
    productId: number
    title: string
    alertType: "late_arrival" | "no_arrival" | "pubdate"
    selectedReason: string
  }>({ open: false, productId: 0, title: "", alertType: "late_arrival", selectedReason: "" })

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      </div>
    )
  }

  // ── Fetch handlers ──

  const handleLateArrivalsClick = async () => {
    if (showLateArrivals) { setShowLateArrivals(false); return }
    setLoadingLate(true)
    try {
      const data = await onFetchLateArrivals()
      setLateArrivals(data)
      setShowLateArrivals(true)
    } catch (err) {
      console.error("Failed to fetch late arrivals", err)
      // Still expand so the empty-state renders instead of the panel looking inert.
      setLateArrivals([])
      setShowLateArrivals(true)
    } finally {
      setLoadingLate(false)
    }
  }

  const handleNoArrivalsClick = async () => {
    if (showNoArrivals) { setShowNoArrivals(false); return }
    setLoadingNoArrivals(true)
    try {
      const res = await fetch(
        `${PREORDER_SERVICE_URL}/admin/preorders/no-arrival-titles`,
        { headers: preorderHeaders() }
      )
      if (res.ok) {
        setNoArrivals(await res.json())
        setShowNoArrivals(true)
      }
    } catch (err) {
      console.error("Failed to fetch no-arrival titles", err)
    } finally {
      setLoadingNoArrivals(false)
    }
  }

  // Arrived-active titles are derived client-side from /products: active preorders
  // carrying a live arrival record. No dedicated endpoint — detachment happens in
  // the Shipping Profiles view, this bar is purely informational.
  const handleArrivedActiveClick = async () => {
    if (showArrivedActive) { setShowArrivedActive(false); return }
    setLoadingArrivedActive(true)
    try {
      const res = await fetch(
        `${PREORDER_SERVICE_URL}/admin/preorders/products`,
        { headers: preorderHeaders() }
      )
      if (res.ok) {
        const rows: any[] = await res.json()
        const filtered: ArrivedActiveTitle[] = rows
          .filter(r => r.classification === "active_preorder" && r.arrival_record_is_live === true)
          .map(r => ({
            product_id: r.product_id,
            title: r.title,
            isbn: r.isbn ?? null,
            pub_date: r.pub_date ?? null,
            first_positive_inventory_at: r.first_positive_inventory_at ?? null,
          }))
        setArrivedActive(filtered)
        setShowArrivedActive(true)
      }
    } catch (err) {
      console.error("Failed to fetch arrived-active titles", err)
    } finally {
      setLoadingArrivedActive(false)
    }
  }

  const handleDiscrepanciesClick = async () => {
    if (showDiscrepancies) { setShowDiscrepancies(false); return }
    setLoadingDiscrepancies(true)
    try {
      const res = await fetch(
        `${EDELWEISS_SERVICE_URL}/discrepancies`,
        { headers: edelweissHeaders() }
      )
      if (res.ok) {
        const data = await res.json()
        setDiscrepancies(data.discrepancies ?? [])
        setDiscrepancyCount(data.count ?? 0)
        setShowDiscrepancies(true)
      }
    } catch (err) {
      console.error("Failed to fetch pub date discrepancies", err)
    } finally {
      setLoadingDiscrepancies(false)
    }
  }

  // ── Dismiss handlers ──

  const dismissAlert = async (
    productId: number,
    alertType: "late_arrival" | "no_arrival",
    reason: string
  ) => {
    const key = `${alertType}-${productId}`
    setDismissing(p => ({ ...p, [key]: true }))
    try {
      const res = await fetch(
        `${PREORDER_SERVICE_URL}/admin/preorders/alerts/dismiss/${productId}`,
        {
          method: "POST",
          headers: preorderHeaders(),
          body: JSON.stringify({ alert_type: alertType, reason }),
        }
      )
      if (res.ok) {
        if (alertType === "late_arrival") {
          setLateArrivals(prev => prev.filter(a => a.product_id !== productId))
        } else {
          setNoArrivals(prev => prev.filter(a => a.product_id !== productId))
        }
        onMetricsRefresh?.()
      }
    } catch (e) {
      console.error(`Failed to dismiss alert for ${productId}:`, e)
    } finally {
      setDismissing(p => ({ ...p, [key]: false }))
    }
  }

  const dismissDiscrepancy = async (productId: number, reason: string) => {
    const key = `pubdate-${productId}`
    setDismissing(p => ({ ...p, [key]: true }))
    try {
      const res = await fetch(
        `${EDELWEISS_SERVICE_URL}/discrepancies/${productId}/resolve`,
        {
          method: "POST",
          headers: edelweissHeaders(),
          body: JSON.stringify({ resolved_by: reason }),
        }
      )
      if (res.ok) {
        setDiscrepancies(prev => prev.filter(d => d.product_id !== productId))
      }
    } catch (e) {
      console.error(`Failed to resolve discrepancy for ${productId}:`, e)
    } finally {
      setDismissing(p => ({ ...p, [key]: false }))
    }
  }

  const reasons = dismissModal.alertType === "late_arrival"
    ? LATE_ARRIVAL_REASONS
    : dismissModal.alertType === "no_arrival"
    ? NO_ARRIVAL_REASONS
    : PUBDATE_DISMISS_REASONS

  return (
    <div className="space-y-3">
      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <MetricCard label="Active Preorders" value={metrics.active_preorders} />
        <MetricCard label="Early Stock" value={metrics.early_arrivals} />
        <MetricCard
          label="This Week's Releases"
          value={metrics.releases_this_week}
          sub={metrics.releases_this_week > 0
            ? `pub dates ${currentWeekLabel()}`
            : "no releases this week"
          }
        />
        <MetricCard
          label="Live Presales"
          value={metrics.total_live_presold_units}
          sub={
            metrics.total_estimated_presold_units > metrics.total_live_presold_units
              ? `${metrics.total_estimated_presold_units.toLocaleString()} incl. estimated`
              : "all verified"
          }
        />
      </div>

      {/* ── Alerts ── */}
      <div className="flex flex-col gap-1.5">

        {/* ── Pub Date Discrepancies (from edelweiss-service) ── */}
        {(discrepancyCount === null || discrepancyCount > 0) && (
        <div className="flex flex-col gap-1 px-3 py-2 rounded border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={handleDiscrepanciesClick}
          >
            <span className="text-orange-600 dark:text-orange-400 text-sm font-bold">
              {discrepancyCount ?? "…"}
            </span>
            <span className="text-xs text-orange-700 dark:text-orange-300 flex-1">
              Edelweiss pub date mismatches
            </span>
            <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">
              {loadingDiscrepancies ? "…" : showDiscrepancies ? "▲" : "▼"}
            </span>
          </div>

          {showDiscrepancies && discrepancies.length > 0 && (
            <div className="mt-2 space-y-1.5 border-t border-orange-200 dark:border-orange-700 pt-2">
              {discrepancies.map(row => {
                const key = `pubdate-${row.product_id}`
                const slipped = row.delta_days > 0
                return (
                  <div key={row.product_id} className="flex items-center justify-between text-xs gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-orange-800 dark:text-orange-200 font-medium truncate block max-w-[220px]">
                        {row.title}
                      </span>
                      <span className="text-orange-600 dark:text-orange-400 font-mono text-[10px]">
                        Shopify: {formatDateShort(row.shopify_pub_date)}
                        {" → "}
                        Edelweiss: {formatDateShort(row.edelweiss_pub_date)}
                        {" "}
                        <span className={slipped
                          ? "text-red-600 dark:text-red-400 font-semibold"
                          : "text-blue-600 dark:text-blue-400 font-semibold"
                        }>
                          ({deltaBadge(row.delta_days)})
                        </span>
                      </span>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setDismissModal({
                          open: true,
                          productId: row.product_id,
                          title: row.title,
                          alertType: "pubdate",
                          selectedReason: "",
                        })
                      }}
                      disabled={!!dismissing[key]}
                      className="px-2 py-0.5 text-[10px] rounded border border-orange-300 dark:border-orange-700
                                 text-orange-600 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/40 shrink-0"
                    >
                      {dismissing[key] ? "…" : "Resolve"}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {showDiscrepancies && discrepancies.length === 0 && !loadingDiscrepancies && (
            <div className="mt-2 border-t border-orange-200 dark:border-orange-700 pt-2">
              <span className="text-xs text-orange-400">All pub dates match Edelweiss.</span>
            </div>
          )}
        </div>

        )}

        {/* ── Stock Received — Active (informational) ── */}
        {metrics.arrived_active_count > 0 && (
          <div className="flex flex-col gap-1 px-3 py-2 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={handleArrivedActiveClick}
            >
              <span className="text-emerald-600 dark:text-emerald-400 text-sm font-bold">
                {metrics.arrived_active_count}
              </span>
              <span className="text-xs text-emerald-700 dark:text-emerald-300 flex-1">
                active {metrics.arrived_active_count === 1 ? "preorder has" : "preorders have"} received stock — candidate{metrics.arrived_active_count === 1 ? "" : "s"} for shipping-profile detachment
              </span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {loadingArrivedActive ? "…" : showArrivedActive ? "▲" : "▼"}
              </span>
            </div>

            {showArrivedActive && arrivedActive.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-emerald-200 dark:border-emerald-700 pt-2">
                {arrivedActive.map(row => (
                  <div key={row.product_id} className="flex items-center justify-between text-xs gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-emerald-800 dark:text-emerald-200 font-medium truncate block max-w-[260px]">
                        {row.title}
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono text-[10px]">
                        {row.pub_date ? `pub ${formatDateShort(row.pub_date)}` : "no pub date"}
                        {row.first_positive_inventory_at ? ` · stock ${formatDateShort(row.first_positive_inventory_at)}` : ""}
                      </span>
                    </div>
                    <span className="text-emerald-500 dark:text-emerald-400 text-[10px] italic shrink-0">
                      detach in Shipping Profiles
                    </span>
                  </div>
                ))}
              </div>
            )}

            {showArrivedActive && arrivedActive.length === 0 && !loadingArrivedActive && (
              <div className="mt-2 border-t border-emerald-200 dark:border-emerald-700 pt-2">
                <span className="text-xs text-emerald-400">No arrived active preorders.</span>
              </div>
            )}
          </div>
        )}

        {/* ── No-Arrival Alert ── */}
        {metrics.no_arrival_count > 0 && (
          <div className="flex flex-col gap-1 px-3 py-2 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={handleNoArrivalsClick}
            >
              <span className="text-red-600 dark:text-red-400 text-sm font-bold">
                {metrics.no_arrival_count}
              </span>
              <span className="text-xs text-red-700 dark:text-red-300 flex-1">
                {metrics.no_arrival_count === 1 ? "title" : "titles"} published with no inventory received — contact vendor
              </span>
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                {loadingNoArrivals ? "…" : showNoArrivals ? "▲" : "▼"}
              </span>
            </div>

            {showNoArrivals && noArrivals.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-red-200 dark:border-red-700 pt-2">
                {noArrivals.map(row => {
                  const key = `no_arrival-${row.product_id}`
                  return (
                    <div key={row.product_id} className="flex items-center justify-between text-xs gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-red-800 dark:text-red-200 font-medium truncate block max-w-[260px]">
                          {row.title}
                        </span>
                        <span className="text-red-500 dark:text-red-400 font-mono text-[10px]">
                          pub {formatDateShort(row.pub_date)}
                        </span>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setDismissModal({
                            open: true,
                            productId: row.product_id,
                            title: row.title,
                            alertType: "no_arrival",
                            selectedReason: "",
                          })
                        }}
                        disabled={!!dismissing[key]}
                        className="px-2 py-0.5 text-[10px] rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 shrink-0"
                      >
                        {dismissing[key] ? "…" : "Resolve"}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {showNoArrivals && noArrivals.length === 0 && !loadingNoArrivals && (
              <div className="mt-2 border-t border-red-200 dark:border-red-700 pt-2">
                <span className="text-xs text-red-400">All no-arrival alerts have been resolved.</span>
              </div>
            )}
          </div>
        )}

        {/* ── Late Arrivals Alert ── */}
        {metrics.late_arrivals_unresolved > 0 && (
          <div className="flex flex-col gap-1 px-3 py-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={handleLateArrivalsClick}
            >
              <span className="text-amber-600 dark:text-amber-400 text-sm font-bold">
                {metrics.late_arrivals_unresolved}
              </span>
              <span className="text-xs text-amber-700 dark:text-amber-300 flex-1">
                {metrics.late_arrivals_unresolved === 1 ? "title" : "titles"} received
                inventory after pub date with open presale commitments
              </span>
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {loadingLate ? "…" : showLateArrivals ? "▲" : "▼"}
              </span>
            </div>

            {showLateArrivals && lateArrivals.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t border-amber-200 dark:border-amber-700 pt-2">
                {lateArrivals.map(row => {
                  const key = `late_arrival-${row.product_id}`
                  return (
                    <div key={row.product_id} className="flex items-center justify-between text-xs gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-amber-800 dark:text-amber-200 font-medium truncate block max-w-[260px]">
                          {row.title}
                        </span>
                        <span className="text-amber-600 dark:text-amber-400 font-mono text-[10px]">
                          pub {formatDateShort(row.pub_date)} · stock {formatDateShort(row.first_positive_inventory_at)}
                        </span>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          setDismissModal({
                            open: true,
                            productId: row.product_id,
                            title: row.title,
                            alertType: "late_arrival",
                            selectedReason: "",
                          })
                        }}
                        disabled={!!dismissing[key]}
                        className="px-2 py-0.5 text-[10px] rounded border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 shrink-0"
                      >
                        {dismissing[key] ? "…" : "Resolve"}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {showLateArrivals && lateArrivals.length === 0 && !loadingLate && (
              <div className="mt-2 border-t border-amber-200 dark:border-amber-700 pt-2">
                <span className="text-xs text-amber-400">
                  No late-arrival details to show. If the count persists, refresh — the list and count may be briefly out of sync.
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Dismiss Modal ── */}
      <ConfirmModal
        open={dismissModal.open}
        onCancel={() => setDismissModal(p => ({ ...p, open: false }))}
        onConfirm={async () => {
          if (!dismissModal.selectedReason) return
          setDismissModal(p => ({ ...p, open: false }))
          if (dismissModal.alertType === "pubdate") {
            await dismissDiscrepancy(dismissModal.productId, dismissModal.selectedReason)
          } else {
            await dismissAlert(dismissModal.productId, dismissModal.alertType as "late_arrival" | "no_arrival", dismissModal.selectedReason)
          }
        }}
        title={
          dismissModal.alertType === "late_arrival" ? "Resolve Late Arrival Alert"
          : dismissModal.alertType === "no_arrival" ? "Resolve No-Arrival Alert"
          : "Resolve Pub Date Mismatch"
        }
        variant="primary"
        confirmLabel="Resolve"
      >
        <p className="mb-3">
          Resolving alert for <span className="font-medium">{dismissModal.title}</span>
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Select a reason:</p>
        <div className="space-y-2">
          {reasons.map(reason => (
            <label
              key={reason}
              className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm transition-colors ${
                dismissModal.selectedReason === reason
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200"
                  : "border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="dismiss-reason"
                checked={dismissModal.selectedReason === reason}
                onChange={() => setDismissModal(p => ({ ...p, selectedReason: reason }))}
                className="text-blue-600"
              />
              {reason}
            </label>
          ))}
        </div>
      </ConfirmModal>
    </div>
  )
}

export default PreorderSummaryCards
