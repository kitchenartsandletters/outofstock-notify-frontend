import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ConfirmModal from '../ConfirmModal';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface PreorderProduct {
  product_id: number;
  title: string;
  isbn: string | null;
  pub_date: string | null;
  classification: string;
  inventory: number;
  total_presale_qty: number;
  live_presale_qty: number;
  data_confidence: string;
  preorder_tag_present: boolean;
  preorder_collection_present: boolean;
  anomaly_type: string | null;
  last_updated: string | null;
  // Arrival signal — present on active preorders whose stock physically arrived.
  // Independent of current inventory sign (a title can arrive and then oversell
  // into negative inventory while still classified active_preorder).
  arrival_record_is_live?: boolean;
  first_positive_inventory_at?: string | null;
}

interface CleanupState {
  product_id: number;
  product_gid: string;
  title: string;
  description_status: 'enriched' | 'partial' | 'cleaned';
  description_needs_cleaning: boolean;
  has_preamble: boolean;
  has_footer: boolean;
  tags: string[];
  inventory: number;
  barcode: string | null;
  pub_date: string | null;
  in_preorder_collection: boolean;
}

interface CleanupResult {
  product_id: number;
  title: string;
  action: string;
  steps: Record<string, { result: string; errors?: any[] | null }>;
  overall: string;
}

type SortKey = 'title' | 'pub_date' | 'classification' | 'inventory' | 'total_presale_qty';
type SortDir = 'asc' | 'desc';
type FilterMode = 'active' | 'all' | 'needs_cleanup' | 'historical';

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const PREORDER_SERVICE_URL = import.meta.env.VITE_PREORDER_BASE_URL;
const ADMIN_TOKEN = import.meta.env.VITE_PREORDER_ADMIN_TOKEN;
const STORAGE_KEY_SORT = 'release-mgmt-sort';
const STORAGE_KEY_FILTER = 'release-mgmt-filter';
const BATCH_DELAY_MS = 150;

const apiHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Admin-Token': ADMIN_TOKEN,
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function stripArticle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, '');
}

function isPastPubDate(pubDate: string | null): boolean {
  if (!pubDate) return false;
  const pub = new Date(pubDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return pub <= today;
}

function isWithinDays(pubDate: string | null, days: number): boolean {
  if (!pubDate) return false;
  const pub = new Date(pubDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const future = new Date(today);
  future.setDate(future.getDate() + days);
  return pub >= today && pub <= future;
}

// A title has received stock when it carries a live inventory_arrival record.
// Surfaced on active preorders because such a title is fulfillable now and is a
// candidate for early shipping-profile detachment — a fact the classification
// alone (active_preorder) does not convey.
function hasReceivedStock(product: PreorderProduct): boolean {
  return product.classification === 'active_preorder' && product.arrival_record_is_live === true;
}

function classificationBadge(classification: string) {
  switch (classification) {
    case 'active_preorder':
      return { label: 'Active', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' };
    case 'early_stock_arrival':
      return { label: 'Early Stock', cls: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300' };
    case 'historical_preorder':
      return { label: 'Historical', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400' };
    default:
      if (classification.startsWith('anomaly_'))
        return {
          label: classification.replace('anomaly_', '').replace(/_/g, ' '),
          cls: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
        };
      return { label: classification, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400' };
  }
}

// Small "stock received" pill shown alongside the classification badge on active
// preorders that have arrived. Title carries the arrival date for context.
function StockReceivedBadge({ product }: { product: PreorderProduct }) {
  if (!hasReceivedStock(product)) return null;
  const arrived = formatTimestamp(product.first_positive_inventory_at);
  return (
    <span
      title={`Stock received${arrived !== '—' ? ` on ${arrived}` : ''} — fulfillable now; candidate for shipping-profile detachment`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] sm:text-xs font-semibold whitespace-nowrap bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300"
    >
      ✓ Stock received
    </span>
  );
}

function descBadge(status: string) {
  switch (status) {
    case 'enriched':
      return { label: 'Enriched', cls: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' };
    case 'partial':
      return { label: 'Partial', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' };
    case 'cleaned':
      return { label: 'Cleaned', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400' };
    default:
      return { label: '—', cls: '' };
  }
}

// ──────────────────────────────────────────────
// localStorage helpers
// ──────────────────────────────────────────────

function loadSort(): { key: SortKey; dir: SortDir } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SORT);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.key && parsed.dir) return parsed;
    }
  } catch { /* ignore */ }
  return { key: 'pub_date', dir: 'asc' };
}

function saveSort(key: SortKey, dir: SortDir) {
  try { localStorage.setItem(STORAGE_KEY_SORT, JSON.stringify({ key, dir })); } catch { /* ignore */ }
}

function loadFilter(): FilterMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FILTER);
    if (raw && ['active', 'all', 'needs_cleanup', 'historical'].includes(raw)) return raw as FilterMode;
  } catch { /* ignore */ }
  return 'active';
}

function saveFilter(f: FilterMode) {
  try { localStorage.setItem(STORAGE_KEY_FILTER, f); } catch { /* ignore */ }
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

const ReleaseManagement = () => {
  const [products, setProducts] = useState<PreorderProduct[]>([]);
  const [cleanupStates, setCleanupStates] = useState<Record<number, CleanupState>>({});
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>(loadSort().key);
  const [sortDir, setSortDir] = useState<SortDir>(loadSort().dir);
  const [filter, setFilter] = useState<FilterMode>(loadFilter());
  const [search, setSearch] = useState('');

  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});
  const [actionResults, setActionResults] = useState<Record<number, CleanupResult>>({});
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    productId: number;
    title: string;
    action: string;
  }>({ open: false, productId: 0, title: '', action: 'full' });

  const batchFetchedRef = useRef(false);

  // Persist sort/filter
  useEffect(() => { saveSort(sortKey, sortDir); }, [sortKey, sortDir]);
  useEffect(() => { saveFilter(filter); }, [filter]);

  // ── Fetch products ──
  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${PREORDER_SERVICE_URL}/admin/preorders/products`, { headers: apiHeaders() });
      if (!res.ok) throw new Error(`Failed to fetch products: ${res.status}`);
      const data: PreorderProduct[] = await res.json();
      setProducts(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // ── Batch fetch cleanup states for non-historical products (Safe Unmount) ──
  useEffect(() => {
    if (batchFetchedRef.current || products.length === 0) return;
    batchFetchedRef.current = true;

    let isMounted = true;
    const eligible = products.filter((p) => p.classification !== 'not_a_preorder_product');

    const fetchBatch = async () => {
      setInspecting(true);
      for (const p of eligible) {
        if (!isMounted) break;
        try {
          const res = await fetch(
            `${PREORDER_SERVICE_URL}/admin/preorders/cleanup/state/${p.product_id}`,
            { headers: apiHeaders() }
          );
          if (res.ok && isMounted) {
            const data: CleanupState = await res.json();
            setCleanupStates((prev) => ({ ...prev, [p.product_id]: data }));
          }
        } catch (e) {
          console.error(`Batch fetch failed for ${p.product_id}:`, e);
        }
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
      if (isMounted) setInspecting(false);
    };

    fetchBatch();

    return () => {
      isMounted = false;
    };
  }, [products]);

  // ── Single fetch ──
  const fetchCleanupState = async (productId: number) => {
    try {
      const res = await fetch(
        `${PREORDER_SERVICE_URL}/admin/preorders/cleanup/state/${productId}`,
        { headers: apiHeaders() }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data: CleanupState = await res.json();
      setCleanupStates((prev) => ({ ...prev, [productId]: data }));
    } catch (e) {
      console.error(`Failed to fetch cleanup state for ${productId}:`, e);
    }
  };

  // ── Cleanup ──
  const runCleanup = async (productId: number, action: string) => {
    setActionLoading((prev) => ({ ...prev, [productId]: true }));
    try {
      const res = await fetch(
        `${PREORDER_SERVICE_URL}/admin/preorders/cleanup/${action}/${productId}`,
        { method: 'POST', headers: apiHeaders() }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Cleanup failed');
      setActionResults((prev) => ({ ...prev, [productId]: data }));
      await fetchCleanupState(productId);
    } catch (e: any) {
      console.error(`Cleanup failed for ${productId}:`, e);
      setActionResults((prev) => ({
        ...prev,
        [productId]: { product_id: productId, title: '', action, steps: {}, overall: 'error' },
      }));
    } finally {
      setActionLoading((prev) => ({ ...prev, [productId]: false }));
    }
  };

  // ── Sort ──
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sortIcon = (key: SortKey) => sortKey !== key ? '⇅' : sortDir === 'asc' ? '↑' : '↓';

  // ── Upcoming releases ──
  const upcomingReleases = useMemo(
    () => products
      .filter((p) => isWithinDays(p.pub_date, 7) && p.classification !== 'historical_preorder')
      .sort((a, b) => (a.pub_date || '').localeCompare(b.pub_date || '')),
    [products]
  );

  // ── Filtered + sorted ──
  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        if (filter === 'active' && p.classification !== 'active_preorder' && p.classification !== 'early_stock_arrival') return false;
        if (filter === 'historical' && p.classification !== 'historical_preorder') return false;
        if (filter === 'needs_cleanup') {
          const cs = cleanupStates[p.product_id];
          if (!cs) return false;
          if (!cs.description_needs_cleaning && !cs.in_preorder_collection) return false;
          if (!isPastPubDate(p.pub_date)) return false;
        }
        if (search) {
          const term = search.toLowerCase();
          if (!p.title.toLowerCase().includes(term) && !(p.isbn || '').includes(term) && !p.product_id.toString().includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let aVal: any = (a as any)[sortKey];
        let bVal: any = (b as any)[sortKey];
        if (sortKey === 'title') { aVal = stripArticle(aVal || ''); bVal = stripArticle(bVal || ''); }
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        if (typeof aVal === 'string') { aVal = aVal.toLowerCase(); bVal = (bVal as string).toLowerCase(); }
        if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [products, cleanupStates, filter, search, sortKey, sortDir]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-4 px-4 sm:px-0 animate-pulse mt-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        <div className="space-y-3 pt-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 sm:h-12 bg-gray-100 dark:bg-gray-800 rounded-xl sm:rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 dark:text-red-400 p-6 text-center sm:text-left">
        <p className="font-semibold">Error loading preorder products</p>
        <p className="text-sm mt-1">{error}</p>
        <button onClick={fetchProducts} className="mt-4 w-full sm:w-auto px-6 py-2.5 bg-gray-600 text-white rounded-xl sm:rounded hover:bg-gray-700 text-sm font-medium">
          Retry
        </button>
      </div>
    );
  }

  // ── Render helpers ──
  const renderCleanupCell = (productId: number, field: 'description_status' | 'in_preorder_collection') => {
    const cs = cleanupStates[productId];
    if (!cs) return <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>;
    if (field === 'description_status') {
      const b = descBadge(cs.description_status);
      return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${b.cls}`}>{b.label}</span>;
    }
    if (field === 'in_preorder_collection') {
      // Pill structures now maintain identical widths and vertical balance across items
      return cs.in_preorder_collection
        ? <span className="inline-block min-w-[36px] text-center px-1.5 py-0.5 rounded text-xs font-semibold bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400">In</span>
        : <span className="inline-block min-w-[36px] text-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-50 dark:bg-gray-800/40 text-gray-400 dark:text-gray-500">Out</span>;
    }
    return null;
  };

  const renderActions = (product: PreorderProduct, isMobile = false) => {
    const cs = cleanupStates[product.product_id];
    const isLoading = actionLoading[product.product_id];
    const result = actionResults[product.product_id];
    const pastPub = isPastPubDate(product.pub_date);

    const baseBtnCls = isMobile 
      ? "w-full text-center px-4 py-2.5 text-xs font-semibold rounded-lg shadow-sm" 
      : "px-2.5 py-1 text-xs rounded font-medium shadow-sm";

    return (
      <div className={`flex items-center ${isMobile ? 'w-full' : 'gap-2'}`}>
        {!cs && (
          <button 
            onClick={() => fetchCleanupState(product.product_id)}
            className={`${baseBtnCls} border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-[0.98] transition-transform`}
          >
            Inspect Status
          </button>
        )}
        {cs && pastPub && (cs.description_needs_cleaning || cs.in_preorder_collection) && (
          <button
            onClick={() => setConfirmModal({ open: true, productId: product.product_id, title: product.title, action: 'full' })}
            disabled={isLoading}
            className={`${baseBtnCls} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 active:scale-[0.98] transition-transform`}
          >
            {isLoading ? 'Running…' : 'Full Cleanup'}
          </button>
        )}
        {cs && !pastPub && (
          <span className={`text-xs text-gray-400 dark:text-gray-500 italic ${isMobile ? 'text-center w-full block bg-gray-50 dark:bg-gray-800/40 py-2 rounded-lg' : ''}`}>
            Not yet due
          </span>
        )}
        {cs && pastPub && !cs.description_needs_cleaning && !cs.in_preorder_collection && (
          <span className={`text-xs font-semibold text-green-600 dark:text-green-400 ${isMobile ? 'text-center w-full block bg-green-50/50 dark:bg-green-900/10 py-2 rounded-lg border border-green-100 dark:border-green-900/30' : ''}`}>
            ✓ Clean
          </span>
        )}
        {result?.overall && (
          <span className={`text-xs font-semibold ml-2 ${result.overall === 'success' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {result.overall === 'success' ? '✓ Done' : '⚠ Partial'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="px-4 sm:px-0 py-4 sm:py-0 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Release Management</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {products.length} preorder products
          {inspecting && <span className="ml-2 inline-block text-blue-500 dark:text-blue-400 text-xs font-medium animate-pulse">· Inspecting states…</span>}
        </p>
      </div>

      {/* ── Upcoming Releases ── */}
      {upcomingReleases.length > 0 && (
        <div className="rounded-xl sm:rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-4">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3">
            Upcoming — Next 7 Days ({upcomingReleases.length})
          </h3>
          <div className="space-y-2">
            {upcomingReleases.map((p) => {
              const cs = cleanupStates[p.product_id];
              const badge = classificationBadge(p.classification);
              return (
                <div key={p.product_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm bg-white dark:bg-gray-800 rounded-xl sm:rounded p-3 sm:py-2 border border-blue-100 dark:border-blue-800/50">
                  <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                    <span className="font-semibold sm:font-medium text-gray-900 dark:text-gray-100 line-clamp-2 sm:truncate">{p.title}</span>
                    <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] sm:text-xs font-semibold sm:font-medium whitespace-nowrap mt-0.5 sm:mt-0 ${badge.cls}`}>{badge.label}</span>
                    <span className="shrink-0 mt-0.5 sm:mt-0"><StockReceivedBadge product={p} /></span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-700/60">
                    <span className="text-xs font-mono sm:font-sans text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(p.pub_date)}</span>
                    <div className="flex items-center gap-2">
                      {cs ? (
                        <>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium ${descBadge(cs.description_status).cls}`}>{descBadge(cs.description_status).label}</span>
                          {renderCleanupCell(p.product_id, 'in_preorder_collection')}
                        </>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Loading…</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Historical Anomalies ── */}
      {(() => {
        const historicalNeedsAttention = products.filter((p) => {
          if (p.classification !== 'historical_preorder') return false;
          const cs = cleanupStates[p.product_id];
          if (!cs) return false;
          return cs.description_needs_cleaning || cs.in_preorder_collection;
        });
        if (historicalNeedsAttention.length === 0) return null;
        return (
          <div className="rounded-xl sm:rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">
              Historical — Needs Attention ({historicalNeedsAttention.length})
            </h3>
            <p className="text-xs text-amber-700 dark:text-amber-400 mb-3 leading-relaxed">
              These titles have released but retain preorder residue (description, collection, or catch-all).
            </p>
            <div className="space-y-2.5">
              {historicalNeedsAttention.map((p) => {
                const cs = cleanupStates[p.product_id];
                const isLoading = actionLoading[p.product_id];
                const result = actionResults[p.product_id];
                return (
                  <div key={p.product_id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm bg-white dark:bg-gray-800 rounded-xl p-3 sm:py-2 border border-amber-100 dark:border-amber-800/50 shadow-sm">
                    <div className="min-w-0 space-y-1">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 sm:truncate">{p.title}</div>
                      <div className="text-xs font-mono text-gray-400">{formatDate(p.pub_date)}</div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-700">
                      <div className="flex gap-1.5">
                        {cs.description_needs_cleaning && (
                          <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-md font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Body</span>
                        )}
                        {cs.in_preorder_collection && (
                          <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded-md font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Collection</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {result?.overall && (
                          <span className={`text-xs font-semibold ${result.overall === 'success' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                            {result.overall === 'success' ? '✓ Done' : '⚠ Partial'}
                          </span>
                        )}
                        <button
                          onClick={() => setConfirmModal({ open: true, productId: p.product_id, title: p.title, action: 'full' })}
                          disabled={isLoading}
                          className="px-3 py-1.5 sm:py-1 text-xs font-semibold sm:font-medium rounded-lg sm:rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 shadow-sm"
                        >
                          {isLoading ? 'Running…' : 'Full Cleanup'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Controls Layout ── */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-gray-50 dark:bg-gray-800/40 p-3 rounded-xl border border-gray-100 dark:border-gray-800/40">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <input type="text" placeholder="Search title, ISBN, or ID…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:min-w-[260px]" />
          
          <select value={filter} onChange={(e) => setFilter(e.target.value as FilterMode)}
            className="px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-lg sm:rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="active">Active / Early Stock</option>
            <option value="all">All Products</option>
            <option value="needs_cleanup">Needs Cleanup</option>
            <option value="historical">Historical Only</option>
          </select>
        </div>
        <span className="text-xs text-center sm:text-right text-gray-400 dark:text-gray-500 font-medium pt-1 sm:pt-0">
          Showing {filteredProducts.length} of {products.length}
        </span>
      </div>

      {/* ── MOBILE VIEW: Card Stack Layout ── */}
      <div className="block sm:hidden space-y-3">
        {filteredProducts.map((product) => {
          const badge = classificationBadge(product.classification);
          const pastPub = isPastPubDate(product.pub_date);
          return (
            <div key={product.product_id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 leading-snug line-clamp-2">{product.title}</h4>
                  <span className="text-xs font-mono text-gray-400 dark:text-gray-500 block mt-1">{product.isbn || product.product_id}</span>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide whitespace-nowrap uppercase ${badge.cls}`}>{badge.label}</span>
                  <StockReceivedBadge product={product} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-gray-50 dark:bg-gray-800/40 p-2.5 rounded-lg border border-gray-100 dark:border-gray-700/30">
                <div>
                  <span className="text-gray-400 block font-medium mb-0.5">Pub Date</span>
                  <span className={`font-medium ${pastPub ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {formatDate(product.pub_date)} {pastPub && '(past)'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 border-l border-gray-200 dark:border-gray-700/60 pl-3">
                  <div>
                    <span className="text-gray-400 block font-medium mb-0.5">Body</span>
                    {renderCleanupCell(product.product_id, 'description_status')}
                  </div>
                  <div>
                    <span className="text-gray-400 block font-medium mb-0.5">Collection</span>
                    {renderCleanupCell(product.product_id, 'in_preorder_collection')}
                  </div>
                </div>
              </div>

              <div className="pt-1">
                {renderActions(product, true)}
              </div>
            </div>
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
            No products match the current filter.
          </div>
        )}
      </div>

      {/* ── DESKTOP VIEW: Data Table Layout ── */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 text-left">
              {([['title', 'Title'], ['pub_date', 'Pub Date'], ['classification', 'Status']] as [SortKey, string][]).map(([key, label]) => (
                <th key={key} onClick={() => handleSort(key)}
                  className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-white whitespace-nowrap select-none">
                  {label} <span className="ml-0.5 opacity-80">{sortIcon(key)}</span>
                </th>
              ))}
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Body HTML</th>
              {/* Fixed: Both text-center layout settings are now explicitly coupled */}
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-center">Collection</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map((product) => {
              const badge = classificationBadge(product.classification);
              const pastPub = isPastPubDate(product.pub_date);
              return (
                <tr key={product.product_id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100 max-w-[280px] lg:max-w-[360px] truncate">{product.title}</div>
                    <div className="text-xs font-mono text-gray-400 dark:text-gray-500 mt-0.5">{product.isbn || product.product_id}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={pastPub ? 'text-gray-500 dark:text-gray-400 font-medium' : 'text-gray-900 dark:text-gray-100 font-medium'}>{formatDate(product.pub_date)}</span>
                    {pastPub && <span className="ml-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded">past</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                      <StockReceivedBadge product={product} />
                    </div>
                  </td>
                  <td className="px-4 py-3">{renderCleanupCell(product.product_id, 'description_status')}</td>
                  {/* Fixed: text-center handles content layout matching head column */}
                  <td className="px-4 py-3 text-center">{renderCleanupCell(product.product_id, 'in_preorder_collection')}</td>
                  <td className="px-4 py-3">{renderActions(product, false)}</td>
                </tr>
              );
            })}
            {filteredProducts.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500 text-sm bg-white dark:bg-gray-800">No products match the current filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Confirm Modal ── */}
      <ConfirmModal
        open={confirmModal.open}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        onConfirm={async () => {
          setConfirmModal((prev) => ({ ...prev, open: false }));
          await runCleanup(confirmModal.productId, confirmModal.action);
        }}
        title="Run Full Cleanup"
        variant="primary"
        confirmLabel="Run Cleanup"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">This will clean the Body HTML, remove from Preorder collection, and unpublish from Catch All for:</p>
        <p className="font-semibold text-gray-900 dark:text-white mt-2 bg-gray-50 dark:bg-gray-800/60 p-2.5 border border-gray-100 dark:border-gray-700 rounded-lg">{confirmModal.title}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 leading-relaxed">Each step handles its mutation independent of failure context — already-clean attributes will be safely skipped.</p>
      </ConfirmModal>
    </div>
  );
};

export default ReleaseManagement;
