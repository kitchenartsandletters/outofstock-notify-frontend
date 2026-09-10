// src/supply-chain/returns/ReturnDraft.tsx
// The returns detail page — renders by status across the whole lifecycle:
//   draft     → curate keep/return, add titles, save
//   picking   → pull sheet: record what was physically pulled (0 = phantom),
//               then manifest behind a guarded confirm flow
//   confirmed → read-only, printable packing list, and record how it shipped
//   shipped   → the same, with carrier + tracking filled in
//
// on_hand comes from the periodic snapshot, NOT a live Shopify read. A title
// transferred into the store this morning can still show 0 until the snapshot
// runs again. So on-hand is shown as guidance with its timestamp and never caps
// what can be entered — the person filling this in is holding the books, and
// the pull sheet reconciles against the physical count.
//
// The manifest is the one action that writes live Shopify inventory, so it is
// gated: dry-run summary → explicit second confirmation → a 5s undo window
// before the real mutation fires.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  fetchReturn, fetchReturnsWorksheet, saveReturn, deleteReturn,
  startPick, savePick, manifestPreview, manifestReturn, fetchPackingList, cancelReturn,
  setShipping, trackingUrl, CARRIERS,
  ReturnIndexRow, ReturnsWorksheetRow, ReturnReason, ManifestSummary, PackingList,
} from '../../api/returnsApi';

interface EditLine {
  id: string;                 // publisher_return_lines.id (needed for pick save)
  inventory_item_id: string;
  variant_id: string | null;
  isbn: string | null;
  title: string | null;
  list_price: number | null;
  on_hand: number;
  sales_12mo: number;
  requested: number;          // planned return qty (draft)
  picked: number;             // physically pulled (picking)
  confirmed: number;          // final (confirmed)
  inventory_adjusted: boolean;
}

const money = (v: number | null | undefined) =>
  v == null ? '—' : v.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const clampInt = (v: number, max: number) => Math.max(0, Math.min(Math.round(v || 0), max));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// Upper bound on a typed quantity. Deliberately not on_hand: the snapshot lags,
// and a stale number must not be able to overrule the physical shelf.
const ENTRY_MAX = 9999;

export default function ReturnDraft() {
  const { returnId = '' } = useParams();
  const navigate = useNavigate();

  const [header, setHeader] = useState<ReturnIndexRow | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<ReturnsWorksheetRow[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [snapshotAsOf, setSnapshotAsOf] = useState<string | null>(null);

  // Shipping (confirmed onwards)
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [shipBusy, setShipBusy] = useState(false);

  // Manifest guarded flow
  type Stage = null | 'summary' | 'confirm' | 'undo' | 'running';
  const [stage, setStage] = useState<Stage>(null);
  const [summary, setSummary] = useState<ManifestSummary | null>(null);
  const [undoLeft, setUndoLeft] = useState(5);
  const [packing, setPacking] = useState<PackingList | null>(null);

  const status = header?.status;
  const isDraft = status === 'draft';
  const isPicking = status === 'picking';
  const isShipped = status === 'shipped';
  const isConfirmed = status === 'confirmed' || isShipped;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await fetchReturn(returnId);
      const st = detail.return.status;
      let byId = new Map<string, ReturnsWorksheetRow>();
      if (st === 'draft' || st === 'picking') {
        // In-stock rows only here: this list exists to attach live on_hand to the
        // lines already on the return. The add-title search is served separately
        // (see the effect below) because a big publisher's full catalogue runs to
        // thousands of rows — PRH alone is ~3,300 — and cannot be loaded up front.
        const ws = await fetchReturnsWorksheet(detail.return.supplier_party_id, { limit: 1000 });
        setSnapshotAsOf(ws.snapshot_as_of ?? null);
        byId = new Map(ws.rows.map(r => [r.inventory_item_id, r]));
      }
      setLines(detail.lines.map(l => {
        const w = byId.get(l.inventory_item_id);
        const requested = l.quantity_requested ?? 0;
        return {
          id: l.id,
          inventory_item_id: l.inventory_item_id,
          variant_id: l.variant_id,
          isbn: l.isbn,
          title: l.title,
          list_price: l.list_price ?? w?.price ?? null,
          on_hand: w?.on_hand ?? 0,
          sales_12mo: w?.sales_12mo ?? 0,
          requested,
          picked: l.quantity_picked ?? requested,
          confirmed: l.quantity_confirmed ?? 0,
          inventory_adjusted: !!l.inventory_adjusted,
        };
      }));
      setHeader(detail.return);
      setCarrier(detail.return.carrier ?? '');
      setTracking(detail.return.tracking_number ?? '');
      setDirty(false);
      if (st === 'confirmed' || st === 'shipped') {
        try { setPacking(await fetchPackingList(returnId)); } catch { /* non-fatal */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load return');
    } finally {
      setLoading(false);
    }
  }, [returnId]);

  useEffect(() => { load(); }, [load]);

  const patchHeader = (p: Partial<ReturnIndexRow>) => { setHeader(h => (h ? { ...h, ...p } : h)); setDirty(true); };

  // ---- draft editing (keep/return) ----
  // on_hand informs the keep/return arithmetic and is flagged when exceeded, but
  // it is NOT a limit — see the ENTRY_MAX note above.
  const overStock = (l: EditLine) => l.on_hand > 0 && l.requested > l.on_hand;
  const setReturn = (id: string, v: number) => {
    setLines(ls => ls.map(l => l.inventory_item_id === id ? { ...l, requested: clampInt(v, ENTRY_MAX) } : l));
    setDirty(true);
  };
  const setKeep = (id: string, keep: number) => {
    setLines(ls => ls.map(l => {
      if (l.inventory_item_id !== id) return l;
      const k = clampInt(keep, ENTRY_MAX);
      return { ...l, requested: Math.max((l.on_hand || (k + l.requested)) - k, 0) };
    }));
    setDirty(true);
  };
  const removeLine = (id: string) => { setLines(ls => ls.filter(l => l.inventory_item_id !== id)); setDirty(true); };
  const addLine = (w: ReturnsWorksheetRow) => {
    setLines(ls => [...ls, {
      id: `new:${w.inventory_item_id}`, inventory_item_id: w.inventory_item_id, variant_id: w.variant_id,
      isbn: w.isbn, title: w.title, list_price: w.price, on_hand: w.on_hand, sales_12mo: w.sales_12mo,
      // A title the snapshot thinks is out of stock has no suggested return, but
      // it is being added because someone is holding a copy — start at 1.
      requested: w.suggested_return > 0 ? w.suggested_return : 1,
      picked: w.suggested_return > 0 ? w.suggested_return : 1,
      confirmed: 0, inventory_adjusted: false,
    }]);
    setAddSearch(''); setAddResults([]); setDirty(true);
  };

  // ---- picking editing (picked count) ----
  const setPicked = (id: string, v: number) => {
    // Not capped at the plan either: if more copies turn up on the shelf than
    // were planned, the pull sheet should be able to say so.
    setLines(ls => ls.map(l => l.id === id ? { ...l, picked: clampInt(v, ENTRY_MAX) } : l));
    setDirty(true);
  };

  const inDraft = useMemo(() => new Set(lines.map(l => l.inventory_item_id)), [lines]);

  // Add-title search runs on the SERVER against the publisher's whole returnable
  // list. It used to filter a locally-loaded page, which silently capped what
  // could be found: Penguin Random House has ~3,300 catalogue rows and Hachette
  // ~1,300, so with a 1,000-row load anything further down was unreachable and
  // simply would not appear however it was spelled.
  useEffect(() => {
    const term = addSearch.trim();
    if (!isDraft || term.length < 2 || !header) { setAddResults([]); return; }
    let cancelled = false;
    setAddSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchReturnsWorksheet(header.supplier_party_id, {
          search: term, includeZeroStock: true, limit: 25,
        });
        if (!cancelled) setAddResults(res.rows);
      } catch {
        if (!cancelled) setAddResults([]);
      } finally {
        if (!cancelled) setAddSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [addSearch, isDraft, header]);

  const addable = useMemo(
    () => addResults.filter(w => !inDraft.has(w.inventory_item_id)).slice(0, 8),
    [addResults, inDraft]
  );

  const totals = useMemo(() => {
    let units = 0, value = 0, count = 0;
    for (const l of lines) {
      const q = isPicking ? l.picked : isConfirmed ? l.confirmed : l.requested;
      if (q > 0) { count++; units += q; value += q * (l.list_price ?? 0); }
    }
    return { units, value, count };
  }, [lines, isPicking, isConfirmed]);

  // ---- actions ----
  const saveDraft = async () => {
    if (!header) return;
    setBusy(true); setError(null);
    try {
      const updated = await saveReturn(returnId, {
        reason: (header.return_type as ReturnReason) || undefined,
        account_number: header.account_number,
        notes: header.notes,
        ship_to_name: header.ship_to_name,
        ship_to_address: header.ship_to_address,
        lines: lines.filter(l => l.requested > 0).map(l => ({
          inventory_item_id: l.inventory_item_id, variant_id: l.variant_id, isbn: l.isbn,
          title: l.title, list_price: l.list_price, quantity_requested: l.requested,
        })),
      });
      setHeader(updated.return); setDirty(false); setNotice('Draft saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setBusy(false); }
  };

  const beginPick = async () => {
    setBusy(true); setError(null);
    try { await startPick(returnId); await load(); setNotice('Pull sheet started — record what you physically pull.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to start pull sheet'); }
    finally { setBusy(false); }
  };

  const savePicked = async () => {
    setBusy(true); setError(null);
    try {
      await savePick(returnId, lines.map(l => ({ line_id: l.id, quantity_picked: l.picked })));
      setDirty(false); setNotice('Pull counts saved.');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save pull counts'); }
    finally { setBusy(false); }
  };

  const removeDraft = async () => {
    if (!confirm('Delete this draft return? This cannot be undone.')) return;
    try { await deleteReturn(returnId); navigate('/supply-chain/returns'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete'); }
  };

  const cancelThis = async () => {
    if (!confirm('Cancel this return? It will be marked cancelled (no inventory change).')) return;
    try { await cancelReturn(returnId); navigate('/supply-chain/returns'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to cancel'); }
  };

  // ---- shipping ----
  const shipDirty =
    (carrier || '') !== (header?.carrier ?? '') ||
    (tracking || '') !== (header?.tracking_number ?? '');

  const saveShipping = async () => {
    setShipBusy(true); setError(null);
    try {
      const updated = await setShipping(returnId, {
        carrier: carrier || null,
        tracking_number: tracking || null,
      });
      setHeader(updated.return);
      setCarrier(updated.return.carrier ?? '');
      setTracking(updated.return.tracking_number ?? '');
      setNotice(updated.return.tracking_number
        ? 'Shipping recorded — this return is marked shipped.'
        : 'Tracking cleared — back to confirmed.');
      try { setPacking(await fetchPackingList(returnId)); } catch { /* non-fatal */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save shipping details');
    } finally {
      setShipBusy(false);
    }
  };

  // ---- manifest guarded flow ----
  const openManifest = async () => {
    if (dirty) { setError('Save your pull counts before creating the manifest.'); return; }
    setError(null); setSummary(null); setStage('summary');
    try {
      const res = await manifestPreview(returnId);
      setSummary(res.summary);
    } catch (e) {
      setStage(null);
      setError(e instanceof Error ? e.message : 'Failed to preview manifest');
    }
  };

  const fireManifest = useCallback(async () => {
    setStage('running'); setError(null);
    try {
      const res = await manifestReturn(returnId);
      setPacking(res.packing_list);
      if (res.inventory.failed > 0 || (res.errors && res.errors.length)) {
        setError(`Some lines did not adjust (${res.inventory.failed} failed). The return stays in picking — you can retry the manifest. ${res.errors.join('; ')}`);
      } else {
        setNotice(`Manifested. Shopify inventory decreased by ${res.summary.units} unit(s) across ${res.summary.titles} title(s).`);
      }
      setStage(null);
      await load();
    } catch (e) {
      setStage(null);
      setError(e instanceof Error ? e.message : 'Manifest failed');
    }
  }, [returnId, load]);

  // undo countdown: when armed, tick down; at 0, fire the real mutation.
  const firedRef = useRef(false);
  useEffect(() => {
    if (stage !== 'undo') { firedRef.current = false; return; }
    if (undoLeft <= 0) {
      if (!firedRef.current) { firedRef.current = true; void fireManifest(); }
      return;
    }
    const t = setTimeout(() => setUndoLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, undoLeft, fireManifest]);

  const armUndo = () => { setUndoLeft(5); setStage('undo'); };
  const abortManifest = () => { setStage(null); setSummary(null); };

  // A paper worksheet for the floor. Deliberately NOT the packing list: it is
  // headed as a worksheet, carries a write-in Picked column, and says plainly
  // that nothing is committed until the counts are entered back in and the
  // manifest is run. Someone finding this sheet on a bench should not mistake
  // it for the document that goes in the box.
  const printPullSheet = () => {
    if (!header) return;
    const rows = lines
      .filter(l => l.requested > 0)
      .map(l => `<tr>
        <td>${esc(l.title)}</td>
        <td class="mono">${esc(l.isbn) || '<span class="muted">no ISBN</span>'}</td>
        <td class="r">${l.on_hand || '—'}</td>
        <td class="r plan">${l.requested}</td>
        <td class="box"></td>
      </tr>`).join('');
    const planned = lines.reduce((n, l) => n + (l.requested > 0 ? l.requested : 0), 0);
    const titles = lines.filter(l => l.requested > 0).length;

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Pull sheet ${esc(header.return_number)}</title>
      <style>
        body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;}
        .banner{border:2px solid #111;padding:8px 12px;margin-bottom:14px;}
        .banner b{font-size:15px;letter-spacing:.02em;}
        .banner div{font-size:11px;color:#444;margin-top:2px;}
        .head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;}
        h1{font-size:17px;margin:0;}
        .sub{color:#555;font-size:12px;}
        .rn{font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.04em;}
        table{width:100%;border-collapse:collapse;margin-top:8px;}
        th,td{border-bottom:1px solid #ccc;padding:7px 8px;text-align:left;vertical-align:top;}
        th{font-size:11px;text-transform:uppercase;color:#555;border-bottom:1.5px solid #111;}
        th.r,td.r{text-align:right;} .mono{font-family:ui-monospace,monospace;font-size:12px;}
        .muted{color:#999;font-style:italic;}
        .plan{font-weight:bold;}
        .box{width:64px;border-bottom:1px solid #ccc;border-left:1px solid #ccc;background:#fafafa;}
        tfoot td{font-weight:bold;border-top:1.5px solid #111;}
        .sign{margin-top:22px;display:flex;gap:32px;font-size:12px;color:#444;}
        .sign div{flex:1;border-top:1px solid #999;padding-top:4px;}
        @media print{ body{margin:14mm;} .box{background:none;} }
      </style></head><body>
      <div class="banner">
        <b>PULL SHEET — WORKSHEET ONLY</b>
        <div>Not a packing list and not a manifest. Nothing is returned and no inventory changes
        until these counts are entered back into the return and the manifest is run.</div>
      </div>

      <div class="head">
        <div>
          <h1>${esc(header.publisher_name)}</h1>
          <div class="sub">Kitchen Arts &amp; Letters · printed ${new Date().toLocaleString()}</div>
        </div>
        <div style="text-align:right">
          <div class="rn">Return Number</div>
          <div class="mono"><b>${esc(header.return_number)}</b></div>
          <div class="sub">${titles} titles · ${planned} units planned</div>
        </div>
      </div>

      <table>
        <thead><tr>
          <th>Title</th><th>ISBN</th><th class="r">On hand</th>
          <th class="r">Planned</th><th class="r">Picked</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="3" class="r">Planned total</td>
          <td class="r">${planned}</td><td class="box"></td>
        </tr></tfoot>
      </table>

      <p style="font-size:11px;color:#555;margin-top:10px;">
        Write the count you actually pull in the last column. Enter <b>0</b> for anything you
        cannot find — that is useful information, not a mistake, and it corrects the shelf count.
        On-hand figures were last refreshed ${snapshotAsOf ? new Date(snapshotAsOf).toLocaleString() : 'recently'}
        and may be behind the shelf.
      </p>

      <div class="sign">
        <div>Pulled by</div><div>Date</div><div>Checked by</div>
      </div>
      </body></html>`;

    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { setError('Popup blocked — allow popups to print the pull sheet.'); return; }
    w.document.write(html); w.document.close(); w.focus(); w.print();
  };

  const printPackingList = (pl: PackingList) => {
    const rows = pl.items.map(i => `<tr>
      <td>${esc(i.title)}</td><td class="mono">${esc(i.isbn)}</td>
      <td class="r">${i.list_price == null ? '—' : '$' + Number(i.list_price).toFixed(2)}</td>
      <td class="r">${i.quantity}</td></tr>`).join('');
    const reason = pl.reason === 'overstock_author_event' ? 'Overstock – author event' : 'Overstock';
    // ship_to_name is the addressee (may be multi-line) and ship_to_address the
    // street lines; they no longer repeat each other.
    const shipTo = [pl.ship_to_name, pl.ship_to_address].filter(Boolean).join('\n');
    const shipRow = pl.tracking_number
      ? `<div><span>Shipped via</span>${esc(pl.carrier || '—')} ${esc(pl.tracking_number)}</div>`
      : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Return ${esc(pl.return_number)}</title>
      <style>
        body{font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:40px;}
        h1{font-size:18px;margin:0;} .sub{color:#555;margin:2px 0 16px;}
        .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;}
        .rn{font-size:11px;text-transform:uppercase;color:#666;letter-spacing:.04em;}
        .meta{margin:16px 0;display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;}
        .meta div span{color:#666;display:block;font-size:11px;text-transform:uppercase;}
        table{width:100%;border-collapse:collapse;margin-top:12px;}
        th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;}
        th.r,td.r{text-align:right;} .mono{font-family:ui-monospace,monospace;}
        tfoot td{font-weight:bold;border-top:2px solid #111;}
        .addr{white-space:pre-line;}
      </style></head><body>
      <div class="head">
        <div><h1>Kitchen Arts &amp; Letters, Inc.</h1><div class="sub">Publisher Return</div></div>
        <div style="text-align:right">
          <div class="rn">Return Number</div>
          <div class="mono"><b>${esc(pl.return_number)}</b></div>
          <div class="sub">${new Date(pl.created_at).toLocaleDateString()}</div></div>
      </div>
      <div class="meta">
        <div><span>Publisher</span>${esc(pl.publisher_name)}</div>
        <div><span>Account #</span>${esc(pl.account_number) || '—'}</div>
        <div><span>Reason</span>${reason}</div>
        <div><span>Units / Titles</span>${pl.total_units} / ${pl.items.length}</div>
        ${shipRow}
        <div style="grid-column:1 / -1"><span>Return to</span><span class="addr" style="color:#111;text-transform:none;font-size:13px;">${esc(shipTo)}</span></div>
      </div>
      <table><thead><tr><th>Title</th><th>ISBN</th><th class="r">List price</th><th class="r">Qty</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" class="r">Total units</td><td class="r">${pl.total_units}</td></tr>
      <tr><td colspan="3" class="r">Total list value</td><td class="r">$${pl.total_value.toFixed(2)}</td></tr></tfoot></table>
      </body></html>`;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { setError('Popup blocked — allow popups to print the packing list.'); return; }
    w.document.write(html); w.document.close(); w.focus(); w.print();
  };

  if (loading) return <div className="opacity-70 text-sm py-8 text-center">Loading…</div>;
  if (!header) return <div className="text-sm text-red-600 px-3 py-2">{error ?? 'Return not found'}</div>;

  const statusBadge = (
    <span className={`text-[11px] uppercase px-2 py-0.5 rounded ${
      isShipped ? 'bg-emerald-100 text-emerald-800' :
      status === 'confirmed' ? 'bg-green-100 text-green-700' :
      isPicking ? 'bg-blue-100 text-blue-700' :
      status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700'}`}>{status}</span>
  );

  const liveTrackingUrl = trackingUrl(carrier, tracking);

  return (
    <div className="space-y-4">
      <div className="text-sm"><Link to="/supply-chain/returns" className="text-blue-600 hover:underline">← All returns</Link></div>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{header.publisher_name ?? 'Return'}</h2>
          <span className="text-sm opacity-70">
            Return Number: <span className="font-mono">{header.return_number}</span> · {statusBadge}
          </span>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {dirty && <span className="text-xs text-amber-600">unsaved changes</span>}
          {isDraft && <button onClick={removeDraft} className="border border-red-300 text-red-600 px-3 py-1 rounded text-sm hover:bg-red-50">Delete</button>}
          {isDraft && <button onClick={saveDraft} disabled={busy || !dirty} className="border px-4 py-1 rounded text-sm disabled:opacity-50">{busy ? '…' : 'Save draft'}</button>}
          {isDraft && <button onClick={beginPick} disabled={busy || dirty} title={dirty ? 'Save changes first' : ''} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1 rounded text-sm disabled:opacity-50">Start pull sheet →</button>}
          {isPicking && <button onClick={cancelThis} className="border border-red-300 text-red-600 px-3 py-1 rounded text-sm hover:bg-red-50">Cancel return</button>}
          {isPicking && <button onClick={printPullSheet} className="border px-4 py-1 rounded text-sm">Print pull sheet</button>}
          {isPicking && <button onClick={savePicked} disabled={busy || !dirty} className="border px-4 py-1 rounded text-sm disabled:opacity-50">Save pull counts</button>}
          {isPicking && <button onClick={openManifest} disabled={busy} className="bg-green-600 hover:bg-green-700 text-white px-4 py-1 rounded text-sm disabled:opacity-50">Create manifest →</button>}
          {isConfirmed && packing && <button onClick={() => printPackingList(packing)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1 rounded text-sm">Print packing list</button>}
        </div>
      </div>

      {notice && <div className="text-sm rounded border border-green-300 bg-green-50 text-green-800 px-3 py-2">{notice}</div>}
      {error && <div className="text-sm rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2">{error}</div>}
      {status === 'cancelled' && <div className="text-sm rounded border border-gray-300 bg-gray-50 px-3 py-2">This return was cancelled.</div>}

      {/* Meta / logistics */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase opacity-60">Reason</span>
          <select disabled={!isDraft} value={header.return_type ?? 'overstock'} onChange={e => patchHeader({ return_type: e.target.value })}
            className="px-2 py-1 border rounded dark:bg-gray-800 disabled:opacity-60">
            <option value="overstock">Overstock</option>
            <option value="overstock_author_event">Overstock – author event</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase opacity-60">Account #</span>
          <input disabled={!isDraft} value={header.account_number ?? ''} onChange={e => patchHeader({ account_number: e.target.value })}
            className="px-2 py-1 border rounded dark:bg-gray-800 disabled:opacity-60" placeholder="—" />
        </label>
        <div className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-xs uppercase opacity-60">Return to</span>
          {/* addressee then street lines — the two no longer repeat each other */}
          <div className="text-xs whitespace-pre-line opacity-80">
            {[header.ship_to_name, header.ship_to_address].filter(Boolean).join('\n')
              || 'No default return address set in Supply Chain.'}
          </div>
        </div>
      </div>

      {/* Shipping — once the inventory is adjusted and the boxes go out */}
      {isConfirmed && (
        <div className="border rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">Shipping</h3>
            {header.shipped_at && (
              <span className="text-xs opacity-60">Shipped {new Date(header.shipped_at).toLocaleDateString()}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase opacity-60">Carrier</span>
              <select value={carrier} onChange={e => setCarrier(e.target.value)}
                className="px-2 py-1 border rounded dark:bg-gray-800 min-w-[8rem]">
                <option value="">—</option>
                {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm flex-1 min-w-[16rem]">
              <span className="text-xs uppercase opacity-60">Tracking number</span>
              <input value={tracking} onChange={e => setTracking(e.target.value)}
                placeholder="e.g. 1Z…"
                className="px-2 py-1 border rounded font-mono dark:bg-gray-800" />
            </label>

            <button onClick={saveShipping} disabled={shipBusy || !shipDirty}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50">
              {shipBusy ? 'Saving…' : 'Save shipping'}
            </button>
          </div>

          {header.tracking_number ? (
            <div className="text-sm">
              {header.carrier && <span className="opacity-70">{header.carrier} · </span>}
              {liveTrackingUrl ? (
                <a href={liveTrackingUrl} target="_blank" rel="noreferrer"
                   className="font-mono text-blue-600 hover:underline">{header.tracking_number}</a>
              ) : (
                <span className="font-mono">{header.tracking_number}</span>
              )}
            </div>
          ) : (
            <div className="text-xs opacity-60">
              Not shipped yet. Adding a tracking number marks this return shipped; clearing it
              puts it back to confirmed.
            </div>
          )}
        </div>
      )}

      {/* Add title (draft only) */}
      {isDraft && (
        <div className="relative max-w-md">
          <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Add a title (search this publisher's full list)…"
            className="w-full px-3 py-2 border rounded text-sm dark:bg-gray-800" />
          {addSearch.trim().length >= 2 && (addSearching || addable.length === 0) && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border rounded shadow-lg px-3 py-2 text-sm opacity-70">
              {addSearching ? 'Searching…' : 'No match in this publisher’s returnable list.'}
            </div>
          )}
          {addable.length > 0 && (
            <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border rounded shadow-lg max-h-64 overflow-auto">
              {addable.map(w => (
                <button key={w.inventory_item_id} onClick={() => addLine(w)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-100 dark:border-gray-700">
                  {w.title} <span className="opacity-60">· {w.isbn} · {w.on_hand > 0 ? `${w.on_hand} on hand` : 'none recorded on hand'} · {w.sales_12mo} sold 12mo</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {snapshotAsOf && !isConfirmed && (
        <div className="text-xs opacity-60">
          On-hand figures as of {new Date(snapshotAsOf).toLocaleString()} — guidance, not a limit.
          If stock has moved since, enter what you actually have.
        </div>
      )}

      <div className="text-sm font-medium">
        {isPicking ? 'Pulling' : isConfirmed ? 'Returned' : 'Returning'}: {totals.count} titles · {totals.units.toLocaleString()} units · {money(totals.value)}
        {isPicking && <span className="opacity-60 font-normal"> — record what you physically pull; set 0 for any copy you can’t find.</span>}
      </div>

      {/* Line table */}
      <div className="overflow-auto border rounded-md">
        <table className="min-w-full border border-gray-200 dark:border-gray-700 text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left border-r border-gray-200 dark:border-gray-700">Title</th>
              <th className="px-3 py-2 text-left border-r border-gray-200 dark:border-gray-700">ISBN</th>
              {!isConfirmed && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">On hand</th>}
              {isDraft && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">12mo</th>}
              {isDraft && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">Keep</th>}
              {isDraft && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">Return</th>}
              {isPicking && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">Planned</th>}
              {isPicking && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">Picked</th>}
              {isConfirmed && <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">Returned</th>}
              <th className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700">Value</th>
              {isDraft && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td className="px-3 py-6 text-center opacity-70" colSpan={9}>No titles on this return.</td></tr>
            ) : lines.map(l => {
              const q = isPicking ? l.picked : isConfirmed ? l.confirmed : l.requested;
              const keep = Math.max((l.on_hand || l.requested) - l.requested, 0);
              return (
                <tr key={l.id} className="even:bg-gray-50 dark:even:bg-gray-700">
                  <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700">{l.title ?? '—'}</td>
                  <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700">{l.isbn ?? '—'}</td>
                  {!isConfirmed && (
                    <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right">
                      {l.on_hand || '—'}
                      {overStock(l) && (
                        <span className="ml-1 text-amber-600" title={`Return exceeds the last known on-hand (${l.on_hand}). That may well be right if stock moved since the snapshot — the pull sheet will confirm.`}>!</span>
                      )}
                    </td>
                  )}
                  {isDraft && <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right">{l.sales_12mo}</td>}
                  {isDraft && (
                    <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right">
                      <input type="number" min={0} max={ENTRY_MAX} value={keep}
                        onChange={e => setKeep(l.inventory_item_id, Number(e.target.value))}
                        className="w-16 px-2 py-1 border rounded text-right dark:bg-gray-800" />
                    </td>
                  )}
                  {isDraft && (
                    <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right">
                      <input type="number" min={0} max={ENTRY_MAX} value={l.requested}
                        onChange={e => setReturn(l.inventory_item_id, Number(e.target.value))}
                        className="w-16 px-2 py-1 border rounded text-right font-semibold dark:bg-gray-800" />
                      <div className="mt-1 flex gap-1 justify-end">
                        <button className="text-[11px] px-1 border rounded" title="Return all on hand" onClick={() => setReturn(l.inventory_item_id, l.on_hand)}>all</button>
                        <button className="text-[11px] px-1 border rounded" title="Keep all" onClick={() => setReturn(l.inventory_item_id, 0)}>keep</button>
                      </div>
                    </td>
                  )}
                  {isPicking && <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right tabular-nums">{l.requested}</td>}
                  {isPicking && (
                    <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right">
                      <input type="number" min={0} max={ENTRY_MAX} value={l.picked}
                        onChange={e => setPicked(l.id, Number(e.target.value))}
                        className="w-16 px-2 py-1 border rounded text-right font-semibold dark:bg-gray-800" />
                      <div className="mt-1 flex gap-1 justify-end">
                        <button className="text-[11px] px-1 border rounded" title="Found all planned" onClick={() => setPicked(l.id, l.requested)}>all</button>
                        <button className="text-[11px] px-1 border rounded" title="None found (phantom)" onClick={() => setPicked(l.id, 0)}>0</button>
                      </div>
                    </td>
                  )}
                  {isConfirmed && <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right tabular-nums">{l.confirmed}</td>}
                  <td className="px-3 py-2 border-r border-gray-200 dark:border-gray-700 text-right">{money(q * (l.list_price ?? 0))}</td>
                  {isDraft && <td className="px-2 py-2 text-center"><button onClick={() => removeLine(l.inventory_item_id)} title="Remove" className="text-gray-400 hover:text-red-500">✕</button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Manifest guarded flow ── */}
      {stage === 'summary' && (
        <Modal title="Review manifest" onClose={abortManifest}>
          {!summary ? <div className="text-sm opacity-70">Calculating…</div> : (
            <>
              <p className="text-sm">You're about to manifest this return to <b>{header.publisher_name}</b>:</p>
              <ul className="text-sm my-3 space-y-1">
                <li>• <b>{summary.titles}</b> titles · <b>{summary.units}</b> units · <b>{money(summary.value)}</b> list value</li>
                <li>• This will <b>decrease Shopify on-hand</b> by these quantities at the store location.</li>
              </ul>
              <div className="max-h-40 overflow-auto border rounded text-xs">
                {summary.deltas.map(d => (
                  <div key={d.inventory_item_id} className="flex justify-between px-2 py-1 border-b last:border-0">
                    <span className="truncate pr-2">{d.title}</span><span className="tabular-nums text-red-600">{d.delta}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={abortManifest} className="border px-4 py-1.5 rounded text-sm">Cancel</button>
                <button onClick={() => setStage('confirm')} className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm">Continue</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {stage === 'confirm' && summary && (
        <Modal title="Confirm inventory adjustment" onClose={abortManifest}>
          <div className="text-sm rounded border border-amber-400 bg-amber-50 text-amber-900 px-3 py-2">
            This writes to <b>live Shopify inventory</b>. On-hand will drop by <b>{summary.units}</b> unit(s) across <b>{summary.titles}</b> title(s). Once applied it can't be undone from here — you'd create a compensating adjustment.
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={abortManifest} className="border px-4 py-1.5 rounded text-sm">Cancel</button>
            <button onClick={armUndo} className="bg-green-600 text-white px-4 py-1.5 rounded text-sm">Confirm &amp; manifest</button>
          </div>
        </Modal>
      )}

      {stage === 'undo' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-lg shadow-lg px-4 py-3 flex items-center gap-4">
          <span className="text-sm">Applying manifest in {undoLeft}s…</span>
          <button onClick={abortManifest} className="text-sm font-semibold text-amber-300 hover:text-amber-200">Undo</button>
        </div>
      )}
      {stage === 'running' && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-lg shadow-lg px-4 py-3 text-sm">Applying inventory adjustments…</div>
      )}

      {/* Packing list (confirmed) */}
      {isConfirmed && packing && (
        <div className="border rounded-md p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Packing list</h3>
            <button onClick={() => printPackingList(packing)} className="text-sm text-blue-600 hover:underline">Print / PDF</button>
          </div>
          <div className="text-sm opacity-80">{packing.total_units} units · {packing.items.length} titles · {money(packing.total_value)} list value</div>
          <div className="text-xs opacity-60">Account #{packing.account_number || '—'} · {packing.reason === 'overstock_author_event' ? 'Overstock – author event' : 'Overstock'}</div>
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}
