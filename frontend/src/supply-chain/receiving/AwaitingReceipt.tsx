// src/supply-chain/receiving/AwaitingReceipt.tsx
// The "Awaiting receipt" pane, extracted from ReceivingDashboard so it can grow
// without pushing everything below it off the page.
//
// Behaviour:
//   - tabbed by PO status, with counts
//   - each tab shows the first ROW_LIMIT rows, oldest first
//   - "Show all" opens a scrollable modal with the full list for that tab
//   - each row shows the submitted date
//
// Rows are ordered oldest-submitted first, deliberately. This pane is a queue,
// and the POs that have been waiting longest are the ones worth surfacing when
// only five fit. Newest-first would hide exactly the ones that need chasing.
//
// The dashboard still owns the fetch and passes results in, so mounting this
// costs one line and there is no second request for the same data.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PurchaseOrder } from '../purchase-orders/purchaseOrderTypes'

const ROW_LIMIT = 5

// Tab order is queue order, not alphabetical: a partially-received PO is closer
// to done than a freshly submitted one.
const TAB_ORDER = ['submitted', 'confirmed', 'partial'] as const
type TabKey = typeof TAB_ORDER[number]

const TAB_LABEL: Record<TabKey, string> = {
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  partial: 'Partial',
}

const STATUS_PILL: Record<string, string> = {
  confirmed: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

const shortDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

/**
 * The date a PO was sent to the supplier.
 *
 * There is no `submitted_at` on the PO. `ordered_at` is the field that records
 * when it went out; `created_at` is the fallback for POs that were never given
 * one. Null renders as an em dash rather than today's date — an unknown send
 * date is not the same as a PO submitted just now.
 */
const submittedAt = (po: PurchaseOrder): string | null =>
  po.ordered_at ?? po.created_at ?? null

/** Days since submission, for the ageing hint on long-waiting POs. */
function daysWaiting(po: PurchaseOrder): number | null {
  const at = submittedAt(po)
  if (!at) return null
  const ms = Date.now() - new Date(at).getTime()
  return Math.floor(ms / 86_400_000)
}

interface Props {
  pos: PurchaseOrder[]
  loading: boolean
}

export default function AwaitingReceipt({ pos, loading }: Props) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey | null>(null)
  const [showAll, setShowAll] = useState(false)

  const byStatus = useMemo(() => {
    const buckets: Record<string, PurchaseOrder[]> = {}
    for (const po of pos) {
      const key = String(po.status)
      ;(buckets[key] ??= []).push(po)
    }
    // Oldest first within each bucket.
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => {
        const av = submittedAt(a), bv = submittedAt(b)
        if (!av && !bv) return 0
        if (!av) return 1
        if (!bv) return -1
        return new Date(av).getTime() - new Date(bv).getTime()
      })
    }
    return buckets
  }, [pos])

  // Only show tabs for statuses actually present, so an empty "Partial" tab
  // doesn't imply there is something behind it.
  const tabs = useMemo(() => {
    const present = TAB_ORDER.filter(k => (byStatus[k]?.length ?? 0) > 0)
    const extra = Object.keys(byStatus)
      .filter(k => !TAB_ORDER.includes(k as TabKey))
      .sort()
    return [...present, ...extra] as string[]
  }, [byStatus])

  const activeTab = tab && tabs.includes(tab) ? tab : tabs[0]
  const rows = activeTab ? byStatus[activeTab] ?? [] : []
  const visible = rows.slice(0, ROW_LIMIT)
  const hidden = Math.max(rows.length - ROW_LIMIT, 0)

  const Row = ({ po, inModal }: { po: PurchaseOrder; inModal?: boolean }) => {
    const waited = daysWaiting(po)
    return (
      <button
        onClick={() => { setShowAll(false); navigate(`/receiving/wizard?po=${po.id}`) }}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left gap-3"
      >
        <div className="flex items-center gap-2 min-w-0">
          {inModal && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0 ${STATUS_PILL[String(po.status)] ?? STATUS_PILL.submitted}`}>
              {po.status}
            </span>
          )}
          <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {po.supplier_name ?? po.account_label}
          </span>
          {po.is_test && (
            <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 uppercase shrink-0">
              Test
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0 text-right">
          <span className="text-[11px] sm:text-xs font-mono text-gray-400">{po.po_number}</span>
          <span className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">
            sent {shortDate(submittedAt(po))}
            {waited != null && waited >= 30 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">· {waited}d</span>
            )}
          </span>
          {po.expected_at && (
            <span className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap hidden sm:inline">
              due {shortDate(po.expected_at)}
            </span>
          )}
          <span className="text-xs font-medium text-blue-500 whitespace-nowrap">Receive &rarr;</span>
        </div>
      </button>
    )
  }

  if (!loading && pos.length === 0) return null

  return (
    <>
      <div className="border dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900 shadow-sm">
        <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700 flex items-center justify-between gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Awaiting receipt
          </h3>
          <span className="text-xs text-gray-400 font-medium">
            {pos.length} PO{pos.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />)}
          </div>
        ) : (
          <>
            {tabs.length > 1 && (
              <div className="flex items-center gap-1 px-3 pt-2 border-b dark:border-gray-700 overflow-x-auto scrollbar-none">
                {tabs.map(k => {
                  const isActive = k === activeTab
                  return (
                    <button
                      key={k}
                      onClick={() => { setTab(k as TabKey); setShowAll(false) }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t border-b-2 whitespace-nowrap transition-colors ${
                        isActive
                          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    >
                      {TAB_LABEL[k as TabKey] ?? k}
                      <span className="ml-1.5 opacity-60 tabular-nums">{byStatus[k]?.length ?? 0}</span>
                    </button>
                  )
                })}
              </div>
            )}

            <div className="divide-y dark:divide-gray-800">
              {visible.map(po => <Row key={po.id} po={po} />)}
            </div>

            {hidden > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full px-4 py-2.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800 border-t dark:border-gray-700 transition-colors"
              >
                Show all {rows.length} {TAB_LABEL[activeTab as TabKey]?.toLowerCase() ?? activeTab} · {hidden} more
              </button>
            )}
          </>
        )}
      </div>

      {showAll && activeTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowAll(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b dark:border-gray-700 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">
                  Awaiting receipt — {TAB_LABEL[activeTab as TabKey] ?? activeTab}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {rows.length} PO{rows.length !== 1 ? 's' : ''}, oldest first
                </div>
              </div>
              <button
                onClick={() => setShowAll(false)}
                className="text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto divide-y dark:divide-gray-800">
              {rows.map(po => <Row key={po.id} po={po} inModal />)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
