const ID_KEY = 'gallery.clientId';
const NAME_KEY = 'gallery.name';

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
}

export function getClientId(): string {
  let id = safeGet(ID_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = crypto.randomUUID();
    safeSet(ID_KEY, id);
  }
  return id;
}

export const getSavedName = () => safeGet(NAME_KEY);
export const saveName = (n: string) => safeSet(NAME_KEY, n);
export function clearName(): void {
  try { localStorage.removeItem(NAME_KEY); } catch { /* ignore */ }
}
