import React, { useState, useMemo } from "react"
import { PreorderRow } from "../../types/preorderTypes"
import {
  sortTitle, formatDate, SortConfig, SortIcon,
  nextSortDirection
} from "../../utils/tableUtils"

interface PreorderTableProps {
  data: PreorderRow[]
  onRowClick: (row: PreorderRow) => void
  isHistorical?: boolean
}

function getClassificationBadgeClass(status: string) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium border-0"
  switch (status) {
    case "active_preorder":
      return `${base} bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200`
    case "early_stock_arrival":
      return `${base} bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200`
    case "historical_preorder":
      return `${base} bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400`
    default:
      if (status?.startsWith("anomaly")) {
        return `${base} bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200`
      }
      return `${base} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300`
  }
}

function formatClassificationLabel(status: string) {
  switch (status) {
    case "early_stock_arrival": return "early stock"
    case "active_preorder":     return "active"
    case "historical_preorder": return "historical"
    default:
      if (status?.startsWith("anomaly")) return status.replace("anomaly_", "").replace(/_/g, " ")
      return status?.replace(/_/g, " ") ?? "—"
  }
}

function getConfidenceBadgeClass(confidence: string) {
  const base = "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border-0 ml-1.5"
  return confidence === "verified"
    ? `${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300`
    : `${base} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`
}

// An active preorder has received stock when it carries a live inventory_arrival
// record — even if demand oversold it into negative inventory (it then stays
// active_preorder rather than becoming early_stock_arrival). Surfaces "stock is
// in the building" and flags a shipping-profile detachment candidate.
function hasReceivedStock(row: PreorderRow): boolean {
  return row.classification === "active_preorder" && row.arrival_record_is_live === true
}

function StockReceivedBadge({ row }: { row: PreorderRow }) {
  if (!hasReceivedStock(row)) return null
  return (
    <span
      title="Stock received — fulfillable now; candidate for shipping-profile detachment"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] sm:text-xs font-semibold whitespace-nowrap bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 ml-1.5"
    >
      ✓ Stock received
    </span>
  )
}

type SortKey = "title" | "classification" | "pub_date"

const PreorderTable: React.FC<PreorderTableProps> = ({
  data,
  onRowClick,
  isHistorical = false,
}) => {
  const [sortConfig, setSortConfig] = useState<SortConfig<{ title: string; classification: string; pub_date: string }> | null>({
    key: "pub_date",
    direction: "asc",
  })

  const handleSort = (key: SortKey) => {
    setSortConfig({
      key,
      direction: nextSortDirection(sortConfig as any, key),
    })
  }

  const sorted = useMemo(() => {
    if (!sortConfig) return data
    return [...data].sort((a, b) => {
      const dir = sortConfig.direction === "asc" ? 1 : -1
      switch (sortConfig.key) {
        case "title":
          return sortTitle(a.title).localeCompare(sortTitle(b.title)) * dir
        case "classification":
          return (a.classification ?? "").localeCompare(b.classification ?? "") * dir
        case "pub_date":
          return ((a.pub_date ?? "9999") > (b.pub_date ?? "9999") ? 1 : -1) * dir
        default:
          return 0
      }
    })
  }, [data, sortConfig])

  const thClass = (key: SortKey) =>
    `px-3 sm:px-4 py-3 border-b dark:border-gray-700 text-left cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors`

  return (
    <div className="w-full">
      {/* --- MOBILE VIEW: Card List --- */}
      <div className="block md:hidden space-y-3">
        {/* Simple Mobile Sort Controls */}
        <div className="flex items-center gap-2 px-1 text-xs text-gray-500 dark:text-gray-400 overflow-x-auto pb-1">
          <span className="font-medium shrink-0">Sort:</span>
          <button 
            onClick={() => handleSort("pub_date")}
            className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${sortConfig?.key === "pub_date" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
          >
            Date <SortIcon active={sortConfig?.key === "pub_date"} direction={sortConfig?.direction ?? "asc"} />
          </button>
          <button 
            onClick={() => handleSort("title")}
            className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${sortConfig?.key === "title" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
          >
            Title <SortIcon active={sortConfig?.key === "title"} direction={sortConfig?.direction ?? "asc"} />
          </button>
          {!isHistorical && (
            <button 
              onClick={() => handleSort("classification")}
              className={`px-2.5 py-1 rounded-full border dark:border-gray-700 shrink-0 ${sortConfig?.key === "classification" ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-semibold" : ""}`}
            >
              Status <SortIcon active={sortConfig?.key === "classification"} direction={sortConfig?.direction ?? "asc"} />
            </button>
          )}
        </div>

        {/* Mobile Cards */}
        {sorted.map((row) => (
          <div
            key={row.product_id}
            onClick={() => onRowClick(row)}
            className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm active:bg-gray-50 dark:active:bg-gray-800/50 transition-colors flex flex-col gap-3"
          >
            {/* Top Row: Title, Reported Status, Action Arrow */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-semibold text-gray-900 dark:text-white text-sm line-clamp-2">{row.title}</span>
                  {isHistorical && row.already_reported && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">
                      Reported
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-gray-400 mt-0.5">{row.product_id}</div>
              </div>
              <span className="text-blue-600 dark:text-blue-400 text-xs font-medium self-start shrink-0 pt-0.5">
                Details &rarr;
              </span>
            </div>

            {/* Middle Row: Status and Status Anomalies */}
            {!isHistorical && (
              <div className="pt-0.5 border-t border-gray-100 dark:border-gray-800/60">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className={getClassificationBadgeClass(row.classification)}>
                    {formatClassificationLabel(row.classification)}
                  </span>
                  <StockReceivedBadge row={row} />
                </div>
                {row.classification === "early_stock_arrival" && row.arrival_timing && (
                  <div className={`text-[10px] mt-1 font-medium ${
                    row.arrival_timing === "early_arrival" ? "text-purple-600 dark:text-purple-400" : "text-gray-500 dark:text-gray-400"
                  }`}>
                    {row.arrival_timing === "early_arrival" ? "⚡ early — stock arrived well before pub date" : "✓ on time"}
                  </div>
                )}
                {row.anomaly_type && (
                  <div className="text-[10px] text-red-500 dark:text-red-400 mt-1 font-mono">
                    {row.anomaly_type}
                  </div>
                )}
              </div>
            )}

            {/* Bottom Row: Metadata & Quantities */}
            <div className="flex items-center justify-between text-xs pt-2 border-t border-gray-100 dark:border-gray-800">
              <div>
                <span className="text-gray-400 block text-[10px] uppercase tracking-wider font-medium">Pub Date</span>
                <span className="text-gray-600 dark:text-gray-300 font-medium">{formatDate(row.pub_date)}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-400 block text-[10px] uppercase tracking-wider font-medium">
                  {isHistorical ? "Total Presales" : "Live Presales"}
                </span>
                <div className="flex items-center justify-end mt-0.5">
                  <span className="font-mono font-bold text-gray-900 dark:text-white">
                    {isHistorical ? row.total_presale_qty.toLocaleString() : row.live_presale_qty.toLocaleString()}
                  </span>
                  <span className={getConfidenceBadgeClass(row.data_confidence)}>
                    {row.data_confidence}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {sorted.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500 italic">
            No titles found.
          </div>
        )}
      </div>

      {/* --- DESKTOP VIEW: Legacy Table --- */}
      <div className="hidden md:block overflow-x-auto border rounded-md dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] sm:text-xs uppercase tracking-wider font-semibold">
            <tr>
              <th className={thClass("title")} onClick={() => handleSort("title")}>
                Title
                <SortIcon active={sortConfig?.key === "title"} direction={sortConfig?.direction ?? "asc"} />
              </th>
              {!isHistorical && (
                <th className={thClass("classification")} onClick={() => handleSort("classification")}>
                  Status
                  <SortIcon active={sortConfig?.key === "classification"} direction={sortConfig?.direction ?? "asc"} />
                </th>
              )}
              <th className={thClass("pub_date")} onClick={() => handleSort("pub_date")}>
                Pub Date
                <SortIcon active={sortConfig?.key === "pub_date"} direction={sortConfig?.direction ?? "asc"} />
              </th>
              <th className="hidden md:table-cell px-4 py-3 border-b dark:border-gray-700 text-right">
                {isHistorical ? "Total Presales" : "Live Presales"}
              </th>
              <th className="px-3 sm:px-4 py-3 border-b dark:border-gray-700 text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {sorted.map((row) => (
              <tr
                key={row.product_id}
                className="even:bg-gray-50/50 dark:even:bg-gray-800/50 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                onClick={() => onRowClick(row)}
              >
                <td className="px-3 sm:px-4 py-3 font-medium text-gray-900 dark:text-white max-w-[150px] sm:max-w-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{row.title}</span>
                    {isHistorical && row.already_reported && (
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 font-medium">
                        Reported
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-gray-400 mt-0.5">{row.product_id}</div>
                </td>
                {!isHistorical && (
                  <td className="px-3 sm:px-4 py-3">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className={getClassificationBadgeClass(row.classification)}>
                        {formatClassificationLabel(row.classification)}
                      </span>
                      <StockReceivedBadge row={row} />
                    </div>
                    {row.classification === "early_stock_arrival" && row.arrival_timing && (
                      <div className={`text-[9px] mt-0.5 font-medium ${
                        row.arrival_timing === "early_arrival"
                          ? "text-purple-600 dark:text-purple-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`}>
                        {row.arrival_timing === "early_arrival" ? "⚡ early — stock arrived well before pub date" : "✓ on time"}
                      </div>
                    )}
                    {row.anomaly_type && (
                      <div className="text-[9px] text-red-500 dark:text-red-400 mt-0.5 font-mono">
                        {row.anomaly_type}
                      </div>
                    )}
                  </td>
                )}
                <td className="px-3 sm:px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                  {formatDate(row.pub_date)}
                </td>
                <td className="hidden md:table-cell px-4 py-3 text-right">
                  <span className="font-mono font-bold text-gray-900 dark:text-white text-xs">
                    {isHistorical
                      ? row.total_presale_qty.toLocaleString()
                      : row.live_presale_qty.toLocaleString()}
                  </span>
                  <span className={getConfidenceBadgeClass(row.data_confidence)}>
                    {row.data_confidence}
                  </span>
                </td>
                <td className="px-3 sm:px-4 py-3 text-right">
                  <button className="text-blue-600 dark:text-blue-400 font-medium text-xs sm:text-sm">
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500 italic"
                >
                  No titles found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PreorderTable
