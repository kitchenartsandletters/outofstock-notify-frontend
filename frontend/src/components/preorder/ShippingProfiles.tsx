import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import ConfirmModal from '../ConfirmModal';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface ProfileProduct {
  product_gid: string;
  product_id: number;
  title: string;
  variants: { variant_gid: string; variant_title: string }[];
}

interface ShippingProfile {
  profile_gid: string;
  profile_id: number;
  name: string;
  is_default: boolean;
  pub_date: string | null;
  product_count: number;
  products: ProfileProduct[];
}

interface RepurposeReadyProfile {
  profile_gid: string;
  name: string;
}

interface ReconcileReport {
  model?: string;
  summary: Record<string, number>;
  report: {
    correctly_assigned: { product_id: number; title: string; pub_date: string; profile: string }[];
    wrong_profile: { product_id: number; title: string; pub_date: string; expected_profile: string; current_profile: string }[];
    missing_from_profile: { product_id: number; title: string; pub_date: string; expected_profile: string }[];
    arrived_should_detach?: { product_id: number; title: string; pub_date: string; current_profile: string; arrived_at: string | null }[];
    should_be_removed: { product_id: number; title: string; pub_date: string; current_profile: string }[];
    exempt: { product_id: number; title: string; pub_date: string; status: string; inventory: number; current_profile: string; reason: string }[];
    no_pub_date: { product_id: number; title: string; status: string }[];
  };
  migration?: {
    titles_on_week_profile: number;
    titles_needing_migration: number;
    arrived_to_detach?: number;
    repurpose_ready_profiles: RepurposeReadyProfile[];
  };
}

type TitleAction = 'already' | 'add' | 'move';

interface WeekPlanTitle {
  product_id: number;
  title: string;
  pub_date: string;
  current_profile: string;
  action: TitleAction;
}

interface WeekPlanWeek {
  week_start: string;
  week_end: string;
  profile_name: string;
  profile_status: 'exists' | 'create';
  profile_gid: string | null;
  titles: WeekPlanTitle[];
}

interface WeekPlan {
  weeks: WeekPlanWeek[];
  emptied_profiles: { profile_gid: string; name: string; products_now: number }[];
  summary: Record<string, number>;
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const PREORDER_SERVICE_URL = import.meta.env.VITE_PREORDER_BASE_URL;
const ADMIN_TOKEN = import.meta.env.VITE_PREORDER_ADMIN_TOKEN;
const BASE = `${PREORDER_SERVICE_URL}/admin/preorders/shipping/profiles`;

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

function isUpcoming(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const future = new Date(today); future.setDate(future.getDate() + days);
  return d >= today && d <= future;
}

function isPast(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

const isWeekProfile = (name: string) => name.startsWith('Week of');

// Derive a sortable YYYY-MM-DD-ish key from a "Week of Mon D–D2, YYYY" name.
function weekSortKey(name: string): string {
  const m = name.match(/Week of (\w+) (\d+)[–\-].*?(\d{4})/);
  if (!m) return name;
  const [, mon, day, year] = m;
  const monthNum = new Date(`${mon} 1, 2000`).getMonth();
  if (Number.isNaN(monthNum)) return name;
  return `${year}-${String(monthNum + 1).padStart(2, '0')}-${String(parseInt(day, 10)).padStart(2, '0')}`;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

const ShippingProfiles = () => {
  const [profiles, setProfiles] = useState<ShippingProfile[]>([]);
  const [reconcile, setReconcile] = useState<ReconcileReport | null>(null);
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<Record<number | string, boolean>>({});
  const [actionResults, setActionResults] = useState<Record<number | string, string>>({});
  const [expandedProfile, setExpandedProfile] = useState<number | null>(null);

  // Confirm modal (per-title assign / remove / detach)
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    productId: number;
    pubDate: string;
    title: string;
    action: 'assign' | 'remove' | 'detach';
    profileName?: string;
  }>({ open: false, productId: 0, pubDate: '', title: '', action: 'assign' });

  // Apply-week modal
  const [applyModal, setApplyModal] = useState<{
    open: boolean;
    week: WeekPlanWeek | null;
  }>({ open: false, week: null });

  // Rename modal
  const [renameModal, setRenameModal] = useState<{
    open: boolean;
    profileId: number;
    currentName: string;
    newName: string;
  }>({ open: false, profileId: 0, currentName: '', newName: '' });

  // ── Fetchers ──
  const fetchProfiles = useCallback(async () => {
    const res = await fetch(`${BASE}`, { headers: apiHeaders() });
    if (!res.ok) throw new Error(`Profiles: ${res.status}`);
    const data = await res.json();
    setProfiles(data.profiles || []);
  }, []);

  const runReconcile = useCallback(async () => {
    setReconciling(true);
    try {
      const res = await fetch(`${BASE}/reconcile`, { method: 'POST', headers: apiHeaders() });
      if (!res.ok) throw new Error(`Reconcile: ${res.status}`);
      setReconcile(await res.json());
    } catch (e) {
      console.error('Reconcile failed:', e);
    } finally {
      setReconciling(false);
    }
  }, []);

  const fetchWeekPlan = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/week-plan`, { headers: apiHeaders() });
      if (!res.ok) throw new Error(`Week plan: ${res.status}`);
      setWeekPlan(await res.json());
    } catch (e) {
      console.error('Week plan failed:', e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchProfiles(), runReconcile(), fetchWeekPlan()]);
  }, [fetchProfiles, runReconcile, fetchWeekPlan]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      await refreshAll();
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  useEffect(() => { load(); }, [load]);

  // ── Per-title week assign (Fix / Assign) ──
  const weekAssign = async (productId: number, pubDate: string) => {
    setActionLoading((p) => ({ ...p, [productId]: true }));
    try {
      const res = await fetch(`${BASE}/week-assign/${productId}`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ pub_date: pubDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setActionResults((p) => ({ ...p, [productId]: `→ ${data.profile_name}` }));
      await refreshAll();
    } catch (e: any) {
      setActionResults((p) => ({ ...p, [productId]: `Error: ${e.message}` }));
    } finally {
      setActionLoading((p) => ({ ...p, [productId]: false }));
    }
  };

  // ── Remove / Detach (→ General) ──
  const removeProduct = async (productId: number, resultLabel = '→ General') => {
    setActionLoading((p) => ({ ...p, [productId]: true }));
    try {
      const res = await fetch(`${BASE}/remove/${productId}`, { method: 'POST', headers: apiHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setActionResults((p) => ({ ...p, [productId]: resultLabel }));
      await refreshAll();
    } catch (e: any) {
      setActionResults((p) => ({ ...p, [productId]: `Error: ${e.message}` }));
    } finally {
      setActionLoading((p) => ({ ...p, [productId]: false }));
    }
  };

  // ── Apply a whole week ──
  const applyWeek = async (weekStart: string) => {
    const key = `apply-${weekStart}`;
    setActionLoading((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`${BASE}/week-apply`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ week_start: weekStart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      const n = Array.isArray(data.assigned) ? data.assigned.length : 0;
      setActionResults((p) => ({ ...p, [key]: `${data.created ? 'Created · ' : ''}${n} assigned` }));
      await refreshAll();
    } catch (e: any) {
      setActionResults((p) => ({ ...p, [key]: `Error: ${e.message}` }));
    } finally {
      setActionLoading((p) => ({ ...p, [key]: false }));
    }
  };

  // ── Rename ──
  const renameProfile = async (profileId: number, newName: string) => {
    const key = `rename-${profileId}`;
    setActionLoading((p) => ({ ...p, [key]: true }));
    try {
      const res = await fetch(`${BASE}/${profileId}/rename`, {
        method: 'POST', headers: apiHeaders(), body: JSON.stringify({ new_name: newName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setActionResults((p) => ({ ...p, [key]: `Renamed to ${newName}` }));
      await refreshAll();
    } catch (e: any) {
      setActionResults((p) => ({ ...p, [key]: `Error: ${e.message}` }));
    } finally {
      setActionLoading((p) => ({ ...p, [key]: false }));
    }
  };

  // ── Categorize profiles (week-native) ──
  const weekProfiles = useMemo(() =>
    profiles
      .filter((p) => !p.is_default && isWeekProfile(p.name) && p.product_count > 0)
      .sort((a, b) => weekSortKey(a.name).localeCompare(weekSortKey(b.name))),
    [profiles]);

  const legacyDateProfiles = useMemo(() =>
    profiles
      .filter((p) => !p.is_default && !isWeekProfile(p.name) && p.pub_date !== null && p.product_count > 0)
      .sort((a, b) => (a.pub_date || '').localeCompare(b.pub_date || '')),
    [profiles]);

  const nonStandardProfiles = useMemo(() =>
    profiles.filter((p) => !p.is_default && !isWeekProfile(p.name) && p.pub_date === null && p.product_count > 0),
    [profiles]);

  const emptyProfiles = useMemo(() =>
    profiles.filter((p) => !p.is_default && p.product_count === 0).sort((a, b) => a.name.localeCompare(b.name)),
    [profiles]);

  // Weeks with anything to do (a title that isn't already on its week profile)
  const actionableWeeks = useMemo(() =>
    (weekPlan?.weeks || []).filter((w) => w.titles.some((t) => t.action !== 'already')),
    [weekPlan]);

  // ── Loading / error ──
  if (loading) {
    return (
      <div className="space-y-4 px-4 md:px-0 animate-pulse mt-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
        </div>
        {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 dark:text-red-400 p-6 text-center md:text-left">
        <p className="font-semibold">Error loading shipping profiles</p>
        <p className="text-sm mt-1">{error}</p>
        <button onClick={load} className="mt-4 w-full md:w-auto px-6 py-2.5 bg-gray-600 text-white rounded-xl md:rounded hover:bg-gray-700 text-sm font-medium">
          Retry
        </button>
      </div>
    );
  }

  const migration = reconcile?.migration;
  const repurposeReady = migration?.repurpose_ready_profiles || [];
  const arrivedToDetach = reconcile?.report.arrived_should_detach || [];

  // ── Small presentational helper for a title row with one action ──
  const TitleRow = ({ item, variant, actionLabel, onAction, meta }: {
    item: { product_id: number; title: string; pub_date?: string };
    variant: 'amber' | 'red' | 'blue' | 'teal';
    actionLabel: string;
    onAction: () => void;
    meta?: ReactNode;
  }) => {
    const border = variant === 'amber' ? 'border-amber-100 dark:border-amber-800/50'
      : variant === 'red' ? 'border-red-100 dark:border-red-800/50'
      : variant === 'teal' ? 'border-teal-100 dark:border-teal-800/50'
      : 'border-blue-100 dark:border-blue-800/50';
    const btn = variant === 'amber' ? 'bg-amber-600 hover:bg-amber-700'
      : variant === 'red' ? 'bg-red-600 hover:bg-red-700'
      : variant === 'teal' ? 'bg-teal-600 hover:bg-teal-700'
      : 'bg-blue-600 hover:bg-blue-700';
    return (
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm bg-white dark:bg-gray-800 rounded-xl sm:rounded-lg px-4 py-3 sm:py-2 border ${border} shadow-sm`}>
        <div className="min-w-0 flex-1">
          <div className="font-semibold sm:font-medium text-gray-900 dark:text-gray-100 truncate" title={item.title}>{item.title}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs mt-1 sm:mt-0.5">
            {item.pub_date && <span className="text-gray-400 font-mono sm:font-sans">{formatDate(item.pub_date)}</span>}
            {meta}
          </div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100 dark:border-gray-700/60">
          {actionResults[item.product_id] && <span className="text-xs font-medium text-green-600 dark:text-green-400">{actionResults[item.product_id]}</span>}
          <button onClick={onAction} disabled={!!actionLoading[item.product_id]}
            className={`w-full sm:w-auto px-4 sm:px-3 py-2 sm:py-1 text-xs font-semibold sm:font-medium rounded-lg sm:rounded text-white disabled:opacity-50 active:scale-[0.99] transition-transform ${btn}`}>
            {actionLoading[item.product_id] ? 'Working…' : actionLabel}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 md:px-0 space-y-6">
      {/* Header + migration progress */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Shipping Profiles</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {migration ? (
              <>
                <span className="font-semibold text-green-600 dark:text-green-400">{migration.titles_on_week_profile}</span> on week profiles
                {' · '}
                <span className="font-semibold text-amber-600 dark:text-amber-400">{migration.titles_needing_migration}</span> to migrate
                {migration.arrived_to_detach ? (
                  <>
                    {' · '}
                    <span className="font-semibold text-teal-600 dark:text-teal-400">{migration.arrived_to_detach}</span> to detach
                  </>
                ) : null}
                {' · '}
                {weekProfiles.length} week profiles · {legacyDateProfiles.length} legacy
              </>
            ) : (
              <>{weekProfiles.length} week profiles · {legacyDateProfiles.length} legacy · {emptyProfiles.length} reusable</>
            )}
          </p>
        </div>
        <button onClick={runReconcile} disabled={reconciling}
          className="px-4 sm:px-3 py-2 sm:py-1.5 text-xs font-semibold sm:font-medium rounded-lg sm:rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-transform active:scale-[0.98] self-start sm:self-auto">
          {reconciling ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Summary cards ── */}
      {reconcile && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {([
            { key: 'correctly_assigned', label: 'On Week Profile', card: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', num: 'text-green-700 dark:text-green-300', lbl: 'text-green-600 dark:text-green-400' },
            { key: 'wrong_profile', label: 'To Migrate', card: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', num: 'text-amber-700 dark:text-amber-300', lbl: 'text-amber-600 dark:text-amber-400' },
            { key: 'missing_from_profile', label: 'Missing', card: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', num: 'text-red-700 dark:text-red-300', lbl: 'text-red-600 dark:text-red-400' },
            { key: 'should_be_removed', label: 'Should Remove', card: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', num: 'text-blue-700 dark:text-blue-300', lbl: 'text-blue-600 dark:text-blue-400' },
            { key: 'exempt', label: 'Exempt', card: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800', num: 'text-purple-700 dark:text-purple-300', lbl: 'text-purple-600 dark:text-purple-400' },
            { key: 'no_pub_date', label: 'No Date', card: 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-700', num: 'text-gray-700 dark:text-gray-300', lbl: 'text-gray-600 dark:text-gray-400' },
          ]).map(({ key, label, card, num, lbl }) => (
            <div key={key} className={`rounded-xl border ${card} p-3 shadow-sm`}>
              <div className={`text-2xl font-bold ${num}`}>{reconcile.summary[key] || 0}</div>
              <div className={`text-xs font-medium ${lbl} mt-0.5`}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Stock Received — detach (arrived active preorders) ── */}
      {arrivedToDetach.length > 0 && (
        <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/10 p-4">
          <h3 className="text-sm font-semibold text-teal-900 dark:text-teal-200 mb-1">
            Stock Received — Detach ({arrivedToDetach.length})
          </h3>
          <p className="text-xs text-teal-700/80 dark:text-teal-400/80 mb-3 leading-relaxed">
            These preorders have physically arrived and are fulfillable now. Detach each from its shipping profile — it falls back to General.
          </p>
          <div className="space-y-2.5">
            {arrivedToDetach.map((item) => (
              <TitleRow key={item.product_id} item={item} variant="teal" actionLabel="Detach"
                onAction={() => setConfirmModal({ open: true, productId: item.product_id, pubDate: item.pub_date, title: item.title, action: 'detach', profileName: item.current_profile })}
                meta={
                  <>
                    <span className="text-gray-400">on {item.current_profile}</span>
                    {item.arrived_at && (
                      <span className="text-teal-600 dark:text-teal-400">· arrived {formatDate(item.arrived_at.slice(0, 10))}</span>
                    )}
                  </>
                } />
            ))}
          </div>
        </div>
      )}

      {/* ── To Migrate (wrong_profile) — per-title fix ── */}
      {reconcile && reconcile.report.wrong_profile.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-4">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-3">
            To Migrate ({reconcile.report.wrong_profile.length})
          </h3>
          <div className="space-y-2.5">
            {reconcile.report.wrong_profile.map((item) => (
              <TitleRow key={item.product_id} item={item} variant="amber" actionLabel="Fix"
                onAction={() => setConfirmModal({ open: true, productId: item.product_id, pubDate: item.pub_date, title: item.title, action: 'assign', profileName: item.expected_profile })}
                meta={
                  <>
                    <span className="font-medium bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300">{item.current_profile}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-medium bg-green-50 dark:bg-green-950/40 px-1.5 py-0.5 rounded text-green-700 dark:text-green-300">{item.expected_profile}</span>
                  </>
                } />
            ))}
          </div>
        </div>
      )}

      {/* ── Missing from Profile ── */}
      {reconcile && reconcile.report.missing_from_profile.length > 0 && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-4">
          <h3 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-3">
            Missing from Profile ({reconcile.report.missing_from_profile.length})
          </h3>
          <div className="space-y-2.5">
            {reconcile.report.missing_from_profile.map((item) => (
              <TitleRow key={item.product_id} item={item} variant="red" actionLabel="Assign"
                onAction={() => setConfirmModal({ open: true, productId: item.product_id, pubDate: item.pub_date, title: item.title, action: 'assign', profileName: item.expected_profile })}
                meta={<span className="font-medium bg-green-50 dark:bg-green-950/40 px-1.5 py-0.5 rounded text-green-700 dark:text-green-300">{item.expected_profile}</span>} />
            ))}
          </div>
        </div>
      )}

      {/* ── Should Be Removed ── */}
      {reconcile && reconcile.report.should_be_removed.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10 p-4">
          <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200 mb-3">
            Should Be Removed ({reconcile.report.should_be_removed.length})
          </h3>
          <div className="space-y-2.5">
            {reconcile.report.should_be_removed.map((item) => (
              <TitleRow key={item.product_id} item={item} variant="blue" actionLabel="Remove"
                onAction={() => setConfirmModal({ open: true, productId: item.product_id, pubDate: item.pub_date, title: item.title, action: 'remove', profileName: item.current_profile })}
                meta={<span className="text-gray-400">on {item.current_profile}</span>} />
            ))}
          </div>
        </div>
      )}

      {/* ── Exempt ── */}
      {reconcile && reconcile.report.exempt.length > 0 && (
        <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/10 p-4">
          <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-3">
            Exempt — Early Stock ({reconcile.report.exempt.length})
          </h3>
          <div className="space-y-2.5">
            {reconcile.report.exempt.map((item) => (
              <div key={item.product_id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm bg-white dark:bg-gray-800 rounded-xl sm:rounded-lg px-4 py-3 sm:py-2 border border-purple-100 dark:border-purple-800/50 shadow-sm">
                <div className="min-w-0 flex-1">
                  <span className="text-gray-900 dark:text-gray-100 font-semibold sm:font-medium block sm:inline truncate" title={item.title}>{item.title}</span>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-purple-600 dark:text-purple-400 mt-1 sm:mt-0.5 sm:ml-2 sm:inline-flex">
                    <span className="font-mono text-gray-400 sm:text-purple-600 dark:text-purple-400">{formatDate(item.pub_date)}</span>
                    <span>•</span>
                    <span>{item.inventory} in stock</span>
                    <span>•</span>
                    <span className="truncate max-w-[140px]">{item.current_profile}</span>
                  </div>
                </div>
                <span className="text-xs font-semibold sm:font-normal text-purple-500 dark:text-purple-400 italic shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-50 dark:border-gray-700/60 text-right">
                  Fulfillable
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Week Profiles (primary) ── */}
      <div className="flex items-center justify-between pt-2">
        <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Week Profiles ({weekProfiles.length})</h3>
      </div>
      <ProfileTable
        profiles={weekProfiles}
        expandedProfile={expandedProfile}
        setExpandedProfile={setExpandedProfile}
        actionLoading={actionLoading}
        actionResults={actionResults}
        onRemove={(prod, profile) => setConfirmModal({ open: true, productId: prod.product_id, pubDate: prod_pubDate(profile), title: prod.title, action: 'remove', profileName: profile.name })}
        emptyLabel="No week profiles yet — apply a week above to create the first."
      />

      {/* ── Legacy date profiles (migrating away) ── */}
      {legacyDateProfiles.length > 0 && (
        <div className="space-y-2.5">
          <div>
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Legacy Date Profiles ({legacyDateProfiles.length})</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">
              Per-date profiles from the old model. Their titles migrate to week profiles above; once empty they become reusable.
            </p>
          </div>
          <ProfileTable
            profiles={legacyDateProfiles}
            expandedProfile={expandedProfile}
            setExpandedProfile={setExpandedProfile}
            actionLoading={actionLoading}
            actionResults={actionResults}
            onRemove={(prod, profile) => setConfirmModal({ open: true, productId: prod.product_id, pubDate: prod_pubDate(profile), title: prod.title, action: 'remove', profileName: profile.name })}
            emptyLabel="No legacy date profiles."
          />
        </div>
      )}

      {/* ── Non-standard ── */}
      {nonStandardProfiles.length > 0 && (
        <div className="space-y-2.5">
          <div>
            <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Non-Standard Profiles ({nonStandardProfiles.length})</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">
              Custom-named profiles — typically oversized items or special packaging. Tracked but skipped during reconciliation.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm bg-white dark:bg-gray-800">
            {nonStandardProfiles.map((profile) => {
              const isExpanded = expandedProfile === profile.profile_id;
              return (
                <div key={profile.profile_id} className="border-t first:border-t-0 border-gray-150 dark:border-gray-700">
                  <div onClick={() => setExpandedProfile(isExpanded ? null : profile.profile_id)}
                    className="px-4 py-3 flex items-center justify-between active:bg-gray-50 dark:active:bg-gray-700/20 md:hover:bg-gray-50/60 md:dark:hover:bg-gray-700/20 cursor-pointer select-none">
                    <div className="min-w-0 flex items-center">
                      <span className="text-xs font-mono text-gray-400 mr-2 w-3">{isExpanded ? '▼' : '▶'}</span>
                      <span className="font-semibold md:font-medium text-gray-700 dark:text-gray-300 truncate">{profile.name}</span>
                    </div>
                    <span className="px-2 py-0.5 shrink-0 rounded-md text-xs font-bold sm:font-medium bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                      {profile.product_count} products
                    </span>
                  </div>
                  {isExpanded && (
                    <div className="bg-gray-50/50 dark:bg-gray-900/20 border-t border-gray-100 dark:border-gray-700/60 px-9 py-3 space-y-2">
                      {profile.products.map((prod) => (
                        <div key={prod.product_id} className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-2xl font-medium line-clamp-1" title={prod.title}>{prod.title}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Repurpose-ready / empty profiles ── */}
      {emptyProfiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">
            Repurpose-Ready ({emptyProfiles.length})
          </h3>
          {repurposeReady.length > 0 && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              {repurposeReady.length} recently emptied by migration. Click a tag to rename and reuse it for a new week.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {emptyProfiles.map((p) => (
              <button key={p.profile_id}
                onClick={() => setRenameModal({ open: true, profileId: p.profile_id, currentName: p.name, newName: '' })}
                className="px-3 py-2 sm:py-1 rounded-lg sm:rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 active:scale-[0.97] sm:active:scale-[0.99] transition-transform text-xs font-medium shadow-xs"
                title="Click to rename profile">
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Confirm Modal (assign / remove / detach) ── */}
      <ConfirmModal
        open={confirmModal.open}
        onCancel={() => setConfirmModal((p) => ({ ...p, open: false }))}
        onConfirm={async () => {
          const action = confirmModal.action;
          setConfirmModal((p) => ({ ...p, open: false }));
          if (action === 'assign') await weekAssign(confirmModal.productId, confirmModal.pubDate);
          else if (action === 'detach') await removeProduct(confirmModal.productId, '→ General (detached)');
          else await removeProduct(confirmModal.productId);
        }}
        title={confirmModal.action === 'assign' ? 'Assign to Week Profile' : confirmModal.action === 'detach' ? 'Detach — Stock Received' : 'Remove from Profile'}
        variant={confirmModal.action === 'remove' ? 'danger' : 'primary'}
        confirmLabel={confirmModal.action === 'assign' ? 'Assign' : confirmModal.action === 'detach' ? 'Detach' : 'Remove'}
      >
        {confirmModal.action === 'assign' ? (
          <div className="space-y-2">
            <p>Assign this title to its release-week profile:</p>
            <p className="font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 p-2.5 rounded-lg border border-gray-150 dark:border-gray-700 line-clamp-2">{confirmModal.title}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">Target: <span className="font-semibold text-gray-700 dark:text-gray-300">{confirmModal.profileName}</span>. Created on the verified builder if it doesn't exist yet.</p>
          </div>
        ) : confirmModal.action === 'detach' ? (
          <div className="space-y-2">
            <p>This title has arrived and is fulfillable now. Detach it from its shipping profile (falls back to General):</p>
            <p className="font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 p-2.5 rounded-lg border border-gray-150 dark:border-gray-700 line-clamp-2">{confirmModal.title}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">Currently on <span className="font-semibold text-gray-700 dark:text-gray-300">{confirmModal.profileName}</span>.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p>Remove this title from its profile (falls back to General):</p>
            <p className="font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 p-2.5 rounded-lg border border-gray-150 dark:border-gray-700 line-clamp-2">{confirmModal.title}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">Removing from <span className="font-semibold text-gray-700 dark:text-gray-300">{confirmModal.profileName}</span>.</p>
          </div>
        )}
      </ConfirmModal>

      {/* ── Apply Week Modal ── */}
      <ConfirmModal
        open={applyModal.open}
        onCancel={() => setApplyModal({ open: false, week: null })}
        onConfirm={async () => {
          const w = applyModal.week;
          setApplyModal({ open: false, week: null });
          if (w) await applyWeek(w.week_start);
        }}
        title="Apply Release Week"
        variant="primary"
        confirmLabel="Apply week"
      >
        {applyModal.week && (
          <div className="space-y-2">
            <p>Consolidate this week onto a single profile:</p>
            <p className="font-semibold text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-800 p-2.5 rounded-lg border border-gray-150 dark:border-gray-700">{applyModal.week.profile_name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">
              {applyModal.week.profile_status === 'create' ? 'Creates the week profile on the verified builder, then assigns ' : 'Assigns '}
              {applyModal.week.titles.filter((t) => t.action !== 'already').length} title(s). Rate-check afterward before applying more weeks.
            </p>
          </div>
        )}
      </ConfirmModal>

      {/* ── Rename Modal ── */}
      {renameModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-5 max-w-md w-full border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">Rename Profile</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Renaming: <span className="font-semibold text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 px-1.5 py-0.5 rounded border border-gray-100 dark:border-gray-800">{renameModal.currentName}</span>
            </p>
            <input type="text" value={renameModal.newName}
              onChange={(e) => setRenameModal((p) => ({ ...p, newName: e.target.value }))}
              placeholder="e.g. Week of Oct 18–24, 2026"
              className="w-full px-3 py-2.5 sm:py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus />
            <div className="flex items-center justify-end gap-2.5">
              <button onClick={() => setRenameModal((p) => ({ ...p, open: false }))}
                className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-lg">
                Cancel
              </button>
              <button onClick={async () => {
                  if (!renameModal.newName.trim()) return;
                  setRenameModal((p) => ({ ...p, open: false }));
                  await renameProfile(renameModal.profileId, renameModal.newName.trim());
                }}
                disabled={!renameModal.newName.trim()}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shadow-sm transition-transform active:scale-[0.98]">
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper: a profile's pub_date (may be null for week profiles)
function prod_pubDate(profile: ShippingProfile): string {
  return profile.pub_date ?? '';
}

// ──────────────────────────────────────────────
// Profile table (shared by week + legacy sections)
// ──────────────────────────────────────────────

const ProfileTable = ({ profiles, expandedProfile, setExpandedProfile, actionLoading, actionResults, onRemove, emptyLabel }: {
  profiles: ShippingProfile[];
  expandedProfile: number | null;
  setExpandedProfile: (id: number | null) => void;
  actionLoading: Record<number | string, boolean>;
  actionResults: Record<number | string, string>;
  onRemove: (prod: ProfileProduct, profile: ShippingProfile) => void;
  emptyLabel: string;
}) => {
  return (
    <>
      {/* Mobile */}
      <div className="block md:hidden space-y-3">
        {profiles.map((profile) => {
          const isExpanded = expandedProfile === profile.profile_id;
          const past = isPast(profile.pub_date);
          const upcoming = isUpcoming(profile.pub_date, 7);
          return (
            <div key={profile.profile_id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
              <div onClick={() => setExpandedProfile(isExpanded ? null : profile.profile_id)}
                className="p-4 flex items-start justify-between gap-3 active:bg-gray-50 dark:active:bg-gray-700/40 transition-colors">
                <div className="min-w-0 space-y-1">
                  <div className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                    <span className="text-gray-400 shrink-0">{isExpanded ? '▼' : '▶'}</span>
                    <span className="truncate">{profile.name}</span>
                  </div>
                  {profile.pub_date && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-mono ${past ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{formatDate(profile.pub_date)}</span>
                      {upcoming && <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-semibold text-[10px]">SOON</span>}
                      {past && <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 font-semibold text-[10px]">PAST</span>}
                    </div>
                  )}
                </div>
                <span className="inline-block px-2 py-1 rounded-md text-xs font-bold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 shrink-0">
                  {profile.product_count} items
                </span>
              </div>
              {isExpanded && (
                <div className="bg-gray-50/70 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700/60 p-3 space-y-2.5">
                  {profile.products.map((prod) => (
                    <div key={prod.product_id} className="flex flex-col gap-2 bg-white dark:bg-gray-800 p-2.5 rounded-lg border border-gray-150 dark:border-gray-700/50">
                      <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 line-clamp-2" title={prod.title}>{prod.title}</div>
                      <div className="flex items-center justify-between gap-2 text-[11px] font-mono pt-1.5 border-t border-gray-50 dark:border-gray-700/40">
                        <span className="text-gray-400">{prod.product_id}</span>
                        <div className="flex items-center gap-2">
                          {actionResults[prod.product_id] && <span className="text-green-600 dark:text-green-400 font-sans font-medium">{actionResults[prod.product_id]}</span>}
                          <button onClick={(e) => { e.stopPropagation(); onRemove(prod, profile); }}
                            disabled={!!actionLoading[prod.product_id]}
                            className="px-2.5 py-1 rounded-md font-sans font-semibold border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 active:bg-red-50 dark:active:bg-red-950/40 disabled:opacity-40">
                            {actionLoading[prod.product_id] ? '…' : 'Remove'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {profiles.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-sm bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">{emptyLabel}</div>
        )}
      </div>

      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 text-left">
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Profile</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Window</th>
              <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-center">Products</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => {
              const isExpanded = expandedProfile === profile.profile_id;
              const past = isPast(profile.pub_date);
              return (
                <tr key={profile.profile_id} className="border-t border-gray-200 dark:border-gray-700">
                  <td colSpan={3} className="p-0">
                    <div onClick={() => setExpandedProfile(isExpanded ? null : profile.profile_id)}
                      className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/80 dark:hover:bg-gray-800/40 cursor-pointer transition-colors">
                      <div className="flex items-center min-w-[280px]">
                        <span className="text-xs font-mono text-gray-400 mr-2 w-3">{isExpanded ? '▼' : '▶'}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{profile.name}</span>
                      </div>
                      <div className="flex-1 grid grid-cols-2 items-center text-left">
                        <div className="whitespace-nowrap pl-4">
                          <span className={past ? 'text-gray-400 font-medium' : 'text-gray-900 dark:text-gray-100 font-medium'}>
                            {profile.pub_date ? formatDate(profile.pub_date) : '—'}
                          </span>
                        </div>
                        <div className="text-center">
                          <span className="px-2.5 py-0.5 rounded text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{profile.product_count}</span>
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="bg-gray-50/40 dark:bg-gray-800/20 border-t border-gray-100 dark:border-gray-800/40 px-10 py-3 space-y-2">
                        {profile.products.map((prod) => (
                          <div key={prod.product_id} className="flex items-center justify-between text-xs max-w-4xl py-0.5">
                            <span className="text-gray-900 dark:text-gray-100 truncate pr-6 font-medium max-w-[500px]" title={prod.title}>{prod.title}</span>
                            <div className="flex items-center gap-4 shrink-0 font-mono">
                              <span className="text-gray-400 text-[11px]">{prod.product_id}</span>
                              {actionResults[prod.product_id] && <span className="text-green-600 dark:text-green-400 font-sans font-medium">{actionResults[prod.product_id]}</span>}
                              <button onClick={(e) => { e.stopPropagation(); onRemove(prod, profile); }}
                                disabled={!!actionLoading[prod.product_id]}
                                className="px-2 py-0.5 font-sans rounded text-[11px] font-medium border border-red-200 dark:border-red-800/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-40">
                                {actionLoading[prod.product_id] ? '…' : 'Remove'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {profiles.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400 text-sm bg-white dark:bg-gray-800">{emptyLabel}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default ShippingProfiles;
