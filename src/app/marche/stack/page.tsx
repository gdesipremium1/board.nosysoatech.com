"use client";

import { useEffect, useMemo, useState } from "react";
import AppMenu from "@/components/AppMenu";
import type { StackRow, StackStudy } from "@/lib/market";
import MarketTabs from "../MarketTabs";
import MultiSelect, { pick } from "../MultiSelect";
import "../marche.css";

// Stacks rentables: real demand (freelance missions actually published)
// against competition (share of professional developers who use the
// technology). Ratio = missions / % of developers: how many missions there
// are for each percent of developers competing for them. Everything is
// derived here from the raw figures of the selected study.

type Me = { username: string; role: string; avatarUrl?: string };
type SortKey = "ratio" | "missions" | "growth" | "rate" | "devShare";
type Verdict = "sweet" | "ok" | "saturated" | "avoid" | "platform" | "absent";

// Thresholds of the verdict, shown in the legend.
const SWEET_RATIO = 150;
const OK_RATIO = 30;
const DECLINE = -0.2;
const MIN_MISSIONS = 10; // below, the technology is barely present on the measured market

const VERDICTS: Record<Verdict, { label: string; help: string }> = {
  sweet: { label: "Forte demande, peu de concurrence", help: `ratio ≥ ${SWEET_RATIO} et missions en hausse` },
  ok: { label: "Bon équilibre", help: `ratio ≥ ${OK_RATIO} et missions stables ou en hausse` },
  saturated: { label: "Concurrence forte", help: `ratio < ${OK_RATIO}` },
  avoid: { label: "En recul", help: `missions en baisse de plus de ${Math.abs(DECLINE * 100)} % sur un an` },
  platform: { label: "Plateforme d'éditeur", help: "absente du sondage développeurs : concurrence non mesurée, souvent faible (certification exigée)" },
  absent: { label: "Peu présent sur ce marché", help: `moins de ${MIN_MISSIONS} missions : marché surtout local ailleurs (Odoo, Symfony en France et en Belgique)` },
};

type Computed = StackRow & { ratio: number | null; growth: number | null; verdict: Verdict };

function compute(r: StackRow): Computed {
  const ratio = r.devShare && r.devShare > 0 ? r.missions / r.devShare : null;
  const growth = r.missionsPrev && r.missionsPrev > 0 ? (r.missions - r.missionsPrev) / r.missionsPrev : null;
  let verdict: Verdict;
  if (growth !== null && growth < DECLINE && r.missionsPrev! >= MIN_MISSIONS) verdict = "avoid";
  else if (r.missions < MIN_MISSIONS) verdict = "absent";
  else if (ratio === null) verdict = "platform";
  else if (ratio >= SWEET_RATIO && (growth ?? 0) >= 0) verdict = "sweet";
  else if (ratio >= OK_RATIO) verdict = "ok";
  else verdict = "saturated";
  return { ...r, ratio, growth, verdict };
}

function pct(v: number | null, signed = false): string {
  if (v === null) return "—";
  const s = `${Math.round(v * 100)} %`;
  return signed && v > 0 ? `+${s}` : s;
}

function fmt(n: number): string {
  return n.toLocaleString("fr-FR");
}

// Log scale helper for the bubble chart.
function logScale(v: number, min: number, max: number, from: number, to: number): number {
  const t = (Math.log10(Math.max(v, min)) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  return from + Math.min(1, Math.max(0, t)) * (to - from);
}

function Scatter({ rows }: { rows: Computed[] }) {
  const pts = rows.filter((r) => r.devShare !== null && r.devShare > 0 && r.missions > 0);
  if (pts.length === 0) return <p className="mk-empty">Aucune techno avec une mesure de concurrence dans cette sélection.</p>;
  const W = 760;
  const H = 360;
  const L = 56;
  const R = 16;
  const T = 16;
  const B = 44;
  const xMin = 0.5;
  const xMax = 50;
  const yMin = 1;
  const yMax = Math.max(10000, ...pts.map((p) => p.missions));
  const x = (v: number) => logScale(v, xMin, xMax, L, W - R);
  const y = (v: number) => logScale(v, yMin, yMax, H - B, T);
  const xTicks = [0.5, 1, 2, 5, 10, 20, 50];
  const yTicks = [1, 10, 100, 1000, 10000].filter((t) => t <= yMax);
  // Iso-ratio line: missions = SWEET_RATIO × % of developers.
  const iso = [xMin, xMax].map((v) => [x(v), y(SWEET_RATIO * v)]);
  return (
    <svg className="mk-scatter" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Missions selon la part de développeurs, par techno">
      <rect x={L} y={T} width={(W - R - L) / 2} height={(H - B - T) / 2} className="mk-sweet-zone" />
      <text x={L + 8} y={T + 16} className="mk-zone-label">Forte demande, peu de concurrence</text>
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={T} y2={H - B} className="mk-grid-line" />
          <text x={x(t)} y={H - B + 16} textAnchor="middle" className="mk-axis">{String(t).replace(".", ",")} %</text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="mk-grid-line" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="mk-axis">{fmt(t)}</text>
        </g>
      ))}
      <line x1={iso[0][0]} y1={iso[0][1]} x2={iso[1][0]} y2={iso[1][1]} className="mk-iso" />
      <text x={W - R - 4} y={H - B - 6} textAnchor="end" className="mk-axis">Part des développeurs qui la pratiquent (concurrence) →</text>
      <text x={14} y={T + 4} className="mk-axis" transform={`rotate(90 14 ${T + 4})`}>Missions sur la période (demande) →</text>
      {pts.map((p) => (
        <g key={p.tech} className={`mk-dot v-${p.verdict}`}>
          <title>{`${p.tech} : ${fmt(p.missions)} missions, ${String(p.devShare).replace(".", ",")} % des développeurs, ratio ${Math.round(p.ratio ?? 0)}`}</title>
          <circle cx={x(p.devShare!)} cy={y(p.missions)} r={5} />
          <text x={x(p.devShare!) + 7} y={y(p.missions) + 4}>{p.tech}</text>
        </g>
      ))}
    </svg>
  );
}

export default function StackPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [studies, setStudies] = useState<StackStudy[]>([]);
  const [studyId, setStudyId] = useState("");
  const [families, setFamilies] = useState<string[]>([]);
  const [verdicts, setVerdicts] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("ratio");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    fetch("/api/market/stack")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Chargement impossible."))))
      .then((json) => {
        setStudies(json.studies);
        if (json.studies[0]) setStudyId(json.studies[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  const study = studies.find((s) => s.id === studyId);
  const all = useMemo(() => (study ? study.rows.map(compute) : []), [study]);
  const familyOptions = useMemo(() => [...new Set(all.map((r) => r.family))].map((f) => ({ value: f, label: f })), [all]);
  const verdictOptions = (Object.keys(VERDICTS) as Verdict[]).map((v) => ({ value: v, label: VERDICTS[v].label }));

  const rows = useMemo(() => {
    const fams = new Set(pick(familyOptions.map((o) => o.value), families));
    const verds = new Set(pick(Object.keys(VERDICTS), verdicts));
    const value = (r: Computed): number => {
      if (sortKey === "ratio") return r.ratio ?? -1;
      if (sortKey === "growth") return r.growth ?? -Infinity;
      if (sortKey === "rate") return r.rate ?? -1;
      if (sortKey === "devShare") return -(r.devShare ?? Infinity);
      return r.missions;
    };
    return all.filter((r) => fams.has(r.family) && verds.has(r.verdict)).sort((a, b) => value(b) - value(a));
  }, [all, families, verdicts, familyOptions, sortKey]);

  const maxRatio = Math.max(1, ...all.map((r) => r.ratio ?? 0));
  const best = all.filter((r) => r.verdict === "sweet").sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const rising = all.filter((r) => r.growth !== null && r.missions >= 50).sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0)).slice(0, 3);
  const falling = all.filter((r) => r.verdict === "avoid").sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0));

  const th = (key: SortKey, label: string) => (
    <th className={"mk-sortable" + (sortKey === key ? " active" : "")} onClick={() => setSortKey(key)} aria-sort={sortKey === key ? "descending" : undefined}>
      {label}
    </th>
  );

  return (
    <div className="mk-page">
      <header>
        <div className="wordmark">
          <img src="/logo-icon.png" alt="" className="wm-icon" />
          <span className="wm-nosy">nosy</span>
          <span className="wm-soa">soa</span>
          <span className="wm-tech">tech</span>
          <span className="wm-board">/board</span>
          <span className="lock">🔒 privé</span>
        </div>
        <div className="crumb">
          <span className="crumb-sep">›</span>
          <span className="crumb-name">Marché</span>
        </div>
        {me && <AppMenu current="marche" me={me} />}
      </header>

      <main className="mk-body">
        <MarketTabs current="stacks" />
        <div className="mk-head">
          <h1>Stacks rentables</h1>
          {studies.length > 0 && (
            <select value={studyId} onChange={(e) => setStudyId(e.target.value)} aria-label="Étude">
              {studies.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          )}
        </div>

        {error && <p className="mk-empty">{error}</p>}
        {!error && studies.length === 0 && (
          <p className="mk-empty">Aucune étude pour l&apos;instant : lancer scripts/market/stack.py puis POST /api/market/stack (voir docs/MARCHE.md).</p>
        )}

        {study && (
          <>
            <p className="mk-help">
              Demande réelle : missions freelance publiées ({study.region}, {study.period}). Concurrence : part des
              développeurs professionnels qui pratiquent la techno{study.respondents ? ` (sondage de ${fmt(study.respondents)} développeurs)` : ""}.
              Le ratio donne le nombre de missions pour chaque pour cent de développeurs en concurrence : plus il est haut, plus la techno est rentable à apprendre ou à vendre.
            </p>

            <div className="mk-grid mk-insights">
              <div className="mk-card">
                <h2>Forte demande, peu de concurrence</h2>
                {best.length === 0 && <p className="mk-empty">Aucune techno ne remplit les deux conditions.</p>}
                {best.map((r) => (
                  <div className="mk-leader" key={r.tech}>
                    <b>{r.tech}</b>
                    <span>ratio {Math.round(r.ratio!)} · {fmt(r.missions)} missions · {pct(r.growth, true)} sur un an{r.rate ? ` · ${r.rate} £/j` : ""}</span>
                  </div>
                ))}
              </div>
              <div className="mk-card">
                <h2>Plus fortes progressions</h2>
                {rising.map((r) => (
                  <div className="mk-leader" key={r.tech}>
                    <b>{r.tech}</b>
                    <span>{pct(r.growth, true)} · {fmt(r.missionsPrev ?? 0)} → {fmt(r.missions)} missions</span>
                  </div>
                ))}
                {falling.length > 0 && (
                  <>
                    <h2 className="mk-subhead">En recul</h2>
                    {falling.map((r) => (
                      <div className="mk-leader" key={r.tech}>
                        <b>{r.tech}</b>
                        <span>{pct(r.growth, true)} · {fmt(r.missionsPrev ?? 0)} → {fmt(r.missions)} missions</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="mk-card">
              <div className="mk-card-head">
                <h2>Demande face à la concurrence</h2>
              </div>
              <p className="mk-help">
                Échelles logarithmiques. En haut à gauche : beaucoup de missions pour peu de développeurs. La ligne en pointillés
                marque le seuil « forte demande » (ratio {SWEET_RATIO}). Les plateformes d&apos;éditeur, sans mesure de concurrence, n&apos;y figurent pas.
              </p>
              <div className="mk-filters">
                <MultiSelect label="Famille" options={familyOptions} selected={families} onChange={setFamilies} />
                <MultiSelect label="Verdict" options={verdictOptions} selected={verdicts} onChange={setVerdicts} />
              </div>
              <div className="mk-scroll">
                <Scatter rows={rows} />
              </div>
              <div className="mk-legend">
                {(Object.keys(VERDICTS) as Verdict[]).map((v) => (
                  <span key={v} title={VERDICTS[v].help}><i className={`mk-swatch v-${v}`} />{VERDICTS[v].label}</span>
                ))}
              </div>
            </div>

            <div className="mk-card">
              <h2>Détail par techno</h2>
              <p className="mk-help">Cliquer sur un en-tête pour trier. Filtres communs avec le graphique.</p>
              <div className="mk-scroll">
                <table className="mk-table mk-stack">
                  <thead>
                    <tr>
                      <th>Techno</th>
                      <th>Famille</th>
                      {th("missions", "Missions")}
                      {th("growth", "Sur un an")}
                      {th("rate", "Tarif médian")}
                      {th("devShare", "Développeurs")}
                      {th("ratio", "Missions par % de devs")}
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.tech}>
                        <td><b>{r.tech}</b></td>
                        <td>{r.family}</td>
                        <td className="mk-n">{fmt(r.missions)}</td>
                        <td className={"mk-n " + (r.growth === null ? "" : r.growth >= 0 ? "mk-up" : "mk-down")}>{pct(r.growth, true)}</td>
                        <td className="mk-n">{r.rate ? `${r.rate} £/j` : "—"}</td>
                        <td className="mk-n">{r.devShare !== null ? `${String(r.devShare).replace(".", ",")} %` : "non mesuré"}</td>
                        <td className="mk-ratio-cell">
                          {r.ratio !== null ? (
                            <div className="mk-ratio">
                              <div><i className={`v-${r.verdict}`} style={{ width: `${Math.max(2, (r.ratio / maxRatio) * 100)}%` }} /></div>
                              <b>{Math.round(r.ratio)}</b>
                            </div>
                          ) : (
                            <span className="mk-na">—</span>
                          )}
                        </td>
                        <td><span className={`mk-verdict v-${r.verdict}`} title={VERDICTS[r.verdict].help}>{VERDICTS[r.verdict].label}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mk-card">
              <h2>Limites et sources</h2>
              <ul className="mk-sources">
                <li>Les missions sont celles du marché {study.region === "Royaume-Uni" ? "britannique, seul relevé public des missions freelance par techno" : study.region} : un indicateur de tendance, pas le volume exact de nos marchés francophones.</li>
                <li>La concurrence est mondiale ; l&apos;offre locale et offshore n&apos;est pas isolée.</li>
                <li>Odoo, Symfony ou PrestaShop pèsent surtout en France et en Belgique : leur faible volume ici ne reflète pas ces marchés.</li>
                {study.notes && <li>{study.notes}</li>}
                {study.sources.map((s) => (
                  <li key={s.id}><a href={s.url} target="_blank" rel="noopener">{s.label}</a></li>
                ))}
              </ul>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
