import { useState } from 'react';
import { clearName, getClientId, getSavedName, saveName } from './session';
import { useRoom } from './net/useRoom';
import { Gallery } from './gallery/Gallery';
import { JoinScreen } from './gallery/JoinScreen';
import './gallery/gallery.css';

const ROOM_URL = import.meta.env.VITE_ROOM_URL ?? 'ws://localhost:8787/ws';
const clientId = getClientId();

export function App() {
  const [name, setName] = useState<string | null>(getSavedName());
  const [password, setPassword] = useState<string | undefined>();
  const { state, send, subscribe, getRoundOps, opLog } = useRoom({ url: ROOM_URL, clientId, name, password });

  const joined = name !== null && state.you !== null && state.error === null;
  if (!joined) {
    return (
      <JoinScreen
        error={state.error}
        onJoin={(n, pw) => { saveName(n); setName(n); setPassword(pw); }}
      />
    );
  }
  return (
    <Gallery
      state={state}
      send={send}
      subscribe={subscribe}
      getRoundOps={getRoundOps}
      opLog={opLog}
      onLeave={() => { clearName(); location.reload(); }}
    />
  );
}
