'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError('Wrong password');
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: '120px auto', padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Salon admin</h1>
      <form onSubmit={onSubmit}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 15,
            border: '1px solid #D4D7D0',
            borderRadius: 8,
            marginBottom: 12,
            boxSizing: 'border-box',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 15,
            background: '#16181D',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>
        {error && <p style={{ color: '#B3261E', fontSize: 14, marginTop: 10 }}>{error}</p>}
      </form>
    </main>
  );
}
