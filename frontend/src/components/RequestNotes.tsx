// src/components/RequestNotes.tsx
//
// Per-request notes log, rendered inside the RightSidebar via RequestTable's
// renderRowContent callback. Self-contained: RightSidebar is shared with the
// Damaged Books module and is not modified by this feature.
//
// Notes are append-only. Editing and deleting are available on your own
// entries as a UI affordance only — the backend authenticates with a single
// shared admin token and cannot distinguish callers.

import { useCallback, useEffect, useState } from 'react';
import { useStaff } from '../auth/StaffProvider';
import { useAuth } from '../auth/AuthProvider';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN;

export interface RequestNote {
  id: string;
  request_id: string;
  cr_id: string | null;
  body: string;
  author_staff_id: string | null;
  author_name: string;
  source: string;
  created_at: string;
  edited_at: string | null;
}

interface RequestNotesProps {
  requestId: string;
  crId?: string | null;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);

  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString();
}

// Accounts read as full emails; the local part is enough in a narrow sidebar.
function shortName(name: string): string {
  const at = name.indexOf('@');
  return at > 0 ? name.slice(0, at) : name;
}

export default function RequestNotes({ requestId, crId }: RequestNotesProps) {
  const { activeStaff } = useStaff();
  const { user } = useAuth();

  const [notes, setNotes] = useState<RequestNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // On /requests only admin/editor accounts are permitted, and StaffGate does
  // not prompt those for a staff profile — so activeStaff is normally null here
  // and attribution falls back to the account email. The staff branch is kept
  // for the case where this route is later opened to shared-terminal accounts.
  const authorName = activeStaff?.name ?? user?.email ?? 'Unknown';
  const authorStaffId = activeStaff?.id ?? null;

  const isOwn = useCallback(
    (note: RequestNote) =>
      note.author_staff_id
        ? note.author_staff_id === authorStaffId
        : note.author_name === authorName,
    [authorStaffId, authorName]
  );

  const loadNotes = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/notes?request_id=${requestId}&token=${ADMIN_TOKEN}`
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const json = await res.json();
      setNotes(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      console.error('[RequestNotes] load failed:', err);
      setError("Notes couldn't be loaded. Try reopening this request.");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const addNote = async () => {
    const body = draft.trim();
    if (!body || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/notes/add?token=${ADMIN_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          cr_id: crId ?? null,
          body,
          author_name: authorName,
          author_staff_id: authorStaffId,
        }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const json = await res.json();
      if (json?.data) setNotes((prev) => [json.data, ...prev]);
      setDraft('');
    } catch (err) {
      console.error('[RequestNotes] add failed:', err);
      setError("That note wasn't saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    const body = editDraft.trim();
    if (!body || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/notes/update?token=${ADMIN_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, body }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const json = await res.json();
      if (json?.data) {
        setNotes((prev) => prev.map((n) => (n.id === id ? json.data : n)));
      }
      setEditingId(null);
      setEditDraft('');
    } catch (err) {
      console.error('[RequestNotes] update failed:', err);
      setError("That change wasn't saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (id: string) => {
    if (saving) return;
    if (!window.confirm('Delete this note? It will no longer appear on this request.')) return;

    setSaving(true);
    setError(null);

    const previous = notes;
    setNotes((prev) => prev.filter((n) => n.id !== id));

    try {
      const res = await fetch(`${API_BASE}/api/notes/remove?token=${ADMIN_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
    } catch (err) {
      console.error('[RequestNotes] remove failed:', err);
      setNotes(previous);
      setError("That note wasn't deleted. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h4 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-900 dark:text-white">
        Notes
        {notes.length > 0 && (
          <span className="text-xs font-normal text-gray-500">({notes.length})</span>
        )}
      </h4>

      {/* Composer */}
      <div className="mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              addNote();
            }
          }}
          rows={3}
          placeholder="Communication, sourcing, offers…"
          className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-500" title={authorName}>
            Posting as {shortName(authorName)}
          </span>
          <button
            type="button"
            onClick={addNote}
            disabled={!draft.trim() || saving}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Add note'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded border border-red-200 bg-red-50 text-red-700 text-xs dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Log */}
      {loading ? (
        <div className="text-xs text-gray-500 animate-pulse">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          No notes yet. Add the first one above.
        </div>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const own = isOwn(note);
            const editing = editingId === note.id;

            return (
              <li
                key={note.id}
                className="group rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span
                    className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate"
                    title={note.author_name}
                  >
                    {shortName(note.author_name)}
                  </span>
                  <span
                    className="text-xs text-gray-400 whitespace-nowrap shrink-0"
                    title={new Date(note.created_at).toLocaleString()}
                  >
                    {relativeTime(note.created_at)}
                    {note.edited_at && ' · edited'}
                  </span>
                </div>

                {editing ? (
                  <div>
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 dark:text-white p-2 focus:ring-2 focus:ring-blue-500 outline-none resize-y"
                    />
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        type="button"
                        onClick={() => saveEdit(note.id)}
                        disabled={!editDraft.trim() || saving}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditDraft('');
                        }}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">
                      {note.body}
                    </p>

                    {own && (
                      <div className="flex items-center gap-3 mt-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(note.id);
                            setEditDraft(note.body);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => removeNote(note.id)}
                          className="text-xs text-red-600 dark:text-red-400 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
