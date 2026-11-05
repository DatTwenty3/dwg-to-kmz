'use client';
// Password page of the work tools: one shared password, remembered on this device unless unticked.
import { useState, type FormEvent } from 'react';
import { Logo } from './icons';

export default function UnlockForm({ next }: { next: string }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, remember }),
      });
      if (res.ok) {
        // A full load, not router.replace: the router keeps the redirect it got when it prefetched the tool before the
        // cookie existed and would bring us straight back here. (Files dropped on the home page before unlocking
        // are lost this way — once per device; afterwards the cookie lets them through.)
        window.location.replace(next);
        return;
      }
      setError(res.status === 429 ? 'Nhập sai nhiều lần. Thử lại sau ít phút.' : 'Mật khẩu không đúng.');
    } catch {
      setError('Không kết nối được. Thử lại.');
    }
    setBusy(false);
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <form onSubmit={submit} className="ui-floating w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-2.5">
          <Logo width={32} height={32} />
          <div>
            <h1 className="text-base font-semibold text-zinc-900">Nhập mật khẩu</h1>
            <p className="text-xs text-zinc-500">Để dùng công cụ Kiểm tra CSDL và Bóc tách DWG.</p>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className="ui-input w-full"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
        />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="ui-check" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Ghi nhớ máy này
        </label>
        <button type="submit" className="ui-btn ui-btn-primary w-full" disabled={busy || !password}>
          {busy ? 'Đang kiểm tra…' : 'Mở khóa'}
        </button>
      </form>
    </main>
  );
}
