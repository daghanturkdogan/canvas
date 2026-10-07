import { CANVAS_H, CANVAS_W, type OverlayShape } from '@gallery/shared';

const TONES: Record<string, string> = { zone: '#ffd24a', flag: '#ffffff', hill: '#7cf5a3' };

export function OverlayLayer({ shapes }: { shapes: OverlayShape[] }) {
  if (shapes.length === 0) return null;
  return (
    <svg className="overlay-layer" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} preserveAspectRatio="none">
      {shapes.map((s, i) =>
        s.kind === 'ring' ? (
          <path
            key={i}
            fillRule="evenodd"
            fill="rgba(10,6,3,0.45)"
            d={`M0 0H${CANVAS_W}V${CANVAS_H}H0Z M${s.x - s.r} ${s.y}a${s.r} ${s.r} 0 1 0 ${s.r * 2} 0a${s.r} ${s.r} 0 1 0 ${-s.r * 2} 0Z`}
          />
        ) : (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.r} fill={TONES[s.tone]} fillOpacity={0.12} stroke={TONES[s.tone]} strokeWidth={4} strokeDasharray="14 10" />
            {s.label && (
              <text x={s.x} y={s.y} textAnchor="middle" dominantBaseline="middle" fontSize={34} fontWeight={700} fill={TONES[s.tone]} stroke="rgba(0,0,0,.5)" strokeWidth={1}>
                {s.label}
              </text>
            )}
          </g>
        ),
      )}
    </svg>
  );
}
