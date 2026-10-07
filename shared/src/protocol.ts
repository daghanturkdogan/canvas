export type ModeId =
  | 'paint' | 'splat' | 'hotzones' | 'hill' | 'enclose' | 'ctf' | 'fog' | 'eraser' | 'shrink' | 'teams';
export type ModeState = Record<string, unknown>;

export interface StrokeOp { k: 's'; id: string; pid: number; pts: number[] }
export interface FillOp { k: 'f'; pid: number; poly: number[] }
export type Op = StrokeOp | FillOp;

export interface PlayerInfo { pid: number; name: string; color: string; online: boolean; wins: number; team?: number }

export interface NextModeInfo { mode: ModeId; name: string; rules: string; howTo: string[]; brush: number }

export interface RoundInfo {
  idx: number;
  mode: ModeId;
  modeName: string;
  rules: string;
  howTo: string[];
  brush: number;
  phase: 'playing' | 'over';
  startsAt: number;
  overAt: number;
  endsAt: number;
  next: NextModeInfo;
}

export interface RoundSummary {
  idx: number;
  mode: ModeId;
  endedAt: number;
  winnerPid: number | null;
  shares: Record<number, number>;
  players: Record<number, { name: string; color: string }>;
}

export type ClientMsg =
  | { t: 'join'; clientId: string; name: string; password?: string }
  | { t: 'stroke'; id: string; pts: number[]; end?: boolean; erase?: boolean }
  | { t: 'get-round'; idx: number };

export type ServerMsg =
  | {
      t: 'welcome';
      serverNow: number;
      you: number;
      players: PlayerInfo[];
      round: RoundInfo;
      winnerPid: number | null;
      ops: Op[];
      shares: Record<number, number>;
      history: RoundSummary[];
      modeState: ModeState | null;
    }
  | { t: 'error'; reason: 'bad-password' | 'room-full' | 'bad-join' }
  | { t: 'stroke'; id: string; pid: number; pts: number[] }
  | { t: 'fill'; pid: number; poly: number[] }
  | { t: 'players'; players: PlayerInfo[] }
  | { t: 'scores'; shares: Record<number, number> }
  | { t: 'round'; round: RoundInfo; winnerPid: number | null; wipe: boolean; history: RoundSummary[] }
  | { t: 'mode-state'; idx: number; state: ModeState | null }
  | { t: 'round-ops'; idx: number; ops: Op[] };
