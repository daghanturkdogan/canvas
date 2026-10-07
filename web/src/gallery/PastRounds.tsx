import type { Op, RoundSummary } from '@gallery/shared';

export function PastRounds(_props: { history: RoundSummary[]; getRoundOps: (idx: number) => Promise<Op[]> }) {
  return <div className="past" />;
}
