import React, { useState, useMemo } from "react"
import { ReleaseReviewRow, ReportablePreorderRow } from "../../types/preorderTypes"
import { generateReportPreview, queueForReport } from "../../../api/preorderApi"
import {
  sortTitle, formatDate, stockStatusLabel, toISODate,
  SortConfig, SortIcon, nextSortDirection
} from "../../utils/tableUtils"

interface ReleaseReviewTableProps {
  upcoming: ReleaseReviewRow[]
  reportable: ReportablePreorderRow[]
  onReported?: () => void
}

function ConfidenceBadge({ confidence }: { confidence: "verified" | "estimated" }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ml-1.5 ${
      confidence === "verified"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
    }`}>
      {confidence === "verified" ? "✓" : "~"} {confidence}
    </span>
  )
}

// Three-state stock pill for the Upcoming section.
//  in_hand           → emerald ✓ "Stock in hand"
//  received_oversold → amber   ⚠ "Received · oversold"  (stock arrived, demand exceeds it — caution)
//  awaiting          → gray    ○ "Awaiting stock"
function StockStatusPill({ inventory, arrivalRecordIsLive }: {
  inventory: number
  arrivalRecordIsLive: boolean | null | undefined
}) {
  const stock = stockStatusLabel(inventory, arrivalRecordIsLive)
  const cls =
    stock.state === "in_hand"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : stock.state === "received_oversold"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
  const glyph =
    stock.state === "in_hand" ? "✓" : stock.state === "received_oversold" ? "⚠" : "○"
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded ${cls}`}>
      {glyph} {stock.label}
    </span>
  )
}

// ── Three-state status badge ───────────────────────────────────────────────────
function ReportingStatusBadge({ row }: { row: ReportablePreorderRow }) {
  if (row.is_reported) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">
        Reported
      </span>
    )
  }
  if (row.is_queued) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
        Queued
      </span>
    )
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
      Pending
    </span>
  )
}

function resolveWeekBounds(anchor: Date): { start: Date; end: Date; label: string } {
  const dayOfWeek = anchor.getDay()
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - dayOfWeek)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return { start, end, label: `${fmt(start)} – ${fmt(end)}, ${end.getFullYear()}` }
}

function daysUntil(pubDate: string | null): number | null {
  if (!pubDate) return null
  const diff = new Date(pubDate).getTime() - new Date().setHours(0, 0, 0, 0)
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

type UpcomingSortKey = "title" | "pub_date"
type ReportableSortKey = "title" | "pub_date"

const ReleaseReviewTable: React.FC<ReleaseReviewTableProps> = ({
  upcoming,
  reportable,
  onReported,
}) => {
  const [weekAnchor, setWeekAnchor] = useState<Date>(new Date())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [queuing, setQueuing] = useState(false)
  const [queueSuccess, setQueueSuccess] = useState(false)

  const [upcomingSort, setUpcomingSort] = useState<SortConfig<{ title: string; pub_date: string }> | null>(null)
  const [reportableSort, setReportableSort] = useState<SortConfig<{ title: string; pub_date: string }> | null>(null)

  const week = useMemo(() => resolveWeekBounds(weekAnchor), [weekAnchor])
  const isCurrentWeek = toISODate(week.start) === toISODate(resolveWeekBounds(new Date()).start)
  const weekIsClosed = toISODate(week.end) < toISODate(new Date())
  const weeksFromCurrent = Math.abs(
    Math.round(
      (week.start.getTime() - resolveWeekBounds(new Date()).start.getTime())
      / (7 * 24 * 60 * 60 * 1000)
    )
  )
  const showReturnButton = weeksFromCurrent > 0

  const reportableForWeek = useMemo(() =>
    reportable.filter((r) => r.report_week_start === toISODate(week.start)),
    [reportable, week])

  const sortedUpcoming = useMemo(() => {
    if (!upcomingSort) return upcoming
    return [...upcoming].sort((a, b) => {
      const dir = upcomingSort.direction === "asc" ? 1 : -1
      if (upcomingSort.key === "title")
        return sortTitle(a.title).localeCompare(sortTitle(b.title)) * dir
      return ((a.pub_date ?? "9999") > (b.pub_date ?? "9999") ? 1 : -1) * dir
    })
  }, [upcoming, upcomingSort])

  const sortedReportable = useMemo(() => {
    if (!reportableSort) return reportableForWeek
    return [...reportableForWeek].sort((a, b) => {
      const dir = reportableSort.direction === "asc" ? 1 : -1
      if (reportableSort.key === "title")
        return sortTitle(a.title).localeCompare(sortTitle(b.title)) * dir
      return ((a.pub_date ?? "9999") > (b.pub_date ?? "9999") ? 1 : -1) * dir
    })
  }, [reportableForWeek, reportableSort])

  const handleUpcomingSort = (key: UpcomingSortKey) => {
    setUpcomingSort({ key, direction: nextSortDirection(upcomingSort as any, key) })
  }

  const handleReportableSort = (key: ReportableSortKey) => {
    setReportableSort({ key, direction: nextSortDirection(reportableSort as any, key) })
  }

  const toggleId = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    const eligible = sortedReportable
      .filter((r) => !r.is_queued && !r.is_reported)
      .map((r) => r.product_id)
    if (selectedIds.size === eligible.length && eligible.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligible))
    }
  }

  const handleGeneratePreview = async () => {
    if (selectedIds.size === 0) return
    setGenerating(true)
    setError(null)
    try {
      const blob = await generateReportPreview(Array.from(selectedIds), toISODate(weekAnchor))
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `nyt_preview_${toISODate(week.end)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err.message || "Report generation failed")
    } finally {
      setGenerating(false)
    }
  }

  const shiftWeek = (direction: -1 | 1) => {
    const next = new Date(weekAnchor)
    next.setDate(weekAnchor.getDate() + direction * 7)
    setWeekAnchor(next)
    setSelectedIds(new Set())
  }

  const handleQueueForReport = async () => {
    if (selectedIds.size === 0) return
    setQueuing(true)
    setQueueSuccess(false)
    setError(null)
    try {
      await queueForReport(Array.from(selectedIds), toISODate(weekAnchor))
      setQueueSuccess(true)
      setSelectedIds(new Set())
      onReported?.()
    } catch (err: any) {
      setError(err.message || "Failed to queue titles for report")
    } finally {
      setQueuing(false)
    }
  }

  const thClass = "px-4 py-3 border-b dark:border-gray-700 text-left cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors text-[10px] sm:text-xs uppercase tracking-wider font-semibold"

  const eligibleCount = sortedReportable.filter((r) => !r.is_queued && !r.is_reported).length
  const queuedCount   = sortedReportable.filter((r) => r.is_queued).length
  const reportedCount = sortedReportable.filter((r) => r.is_reported).length

  return (
    <div className="space-y-8">

      {/* ── Upcoming ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-3 border-l-2 border-amber-400 pl-2">
          Upcoming — Next 7 Days
        </h2>

        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic px-1">
            No titles publishing within 7 days.
          </p>
        ) : (
          <>
            {/* MOBILE VIEW: Upcoming Cards */}
            <div className="block md:hidden space-y-3">
              <div className="flex items-center gap-2 px-1 text-xs text-gray-500 dark:text-gray-400 overflow-x-auto pb-1">
                <span className="font-medium shrink-0">Sort:</span>
                <button 
                  onClick={() => handleUpcomingSort("pub_date")}
                  className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${upcomingSort?.key === "pub_date" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
                >
                  Date <SortIcon active={upcomingSort?.key === "pub_date"} direction={upcomingSort?.direction ?? "asc"} />
                </button>
                <button 
                  onClick={() => handleUpcomingSort("title")}
                  className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${upcomingSort?.key === "title" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
                >
                  Title <SortIcon active={upcomingSort?.key === "title"} direction={upcomingSort?.direction ?? "asc"} />
                </button>
              </div>

              {sortedUpcoming.map((row) => {
                const days = daysUntil(row.pub_date)
                return (
                  <div key={row.product_id} className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <span className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-2">{row.title}</span>
                        <div className="text-[10px] font-mono text-gray-400 mt-0.5">ISBN: {row.isbn ?? "—"}</div>
                      </div>
                      <span className={`text-xs font-bold shrink-0 px-2 py-0.5 rounded-md bg-gray-50 dark:bg-gray-800/60 ${
                        days !== null && days <= 1 ? "text-red-600 dark:text-red-400" : days !== null && days <= 3 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"
                      }`}>
                        {days !== null ? (days === 0 ? "Today" : `${days}d out`) : "—"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2.5 border-t border-gray-100 dark:border-gray-800/80">
                      <div className="space-y-1">
                        <span className="text-gray-400 block text-[9px] uppercase tracking-wider font-medium">Pub Date & Stock</span>
                        <div className="flex flex-col gap-1 items-start">
                          <span className="text-gray-600 dark:text-gray-300 font-medium">{formatDate(row.pub_date)}</span>
                          <StockStatusPill inventory={row.inventory ?? 0} arrivalRecordIsLive={row.arrival_record_is_live} />
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-gray-400 block text-[9px] uppercase tracking-wider font-medium">Live Presales</span>
                        <div className="flex items-center justify-end mt-0.5">
                          <span className="font-mono font-bold text-gray-900 dark:text-white">
                            {row.live_presale_qty.toLocaleString()}
                          </span>
                          <ConfidenceBadge confidence={row.data_confidence} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* DESKTOP VIEW: Upcoming Table */}
            <div className="hidden md:block overflow-x-auto border rounded-md dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className={thClass} onClick={() => handleUpcomingSort("title")}>
                      Title
                      <SortIcon active={upcomingSort?.key === "title"} direction={upcomingSort?.direction ?? "asc"} />
                    </th>
                    <th className={thClass} onClick={() => handleUpcomingSort("pub_date")}>
                      Pub Date
                      <SortIcon active={upcomingSort?.key === "pub_date"} direction={upcomingSort?.direction ?? "asc"} />
                    </th>
                    <th className="px-4 py-3 border-b dark:border-gray-700 text-center text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
                      Days Out
                    </th>
                    <th className="px-4 py-3 border-b dark:border-gray-700 text-left text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
                      Stock Status
                    </th>
                    <th className="px-4 py-3 border-b dark:border-gray-700 text-right text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
                      Live Presales
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {sortedUpcoming.map((row) => {
                    const days = daysUntil(row.pub_date)
                    return (
                      <tr key={row.product_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-xs truncate">
                          {row.title}
                          <div className="text-[10px] font-mono text-gray-400 mt-0.5">{row.isbn ?? "—"}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(row.pub_date)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-bold ${
                            days !== null && days <= 1
                              ? "text-red-600 dark:text-red-400"
                              : days !== null && days <= 3
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-gray-500 dark:text-gray-400"
                          }`}>
                            {days !== null ? (days === 0 ? "Today" : `${days}d`) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StockStatusPill inventory={row.inventory ?? 0} arrivalRecordIsLive={row.arrival_record_is_live} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono font-bold text-xs text-gray-900 dark:text-white">
                            {row.live_presale_qty.toLocaleString()}
                          </span>
                          <ConfidenceBadge confidence={row.data_confidence} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ── Reportable ── */}
      <section>
        {/* Header Block with Flex adjustments for wrapping on ultra-small displays */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center flex-wrap gap-2 sm:gap-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 border-l-2 border-blue-500 pl-2">
              Reportable — NYT Eligible
            </h2>
            {sortedReportable.length > 0 && (
              <div className="flex items-center gap-1.5">
                {queuedCount > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
                    {queuedCount} queued
                  </span>
                )}
                {reportedCount > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">
                    {reportedCount} reported
                  </span>
                )}
                {eligibleCount > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">
                    {eligibleCount} pending
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-2 text-xs w-full sm:w-auto bg-gray-50 dark:bg-gray-800/40 sm:bg-transparent p-2 sm:p-0 rounded-lg">
            {showReturnButton && (
              <button
                onClick={() => {
                  setWeekAnchor(new Date())
                  setSelectedIds(new Set())
                }}
                className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 font-medium transition-colors text-xs"
              >
                ↩ Current
              </button>
            )}
            <div className="flex items-center gap-1 ml-auto sm:ml-0">
              <button
                onClick={() => shiftWeek(-1)}
                className="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 font-bold"
              >←</button>
              <span className="font-mono text-gray-700 dark:text-gray-300 w-[140px] sm:w-[180px] text-center text-[11px] sm:text-xs tracking-tight">
                {week.label}
              </span>
              <button
                onClick={() => shiftWeek(1)}
                disabled={isCurrentWeek}
                className={`px-2.5 py-1 rounded font-bold ${
                  isCurrentWeek
                    ? "bg-gray-50 dark:bg-gray-900 text-gray-300 dark:text-gray-600 cursor-not-allowed"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >→</button>
            </div>
          </div>
        </div>

        {sortedReportable.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 italic px-1">
            No reportable titles for this reporting week.
          </p>
        ) : (
          <>
            {/* MOBILE VIEW: Reportable Card List */}
            <div className="block md:hidden space-y-3">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 overflow-x-auto">
                  <span className="font-medium shrink-0">Sort:</span>
                  <button 
                    onClick={() => handleReportableSort("pub_date")}
                    className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${reportableSort?.key === "pub_date" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
                  >
                    Date <SortIcon active={reportableSort?.key === "pub_date"} direction={reportableSort?.direction ?? "asc"} />
                  </button>
                  <button 
                    onClick={() => handleReportableSort("title")}
                    className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${reportableSort?.key === "title" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
                  >
                    Title <SortIcon active={reportableSort?.key === "title"} direction={reportableSort?.direction ?? "asc"} />
                  </button>
                </div>
                
                {eligibleCount > 0 && (
                  <button 
                    onClick={toggleAll}
                    className="text-xs text-blue-600 dark:text-blue-400 font-semibold px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded"
                  >
                    {selectedIds.size === eligibleCount ? "Deselect All" : "Select All"}
                  </button>
                )}
              </div>

              {sortedReportable.map((row) => {
                const locked = row.is_queued || row.is_reported
                return (
                  <div 
                    key={row.product_id} 
                    onClick={() => !locked && toggleId(row.product_id)}
                    className={`p-4 rounded-xl border transition-all flex flex-col gap-3 ${
                      locked 
                        ? "bg-gray-50/60 dark:bg-gray-900/40 border-gray-100 dark:border-gray-800/50 opacity-60" 
                        : selectedIds.has(row.product_id)
                        ? "bg-blue-50/30 dark:bg-blue-900/10 border-blue-400 dark:border-blue-500 shadow-sm"
                        : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 shadow-sm"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {!locked && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.product_id)}
                          onChange={() => {}} // Controlled globally by container click handler
                          className="rounded mt-1 pointer-events-none"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-2">{row.title}</span>
                        <div className="text-[10px] font-mono text-gray-400 mt-0.5">ISBN: {row.isbn ?? "—"}</div>
                      </div>
                      <div className="shrink-0 self-start">
                        <ReportingStatusBadge row={row} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-2.5 border-t border-gray-100 dark:border-gray-800/80">
                      <div>
                        <span className="text-gray-400 block text-[9px] uppercase tracking-wider font-medium">Pub Date</span>
                        <span className="text-gray-600 dark:text-gray-300 font-medium">{formatDate(row.pub_date)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-gray-400 block text-[9px] uppercase tracking-wider font-medium">Total Presales</span>
                        <div className="flex items-center justify-end mt-0.5">
                          <span className="font-mono font-bold text-gray-900 dark:text-white">
                            {row.total_presale_qty.toLocaleString()}
                          </span>
                          <ConfidenceBadge confidence={row.data_confidence} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* DESKTOP VIEW: Reportable Table */}
            <div className="hidden md:block overflow-x-auto border rounded-md dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-4 py-3 border-b dark:border-gray-700 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size > 0 && selectedIds.size === eligibleCount}
                        onChange={toggleAll}
                        disabled={eligibleCount === 0}
                        className="rounded"
                      />
                    </th>
                    <th className={thClass} onClick={() => handleReportableSort("title")}>
                      Title
                      <SortIcon active={reportableSort?.key === "title"} direction={reportableSort?.direction ?? "asc"} />
                    </th>
                    <th className="px-4 py-3 border-b dark:border-gray-700 text-left text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
                      ISBN
                    </th>
                    <th className={thClass} onClick={() => handleReportableSort("pub_date")}>
                      Pub Date
                      <SortIcon active={reportableSort?.key === "pub_date"} direction={reportableSort?.direction ?? "asc"} />
                    </th>
                    <th className="px-4 py-3 border-b dark:border-gray-700 text-right text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
                      Total Presales
                    </th>
                    <th className="px-4 py-3 border-b dark:border-gray-700 text-center text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {sortedReportable.map((row) => {
                    const locked = row.is_queued || row.is_reported
                    return (
                      <tr
                        key={row.product_id}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${locked ? "opacity-60" : ""}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.product_id)}
                            onChange={() => toggleId(row.product_id)}
                            disabled={locked}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-xs truncate">
                          {row.title}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                          {row.isbn ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {formatDate(row.pub_date)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono font-bold text-xs text-gray-900 dark:text-white">
                            {row.total_presale_qty.toLocaleString()}
                          </span>
                          <ConfidenceBadge confidence={row.data_confidence} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <ReportingStatusBadge row={row} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom Actions Sticky Panel / Container */}
            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50 dark:bg-gray-800/30 p-4 sm:p-0 rounded-xl sm:bg-transparent">
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-left font-medium">
                {selectedIds.size > 0
                  ? `${selectedIds.size} title${selectedIds.size !== 1 ? "s" : ""} selected`
                  : "Select titles to include in the NYT report"
                }
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 w-full sm:w-auto">
                {error && (
                  <span className="text-xs text-red-500 dark:text-red-400 text-center sm:text-right">{error}</span>
                )}
                {queueSuccess && (
                  <span className="text-xs text-blue-600 dark:text-blue-400 text-center sm:text-right font-medium">
                    ✓ Queued for report — review in Reports › NYT Reporting
                  </span>
                )}
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={handleGeneratePreview}
                    disabled={selectedIds.size === 0 || generating}
                    className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-xs font-bold bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg sm:rounded transition-all text-center"
                    title="Download a CSV preview without queuing titles for upload"
                  >
                    {generating ? "Generating…" : "Preview CSV"}
                  </button>
                  <button
                    onClick={handleQueueForReport}
                    disabled={selectedIds.size === 0 || queuing}
                    className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg sm:rounded shadow transition-all active:scale-[0.98] text-center"
                    title="Queue selected titles for the automated NYT report upload"
                  >
                    {queuing ? "Queuing…" : "Queue for Report"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export default ReleaseReviewTable
