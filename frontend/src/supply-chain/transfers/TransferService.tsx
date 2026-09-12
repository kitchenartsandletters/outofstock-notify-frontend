// TransferService.tsx
import { useEffect, useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  InventoryTransfer, TransferDetail,
  TRANSFER_STATUS_LABELS, TRANSFER_STATUS_COLORS, TransferStatus,
} from './transferTypes'
import { fetchTransfers, fetchTransferDetail, fetchLocations, Location } from '../../api/supplyChainApi'
import { formatDate, SortConfig, SortIcon, nextSortDirection } from '../../utils/tableUtils'
import TransferDispatchForm from './TransferDispatchForm'
import TransferReceivePanel from './TransferReceivePanel'
import TransfersSearch from './TransfersSearch'
import RightSidebar from '../../components/RightSidebar'

type LocMap = Record<string, Location>

const idTail = (gid: string) => gid.split('/').pop() ?? gid
const shortId = (id: string) => id.slice(0, 8)
const transferRef = (t: InventoryTransfer) => t.transfer_number ?? shortId(t.id)

const TestBadge = () => (
  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-yellow-200 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
    Test
  </span>
)

function LocationLabel({ id, locMap }: { id: string; locMap: LocMap }) {
  const name = locMap[id]?.name
  return (
    <div>
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{name ?? '—'}</p>
      <p className="font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate">{idTail(id)}</p>
    </div>
  )
}

function TransferDetailSidebar({ detail, locMap, onClose, onReceive }: {
  detail: TransferDetail | null
  locMap: LocMap
  onClose: () => void
  onReceive: (transferId: string) => void
}) {
  const [isVisible,     setIsVisible]     = useState(false)
  const [shouldRender,  setShouldRender]  = useState(false)

  useEffect(() => {
    if (detail) {
      setShouldRender(true)
      setTimeout(() => setIsVisible(true), 10)
    } else {
      setIsVisible(false)
      const t = setTimeout(() => setShouldRender(false), 300)
      return () => clearTimeout(t)
    }
  }, [detail])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) { setIsVisible(false); setTimeout(onClose, 300) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isVisible, onClose])

  const handleClose = () => { setIsVisible(false); setTimeout(onClose, 300) }

  if (!shouldRender || !detail) return null
  const { transfer, lines } = detail

  return createPortal(
    <>
      <div
        className={`fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />
      <div className={`fixed top-0 right-0 h-full w-full sm:w-[28rem] bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-2xl z-50 transition-transform duration-300 transform ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>

        <div className="flex items-center justify-between p-4 border-b dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div>
            <h3 className="font-bold text-lg text-gray-900 dark:text-white">Transfer</h3>
            <p className="font-mono text-xs text-gray-500 dark:text-gray-400 mt-0.5">{transferRef(transfer)}</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${TRANSFER_STATUS_COLORS[transfer.status]}`}>
                {TRANSFER_STATUS_LABELS[transfer.status]}
              </span>
              {transfer.is_test && <TestBadge />}
            </div>
          </div>
          <button onClick={handleClose} className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:underline">Close</button>
        </div>

        <div className="p-5 text-sm space-y-6 overflow-y-auto h-[calc(100%-5.5rem)] pb-10">
          {transfer.is_test && (
            <div className="px-3 py-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 text-xs text-yellow-800 dark:text-yellow-200">
              Test transfer — statuses advance for rehearsal, but no Shopify inventory is changed.
            </div>
          )}

          <section>
            <h4 className="font-bold text-gray-900 dark:text-white uppercase text-[11px] tracking-widest border-l-2 border-blue-500 pl-2 mb-4">Route</h4>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex-1 rounded border dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-gray-800">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-0.5">From</p>
                <LocationLabel id={transfer.from_location_id} locMap={locMap} />
              </div>
              <span className="text-gray-400">→</span>
              <div className="flex-1 rounded border dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-gray-800">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-0.5">To</p>
                <LocationLabel id={transfer.to_location_id} locMap={locMap} />
              </div>
            </div>
            <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
              <p>Created: {formatDate(transfer.created_at)}</p>
              {transfer.received_at && <p>Received: {formatDate(transfer.received_at)}</p>}
              {transfer.notes && <p className="italic mt-1">{transfer.notes}</p>}
            </div>
          </section>

          {transfer.status === 'in_transit' && (
            <button
              onClick={e => { e.stopPropagation(); onReceive(transfer.id) }}
              className="px-2 py-1 rounded text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
            >
              Receive →
            </button>
          )}

          <section>
            <h4 className="font-bold text-gray-900 dark:text-white uppercase text-[11px] tracking-widest border-l-2 border-purple-500 pl-2 mb-4">
              Lines ({lines.length})
            </h4>
            <div className="space-y-2">
              {lines.map(line => (
                <div key={line.id} className="rounded border dark:border-gray-700 px-3 py-2.5 bg-gray-50/50 dark:bg-gray-900/50">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                        {line.title ?? idTail(line.inventory_item_id)}
                      </p>
                      <p className="font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {idTail(line.variant_id)}{line.isbn ? ` · ${line.isbn}` : ''}
                      </p>
                      {line.vendor && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{line.vendor}</p>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 shrink-0">
                      {line.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-gray-600 dark:text-gray-400">
                    <span>Sent: <strong>{line.quantity_sent}</strong></span>
                    {line.quantity_received != null && (
                      <span className={line.quantity_received < line.quantity_sent ? 'text-amber-600 dark:text-amber-400' : ''}>
                        Rcvd: <strong>{line.quantity_received}</strong>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>,
    document.body
  )
}

function TransferTable({ transfers, locMap, sortConfig, onSort, onRowClick, selectedId }: {
  transfers:  InventoryTransfer[]
  locMap:     LocMap
  sortConfig: SortConfig<InventoryTransfer> | null
  onSort:     (k: keyof InventoryTransfer) => void
  onRowClick: (t: InventoryTransfer) => void
  selectedId: string | null
}) {
  if (transfers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-600">
        <p className="text-sm">No transfers found.</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto border rounded-md dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
      <table className="min-w-full border-collapse text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Transfer</th>
            {(['status','created_at','received_at'] as (keyof InventoryTransfer)[]).map(k => (
              <th key={k} onClick={() => onSort(k)}
                className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap">
                {k.replace('_at','').replace('_',' ')}
                <SortIcon active={sortConfig?.key === k} direction={sortConfig?.direction ?? 'asc'} />
              </th>
            ))}
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Route</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {transfers.map(t => (
            <tr key={t.id} onClick={() => onRowClick(t)}
              className={`cursor-pointer transition-colors ${t.id === selectedId ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{transferRef(t)}</span>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${TRANSFER_STATUS_COLORS[t.status]}`}>
                    {TRANSFER_STATUS_LABELS[t.status]}
                  </span>
                  {t.is_test && <TestBadge />}
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(t.created_at)}</td>
              <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.received_at ? formatDate(t.received_at) : '—'}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{locMap[t.from_location_id]?.name ?? '—'}</p>
                    <p className="font-mono text-[10px] text-gray-400 truncate">{idTail(t.from_location_id)}</p>
                  </div>
                  <span className="text-gray-400 shrink-0">→</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{locMap[t.to_location_id]?.name ?? '—'}</p>
                    <p className="font-mono text-[10px] text-gray-400 truncate">{idTail(t.to_location_id)}</p>
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TransferService() {
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([])
  const [locMap,    setLocMap]    = useState<LocMap>({})
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'all'>('all')
  const [sortConfig, setSortConfig] = useState<SortConfig<InventoryTransfer> | null>({ key: 'created_at', direction: 'desc' })
  const [selected,  setSelected]  = useState<InventoryTransfer | null>(null)
  const [detail,    setDetail]    = useState<TransferDetail | null>(null)
  const [showDispatchForm,   setShowDispatchForm]   = useState(false)
  const [receivingTransferId, setReceivingTransferId] = useState<string | null>(null)
  const [docsFilePath, setDocsFilePath] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setTransfers(await fetchTransfers({ limit: 200 })) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load transfers') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetchLocations()
      .then(locs => setLocMap(Object.fromEntries(locs.map(l => [l.id, l]))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selected) { setDetail(null); return }
    fetchTransferDetail(selected.id).then(setDetail).catch(() => setDetail(null))
  }, [selected])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = transfers.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (!q) return true
      const hay = [
        t.search_blob ?? '',
        locMap[t.from_location_id]?.name ?? '',
        locMap[t.to_location_id]?.name ?? '',
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
    if (sortConfig) {
      list = [...list].sort((a, b) => {
        const av = a[sortConfig.key] as string | null
        const bv = b[sortConfig.key] as string | null
        if (!av) return 1; if (!bv) return -1
        const cmp = av < bv ? -1 : av > bv ? 1 : 0
        return sortConfig.direction === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [transfers, statusFilter, search, sortConfig, locMap])

  const counts = useMemo(() => {
    return {
      all: transfers.length,
      pending: transfers.filter(t => t.status === 'pending').length,
      in_transit: transfers.filter(t => t.status === 'in_transit').length,
      partial: transfers.filter(t => t.status === 'partial').length,
      received: transfers.filter(t => t.status === 'received').length,
      cancelled: transfers.filter(t => t.status === 'cancelled').length,
    }
  }, [transfers])

  const STATUS_FILTERS: { key: TransferStatus | 'all'; label: string }[] = [
    { key: 'all',        label: 'All'        },
    { key: 'pending',    label: 'Pending'    },
    { key: 'in_transit', label: 'In Transit' },
    { key: 'partial',    label: 'Partial'    },
    { key: 'received',   label: 'Received'   },
    { key: 'cancelled',  label: 'Cancelled'  },
  ]

  return (
    <>
      <div className="p-4 sm:p-6 space-y-6 bg-white dark:bg-gray-950 min-h-screen">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Transfers</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {loading ? 'Loading…' : `${transfers.length} total transfers`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDocsFilePath('/docs/supply-chain-transfers.md')}
              className="px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              View Help Guide
            </button>
            <button
              onClick={() => setShowDispatchForm(true)}
              className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors"
            >
              + New transfer
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        <TransfersSearch />

        {/* Formatted controls following the requested pattern */}
        <div className="space-y-4">
          {/* Filter tabs */}
          <div className="flex gap-1 overflow-x-auto pb-1 border-b dark:border-gray-800/80 scrollbar-none">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap
                  ${statusFilter === f.key
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                {f.label} ({counts[f.key as keyof typeof counts] ?? 0})
              </button>
            ))}
          </div>

          {/* Search field with leading magnifying glass */}
          <div className="relative w-full sm:max-w-xs">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 dark:text-gray-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search transfer #, title, ISBN…"
              className="w-full pl-9 pr-4 py-1.5 border dark:border-gray-700 rounded-md text-xs sm:text-sm bg-white dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 outline-none placeholder-gray-400 dark:placeholder-gray-500 shadow-sm"
            />
          </div>
        </div>

        {loading ? (
          <div className="h-32 rounded-md border dark:border-gray-700 bg-white dark:bg-gray-900 animate-pulse" />
        ) : (
          <TransferTable
            transfers={filtered}
            locMap={locMap}
            sortConfig={sortConfig}
            onSort={k => setSortConfig(prev => ({ key: k, direction: nextSortDirection(prev, k) }))}
            onRowClick={t => setSelected(prev => prev?.id === t.id ? null : t)}
            selectedId={selected?.id ?? null}
          />
        )}

        <TransferDetailSidebar
          detail={detail}
          locMap={locMap}
          onClose={() => setSelected(null)}
          onReceive={(id) => { setSelected(null); setReceivingTransferId(id) }}
        />
      </div>

      {showDispatchForm && (
        <TransferDispatchForm
          defaultFromLocationId="gid://shopify/Location/40052293765"
          defaultToLocationId="gid://shopify/Location/67668738181"
          onClose={() => setShowDispatchForm(false)}
          onDispatched={async () => { setShowDispatchForm(false); await load() }}
        />
      )}

      {receivingTransferId && (
        <TransferReceivePanel
          transferId={receivingTransferId}
          onClose={() => setReceivingTransferId(null)}
          onReceived={async () => { setReceivingTransferId(null); await load() }}
        />
      )}

      {docsFilePath && (
        <RightSidebar
          title="Transfers Guide"
          docsFilePath={docsFilePath}
          onClose={() => setDocsFilePath(null)}
        />
      )}
    </>
  )
}