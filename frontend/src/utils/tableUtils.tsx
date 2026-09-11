// src/utils/tableUtils.ts

/** Strip leading articles for sort purposes: "The Art of..." → "Art of..." */
export function sortTitle(title: string | null | undefined): string {
  if (!title) return ""
  return title.replace(/^(a |an |the )/i, "").toLowerCase()
}

/** Format YYYY-MM-DD or ISO timestamp to "Month DD, YYYY" */
export function formatDate(date: string | null | undefined): string {
  if (!date) return "—"
  // Split YYYY-MM-DD directly to avoid timezone offset issues.
  // new Date("2026-04-07") parses as UTC midnight which shifts to the
  // prior day when converted to ET. Parsing parts directly avoids this.
  const parts = date.substring(0, 10).split("-")
  if (parts.length !== 3) return "—"
  const [year, month, day] = parts.map(Number)
  if (!year || !month || !day) return "—"
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

/** Format a Date object to YYYY-MM-DD using local date parts.
 *  Never use toISOString() for date-only formatting — it returns UTC
 *  which shifts the date when the local timezone is behind UTC. */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Operational stock status label for the Releases Upcoming section.
 *  DEPRECATED in favor of stockStatusLabel — retained for back-compat with
 *  any remaining callers. Binary: on-hand vs awaiting, from inventory only. */
export function stockReceivedLabel(
  inventory: number,
  arrivalTiming: string | null | undefined
): { label: string; received: boolean } {
  // Primary signal: current inventory count.
  // If inventory is positive, stock is physically on hand now.
  // arrival_timing is not used here because it reflects historical
  // first-positive event which may have been a refund restock,
  // manual adjustment, or incoming PO allocation — not publisher receipt.
  if (inventory > 0) {
    return { label: "Stock in hand", received: true }
  }
  return { label: "Awaiting stock", received: false }
}

/** Three-state operational stock status.
 *
 *  Resolves the "Awaiting stock" contradiction for titles that physically
 *  received stock but oversold into negative inventory: those are neither
 *  "in hand" (no stock now) nor "awaiting" (stock did arrive). They are
 *  "Received · oversold".
 *
 *  Keyed off arrival_record_is_live — the clean live-webhook receipt signal
 *  (a live inventory event drove inventory positive within 60s) — NOT
 *  arrival_timing, which can reflect refund restocks / PO allocations and is
 *  the noise the binary label deliberately avoided.
 *
 *   inventory > 0                         → "Stock in hand"      (in_hand)
 *   inventory <= 0 && arrivalRecordIsLive → "Received · oversold" (received_oversold)
 *   inventory <= 0 && !arrivalRecordIsLive→ "Awaiting stock"     (awaiting)
 */
export function stockStatusLabel(
  inventory: number,
  arrivalRecordIsLive: boolean | null | undefined
): { label: string; state: "in_hand" | "received_oversold" | "awaiting" } {
  if (inventory > 0) return { label: "Stock in hand", state: "in_hand" }
  if (arrivalRecordIsLive) return { label: "Received · oversold", state: "received_oversold" }
  return { label: "Awaiting stock", state: "awaiting" }
}

export type SortDirection = "asc" | "desc"

export interface SortConfig<T> {
  key: keyof T
  direction: SortDirection
}

/** Returns next sort direction, toggling asc/desc, defaulting to asc */
export function nextSortDirection<T>(
  config: SortConfig<T> | null,
  key: keyof T
): SortDirection {
  if (config?.key === key && config.direction === "asc") return "desc"
  return "asc"
}

/** Sort icon element */
export function SortIcon({
  active,
  direction,
}: {
  active: boolean
  direction: SortDirection
}) {
  if (!active) return <span className="ml-1 text-gray-300 dark:text-gray-600">↕</span>
  return (
    <span className="ml-1 text-blue-500">
      {direction === "asc" ? "↑" : "↓"}
    </span>
  )
}
