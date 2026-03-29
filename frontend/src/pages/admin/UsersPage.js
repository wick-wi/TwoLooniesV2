import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getAdminUsers, getAdminUser, hardDeleteUser } from '../../utils/adminApi';
import { Search, ChevronRight, ChevronLeft, ShieldCheck, RefreshCw } from 'lucide-react';

function UserDetailModal({ userId, token, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  useEffect(() => {
    getAdminUser(userId, token)
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [userId, token]);

  const handleDelete = async () => {
    if (confirmDelete !== 'DELETE') return;
    setDeleting(true);
    try {
      await hardDeleteUser(userId, token);
      onClose(true);
    } catch {
      alert('Hard delete failed. Check the console.');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-auto max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">User Details</h2>
          <button onClick={() => onClose(false)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">&times;</button>
        </div>
        {loading ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading...</div>
        ) : !data ? (
          <div className="p-8 text-center text-red-400 text-sm">Failed to load user.</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">User ID</p>
              <p className="text-sm font-mono text-zinc-300">{data.profile?.id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Display Name</p>
              <p className="text-sm text-zinc-200">{data.profile?.display_name || '—'}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-zinc-500">Statements</p>
                <p className="text-2xl font-semibold text-zinc-100">{data.statements?.length ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-500">Accounts</p>
                <p className="text-2xl font-semibold text-zinc-100">{data.accounts?.length ?? 0}</p>
              </div>
            </div>
            {data.statements?.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">Recent Statements</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {data.statements.slice(0, 5).map((s) => (
                    <div key={s.id} className="text-xs text-zinc-400 flex justify-between">
                      <span className="truncate mr-2">{s.filename}</span>
                      <span className="shrink-0 text-zinc-600">{s.start_date?.slice(0, 7)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Hard delete zone */}
            <div className="rounded-lg border border-red-800 bg-red-950/20 p-4 mt-4">
              <p className="text-sm font-medium text-red-400 mb-1">Hard Delete (GDPR)</p>
              <p className="text-xs text-zinc-500 mb-3">
                This permanently wipes all statements, transactions, storage files, and the auth
                account. This action cannot be undone.
              </p>
              <input
                value={confirmDelete}
                onChange={(e) => setConfirmDelete(e.target.value)}
                placeholder='Type "DELETE" to confirm'
                className="w-full rounded border border-red-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 mb-2 focus:outline-none focus:border-red-600"
              />
              <button
                onClick={handleDelete}
                disabled={confirmDelete !== 'DELETE' || deleting}
                className="w-full rounded bg-red-800 px-4 py-2 text-sm text-red-100 hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {deleting ? 'Deleting...' : 'Hard Delete User'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { getAccessToken } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminUsers({ page, page_size: PAGE_SIZE, search: search || undefined }, getAccessToken());
      setUsers(res.data.users || []);
    } catch {
      setError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [page, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const handleModalClose = (deleted) => {
    setSelectedUser(null);
    if (deleted) load();
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">User Management</h1>
          <p className="text-sm text-zinc-500 mt-0.5">View users and perform GDPR hard deletes</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by display name..."
            className="w-full rounded border border-zinc-700 bg-zinc-900 pl-8 pr-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          />
        </div>
        <button type="submit" className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          Search
        </button>
      </form>

      {error && (
        <div className="mb-4 rounded border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/60">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Name</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">ID</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Statements</th>
              <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">Transactions</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Joined</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">Admin</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-zinc-800 animate-pulse">
                  {[...Array(7)].map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-zinc-800 rounded" /></td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-zinc-500">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-zinc-800 bg-zinc-950 hover:bg-zinc-900 transition-colors">
                  <td className="px-4 py-3 text-zinc-200 font-medium">{u.display_name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500 truncate max-w-[120px]">{u.id}</td>
                  <td className="px-4 py-3 text-right text-zinc-400 tabular-nums">{u.statement_count ?? 0}</td>
                  <td className="px-4 py-3 text-right text-zinc-400 tabular-nums">{u.transaction_count ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {u.is_admin && <ShieldCheck size={14} className="text-emerald-400 mx-auto" />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedUser(u.id)}
                      className="text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>Page {page}</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded border border-zinc-800 px-2 py-1 hover:border-zinc-700 disabled:opacity-30"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={users.length < PAGE_SIZE}
            className="rounded border border-zinc-800 px-2 py-1 hover:border-zinc-700 disabled:opacity-30"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {selectedUser && (
        <UserDetailModal userId={selectedUser} token={getAccessToken()} onClose={handleModalClose} />
      )}
    </div>
  );
}
