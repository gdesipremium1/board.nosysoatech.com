"use client";

import { useMemo } from "react";
import { STRATEGY_LABELS, type Prospect, type ProspectEvent } from "@/lib/prospectionShared";

// Prospecting statistics, computed from the event journal of the prospects
// currently shown (the page filters apply). Plain SVG/HTML charts: the board
// has no chart dependency and these shapes don't need one.

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const WEEKDAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const SENT = "#2a78d6";
const FOLLOW_UP = "#1baf7a";
const REPLY = "#eb6834";
const RATE = "#6250d6";
const POSITIVE = "#e87ba4";

// One fixed color per strategy, so a strategy keeps its color whatever the filter.
const STRATEGY_COLORS: Record<string, string> = {
  candidature: "#e87ba4",
  recruteur: "#6250d6",
  lims_mes: "#1baf7a",
  agence: "#eda100",
  esn: "#2a78d6",
  client_direct: "#eb6834",
  partenariat: "#008300",
  local: "#e34948",
  autre: "#a3a29c",
};

const SENTIMENTS = [
  { key: "positive", label: "Positive", color: "#008300" },
  { key: "neutre", label: "Neutre", color: "#eda100" },
  { key: "negative", label: "Négative", color: "#e34948" },
  { key: "none", label: "Non qualifiée", color: "#a3a29c" },
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  email: "E-mail",
  linkedin: "LinkedIn",
  formulaire: "Formulaire",
  whatsapp: "WhatsApp",
  telephone: "Téléphone",
  autre: "Autre",
};

function weekday(iso: string): number {
  return (new Date(iso).getDay() + 6) % 7; // Monday = 0
}

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

function sum(row: Record<string, number>): number {
  return Object.values(row).reduce((a, b) => a + b, 0);
}

export default function ProspectionCharts({ prospects, events }: { prospects: Prospect[]; events: ProspectEvent[] }) {
  const data = useMemo(() => {
    const ids = new Set(prospects.map((p) => p.id));
    const evs = events.filter((e) => ids.has(e.prospectId));
    const sends = evs.filter((e) => e.type === "email_sent");
    const followUps = evs.filter((e) => e.type === "follow_up_sent");
    const replies = evs.filter((e) => e.type === "reply_received");

    // First e-mail per prospect: the moment a reply is attributed to.
    const firstSend = new Map<string, ProspectEvent>();
    for (const e of [...sends].sort((a, b) => a.at.localeCompare(b.at))) {
      if (!firstSend.has(e.prospectId)) firstSend.set(e.prospectId, e);
    }
    const contacted = new Set([...firstSend.keys(), ...followUps.map((e) => e.prospectId)]);
    const replied = new Set(replies.map((e) => e.prospectId));

    const week = { sent: Array(7).fill(0), followUps: Array(7).fill(0), replies: Array(7).fill(0) };
    sends.forEach((e) => week.sent[weekday(e.at)]++);
    followUps.forEach((e) => week.followUps[weekday(e.at)]++);
    replies.forEach((e) => week.replies[weekday(e.at)]++);

    // Best day = highest reply rate on the first e-mails sent that day.
    const dayRate = WEEKDAYS.map((_, d) => {
      const sentThatDay = [...firstSend.values()].filter((e) => weekday(e.at) === d);
      return sentThatDay.length ? sentThatDay.filter((e) => replied.has(e.prospectId)).length / sentThatDay.length : -1;
    });
    const best = dayRate.indexOf(Math.max(...dayRate));

    // Monthly progression (last 6 months with activity).
    const monthKey = (iso: string) => iso.slice(0, 7);
    const months = [...new Set([...sends, ...replies].map((e) => monthKey(e.at)))].sort().slice(-6);
    const monthly = months.map((m) => {
      const s = sends.filter((e) => monthKey(e.at) === m).length;
      const r = replies.filter((e) => monthKey(e.at) === m);
      return {
        label: MONTHS[Number(m.slice(5, 7)) - 1],
        rate: pct(r.length, s),
        positive: pct(r.filter((e) => e.sentiment === "positive").length, s),
      };
    });

    // Reply rate per strategy, among contacted prospects.
    const strategies = new Map<string, { sent: number; replied: number }>();
    for (const p of prospects) {
      if (!p.strategy || !contacted.has(p.id)) continue;
      const row = strategies.get(p.strategy) ?? { sent: 0, replied: 0 };
      row.sent++;
      if (replied.has(p.id)) row.replied++;
      strategies.set(p.strategy, row);
    }

    // Reactions per channel, split by sentiment.
    const channels = new Map<string, Record<string, number>>();
    for (const e of replies) {
      const c = e.channel ?? "email";
      const row = channels.get(c) ?? { positive: 0, neutre: 0, negative: 0, none: 0 };
      row[e.sentiment ?? "none"]++;
      channels.set(c, row);
    }

    return {
      sentCount: sends.length,
      replyCount: replies.length,
      rate: pct([...replied].filter((id) => contacted.has(id)).length, contacted.size),
      best: dayRate[best] >= 0 ? WEEKDAY_NAMES[best] : "—",
      week,
      monthly,
      strategies: [...strategies.entries()]
        .map(([key, r]) => ({ key, ...r, rate: pct(r.replied, r.sent) }))
        .sort((a, b) => b.rate - a.rate || b.sent - a.sent),
      channels: [...channels.entries()].sort((a, b) => sum(b[1]) - sum(a[1])),
    };
  }, [prospects, events]);

  if (!data.sentCount && !data.replyCount) {
    return <p className="px-chart-empty">Aucun envoi enregistré pour ces prospects : les graphiques apparaîtront après les premiers e-mails.</p>;
  }

  const channelMax = Math.max(1, ...data.channels.map(([, row]) => sum(row)));

  return (
    <div className="px-charts">
      <div className="px-kpis">
        <Kpi label="Mails envoyés" value={data.sentCount} />
        <Kpi label="Réponses" value={data.replyCount} />
        <Kpi label="Taux de réponse" value={`${data.rate} %`} />
        <Kpi label="Meilleur jour" value={data.best} />
      </div>

      <section className="px-chart">
        <h3>Activité par jour de la semaine</h3>
        <Legend items={[["Envois", SENT], ["Relances", FOLLOW_UP], ["Réponses reçues", REPLY]]} />
        <GroupedBars
          labels={WEEKDAYS}
          series={[
            { name: "Envois", color: SENT, values: data.week.sent },
            { name: "Relances", color: FOLLOW_UP, values: data.week.followUps },
            { name: "Réponses", color: REPLY, values: data.week.replies },
          ]}
        />
      </section>

      <section className="px-chart">
        <h3>Progression du taux de réponse par mois</h3>
        <Legend items={[["Taux de réponse (%)", RATE], ["Réponses positives (%)", POSITIVE, true]]} />
        <LineChart
          labels={data.monthly.map((m) => m.label)}
          series={[
            { name: "Taux de réponse", color: RATE, values: data.monthly.map((m) => m.rate) },
            { name: "Réponses positives", color: POSITIVE, dashed: true, values: data.monthly.map((m) => m.positive) },
          ]}
        />
      </section>

      <section className="px-chart">
        <h3>Taux de réponse par stratégie</h3>
        {data.strategies.length === 0 && <p className="px-chart-empty">Pas encore de prospects contactés.</p>}
        {data.strategies.map((r) => (
          <div className="px-hbar" key={r.key}>
            <span>{STRATEGY_LABELS[r.key as keyof typeof STRATEGY_LABELS] ?? r.key}</span>
            <div>
              <i style={{ width: `${Math.max(r.rate, 1)}%`, background: STRATEGY_COLORS[r.key] ?? "#a3a29c" }} />
            </div>
            <b>
              {r.rate} % <small>({r.replied}/{r.sent})</small>
            </b>
          </div>
        ))}
      </section>

      <section className="px-chart">
        <h3>Réactions par canal</h3>
        <Legend items={SENTIMENTS.map((s) => [s.label, s.color] as const)} />
        {data.channels.length === 0 && <p className="px-chart-empty">Aucune réponse enregistrée.</p>}
        {data.channels.map(([channel, row]) => (
          <div className="px-hbar" key={channel}>
            <span>{CHANNEL_LABELS[channel] ?? channel}</span>
            <div>
              <div className="px-stack" style={{ width: `${(sum(row) / channelMax) * 100}%` }}>
                {SENTIMENTS.filter((s) => row[s.key]).map((s) => (
                  <i key={s.key} style={{ flex: row[s.key], background: s.color }} title={`${s.label} : ${row[s.key]}`} />
                ))}
              </div>
            </div>
            <b>{sum(row)}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="px-kpi">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Legend({ items }: { items: readonly (readonly [string, string] | readonly [string, string, boolean])[] }) {
  return (
    <div className="px-chart-legend">
      {items.map(([label, color, dashed]) => (
        <span key={label}>
          <i className={dashed ? "dashed" : undefined} style={dashed ? { borderColor: color } : { background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// Charts share one coordinate system; the SVG scales with its column and
// keeps this aspect ratio, so text stays proportionate.
const W = 520;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function niceMax(v: number, percent = false): number {
  if (percent) return Math.max(10, Math.ceil(v / 10) * 10);
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v)) / 2;
  return Math.ceil(v / step) * step;
}

function YAxis({ max, suffix = "" }: { max: number; suffix?: string }) {
  return (
    <g>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = PAD.top + PLOT_H * (1 - f);
        return (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} className={f === 0 ? "px-base" : "px-grid"} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" className="px-tick">
              {Math.round(max * f)}
              {suffix}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function GroupedBars({ labels, series }: { labels: string[]; series: { name: string; color: string; values: number[] }[] }) {
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const group = PLOT_W / labels.length;
  const barW = Math.min(14, (group - 10) / series.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="px-svg" role="img" aria-label="Envois, relances et réponses par jour de la semaine">
      <YAxis max={max} />
      {labels.map((label, i) => {
        const x0 = PAD.left + i * group + (group - barW * series.length) / 2;
        return (
          <g key={label}>
            {series.map((s, j) => {
              const h = (s.values[i] / max) * PLOT_H;
              return h > 0 ? (
                <path
                  key={s.name}
                  d={roundedTop(x0 + j * barW + 1, PAD.top + PLOT_H - h, barW - 2, h)}
                  fill={s.color}
                >
                  <title>{`${label} · ${s.name} : ${s.values[i]}`}</title>
                </path>
              ) : null;
            })}
            <text x={PAD.left + i * group + group / 2} y={H - 7} textAnchor="middle" className="px-tick">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Bar with rounded data end and square baseline.
function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(3, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function LineChart({ labels, series }: { labels: string[]; series: { name: string; color: string; dashed?: boolean; values: number[] }[] }) {
  if (labels.length === 0) return <p className="px-chart-empty">Pas encore assez d&apos;historique.</p>;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)), true);
  const step = labels.length > 1 ? PLOT_W / (labels.length - 1) : 0;
  const x = (i: number) => (labels.length === 1 ? PAD.left + PLOT_W / 2 : PAD.left + i * step);
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  const first = series[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="px-svg" role="img" aria-label="Taux de réponse par mois">
      <YAxis max={max} suffix=" %" />
      {first && labels.length > 1 && (
        <polygon
          points={`${x(0)},${PAD.top + PLOT_H} ${first.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} ${x(labels.length - 1)},${PAD.top + PLOT_H}`}
          fill={first.color}
          opacity={0.1}
        />
      )}
      {series.map((s) => (
        <g key={s.name}>
          <polyline
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.dashed ? "6 4" : undefined}
          />
          {s.values.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={s.color} className="px-dot">
              <title>{`${labels[i]} · ${s.name} : ${v} %`}</title>
            </circle>
          ))}
        </g>
      ))}
      {labels.map((label, i) => (
        <text key={label} x={x(i)} y={H - 7} textAnchor="middle" className="px-tick">
          {label}
        </text>
      ))}
    </svg>
  );
}
