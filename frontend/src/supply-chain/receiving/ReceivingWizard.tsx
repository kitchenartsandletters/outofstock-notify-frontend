// ReceivingWizard.tsx
// Phase-based wizard: idle → review → confirm → confirming → result
//
// Damage handling (#29):
//   HARD RULE: quantity_received = undamaged copies only.
//   quantity_damaged is tracked separately and never added to quantity_received.
//
//   Each line row has a structured damage section (expandable):
//     1. Qty damaged    — how many arrived damaged (max = qty that arrived total)
//     2. Disposal       — Donate/destroy · Return (call tag) [folded into notes]
//     3. Resolution     — Credit · Replacement incoming
//        Credit:       line closes at quantity_received (account credit fills the gap)
//        Replacement:  line stays partial; publisher reshipping on same PO number
//
//   "Qty arrived" = quantity_received + quantity_damaged
//   Staff enter total qty that arrived, then how many were damaged.
//   quantity_received is derived: arrived − damaged.
//
//   The confirm summary shows damaged-line details so staff can verify before submit.
//   Disposal method and damage note are folded into receipt-level notes on submit.
//
// Receiving decision support:
//   Each line row shows live on-hand, a loud warning when copies already here are
//   committed to unfulfilled orders, and the publisher list price against the
//   current Shopify price. The backend attaches these to the PO detail response;
//   they are read-only and never sent back. They WARN and never block — a
//   receiver with a box in hand must always be able to finish receiving.
//
// Other phases unchanged from previous commits (#11 notes seeding, #12 confirm, #14 PDF).

import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  WizardLine, ReceiveResult, DamageDisposal, DamageResolution,
  stockContextFromLine, formatStockCount, formatMoney,
} from './receivingTypes'
import { PurchaseOrderDetail } from '../purchase-orders/purchaseOrderTypes'
import {
  fetchPurchaseOrderDetail,
  receiveOrder,
  parseAndLookup,
  downloadReceiptPdf,
} from '../../api/supplyChainApi'
import { useLocations } from '../hooks/useLocations'
import { formatDate } from '../../utils/tableUtils'
import RightSidebar from '../../components/RightSidebar'

type Phase = 'idle' | 'review' | 'confirm' | 'confirming' | 'result'
type ScanState = 'idle' | 'scanning' | 'done' | 'error'

const DEFAULT_LOCATION_ID = 'gid://shopify/Location/40052293765'

// ---------------------------------------------------------------------------
// Packing slip scanner (unchanged)
// ---------------------------------------------------------------------------

function WizardSlipScanner({
  lines,
  onLinesUpdated,
}: {
  lines: WizardLine[]
  onLinesUpdated: (updates: Record<string, number>) => void
}) {
  const [scanState, setScanState]     = useState<ScanState>('idle')
  const [scanSummary, setScanSummary] = useState<{
    matched: number; unmatched: number; notOnSlip: number; previewUrl: string | null
  } | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const previewUrl = URL.createObjectURL(file)
    setScanState('scanning')
    setScanError(null)
    setScanSummary(null)

    try {
      const result = await parseAndLookup(file)
      if (result.stub || result.lines.length === 0) {
        setScanError('Could not extract lines from this image. Adjust quantities manually.')
        setScanState('error')
        return
      }

      const slipQtyByIsbn: Record<string, number> = {}
      for (const sl of result.lines) {
        if (sl.isbn && sl.quantity != null)
          slipQtyByIsbn[sl.isbn] = (slipQtyByIsbn[sl.isbn] ?? 0) + sl.quantity
      }

      const updates: Record<string, number> = {}
      let matched = 0, notOnSlip = 0
      for (const wizLine of lines) {
        if (!wizLine.isbn) continue
        const slipQty  = slipQtyByIsbn[wizLine.isbn]
        const remaining = wizLine.quantity_ordered - wizLine.quantity_previously_received
        if (slipQty != null) {
          updates[wizLine.purchase_order_line_id] = Math.min(slipQty, remaining)
          matched++
        } else {
          updates[wizLine.purchase_order_line_id] = 0
          notOnSlip++
        }
      }

      const poIsbns   = new Set(lines.map(l => l.isbn).filter(Boolean))
      const unmatched = Object.keys(slipQtyByIsbn).filter(isbn => !poIsbns.has(isbn)).length

      onLinesUpdated(updates)
      setScanSummary({ matched, unmatched, notOnSlip, previewUrl })
      setScanState('done')
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
      setScanState('error')
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleReset = () => { setScanState('idle'); setScanSummary(null); setScanError(null) }

  if (scanState === 'idle') return (
    <div className="flex items-center justify-between px-4 py-3 rounded-md border border-dashed
                    border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/30">
      <p className="text-xs text-gray-500 dark:text-gray-400">Scan packing slip to auto-fill quantities</p>
      <button type="button" onClick={() => inputRef.current?.click()}
        className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-xs font-semibold
                   text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors">
        📷 Scan slip
      </button>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" capture="environment"
        onChange={handleFileChange} className="hidden" />
    </div>
  )

  if (scanState === 'scanning') return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-md border dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
      <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0" />
      <p className="text-xs text-gray-500 dark:text-gray-400 animate-pulse">Reading packing slip and matching lines…</p>
    </div>
  )

  if (scanState === 'error') return (
    <div className="flex items-center justify-between px-4 py-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
      <p className="text-xs text-red-700 dark:text-red-300">{scanError}</p>
      <button type="button" onClick={handleReset} className="text-xs text-red-500 hover:underline shrink-0 ml-3">Try again</button>
    </div>
  )

  if (scanState === 'done' && scanSummary) return (
    <div className={`px-4 py-3 rounded-md border space-y-1
      ${scanSummary.notOnSlip > 0 || scanSummary.unmatched > 0
        ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
        : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <p className={`text-xs font-semibold ${scanSummary.notOnSlip > 0 || scanSummary.unmatched > 0 ? 'text-amber-800 dark:text-amber-200' : 'text-green-800 dark:text-green-200'}`}>
            {scanSummary.matched === 0 ? 'No lines matched — verify quantities manually'
              : `${scanSummary.matched} line${scanSummary.matched !== 1 ? 's' : ''} matched from packing slip`}
          </p>
          {scanSummary.notOnSlip > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ {scanSummary.notOnSlip} line{scanSummary.notOnSlip !== 1 ? 's' : ''} on this PO not found on slip — set to 0.
            </p>
          )}
          {scanSummary.unmatched > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              ⚠ {scanSummary.unmatched} ISBN{scanSummary.unmatched !== 1 ? 's' : ''} on slip not matched to a PO line.
            </p>
          )}
          <p className="text-[10px] text-gray-500 dark:text-gray-400">Review quantities below before submitting.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {scanSummary.previewUrl && (
            <a href={scanSummary.previewUrl} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-gray-400 hover:underline">View</a>
          )}
          <button type="button" onClick={handleReset}
            className="text-[10px] text-gray-400 hover:underline">Rescan</button>
        </div>
      </div>
    </div>
  )

  return null
}

// ---------------------------------------------------------------------------
// Live stock + price context for a line.
//
// Two signals a receiver previously had to leave the flow to get:
//   1. Copies already on hand, and whether any are committed to unfulfilled
//      orders. on_hand > 0 AND committed > 0 means the title is sitting here
//      while customers wait — surface it loudly, but never block receiving.
//   2. Publisher list price vs the current Shopify price, flagged on ANY
//      difference so staff can correct Shopify in the moment.
//
// null/undefined renders as an em dash. A failed Shopify lookup must never
// display as 0, which would wrongly say "nothing on hand, nothing waiting".
// ---------------------------------------------------------------------------

function LineStockPriceContext({ line }: { line: WizardLine }) {
  const knowsStock = line.on_hand !== null && line.on_hand !== undefined
  const knowsPrice =
    (line.list_price !== null && line.list_price !== undefined) ||
    (line.current_price !== null && line.current_price !== undefined)

  if (!knowsStock && !knowsPrice) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px]">
        {knowsStock && (
          <span className="text-gray-500 dark:text-gray-400">
            On hand:{' '}
            <strong className="font-mono text-gray-900 dark:text-gray-100">
              {formatStockCount(line.on_hand)}
            </strong>
          </span>
        )}
        {knowsPrice && (
          <span className="text-gray-500 dark:text-gray-400">
            List <strong className="font-mono text-gray-900 dark:text-gray-100">{formatMoney(line.list_price)}</strong>
            {' · '}
            Shopify{' '}
            <strong className={`font-mono ${
              line.price_mismatch
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-900 dark:text-gray-100'
            }`}>
              {formatMoney(line.current_price)}
            </strong>
          </span>
        )}
        {line.price_mismatch && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700
                           dark:bg-red-900/30 dark:text-red-300 uppercase tracking-wide">
            Price mismatch
          </span>
        )}
      </div>

      {line.price_mismatch && (
        <p className="text-[11px] text-red-700 dark:text-red-300">
          Shopify price differs from the publisher's list price — update the product before shelving.
        </p>
      )}

      {line.stock_alert && (
        <div className="px-2.5 py-2 rounded border border-red-300 dark:border-red-700
                        bg-red-50 dark:bg-red-900/20">
          <p className="text-[11px] font-semibold text-red-800 dark:text-red-200">
            ⚠ {formatStockCount(line.committed)} unit{line.committed === 1 ? '' : 's'} committed to unfulfilled orders
          </p>
          <p className="text-[11px] text-red-700 dark:text-red-300 mt-0.5">
            {formatStockCount(line.on_hand)} already on hand — check whether these should have shipped already.
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Structured damage section (#29)
//
// Staff workflow:
//   1. Enter how many copies arrived total (qty_arrived)
//   2. Enter how many of those are damaged (qty_damaged)
//   3. System derives quantity_received = qty_arrived − qty_damaged (undamaged only)
//   4. Choose disposal method (for notes record)
//   5. Choose resolution (credit closes the line; replacement keeps it open)
//
// "I don't know yet" is valid for resolution — staff can set it post-receive
// via the PODetailSidebar resolve-damage action.
// ---------------------------------------------------------------------------

function DamageSection({
  line,
  onChange,
}: {
  line: WizardLine
  onChange: (patch: Partial<Pick<WizardLine, 'quantity_received' | 'quantity_damaged' | 'damage_disposal' | 'damage_resolution'>>) => void
}) {
  const remaining  = line.quantity_ordered - line.quantity_previously_received
  // qty_arrived is what the staff physically counted coming off the truck
  const qtyArrived = line.quantity_received + line.quantity_damaged

  const handleArrivedChange = (arrived: number) => {
    const safeArrived  = Math.min(Math.max(0, arrived), remaining)
    const safeDamaged  = Math.min(line.quantity_damaged, safeArrived)
    onChange({
      quantity_received: safeArrived - safeDamaged,
      quantity_damaged:  safeDamaged,
    })
  }

  const handleDamagedChange = (damaged: number) => {
    const safeDamaged = Math.min(Math.max(0, damaged), qtyArrived)
    onChange({
      quantity_damaged:  safeDamaged,
      quantity_received: qtyArrived - safeDamaged,
    })
  }

  return (
    <div className="border-t border-amber-200 dark:border-amber-800 pt-3 mt-1 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
        Damage details
      </p>

      {/* Qty arrived + qty damaged — derive quantity_received automatically */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold mb-1">
            Total arrived
            <span className="ml-1 normal-case font-normal text-gray-400">(incl. damaged)</span>
          </label>
          <input
            type="number" min={0} max={remaining}
            value={qtyArrived}
            onChange={e => handleArrivedChange(parseInt(e.target.value) || 0)}
            className="w-full px-3 py-1.5 border dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
          />
          <p className="text-[10px] text-gray-400 mt-1">max {remaining}</p>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-amber-500 dark:text-amber-400 font-bold mb-1">
            Qty damaged
          </label>
          <input
            type="number" min={0} max={qtyArrived}
            value={line.quantity_damaged}
            onChange={e => handleDamagedChange(parseInt(e.target.value) || 0)}
            className="w-full px-3 py-1.5 border border-amber-300 dark:border-amber-700 rounded text-sm bg-amber-50/50 dark:bg-amber-900/10 dark:text-white focus:ring-2 focus:ring-amber-400 outline-none font-mono"
          />
          {line.quantity_damaged > 0 && (
            <p className="text-[10px] text-green-600 dark:text-green-400 mt-1 font-mono">
              → {line.quantity_received} restocked to Shopify
            </p>
          )}
        </div>
      </div>

      {/* Only show the rest once there are actually damaged copies */}
      {line.quantity_damaged > 0 && (
        <>
          {/* Disposal */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold mb-1.5">
              Disposal of damaged copies
            </label>
            <div className="flex gap-2">
              {([
                { value: 'donate_destroy', label: 'Donate / destroy' },
                { value: 'return',         label: 'Return (call tag)' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ damage_disposal: opt.value })}
                  className={`flex-1 px-3 py-2 rounded border text-xs font-medium transition-colors
                    ${line.damage_disposal === opt.value
                      ? 'border-amber-400 dark:border-amber-600 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold mb-1.5">
              Publisher response
            </label>
            <div className="flex gap-2">
              {([
                { value: 'credit',              label: 'Credit',              sub: 'Account credited — line closes' },
                { value: 'replacement_pending', label: 'Replacement incoming', sub: 'Same PO# — keep open' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() =>
                    onChange({
                      damage_resolution: line.damage_resolution === opt.value ? null : opt.value,
                    })
                  }
                  className={`flex-1 px-3 py-2 rounded border text-xs font-medium transition-colors text-left
                    ${line.damage_resolution === opt.value
                      ? opt.value === 'credit'
                        ? 'border-green-400 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
                        : 'border-blue-400 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'}`}
                >
                  <div className="font-semibold">{opt.label}</div>
                  <div className={`text-[10px] mt-0.5 ${
                    line.damage_resolution === opt.value
                      ? opt.value === 'credit'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-blue-500 dark:text-blue-400'
                      : 'text-gray-400 dark:text-gray-500'
                  }`}>{opt.sub}</div>
                </button>
              ))}
            </div>
            {!line.damage_resolution && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                Don't know yet? Leave unselected — you can record the response from the PO later.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line row (#29 updated — replaces free-text damage note)
// ---------------------------------------------------------------------------

function LineRow({
  line,
  fromScan,
  onQtyChange,
  onDamageChange,
}: {
  line: WizardLine
  fromScan: boolean
  onQtyChange:    (id: string, value: number) => void
  onDamageChange: (id: string, patch: Partial<Pick<WizardLine, 'quantity_received' | 'quantity_damaged' | 'damage_disposal' | 'damage_resolution'>>) => void
}) {
  const remaining  = line.quantity_ordered - line.quantity_previously_received
  const [showDamage, setShowDamage] = useState(line.quantity_damaged > 0)
  const hasDamage  = line.quantity_damaged > 0

  // When staff open the damage section for the first time, pre-set qty_arrived
  // to the current quantity_received so they don't have to re-enter it
  const handleOpenDamage = () => {
    if (!showDamage && !hasDamage) {
      // Pre-seed arrived = current qty_received so the field isn't blank
      // quantity_damaged defaults to 0 → quantity_received stays the same until they enter damage qty
    }
    setShowDamage(v => !v)
  }

  return (
    <div className={`rounded-md border bg-white dark:bg-gray-900 px-4 py-3 space-y-3
      ${line.stock_alert
        ? 'border-red-300 dark:border-red-700'
        : fromScan && line.quantity_received === 0 && !hasDamage
        ? 'border-amber-300 dark:border-amber-700'
        : hasDamage
        ? 'border-amber-400 dark:border-amber-600'
        : 'dark:border-gray-700'}`}>

      {/* Title / ISBN / badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">{line.title}</p>
            {hasDamage && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 uppercase tracking-wide shrink-0">
                {line.quantity_damaged} damaged
              </span>
            )}
            {hasDamage && line.damage_resolution === 'credit' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 uppercase tracking-wide shrink-0">
                Credit
              </span>
            )}
            {hasDamage && line.damage_resolution === 'replacement_pending' && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 uppercase tracking-wide shrink-0">
                Replacement
              </span>
            )}
            {fromScan && line.quantity_received === 0 && !hasDamage && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 uppercase tracking-wide shrink-0">
                Not on slip
              </span>
            )}
            {fromScan && line.quantity_received > 0 && !hasDamage && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 uppercase tracking-wide shrink-0">
                From scan
              </span>
            )}
          </div>
          {line.isbn && <p className="text-[11px] font-mono text-gray-400 dark:text-gray-500 mt-0.5">{line.isbn}</p>}
        </div>
        <div className="text-right text-xs text-gray-500 dark:text-gray-400 shrink-0">
          <p>Ordered: <strong>{line.quantity_ordered}</strong></p>
          {line.quantity_previously_received > 0 && (
            <p>Prev. rcvd: <strong>{line.quantity_previously_received}</strong></p>
          )}
          <p>Remaining: <strong className={remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>{remaining}</strong></p>
        </div>
      </div>

      {/* Live on-hand / committed / price context — warns, never blocks */}
      <LineStockPriceContext line={line} />

      {/* Qty received (undamaged) — shown when damage section is not open */}
      {!showDamage && (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold mb-1">
              Qty received
              {hasDamage && (
                <span className="ml-1 normal-case font-normal text-green-600 dark:text-green-400">
                  (undamaged only — {line.quantity_received} to Shopify)
                </span>
              )}
            </label>
            <input
              type="number" min={0} max={remaining}
              value={line.quantity_received}
              onChange={e => onQtyChange(line.purchase_order_line_id, Math.max(0, parseInt(e.target.value) || 0))}
              className={`w-full px-3 py-1.5 border rounded text-sm bg-white dark:bg-gray-800 dark:text-white
                focus:ring-2 focus:ring-blue-500 outline-none font-mono
                ${fromScan && line.quantity_received === 0 && !hasDamage
                  ? 'border-amber-300 dark:border-amber-600'
                  : 'dark:border-gray-600'}`}
            />
          </div>
          <button
            type="button"
            onClick={handleOpenDamage}
            className="px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 text-xs font-medium
                       text-gray-400 dark:text-gray-500 hover:border-amber-300 dark:hover:border-amber-700
                       hover:text-amber-600 dark:hover:text-amber-400 transition-colors mb-0.5">
            + Damage
          </button>
        </div>
      )}

      {/* Damage section */}
      {showDamage && (
        <div>
          {/* Close button */}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Qty received (undamaged):
              <strong className="ml-1 font-mono text-gray-900 dark:text-gray-100">{line.quantity_received}</strong>
              {line.quantity_damaged > 0 && (
                <span className="ml-1 text-green-600 dark:text-green-400">→ Shopify</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                setShowDamage(false)
                // If no damage was actually entered, clear everything
                if (line.quantity_damaged === 0) {
                  onDamageChange(line.purchase_order_line_id, {
                    damage_disposal: null,
                    damage_resolution: null,
                  })
                }
              }}
              className="text-[10px] text-gray-400 hover:underline">
              {line.quantity_damaged > 0 ? 'Collapse' : 'Cancel'}
            </button>
          </div>
          <DamageSection
            line={line}
            onChange={patch => onDamageChange(line.purchase_order_line_id, patch)}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm summary — updated to show damage details (#29)
// ---------------------------------------------------------------------------

function ConfirmSummary({
  lines,
  completedLines,
  poDetail,
  locationId,
  notes,
  isTest,
  locationName,
  onBack,
  onConfirm,
  busy,
}: {
  lines: WizardLine[]
  completedLines: Array<{ title: string; isbn: string | null; quantity_ordered: number; quantity_received: number }>
  poDetail: PurchaseOrderDetail
  locationId: string
  notes: string
  isTest: boolean
  locationName: (id: string) => string
  onBack: () => void
  onConfirm: () => void
  busy: boolean
}) {
  const activeLines   = lines.filter(l => l.quantity_received > 0 || l.quantity_damaged > 0)
  const damagedLines  = activeLines.filter(l => l.quantity_damaged > 0)
  // Lines with zero qty_received AND zero damage are treated as skipped
  const outstandingLines = lines.filter(l => l.quantity_received === 0 && l.quantity_damaged === 0)
  // Credit lines close even though qty_received < qty_ordered
  const creditLines   = damagedLines.filter(l => l.damage_resolution === 'credit')
  const replacementLines = damagedLines.filter(l => l.damage_resolution === 'replacement_pending')
  // Lines being received that already have copies committed to unfulfilled
  // orders — last chance to notice before the box goes on the shelf.
  const alertLines    = activeLines.filter(l => l.stock_alert)

  const totalReceived = activeLines.reduce((s, l) => s + l.quantity_received, 0)
  const totalDamaged  = activeLines.reduce((s, l) => s + l.quantity_damaged, 0)
  const isPartial     = outstandingLines.length > 0 || replacementLines.length > 0 || completedLines.length > 0

  const order = poDetail.order as any

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Confirm Receipt</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Review before applying inventory changes.</p>
      </div>

      {/* Orders already waiting on titles in this receipt */}
      {alertLines.length > 0 && (
        <div className="px-4 py-3 rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 space-y-2">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            ⚠ {alertLines.length} title{alertLines.length !== 1 ? 's' : ''} in this receipt {alertLines.length !== 1 ? 'have' : 'has'} unfulfilled orders waiting
          </p>
          <div className="space-y-0.5">
            {alertLines.map(l => (
              <p key={l.purchase_order_line_id} className="text-xs text-red-700 dark:text-red-300 truncate">
                · {l.title} — {formatStockCount(l.committed)} committed, {formatStockCount(l.on_hand)} on hand
              </p>
            ))}
          </div>
          <p className="text-xs text-red-600 dark:text-red-400">
            Check whether these should have shipped already. Receiving is not blocked.
          </p>
        </div>
      )}

      {/* Partial alert — outstanding + replacement-pending lines */}
      {isPartial && (outstandingLines.length > 0 || replacementLines.length > 0) && (
        <div className="px-4 py-3 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 space-y-2">
          {outstandingLines.length > 0 && (
            <>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                ⚠ {outstandingLines.length} line{outstandingLines.length !== 1 ? 's' : ''} ({outstandingLines.reduce((s,l) => s + (l.quantity_ordered - l.quantity_previously_received), 0)} units) still outstanding
              </p>
              <div className="space-y-0.5">
                {outstandingLines.map(l => (
                  <p key={l.purchase_order_line_id} className="text-xs text-amber-700 dark:text-amber-300 truncate">
                    · {l.title} — {l.quantity_ordered - l.quantity_previously_received} remaining
                  </p>
                ))}
              </div>
            </>
          )}
          {replacementLines.length > 0 && (
            <>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                ⟳ {replacementLines.length} line{replacementLines.length !== 1 ? 's' : ''} awaiting replacement on this PO
              </p>
              <div className="space-y-0.5">
                {replacementLines.map(l => (
                  <p key={l.purchase_order_line_id} className="text-xs text-blue-700 dark:text-blue-300 truncate">
                    · {l.title} — {l.quantity_damaged} damaged, replacement incoming
                  </p>
                ))}
              </div>
            </>
          )}
          <p className="text-xs text-amber-600 dark:text-amber-400">
            PO will stay in "Partial" / "Awaiting receipt" until all lines are resolved.
          </p>
        </div>
      )}

      {/* Summary card */}
      <div className="border dark:border-gray-700 rounded-lg overflow-hidden text-sm">
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Receipt summary</p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">PO</span>
            <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{poDetail.order.po_number}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Supplier</span>
            <span className="text-gray-900 dark:text-gray-100">{order?.supplier_name ?? order?.account_label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Receiving into</span>
            <span className="text-gray-900 dark:text-gray-100">{locationName(locationId)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Restocked to Shopify</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{totalReceived} units (undamaged)</span>
          </div>
          {totalDamaged > 0 && (
            <div className="flex justify-between">
              <span className="text-amber-600 dark:text-amber-400">Damaged (not restocked)</span>
              <span className="font-semibold text-amber-700 dark:text-amber-300">{totalDamaged} units</span>
            </div>
          )}
          {notes.trim() && (
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 dark:text-gray-400 shrink-0">Notes</span>
              <span className="text-xs text-gray-600 dark:text-gray-400 text-right">{notes.trim()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Lines being received */}
      <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
          <p className="text-[10px] font-bold uppercase tracking-wider text-green-700 dark:text-green-400">
            Lines ({activeLines.length} · {totalReceived} restocked{totalDamaged > 0 ? ` + ${totalDamaged} damaged` : ''})
          </p>
        </div>
        <div className="divide-y dark:divide-gray-800 max-h-56 overflow-y-auto">
          {activeLines.map(l => (
            <div key={l.purchase_order_line_id} className="px-4 py-2 text-sm">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-gray-900 dark:text-gray-100 truncate">{l.title}</p>
                  {l.isbn && <p className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{l.isbn}</p>}
                </div>
                <div className="text-right shrink-0 ml-3 space-y-0.5">
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                    × {l.quantity_received} ✓
                  </p>
                  {l.quantity_damaged > 0 && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                      {l.quantity_damaged} dmg
                      {l.damage_resolution === 'credit' && ' · credit'}
                      {l.damage_resolution === 'replacement_pending' && ' · repl.'}
                      {!l.damage_resolution && ' · TBD'}
                    </p>
                  )}
                  {l.price_mismatch && (
                    <p className="text-[10px] text-red-600 dark:text-red-400">price mismatch</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {creditLines.length > 0 && (
        <div className="px-3 py-2.5 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-200">
          ✓ {creditLines.length} line{creditLines.length !== 1 ? 's' : ''} will close immediately — account credit covers the damaged units.
        </div>
      )}

      {isTest && (
        <div className="px-3 py-2.5 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 text-sm text-yellow-800 dark:text-yellow-200">
          ⚑ Test mode — Shopify inventory will NOT be updated.
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onBack} disabled={busy}
          className="px-4 py-2.5 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors">
          ← Back
        </button>
        <button onClick={onConfirm} disabled={busy}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-md text-sm transition-colors disabled:opacity-50 active:scale-[0.98]">
          {busy ? 'Applying…' : isTest
            ? `Confirm test receipt (${totalReceived} units) →`
            : `Confirm & apply to Shopify (${totalReceived} units) →`}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Receipt PDF download button (#14 — unchanged)
// ---------------------------------------------------------------------------

function ReceiptPdfButton({ receiptId }: { receiptId: string }) {
  const [downloading, setDownloading] = useState(false)
  const [dlError, setDlError]         = useState<string | null>(null)

  const handleDownload = async () => {
    setDownloading(true)
    setDlError(null)
    try {
      await downloadReceiptPdf(receiptId)
    } catch (e) {
      setDlError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <button onClick={handleDownload} disabled={downloading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md border
                   border-gray-300 dark:border-gray-600 text-sm font-medium
                   text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800
                   disabled:opacity-50 transition-colors">
        {downloading ? (
          <><span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />Generating PDF…</>
        ) : '↓ Download receipt PDF'}
      </button>
      {dlError && <p className="text-xs text-red-600 dark:text-red-400 mt-1 text-center">{dlError}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export default function ReceivingWizard() {
  const [searchParams] = useSearchParams()
  const poId = searchParams.get('po')
  const { locationName } = useLocations()

  const [phase,         setPhase]         = useState<Phase>('idle')
  const [docsFilePath,  setDocsFilePath]  = useState<string | null>(null)
  const [poDetail,      setPoDetail]      = useState<PurchaseOrderDetail | null>(null)
  const [lines,         setLines]         = useState<WizardLine[]>([])
  const [completedLines, setCompletedLines] = useState<Array<{
    title: string; isbn: string | null; quantity_ordered: number; quantity_received: number
  }>>([])
  const [locationId,    setLocationId]    = useState(DEFAULT_LOCATION_ID)
  const [notes,         setNotes]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [busy,          setBusy]          = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [result,        setResult]        = useState<ReceiveResult | null>(null)
  const [scannedLineIds, setScannedLineIds] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  useEffect(() => {
    if (!poId) return
    setLoading(true)
    fetchPurchaseOrderDetail(poId)
      .then(detail => {
        setPoDetail(detail)
        initLines(detail)
        const dest = (detail.order as any).destination_location_id
        setLocationId(dest || DEFAULT_LOCATION_ID)
        const ref = (detail.order as any).informal_ref
        if (ref) setNotes(ref)
        setPhase('review')
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load PO'))
      .finally(() => setLoading(false))
  }, [poId])

  function initLines(detail: PurchaseOrderDetail) {
    const completed = detail.lines.filter(l => l.status === 'received' || l.status === 'cancelled')
    const active    = detail.lines.filter(l => l.status !== 'cancelled' && l.status !== 'received')
    setCompletedLines(completed.map(l => ({
      title:             l.title ?? `Item ${l.inventory_item_id.split('/').pop()}`,
      isbn:              l.isbn ?? null,
      quantity_ordered:  l.quantity_ordered,
      quantity_received: l.quantity_received,
    })))
    setLines(active.map(l => ({
      purchase_order_line_id:       l.id,
      inventory_item_id:            l.inventory_item_id,
      variant_id:                   l.variant_id,
      title:                        l.title ?? `Item ${l.inventory_item_id.split('/').pop()}`,
      isbn:                         l.isbn ?? null,
      quantity_ordered:             l.quantity_ordered,
      quantity_previously_received: l.quantity_received,
      // Start at 0, not the full outstanding quantity. Pre-filling every line
      // with "everything arrived" means a partial shipment has to be corrected
      // line by line, and anything the receiver misses is silently received —
      // which is how a title that never shipped ended up received in full.
      // "Receive all" below makes the complete-shipment case one click.
      quantity_received:            0,
      quantity_damaged:             0,
      damage_disposal:              null,
      damage_resolution:            null,
      // Live on-hand / committed / price attached by the backend. Absent fields
      // read as unknown, never as zero.
      ...stockContextFromLine(l),
    })))
  }

  function handleScanUpdate(updates: Record<string, number>) {
    setLines(prev => prev.map(l =>
      l.purchase_order_line_id in updates
        ? { ...l, quantity_received: updates[l.purchase_order_line_id] }
        : l
    ))
    setScannedLineIds(new Set(Object.keys(updates)))
  }

  function handleQtyChange(lineId: string, value: number) {
    setLines(prev => prev.map(l =>
      l.purchase_order_line_id === lineId ? { ...l, quantity_received: value } : l
    ))
  }

  // Bulk quantity controls. Receiving a single title from a long PO otherwise
  // means zeroing every other line by hand; receiving everything otherwise
  // means typing each quantity. Both only touch quantity_received — damaged
  // counts and their resolutions are deliberately left alone, since those are
  // per-line judgements a bulk action shouldn't overwrite.
  function setAllReceived(mode: 'all' | 'none') {
    setLines(prev => prev.map(l => {
      const remaining = l.quantity_ordered - l.quantity_previously_received
      return {
        ...l,
        quantity_received: mode === 'none'
          ? 0
          : Math.max(0, remaining - l.quantity_damaged),
      }
    }))
  }

  function handleDamageChange(
    lineId: string,
    patch: Partial<Pick<WizardLine, 'quantity_received' | 'quantity_damaged' | 'damage_disposal' | 'damage_resolution'>>
  ) {
    setLines(prev => prev.map(l =>
      l.purchase_order_line_id === lineId ? { ...l, ...patch } : l
    ))
  }

  function validate(): string | null {
    const hasAny = lines.some(l => l.quantity_received > 0 || l.quantity_damaged > 0)
    if (!hasAny) return 'At least one line must have a received or damaged quantity.'

    // Hard rule enforced client-side too: qty_received must be undamaged only
    for (const l of lines) {
      const remaining = l.quantity_ordered - l.quantity_previously_received
      if (l.quantity_received + l.quantity_damaged > remaining) {
        return `${l.title}: total arrived (${l.quantity_received + l.quantity_damaged}) exceeds remaining ordered qty (${remaining}).`
      }
    }
    return null
  }

  function handleReviewNext() {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)
    setPhase('confirm')
  }

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    setPhase('confirming')

    try {
      // Lines with any activity (received or damaged)
      const activeLines = lines.filter(l => l.quantity_received > 0 || l.quantity_damaged > 0)

      // receipt_type: full only if every line is fully received (credit lines count as received)
      const allFull = activeLines.every(l => {
        const remaining = l.quantity_ordered - l.quantity_previously_received
        const totalArrived = l.quantity_received + l.quantity_damaged
        return totalArrived >= remaining && (
          l.damage_resolution === 'credit' || l.quantity_damaged === 0
        )
      }) && lines.every(l => l.quantity_received + l.quantity_damaged > 0 || l.quantity_previously_received >= l.quantity_ordered)

      // Build notes — include disposal and resolution context for each damaged line
      const damageNoteParts = activeLines
        .filter(l => l.quantity_damaged > 0)
        .map(l => {
          const parts = [`${l.title}: ${l.quantity_damaged} damaged`]
          if (l.damage_disposal === 'donate_destroy') parts.push('donate/destroy')
          if (l.damage_disposal === 'return') parts.push('return with call tag')
          if (l.damage_resolution === 'credit') parts.push('credit taken')
          if (l.damage_resolution === 'replacement_pending') parts.push('replacement incoming on this PO')
          return parts.join(' — ')
        })

      const combinedNotes = [
        notes.trim() || null,
        damageNoteParts.length > 0 ? `Damage: ${damageNoteParts.join('; ')}` : null,
      ].filter(Boolean).join('\n') || undefined

      const res = await receiveOrder({
        purchase_order_id: poDetail!.order.id,
        location_id:       locationId,
        receipt_type:      allFull ? 'full' : 'partial',
        notes:             combinedNotes,
        lines: activeLines.map(l => ({
          purchase_order_line_id: l.purchase_order_line_id,
          inventory_item_id:      l.inventory_item_id,
          quantity_received:      l.quantity_received,   // undamaged only — hard rule
          quantity_damaged:       l.quantity_damaged,
          damage_resolution:      l.damage_resolution,
        })),
      })

      setResult(res)
      setPhase('result')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Receiving failed')
      setPhase('review')
    } finally {
      setBusy(false)
    }
  }

  function handleReset() { navigate('/receiving') }

  const order  = poDetail?.order as any
  const isTest = !!order?.is_test
  // Lines the receiver has actually entered something for — drives the counter
  // and disables "Clear all" when there is nothing to clear.
  const enteredCount = lines.filter(l => l.quantity_received > 0 || l.quantity_damaged > 0).length

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Receive Stock</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Record stock received against a purchase order.</p>
        </div>
        <button onClick={() => setDocsFilePath('/docs/supply-chain-receiving-wizard.md')}
          className="shrink-0 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
          View Help Guide
        </button>
      </div>

      {/* ── IDLE ─────────────────────────────────────────────────── */}
      {phase === 'idle' && (
        <div className="space-y-4">
          {loading && <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">Loading PO…</p>}
          {!loading && (
            <div className="rounded-md border dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
              Open a purchase order and click <strong>Receive →</strong> from the sidebar,
              or go to <strong>Receiving → New Receipt</strong> to look up a PO by number.
            </div>
          )}
          {error && (
            <div className="px-3 py-2 rounded bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">{error}</div>
          )}
        </div>
      )}

      {/* ── REVIEW ───────────────────────────────────────────────── */}
      {phase === 'review' && poDetail && (
        <div className="space-y-5">
          <div className="rounded-md border dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-sm space-y-0.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold text-gray-900 dark:text-gray-100">{poDetail.order.po_number}</span>
                {poDetail.order.is_ad_hoc && <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase">Ad hoc</span>}
                {isTest && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 uppercase">Test</span>}
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">{poDetail.lines.length} line{poDetail.lines.length !== 1 ? 's' : ''}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {order?.supplier_name ?? order?.account_label ?? ''}
              {poDetail.order.ordered_at ? ` · Ordered ${formatDate(poDetail.order.ordered_at)}` : ''}
            </p>
            {order?.informal_ref && <p className="text-[11px] font-mono text-gray-400 dark:text-gray-500">ref: {order.informal_ref}</p>}
          </div>

          <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-blue-500 dark:text-blue-400 font-bold mb-0.5">Receiving into</p>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{locationName(locationId)}</p>
              <p className="font-mono text-[10px] text-blue-400 dark:text-blue-500 mt-0.5">{locationId.split('/').pop()}</p>
            </div>
            <span className="text-[11px] text-blue-500 dark:text-blue-400">PO destination</span>
          </div>

          {lines.length > 0 && <WizardSlipScanner lines={lines} onLinesUpdated={handleScanUpdate} />}

          {lines.length > 1 && (
            <div className="flex items-center justify-between gap-3 px-1">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                {enteredCount} of {lines.length} line{lines.length !== 1 ? 's' : ''} with a quantity
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAllReceived('all')}
                  className="px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-[11px] font-semibold
                             text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors">
                  Receive all
                </button>
                <button type="button" onClick={() => setAllReceived('none')}
                  disabled={enteredCount === 0}
                  className="px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-[11px] font-semibold
                             text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800
                             disabled:opacity-40 transition-colors">
                  Clear all
                </button>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {lines.map(l => (
              <LineRow
                key={l.purchase_order_line_id}
                line={l}
                fromScan={scannedLineIds.has(l.purchase_order_line_id)}
                onQtyChange={handleQtyChange}
                onDamageChange={handleDamageChange}
              />
            ))}

            {completedLines.length > 0 && (
              <div className="border dark:border-gray-700 rounded-md overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-gray-400 dark:text-gray-500">
                    Already received ({completedLines.length} line{completedLines.length !== 1 ? 's' : ''})
                  </p>
                </div>
                {completedLines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b dark:border-gray-800 last:border-0 opacity-60">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{l.title}</p>
                      {l.isbn && <p className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{l.isbn}</p>}
                    </div>
                    <span className="text-xs font-semibold text-green-600 dark:text-green-400 shrink-0 ml-3">
                      ✓ {l.quantity_received}/{l.quantity_ordered}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {lines.length === 0 && completedLines.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-600 italic">All lines on this order are already received or cancelled.</p>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-bold mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Packing slip reference, price discrepancies, substitutions, backorder notes…"
              className="w-full px-3 py-2 border rounded text-sm bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
            />
          </div>

          {error && (
            <div className="px-3 py-2 rounded bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">{error}</div>
          )}

          <button disabled={lines.length === 0 || busy} onClick={handleReviewNext}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-md text-sm transition-colors disabled:opacity-50 active:scale-[0.98]">
            Review & confirm →
          </button>
        </div>
      )}

      {/* ── CONFIRM ──────────────────────────────────────────────── */}
      {phase === 'confirm' && poDetail && (
        <ConfirmSummary
          lines={lines} completedLines={completedLines}
          poDetail={poDetail} locationId={locationId}
          notes={notes} isTest={isTest} locationName={locationName}
          onBack={() => setPhase('review')}
          onConfirm={handleConfirm}
          busy={busy}
        />
      )}

      {/* ── CONFIRMING ───────────────────────────────────────────── */}
      {phase === 'confirming' && (
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-gray-500 dark:text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Applying inventory adjustments…</p>
          <p className="text-xs text-gray-400 dark:text-gray-600">Do not close this page.</p>
        </div>
      )}

      {/* ── RESULT ───────────────────────────────────────────────── */}
      {phase === 'result' && result && (
        <div className="space-y-5">
          <div className={`rounded-md border px-4 py-4 ${
            result.status === 'applied'        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : result.status === 'test_applied' ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
            : result.status === 'partial'      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
            :                                    'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">
                {result.status === 'applied' ? '✓' : result.status === 'test_applied' ? '⚑' : result.status === 'partial' ? '⚠' : '✗'}
              </span>
              <h3 className={`font-semibold ${
                result.status === 'applied'        ? 'text-green-800 dark:text-green-200'
                : result.status === 'test_applied' ? 'text-yellow-800 dark:text-yellow-200'
                : result.status === 'partial'      ? 'text-amber-800 dark:text-amber-200'
                :                                    'text-red-800 dark:text-red-200'
              }`}>
                {result.status === 'applied'         ? 'Receipt applied successfully'
                  : result.status === 'test_applied' ? 'Test receipt recorded — Shopify not updated'
                  : result.status === 'partial'      ? 'Partial receipt — some lines failed'
                  :                                    'Receipt failed'}
              </h3>
            </div>
            <div className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
              <p>{result.lines_applied} line{result.lines_applied !== 1 ? 's' : ''} applied</p>
              {result.lines_failed  > 0 && <p className="text-red-700 dark:text-red-300">{result.lines_failed} line{result.lines_failed !== 1 ? 's' : ''} failed</p>}
              {result.lines_skipped > 0 && <p className="text-gray-500 dark:text-gray-400">{result.lines_skipped} line{result.lines_skipped !== 1 ? 's' : ''} skipped</p>}
              {notes.trim() && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono">Notes: {notes.trim()}</p>
              )}
              <p className="text-[11px] font-mono text-gray-400 dark:text-gray-500 mt-2">Receipt ID: {result.receipt_id}</p>
            </div>
            {result.errors.length > 0 && (
              <div className="mt-3 space-y-1">
                {result.errors.map((e, i) => <p key={i} className="text-xs text-red-700 dark:text-red-300 font-mono">{e}</p>)}
              </div>
            )}
          </div>

          {(result.status === 'applied' || result.status === 'test_applied') && (
            <ReceiptPdfButton receiptId={result.receipt_id} />
          )}

          <button onClick={handleReset}
            className="w-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium py-2.5 rounded-md text-sm transition-colors">
            Receive another order
          </button>
        </div>
      )}

      {docsFilePath && (
        <RightSidebar
          title="Receiving — Counting Books In"
          docsFilePath={docsFilePath}
          onClose={() => setDocsFilePath(null)}
        />
      )}
    </div>
  )
}
