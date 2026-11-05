import { useId } from 'react';

// Small dependency-free SVG charts. Each has a text summary for screen readers and a <title> tooltip on every mark.

export interface ChartSeries { name: string; color: string; values: number[] }

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 34 };

/** A "nice" axis maximum (4, 5, 10, 20, 50, 100 …) so gridlines fall on round numbers. */
export function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const f = max / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Show roughly `n` labels however many days there are. */
const labelEvery = (count: number, n = 7) => Math.max(1, Math.ceil(count / n));

function Frame({ labels, max, children, title }: { labels: string[]; max: number; children: React.ReactNode; title: string }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const innerH = H - PAD.top - PAD.bottom;
  const every = labelEvery(labels.length);
  const slot = (W - PAD.left - PAD.right) / Math.max(labels.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="h-auto w-full">
      {ticks.map((t) => {
        const y = PAD.top + innerH - (t / max) * innerH;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.12} />
            <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity={0.6}>{t}</text>
          </g>
        );
      })}
      {labels.map((l, i) => (i % every === 0 ? (
        <text key={l} x={PAD.left + slot * (i + 0.5)} y={H - 8} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity={0.6}>{l}</text>
      ) : null))}
      {children}
    </svg>
  );
}

export function Legend({ series }: { series: Pick<ChartSeries, 'name' | 'color'>[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />{s.name}</li>
      ))}
    </ul>
  );
}

/** Grouped bars: one group per label, one bar per series. */
export function BarChart({ labels, series, title }: { labels: string[]; series: ChartSeries[]; title: string }) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const innerH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / Math.max(labels.length, 1);
  const groupW = Math.min(slot * 0.8, 40 * series.length);
  const barW = groupW / series.length;
  return (
    <figure>
      <Frame labels={labels} max={max} title={`${title}. ${series.map((s) => `${s.name}: ${s.values.join(', ')}`).join('; ')}`}>
        {labels.map((label, i) =>
          series.map((s, k) => {
            const v = s.values[i] ?? 0;
            const h = (v / max) * innerH;
            return (
              <rect key={`${label}-${s.name}`} x={PAD.left + slot * i + (slot - groupW) / 2 + barW * k + 0.5} y={PAD.top + innerH - h} width={Math.max(barW - 1, 1)} height={h} rx={2} fill={s.color}>
                <title>{`${label} · ${s.name}: ${v}`}</title>
              </rect>
            );
          }),
        )}
      </Frame>
      {series.length > 1 && <Legend series={series} />}
    </figure>
  );
}

/** One line per series. */
export function LineChart({ labels, series, title }: { labels: string[]; series: ChartSeries[]; title: string }) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const innerH = H - PAD.top - PAD.bottom;
  const slot = (W - PAD.left - PAD.right) / Math.max(labels.length, 1);
  const x = (i: number) => PAD.left + slot * (i + 0.5);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const gradient = useId();
  return (
    <figure>
      <Frame labels={labels} max={max} title={`${title}. ${series.map((s) => `${s.name}: ${s.values.join(', ')}`).join('; ')}`}>
        {series.map((s, k) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.name}>
              {k === 0 && s.values.length > 1 && (
                <>
                  <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity={0.3} /><stop offset="1" stopColor={s.color} stopOpacity={0} /></linearGradient></defs>
                  <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`} fill={`url(#${gradient})`} />
                </>
              )}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {s.values.map((v, i) => (
                <circle key={labels[i]} cx={x(i)} cy={y(v)} r={3} fill={s.color}><title>{`${labels[i]} · ${s.name}: ${v}`}</title></circle>
              ))}
            </g>
          );
        })}
      </Frame>
      {series.length > 1 && <Legend series={series} />}
    </figure>
  );
}

/** A single horizontal bar split into labelled segments (e.g. applications by status). */
export function StackedBar({ segments, title }: { segments: { name: string; color: string; value: number }[]; title: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <figure>
      <div role="img" aria-label={`${title}. ${segments.map((s) => `${s.name}: ${s.value}`).join('; ')}`} className="flex h-4 w-full overflow-hidden rounded-full bg-bg-tertiary">
        {total > 0 && segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.name} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} title={`${s.name}: ${s.value}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-ink-secondary"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />{s.name}</span>
            <span className="font-bold">{s.value}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
