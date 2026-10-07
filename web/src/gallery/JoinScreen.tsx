import { useState } from 'react';

interface Props { error: string | null; onJoin: (name: string, password?: string) => void }

export function JoinScreen({ error, onJoin }: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const needsPassword = error === 'bad-password';
  return (
    <div className="join">
      <form
        className="join-card"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onJoin(name.trim(), password || undefined); }}
      >
        <h1>Canvas Gallery</h1>
        <p>Pick a name and step up to the wall.</p>
        <input autoFocus maxLength={20} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        {needsPassword && (
          <input type="password" placeholder="Room password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        {error === 'room-full' && <div className="join-error">The gallery is full right now. Try again soon.</div>}
        {error === 'bad-password' && <div className="join-error">That password didn't work.</div>}
        <button type="submit" disabled={!name.trim()}>Enter the gallery</button>
      </form>
    </div>
  );
}
