import type { PlayerInfo, RoundInfo, RoundSummary, ServerMsg } from '@gallery/shared';

export interface RoomState {
  conn: 'connecting' | 'open' | 'closed';
  error: string | null;
  you: number | null;
  players: PlayerInfo[];
  shares: Record<number, number>;
  round: RoundInfo | null;
  winnerPid: number | null;
  history: RoundSummary[];
  clockOffset: number;
}

export const initialState: RoomState = {
  conn: 'connecting', error: null, you: null, players: [], shares: {}, round: null, winnerPid: null, history: [], clockOffset: 0,
};

export type Action =
  | { type: 'conn'; conn: RoomState['conn'] }
  | { type: 'server'; msg: ServerMsg; localNow: number };

export function reduce(state: RoomState, action: Action): RoomState {
  if (action.type === 'conn') return { ...state, conn: action.conn };
  const m = action.msg;
  switch (m.t) {
    case 'welcome':
      return {
        ...state, error: null, you: m.you, players: m.players, round: m.round, winnerPid: m.winnerPid,
        shares: m.shares, history: m.history, clockOffset: m.serverNow - action.localNow,
      };
    case 'players': return { ...state, players: m.players };
    case 'scores': return { ...state, shares: m.shares };
    case 'round':
      return {
        ...state, round: m.round, winnerPid: m.winnerPid, history: m.history,
        shares: m.wipe ? {} : state.shares,
      };
    case 'error': return { ...state, error: m.reason };
    default: return state;
  }
}
