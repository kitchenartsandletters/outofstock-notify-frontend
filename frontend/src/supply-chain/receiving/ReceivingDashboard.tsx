// ReceivingDashboard.tsx
// Route: /receiving
//
// Groups receipts by PO — a PO is the unit of work, receipts are attempts.
// Shows submitted/confirmed/partial POs awaiting receipt above the history table.
// Lines column shows completion breakdown: complete / partial / pending.
//
// Status column semantics:
//   canonical_status is derived from the PO's own status (received, partial, etc.)
//   NOT from the receipt's status (applied, test_applied, etc.).
//   Receipt-level status (applied, test_applied, failed) is shown only in the
//   expanded attempt rows — the top-level badge always reflects PO state so
//   a partially-received PO always shows "Partial", never "Received".

import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PODetailSidebar from '../purchase-orders/PODetailSidebar'
import RightSidebar from '../../components/RightSidebar'
import {
  fetchPurchaseOrderDetail,
  fetchPurchaseOrders,
  fetchReceiptHistory,
} from '../../api/supplyChainApi'
import { PurchaseOrder, PurchaseOrderDetail } from '../purchase-orders/purchaseOrderTypes'
import AwaitingReceipt from './AwaitingReceipt'
import { SortConfig, SortIcon } from '../../utils/tableUtils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReceiptAttempt {
  id: string
  status: 'pending' | 'applied' | 'failed' | 'partial' | 'cancelled' | 'test_applied'
  received_at: string
  notes: string | null
  line_count: number
  units_received: number
}

interface POReceivingGroup {
  po_id: string
  po_number: string
  is_ad_hoc: boolean
  informal_ref: string | null
  supplier_name: string
  account_label: string
  canonical_status: string
  canonical_receipt: ReceiptAttempt | null
  attempts: ReceiptAttempt[]
  total_units: number
  total_lines: number
  lines_full:    number
  lines_partial: number
  lines_open:    number
  lines_total:   number
  is_test: boolean
}

interface RawReceiptRow {
  id: string
  status: string
  po_status?: string
  received_at: string
  notes: string | null
  po_id: string
  po_number: string
  is_ad_hoc: boolean
  informal_ref: string | null
  supplier_name: string
  account_label: string
  line_count: number
  units_received: number
  lines_full?:    number
  lines_partial?: number
  lines_open?:    number
  lines_total?:   number
  is_test?: boolean
}

type SortKey = 'received_at' | 'supplier_name' | 'po_number' | 'canonical_status'

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const PO_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  received:  { label: 'Received',  color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',     dot: 'bg-green-500'  },
  partial:   { label: 'Partial',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',     dot: 'bg-amber-500'  },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',         dot: 'bg-blue-400'   },
  confirmed: { label: 'Confirmed', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300', dot: 'bg-indigo-400' },
  draft:     { label: 'Draft',     color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',            dot: 'bg-gray-400'   },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',            dot: 'bg-gray-300'   },
  failed:    { label: 'Failed',    color: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',             dot: 'bg-red-500'    },
  pending:   { label: 'Pending',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',         dot: 'bg-blue-400'   },
}

const RECEIPT_STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  applied:      { label: 'Applied',   color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',     dot: 'bg-green-500'  },
  test_applied: { label: 'Test run',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', dot: 'bg-yellow-500' },
  partial:      { label: 'Partial',   color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',     dot: 'bg-amber-500'  },
  failed:       { label: 'Failed',    color: 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400',             dot: 'bg-red-500'    },
  pending:      { label: 'Pending',   color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',         dot: 'bg-blue-400'   },
  cancelled:    { label: 'Cancelled', color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',            dot: 'bg-gray-400'   },
}

function POStatusBadge({ status }: { status: string }) {
  const cfg = PO_STATUS_CONFIG[status] ?? PO_STATUS_CONFIG.pending
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function ReceiptStatusBadge({ status }: { status: string }) {
  const cfg = RECEIPT_STATUS_CONFIG[status] ?? RECEIPT_STATUS_CONFIG.pending
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Group raw receipt rows by PO
// ---------------------------------------------------------------------------

function groupByPO(rows: RawReceiptRow[]): POReceivingGroup[] {
  const map = new Map<string, POReceivingGroup>()

  for (const row of rows) {
    if (!map.has(row.po_id)) {
      map.set(row.po_id, {
        po_id:             row.po_id,
        po_number:         row.po_number,
        is_ad_hoc:         row.is_ad_hoc,
        informal_ref:      row.informal_ref,
        supplier_name:     row.supplier_name,
        account_label:     row.account_label,
        canonical_status:  row.po_status ?? 'pending',
        canonical_receipt: null,
        attempts:          [],
        total_units:       0,
        total_lines:       0,
        lines_full:        0,
        lines_partial:     0,
        lines_open:        0,
        lines_total:       0,
        is_test:           false,
      })
    }

    const group = map.get(row.po_id)!
    const attempt: ReceiptAttempt = {
      id:             row.id,
      status:         row.status as ReceiptAttempt['status'],
      received_at:    row.received_at,
      notes:          row.notes,
      line_count:     row.line_count,
      units_received: row.units_received,
    }
    group.attempts.push(attempt)

    if (row.status === 'applied' || row.status === 'partial' || row.status === 'test_applied') {
      group.canonical_receipt = attempt
      group.canonical_status  = row.po_status ?? row.status
      group.total_units       = row.units_received
      group.total_lines       = row.line_count
      group.lines_full        = row.lines_full    ?? 0
      group.lines_partial     = row.lines_partial ?? 0
      group.lines_open        = row.lines_open    ?? 0
      group.lines_total       = row.lines_total   ?? 0
      group.is_test           = row.is_test       ?? false
    } else if (!group.canonical_receipt) {
      group.canonical_receipt = attempt
      group.canonical_status  = row.po_status ?? row.status
      group.total_units       = row.units_received
      group.total_lines       = row.line_count
    }
  }

  return Array.from(map.values())
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return (
    <div className={`border rounded-lg px-4 py-3 ${alert
      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
      <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500 mb-0.5">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${alert ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

function ThSortable({
  label, sortKey, sortConfig, onSort, align = 'left',
}: {
  label: string; sortKey: SortKey
  sortConfig: SortConfig<any> | null
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortConfig?.key === sortKey
  return (
    <button type="button" onClick={() => onSort(sortKey)}
      className={`text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide
        hover:text-gray-700 dark:hover:text-gray-200 transition-colors select-none
        ${align === 'right' ? 'text-right w-full block' : ''}`}>
      {label}
      <SortIcon active={active} direction={sortConfig?.direction ?? 'asc'} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export default function ReceivingDashboard() {
  const navigate = useNavigate()
  const [groups, setGroups]             = useState<POReceivingGroup[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortConfig, setSortConfig]     = useState<SortConfig<any> | null>({
    key: 'received_at', direction: 'desc',
  })
  const [searchQuery, setSearchQuery]   = useState('')
  const [searching, setSearching]       = useState(false)
  const [selectedPODetail, setSelectedPODetail] = useState<PurchaseOrderDetail | null>(null)
  const [docsFilePath, setDocsFilePath] = useState<string | null>(null)
  const [submittedPOs, setSubmittedPOs] = useState<PurchaseOrder[]>([])
  const [posLoading, setPosLoading]     = useState(true)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track expanded cards on mobile view specifically
  const [mobileExpandedCardIds, setMobileExpandedCardIds] = useState<Record<string, boolean>>({})

  // Initial load
  useEffect(() => {
    fetchReceiptHistory({ limit: 100 })
      .then(rows => setGroups(groupByPO(rows as RawReceiptRow[])))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  // Awaiting receipt POs
  useEffect(() => {
    fetchPurchaseOrders({ status: 'submitted,confirmed,partial', limit: 50 })
      .then(orders => setSubmittedPOs(orders))
      .catch(() => {})
      .finally(() => setPosLoading(false))
  }, [])

  // Debounced search
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const rows = await fetchReceiptHistory({ limit: 100, search: searchQuery || undefined })
        setGroups(groupByPO(rows as RawReceiptRow[]))
      } catch { /* keep results on error */ }
      finally { setSearching(false) }
    }, 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchQuery])

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const toggleMobileCardExpansion = (poId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setMobileExpandedCardIds(prev => ({ ...prev, [poId]: !prev[poId] }))
  }

  const filtered = useMemo(() => {
    let list = statusFilter === 'all'
      ? groups
      : groups.filter(g => g.canonical_status === statusFilter)

    if (sortConfig) {
      const { key, direction } = sortConfig
      list = [...list].sort((a, b) => {
        let av = ''
        let bv = ''

        if (key === 'received_at') {
          av = a.canonical_receipt?.received_at ?? ''
          bv = b.canonical_receipt?.received_at ?? ''
        } else {
          // Safe lookup via checking if key is part of object keys
          const validKey = key as keyof POReceivingGroup
          av = (a[validKey] as string) ?? ''
          bv = (b[validKey] as string) ?? ''
        }

        const cmp = av.localeCompare(bv)
        return direction === 'asc' ? cmp : -cmp
      })
    }

    return list
  }, [groups, statusFilter, sortConfig])

  const totalUnits    = groups.filter(g => ['received','partial'].includes(g.canonical_status)).reduce((s,g) => s+g.total_units, 0)
  const failedGroups  = groups.filter(g => g.canonical_status === 'failed')
  const pendingGroups = groups.filter(g => g.canonical_status === 'pending')

  const counts = {
    all:      groups.length,
    received: groups.filter(g => g.canonical_status === 'received').length,
    partial:  groups.filter(g => g.canonical_status === 'partial').length,
    pending:  pendingGroups.length,
    failed:   failedGroups.length,
  }

  const handleRowClick = async (poId: string) => {
    try {
      const detail = await fetchPurchaseOrderDetail(poId)
      setSelectedPODetail(detail)
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-6 max-w-5xl p-4 sm:p-6 bg-white dark:bg-gray-950 min-h-screen">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">Receiving</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5">Incoming stock history and receipt management.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setDocsFilePath('/docs/supply-chain-receiving.md')}
            className="px-3 py-2 text-xs sm:text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
            View Help Guide
          </button>
          <button onClick={() => navigate('/receiving/new')}
            className="w-full sm:w-auto px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold transition-colors shadow-sm flex items-center justify-center gap-1.5">
            <span>+ New Receipt</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Orders received" value={counts.received} />
          <StatCard label="Units received" value={totalUnits.toLocaleString()} sub="received + partial" />
          <StatCard label="Failed" value={failedGroups.length}
            sub={failedGroups.length > 0 ? 'need attention' : 'all clear'} alert={failedGroups.length > 0} />
          <StatCard label="Pending" value={pendingGroups.length}
            sub={pendingGroups.length > 0 ? 'in progress' : 'none open'} />
        </div>
      )}

      {/* Failed alert */}
      {failedGroups.length > 0 && (
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 space-y-1">
          <p className="text-xs sm:text-sm font-semibold text-red-700 dark:text-red-300">
            {failedGroups.length} failed receipt{failedGroups.length !== 1 ? 's' : ''} need attention
          </p>
          {failedGroups.map(g => (
            <p key={g.po_id} className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono">
              {g.po_number} · {g.supplier_name} · {g.canonical_receipt ? formatDate(g.canonical_receipt.received_at) : '—'}
            </p>
          ))}
        </div>
      )}

      {/* Search bar */}
      <div className="relative">
        <input
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by PO number, supplier, or reference…"
          className="w-full pl-9 pr-4 py-1.5 border dark:border-gray-700 rounded-md text-xs sm:text-sm
                     bg-white dark:bg-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500/20 outline-none placeholder-gray-400 dark:placeholder-gray-500 shadow-sm"
        />
        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        {searching && (
          <div className="absolute right-3 top-2.5 w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Awaiting receipt — tabbed, abridged, with a Show all modal. */}
      <AwaitingReceipt pos={submittedPOs} loading={posLoading} />

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 border-b dark:border-gray-800/80 scrollbar-none">
        {([
          { key: 'all',      label: `All (${counts.all})` },
          { key: 'received', label: `Received (${counts.received})` },
          { key: 'partial',  label: `Partial (${counts.partial})` },
          { key: 'pending',  label: `Pending (${counts.pending})` },
          { key: 'failed',   label: `Failed (${counts.failed})` },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap
              ${statusFilter === key
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs sm:text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-gray-400 dark:text-gray-500 text-xs sm:text-sm">
            {searchQuery ? `No receipts match "${searchQuery}"` : 'No receipts found.'}
          </p>
          {!searchQuery && (
            <button onClick={() => navigate('/receiving/new')} className="mt-3 text-xs sm:text-sm text-blue-500 hover:underline">
              Start a new receipt? &rarr;
            </button>
          )}
        </div>
      )}

      {/* PO-grouped receipt lists */}
      {!loading && !error && filtered.length > 0 && (
        <div className="w-full">
          
          {/* --- MOBILE VIEW: Card List --- */}
          <div className="block md:hidden space-y-3">
            {/* Quick Mobile Sorter Chips */}
            <div className="flex items-center gap-2 text-xs text-gray-500 overflow-x-auto pb-1 scrollbar-none">
              <span className="font-medium shrink-0">Sort:</span>
              <button onClick={() => handleSort('received_at')} className={`px-2.5 py-1 rounded-full border dark:border-gray-800 shrink-0 ${sortConfig?.key === 'received_at' ? 'bg-gray-100 dark:bg-gray-800 font-bold text-gray-900 dark:text-white' : ''}`}>
                Date <SortIcon active={sortConfig?.key === 'received_at'} direction={sortConfig?.direction ?? 'asc'} />
              </button>
              <button onClick={() => handleSort('supplier_name')} className={`px-2.5 py-1 rounded-full border dark:border-gray-800 shrink-0 ${sortConfig?.key === 'supplier_name' ? 'bg-gray-100 dark:bg-gray-800 font-bold text-gray-900 dark:text-white' : ''}`}>
                Supplier <SortIcon active={sortConfig?.key === 'supplier_name'} direction={sortConfig?.direction ?? 'asc'} />
              </button>
              <button onClick={() => handleSort('po_number')} className={`px-2.5 py-1 rounded-full border dark:border-gray-800 shrink-0 ${sortConfig?.key === 'po_number' ? 'bg-gray-100 dark:bg-gray-800 font-bold text-gray-900 dark:text-white' : ''}`}>
                PO # <SortIcon active={sortConfig?.key === 'po_number'} direction={sortConfig?.direction ?? 'asc'} />
              </button>
            </div>

            {filtered.map(group => {
              const mobileExpanded = !!mobileExpandedCardIds[group.po_id]
              const hasMultipleAttempts = group.attempts.length > 1
              const supplementaryAttempts = group.attempts.filter(a => a.id !== group.canonical_receipt?.id)

              return (
                <div key={group.po_id} onClick={() => handleRowClick(group.po_id)}
                  className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm flex flex-col gap-3 active:bg-gray-50 dark:active:bg-gray-800/40">
                  
                  {/* Top segment */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center flex-wrap gap-1.5">
                        <span className="font-mono font-bold text-sm text-gray-900 dark:text-white">{group.po_number}</span>
                        {group.is_ad_hoc && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/20 border border-amber-200/40 uppercase">Ad hoc</span>}
                        {group.is_test && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 uppercase">Test</span>}
                      </div>
                      {group.informal_ref && <p className="text-[11px] font-mono text-gray-400 truncate mt-0.5">ref: {group.informal_ref}</p>}
                    </div>
                    <div className="shrink-0 text-right text-xs text-gray-500">
                      <p className="font-medium">{group.canonical_receipt ? formatDate(group.canonical_receipt.received_at) : '—'}</p>
                      <p className="text-[10px] text-gray-400">{group.canonical_receipt ? formatTime(group.canonical_receipt.received_at) : ''}</p>
                    </div>
                  </div>

                  {/* Mid Segment */}
                  <div className="flex justify-between items-center py-2 border-t border-gray-100 dark:border-gray-800/60 gap-4">
                    <div className="min-w-0">
                      <span className="text-[9px] text-gray-400 uppercase tracking-wider block font-semibold">Supplier</span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 block truncate">{group.supplier_name}</span>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <POStatusBadge status={group.canonical_status} />
                      {hasMultipleAttempts && (
                        <button onClick={(e) => toggleMobileCardExpansion(group.po_id, e)} className="text-[10px] text-blue-500 underline font-medium">
                          {mobileExpanded ? 'Hide history' : `${group.attempts.length} attempts ▾`}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Lines Breakdown Segment */}
                  <div className="grid grid-cols-3 gap-2 py-2 border-t border-gray-100 dark:border-gray-800 text-center text-[11px] bg-gray-50/50 dark:bg-gray-900/40 rounded-lg">
                    <div>
                      <span className="text-gray-400 block text-[9px] uppercase font-bold">Complete</span>
                      <span className="font-mono text-green-600 dark:text-green-400 font-semibold">{group.lines_full}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] uppercase font-bold">Partial</span>
                      <span className="font-mono text-amber-600 dark:text-amber-400 font-semibold">{group.lines_partial}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] uppercase font-bold">Pending</span>
                      <span className="font-mono text-gray-500 dark:text-gray-400 font-semibold">{group.lines_open}</span>
                    </div>
                  </div>

                  {/* Nested accordion on mobile cards */}
                  {mobileExpanded && supplementaryAttempts.length > 0 && (
                    <div className="border dark:border-gray-800 rounded-md bg-gray-50 dark:bg-gray-950/60 p-2 space-y-1.5 mt-1" onClick={e => e.stopPropagation()}>
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Previous Attemps</p>
                      {supplementaryAttempts.map(attempt => (
                        <div key={attempt.id} className="flex flex-col gap-1 text-[11px] border-b dark:border-gray-800 last:border-0 pb-1.5 last:pb-0 opacity-75">
                          <div className="flex justify-between items-center">
                            <ReceiptStatusBadge status={attempt.status} />
                            <span className="text-gray-400 font-mono text-[10px]">
                              {formatDate(attempt.received_at)} {formatTime(attempt.received_at)}
                            </span>
                          </div>
                          {attempt.notes && <p className="text-gray-500 italic truncate">{attempt.notes}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )
            })}
          </div>

          {/* --- DESKTOP VIEW: Standalone Grid-Table --- */}
          <div className="hidden md:block border dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
              <div className="w-4 shrink-0" />
              <div className="w-24 shrink-0">
                <ThSortable label="Date" sortKey="received_at" sortConfig={sortConfig} onSort={handleSort} />
              </div>
              <div className="flex-1">
                <ThSortable label="Supplier" sortKey="supplier_name" sortConfig={sortConfig} onSort={handleSort} />
              </div>
              <div className="w-52 shrink-0">
                <ThSortable label="PO" sortKey="po_number" sortConfig={sortConfig} onSort={handleSort} />
              </div>
              <div className="w-24 shrink-0">
                <ThSortable label="Status" sortKey="canonical_status" sortConfig={sortConfig} onSort={handleSort} />
              </div>
              <div className="w-24 shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-right">
                Lines
              </div>
            </div>
            {filtered.map(group => (
              <POGroupRow key={group.po_id} group={group} onRowClick={handleRowClick} />
            ))}
          </div>

        </div>
      )}

      <PODetailSidebar
        detail={selectedPODetail}
        onClose={() => setSelectedPODetail(null)}
        onReceive={poId => navigate(`/receiving/wizard?po=${poId}`)}
        wide={true}
      />

      {docsFilePath && (
        <RightSidebar
          title="Receiving Guide"
          docsFilePath={docsFilePath}
          onClose={() => setDocsFilePath(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop-only components preserved exactly for legacy viewport layout compliance
// ---------------------------------------------------------------------------

function POGroupRow({ group, onRowClick }: { group: POReceivingGroup; onRowClick: (poId: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const hasMultiple  = group.attempts.length > 1
  const nonCanonical = group.attempts.filter(a => a.id !== group.canonical_receipt?.id)

  return (
    <div className="border-b dark:border-gray-800 last:border-0">
      <div
        className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer"
        onClick={() => onRowClick(group.po_id)}
      >
        <button type="button"
          onClick={e => { e.stopPropagation(); hasMultiple && setExpanded(v => !v) }}
          className={`mt-0.5 w-4 shrink-0 text-gray-400 dark:text-gray-500 text-xs
            ${hasMultiple ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200' : 'cursor-default opacity-0'}`}>
          {expanded ? '▾' : '▸'}
        </button>

        <div className="w-24 shrink-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {group.canonical_receipt ? formatDate(group.canonical_receipt.received_at) : '—'}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {group.canonical_receipt ? formatTime(group.canonical_receipt.received_at) : ''}
          </p>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{group.supplier_name}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{group.account_label}</p>
        </div>

        <div className="w-52 shrink-0 min-w-0">
          <p className="text-xs font-mono text-gray-700 dark:text-gray-300">{group.po_number}</p>
          {group.is_ad_hoc && (
            <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wide">Ad hoc</span>
          )}
          {group.informal_ref && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">{group.informal_ref}</p>
          )}
        </div>

        <div className="w-24 shrink-0 flex flex-col items-start gap-1">
          <POStatusBadge status={group.canonical_status} />
          {group.is_test && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 uppercase">
              Test
            </span>
          )}
          {hasMultiple && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{group.attempts.length} attempts</span>
          )}
        </div>

        <div className="w-24 shrink-0 text-right space-y-0.5">
          {group.lines_full > 0 && <p className="text-[11px] text-green-600 dark:text-green-400 tabular-nums">{group.lines_full} complete</p>}
          {group.lines_partial > 0 && <p className="text-[11px] text-amber-600 dark:text-amber-400 tabular-nums">{group.lines_partial} partial</p>}
          {group.lines_open > 0 && <p className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{group.lines_open} pending</p>}
          {group.lines_total === 0 && <p className="text-[11px] text-gray-400 tabular-nums">{group.total_lines} line{group.total_lines !== 1 ? 's' : ''}</p>}
        </div>
      </div>

      {expanded && nonCanonical.length > 0 && (
        <div className="ml-7 mr-4 mb-2 border dark:border-gray-800 rounded-md overflow-hidden bg-gray-50/50 dark:bg-gray-900/30">
          {nonCanonical.map(attempt => (
            <div key={attempt.id}
              className="flex items-center gap-3 px-3 py-2 border-b dark:border-gray-800 last:border-0 opacity-60">
              <ReceiptStatusBadge status={attempt.status} />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {formatDate(attempt.received_at)} {formatTime(attempt.received_at)}
              </span>
              {attempt.notes && (
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1">
                  {attempt.notes.slice(0, 100)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}