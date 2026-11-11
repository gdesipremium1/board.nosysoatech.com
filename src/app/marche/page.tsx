"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import AppMenu from "@/components/AppMenu";
import type { MarketStudy } from "@/lib/market";
import { countryLabel, type Prospect, type ProspectEvent } from "@/lib/prospectionShared";
import MarketTabs from "./MarketTabs";
import MultiSelect, { pick, type Option } from "./MultiSelect";
import WorkConditions from "./WorkConditions";
import "./marche.css";

// Market studies: which skills are in demand where, and how many developers
// already offer them. Raw figures come from dated studies (Google Trends,
// GitHub Innovation Graph, Eurostat, StoreCensus, posted by the collection
// scripts); our own reply rate per country is computed live from the
// prospection journal, the one source no public dataset can give.
//
// Each table has its own country / skill filters. They only hide rows and
// columns: "best country = 100" and demand / supply always compare against
// every country of the study, so a value never changes with the filter.

type Me = { username: string; role: string; avatarUrl?: string };
type Mode = "relative" | "raw";
type SupplyMode = "count" | "density" | "gap";
type TableId = "demand" | "supply" | "ranking" | "leaders" | "official" | "stores";
type Filter = { countries: string[]; skills: string[] };

const MIN_CONTACTED = 5; // below this, a country's reply rate is noise
const EMPTY: Filter = { countries: [], skills: [] };

function heat(v: number | undefined, rgb = "42, 120, 214"): React.CSSProperties {
  if (v === undefined) return {};
  // One hue, light to dark (sequential): 8% to 85% opacity.
  const a = 0.08 + (Math.min(100, Math.max(0, v)) / 100) * 0.77;
  return { background: `rgba(${rgb}, ${a.toFixed(2)})`, color: a > 0.5 ? "#fff" : undefined };
}

// Demand / supply: above 1, the country searches for the skill more than it
// has developers for it, relative to the other countries (orange = gap to
// fill remotely); below 1, local supply is comparatively ample (gray).
function gapStyle(r: number | undefined): React.CSSProperties {
  if (r === undefined) return {};
  if (r < 1) return { background: `rgba(137, 135, 129, ${(0.08 + (1 - r) * 0.3).toFixed(2)})` };
  const a = 0.12 + Math.min(1, (r - 1) / 2) * 0.73;
  return { background: `rgba(235, 104, 52, ${a.toFixed(2)})`, color: a > 0.5 ? "#fff" : undefined };
}

function compact(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)} k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} k` : String(n);
}

export default function MarchePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [studies, setStudies] = useState<MarketStudy[]>([]);
  const [studyId, setStudyId] = useState("");
  const [mode, setMode] = useState<Mode>("relative");
  const [supplyMode, setSupplyMode] = useState<SupplyMode>("gap");
  const [filters, setFilters] = useState<Record<TableId, Filter>>({
    demand: EMPTY,
    supply: EMPTY,
    ranking: EMPTY,
    leaders: EMPTY,
    official: EMPTY,
    stores: EMPTY,
  });
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [events, setEvents] = useState<ProspectEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    fetch("/api/market")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Chargement impossible."))))
      .then((json) => {
        setStudies(json.studies);
        if (json.studies[0]) setStudyId(json.studies[0].id);
      })
      .catch((e) => setError(e.message));
    fetch("/api/prospection/prospects")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        setProspects(json.prospects);
        setEvents(json.events);
      })
      .catch(() => undefined);
  }, []);

  const study = studies.find((s) => s.id === studyId) ?? null;
  const setFilter = (table: TableId, key: keyof Filter) => (values: string[]) =>
    setFilters((prev) => ({ ...prev, [table]: { ...prev[table], [key]: values } }));

  // Older studies have no families: one group with every skill.
  const families: [string, string[]][] = study
    ? Object.entries(study.families ?? { Compétences: study.skills }).map(([f, skills]) => [
        f,
        skills.filter((s) => study.trends[s]),
      ])
    : [];
  const grouped = families.length > 1;
  const familyOf = (skill: string) => families.find(([, skills]) => skills.includes(skill))?.[0] ?? "";
  const familiesFor = (selected: string[]): [string, string[]][] =>
    families.map(([f, skills]) => [f, pick(skills, selected)] as [string, string[]]).filter(([, skills]) => skills.length > 0);

  const countryOptions: Option[] = (study?.countries ?? []).map((c) => ({ value: c, label: countryLabel(c) }));
  const skillOptions = (only?: (skill: string) => boolean): Option[] =>
    families.flatMap(([f, skills]) =>
      skills.filter((s) => !only || only(s)).map((s) => ({ value: s, label: s, group: grouped ? f : undefined })),
    );

  // One pair of filters (countries, skills) for a table.
  // Plain render functions (not components): a component declared here
  // would be remounted on every render and close the open drop-down.
  const filtersFor = (table: TableId, { countries = true, skills = true, onlySkills }: { countries?: boolean; skills?: boolean; onlySkills?: (s: string) => boolean } = {}) => (
    <div className="mk-filters">
      {countries && (
        <MultiSelect label="Pays" options={countryOptions} selected={filters[table].countries} onChange={setFilter(table, "countries")} />
      )}
      {skills && (
        <MultiSelect label="Compétences" options={skillOptions(onlySkills)} selected={filters[table].skills} onChange={setFilter(table, "skills")} />
      )}
    </div>
  );

  // Supply of one skill in one country: developers pushing code in its
  // language(s), raw or per 1,000 active developers of the country.
  const supplyCount = (skill: string, country: string): number | undefined => {
    const langs = study?.supply?.skillLanguages[skill];
    if (!langs) return undefined;
    const n = langs.reduce((sum, l) => sum + (study?.supply?.languages[l]?.[country] ?? 0), 0);
    return n || undefined;
  };
  const supplyDensity = (skill: string, country: string): number | undefined => {
    const n = supplyCount(skill, country);
    const devs = study?.supply?.developers[country];
    return n && devs ? (n / devs) * 1000 : undefined;
  };
  const maxDensity = (skill: string) => Math.max(...(study?.countries ?? []).map((c) => supplyDensity(skill, c) ?? 0));
  // Both sides normalized per skill (best country = 1) before dividing, so
  // the ratio compares countries, not skills.
  const gap = (skill: string, country: string): number | undefined => {
    const demand = study?.trends[skill]?.[country];
    const density = supplyDensity(skill, country);
    if (!demand || !density) return undefined;
    const maxDemand = Math.max(...(study?.countries ?? []).map((c) => study?.trends[skill]?.[c] ?? 0));
    return demand / maxDemand / (density / maxDensity(skill));
  };

  // Skills ranked within the chosen countries (average of each country's
  // ratio to the common anchor), so skills are comparable to one another.
  const rankCountries = useMemo(() => {
    const withData = (study?.countries ?? []).filter((c) => Object.values(study?.vsAnchor ?? {}).some((row) => (row[c] ?? 0) > 0));
    return pick(withData, filters.ranking.countries);
  }, [study, filters.ranking.countries]);
  const ranking = useMemo(() => {
    if (!study?.vsAnchor || rankCountries.length === 0) return [];
    const rows = Object.entries(study.vsAnchor)
      .map(([skill, byCountry]) => ({
        skill,
        v: rankCountries.reduce((s, c) => s + (byCountry[c] ?? 0), 0) / rankCountries.length,
      }))
      .filter((r) => r.v > 0)
      .sort((a, b) => b.v - a.v);
    const max = rows[0]?.v ?? 1;
    const selected = filters.ranking.skills;
    return pick(rows.map((r) => r.skill), selected)
      .slice(0, selected.length ? undefined : 15)
      .map((skill) => {
        const v = rows.find((r) => r.skill === skill)!.v;
        return { skill, pct: Math.round((v / max) * 100) };
      });
  }, [study, rankCountries, filters.ranking.skills]);

  // Our reply rate per country (first e-mail or follow-up = contacted).
  const replyRate = useMemo(() => {
    const contacted = new Set(events.filter((e) => e.type === "email_sent" || e.type === "follow_up_sent").map((e) => e.prospectId));
    const replied = new Set(events.filter((e) => e.type === "reply_received").map((e) => e.prospectId));
    const rows = new Map<string, { sent: number; replied: number }>();
    for (const p of prospects) {
      if (!contacted.has(p.id)) continue;
      const c = p.country ?? "FR";
      const row = rows.get(c) ?? { sent: 0, replied: 0 };
      row.sent++;
      if (replied.has(p.id)) row.replied++;
      rows.set(c, row);
    }
    return rows;
  }, [prospects, events]);

  // Relative mode: the best country of each skill = 100, so rows compare
  // countries for one skill (Google indices are not comparable across rows).
  const cell = (skill: string, country: string): number | undefined => {
    const row = study?.trends[skill];
    const v = row?.[country];
    if (v === undefined || v === 0) return undefined;
    if (mode === "raw") return v;
    const max = Math.max(...Object.values(row ?? {}));
    return max ? Math.round((v / max) * 100) : undefined;
  };

  const cellRelative = (skill: string, country: string): number | undefined => {
    const row = study?.trends[skill];
    const v = row?.[country];
    const max = Math.max(0, ...Object.values(row ?? {}));
    return v && max ? Math.round((v / max) * 100) : undefined;
  };

  const leaders = (skill: string, countries: string[]): string[] =>
    countries
      .filter((c) => (study?.trends[skill]?.[c] ?? 0) > 0)
      .sort((a, b) => (study?.trends[skill]?.[b] ?? 0) - (study?.trends[skill]?.[a] ?? 0))
      .slice(0, 3);

  const storesMax = Math.max(1, ...Object.values(study?.stores ?? {}).map((n) => n ?? 0));
  const hasSupply = (s: string) => !!study?.supply?.skillLanguages[s];

  const countryHead = (countries: string[]) => (
    <thead>
      <tr>
        <th />
        {countries.map((c) => (
          <th key={c} title={countryLabel(c)}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );

  // Country-only tables (Eurostat, WooCommerce stores): choosing skills adds,
  // for each, its demand (best country = 100) and supply (per 1,000 devs).
  const chosen = (table: TableId) => (filters[table].skills.length ? pick(study?.skills ?? [], filters[table].skills) : []);
  const skillHead = (table: TableId) =>
    chosen(table).map((s) => (
      <th key={s}>
        {s}
        <br />
        <small>demande · offre</small>
      </th>
    ));
  const skillCells = (table: TableId, country: string) =>
    chosen(table).map((s) => {
      const d = country === "EU27_2020" ? undefined : cellRelative(s, country);
      const o = country === "EU27_2020" ? undefined : supplyDensity(s, country);
      return (
        <td key={s} title={`${s} : demande ${d ?? "n.d."} (meilleur pays = 100) · offre ${o ? Math.round(o) : "n.d."} pour 1 000 dév.`}>
          {d ?? "n.d."} · {o ? Math.round(o) : "n.d."}
        </td>
      );
    });

  const demandCountries = study ? pick(study.countries, filters.demand.countries) : [];
  const supplyCountries = study ? pick(study.countries, filters.supply.countries) : [];

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
        <MarketTabs current="etudes" />
        <div className="mk-head">
          <h1>Études de marché</h1>
          {studies.length > 0 && (
            <select value={studyId} onChange={(e) => setStudyId(e.target.value)} aria-label="Étude">
              {studies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <p className="mk-empty">{error}</p>}
        {!error && studies.length === 0 && (
          <p className="mk-empty">Aucune étude pour l&apos;instant : elles sont ajoutées par le script de collecte (POST /api/market).</p>
        )}

        {study && (
          <>
            <section className="mk-card">
              <div className="mk-card-head">
                <h2>Demande : intérêt de recherche par compétence et par pays</h2>
                <div className="mk-toggle" role="group" aria-label="Mode d'affichage">
                  <button type="button" className={mode === "relative" ? "active" : ""} onClick={() => setMode("relative")}>
                    Meilleur pays = 100
                  </button>
                  <button type="button" className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>
                    Indice Google brut
                  </button>
                </div>
              </div>
              {filtersFor("demand")}
              <p className="mk-help">
                Google Trends, 12 derniers mois, par sujet (pas par mot). Une ligne compare les pays entre eux pour une
                compétence ; ne pas comparer deux lignes.
              </p>
              <div className="mk-scroll">
                <table className="mk-matrix">
                  {countryHead(demandCountries)}
                  <tbody>
                    {familiesFor(filters.demand.skills).map(([f, skills]) => (
                      <Fragment key={f}>
                        {grouped && (
                          <tr className="mk-family">
                            <th colSpan={demandCountries.length + 1}>{f}</th>
                          </tr>
                        )}
                        {skills.map((skill) => (
                          <tr key={skill}>
                            <th title={study.topics?.[skill]}>{skill}</th>
                            {demandCountries.map((c) => {
                              const v = cell(skill, c);
                              return (
                                <td key={c} style={heat(mode === "relative" ? v : v === undefined ? undefined : Math.min(100, v * 2))}>
                                  {v ?? <span className="mk-na">n.d.</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="mk-own">
                      <th>Notre taux de réponse</th>
                      {demandCountries.map((c) => {
                        const r = replyRate.get(c);
                        const ok = r && r.sent >= MIN_CONTACTED;
                        return (
                          <td key={c} title={r ? `${r.replied} réponse(s) sur ${r.sent} prospects contactés` : "Aucun prospect contacté"}>
                            {ok ? `${Math.round((r.replied / r.sent) * 100)} %` : <span className="mk-na">{r ? `${r.sent} env.` : "—"}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mk-help">
                Dernière ligne : calculée en direct depuis la prospection (affichée à partir de {MIN_CONTACTED} prospects
                contactés par pays).
              </p>
            </section>

            {study.supply && (
              <section className="mk-card">
                <div className="mk-card-head">
                  <h2>Offre : développeurs par compétence et par pays</h2>
                  <div className="mk-toggle" role="group" aria-label="Mesure de l'offre">
                    <button type="button" className={supplyMode === "gap" ? "active" : ""} onClick={() => setSupplyMode("gap")}>
                      Demande ÷ offre
                    </button>
                    <button type="button" className={supplyMode === "density" ? "active" : ""} onClick={() => setSupplyMode("density")}>
                      Pour 1 000 dév.
                    </button>
                    <button type="button" className={supplyMode === "count" ? "active" : ""} onClick={() => setSupplyMode("count")}>
                      Nombre
                    </button>
                  </div>
                </div>
                {filtersFor("supply", { onlySkills: hasSupply })}
                <p className="mk-help">
                  {supplyMode === "gap"
                    ? "Au-dessus de 1 (orange) : le pays recherche la compétence plus qu'il n'a de développeurs pour elle, comparé aux autres pays ; c'est là qu'un prestataire à distance a le plus de place. En dessous de 1 (gris) : l'offre locale est abondante."
                    : supplyMode === "density"
                      ? "Développeurs actifs sur GitHub qui utilisent le langage de la compétence, pour 1 000 développeurs du pays : la spécialisation du pays."
                      : "Développeurs actifs sur GitHub ayant poussé du code dans le langage de la compétence ce trimestre."}{" "}
                  Source : GitHub Innovation Graph ({study.supply.period}). Le langage mesuré s&apos;affiche au survol du nom.
                </p>
                <div className="mk-scroll">
                  <table className="mk-matrix">
                    {countryHead(supplyCountries)}
                    <tbody>
                      <tr className="mk-own">
                        <th>Développeurs actifs</th>
                        {supplyCountries.map((c) => (
                          <td key={c}>{study.supply?.developers[c] ? compact(study.supply.developers[c]) : <span className="mk-na">n.d.</span>}</td>
                        ))}
                      </tr>
                      {familiesFor(filters.supply.skills).map(([f, skills]) => {
                        const measured = skills.filter(hasSupply);
                        if (measured.length === 0) return null;
                        return (
                          <Fragment key={f}>
                            {grouped && (
                              <tr className="mk-family">
                                <th colSpan={supplyCountries.length + 1}>{f}</th>
                              </tr>
                            )}
                            {measured.map((skill) => {
                              const best = maxDensity(skill);
                              return (
                                <tr key={skill}>
                                  <th title={`Mesuré par : ${study.supply?.skillLanguages[skill].join(" + ")}`}>{skill}</th>
                                  {supplyCountries.map((c) => {
                                    if (supplyMode === "gap") {
                                      const r = gap(skill, c);
                                      return (
                                        <td key={c} style={gapStyle(r)}>
                                          {r === undefined ? <span className="mk-na">n.d.</span> : r.toFixed(1).replace(".", ",")}
                                        </td>
                                      );
                                    }
                                    const d = supplyDensity(skill, c);
                                    const n = supplyCount(skill, c);
                                    return (
                                      <td key={c} style={heat(d && best ? (d / best) * 100 : undefined, "27, 175, 122")}>
                                        {n === undefined ? (
                                          <span className="mk-na">n.d.</span>
                                        ) : supplyMode === "density" ? (
                                          Math.round(d ?? 0)
                                        ) : (
                                          compact(n)
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mk-help">
                  Sans mesure de l&apos;offre (pas de langage propre) : cloud, cybersécurité, Power BI, SAP, test, design et
                  gestion de projet.
                </p>
              </section>
            )}

            {study.vsAnchor && (
              <section className="mk-card">
                <div className="mk-card-head">
                  <h2>Profils les plus recherchés par pays</h2>
                </div>
                <div className="mk-filters">
                  <MultiSelect
                    label="Pays"
                    options={countryOptions.filter((o) => Object.values(study.vsAnchor ?? {}).some((row) => (row[o.value] ?? 0) > 0))}
                    selected={filters.ranking.countries}
                    onChange={setFilter("ranking", "countries")}
                  />
                  <MultiSelect
                    label="Compétences"
                    options={skillOptions((s) => !!study.vsAnchor?.[s])}
                    selected={filters.ranking.skills}
                    onChange={setFilter("ranking", "skills")}
                  />
                </div>
                <p className="mk-help">
                  {filters.ranking.skills.length
                    ? "Les compétences choisies"
                    : "Les 15 profils les plus recherchés"}{" "}
                  {rankCountries.length === 1
                    ? `en ${countryLabel(rankCountries[0])}`
                    : `en moyenne sur ${rankCountries.length} pays`}
                  , comparés entre eux (le plus recherché = 100), grâce à un sujet de référence ({study.anchor ?? "React"})
                  mesuré dans chaque requête.
                </p>
                {ranking.length === 0 && <p className="mk-empty">Aucune donnée pour cette sélection.</p>}
                {ranking.map((r) => (
                  <div className="mk-bar mk-rank" key={r.skill}>
                    <span title={study.topics?.[r.skill]}>{r.skill}</span>
                    <div>
                      <i style={{ width: `${Math.max(1, r.pct)}%` }} />
                    </div>
                    <b>{r.pct}</b>
                    <em>{familyOf(r.skill)}</em>
                  </div>
                ))}
              </section>
            )}

            <WorkConditions study={study} families={families} countryOptions={countryOptions} />

            <div className="mk-grid">
              <section className="mk-card">
                <h2>Pays en tête par compétence</h2>
                {filtersFor("leaders")}
                {familiesFor(filters.leaders.skills)
                  .flatMap(([, skills]) => skills)
                  .map((skill) => (
                    <div className="mk-leader" key={skill}>
                      <b>{skill}</b>
                      <span>
                        {leaders(skill, pick(study.countries, filters.leaders.countries))
                          .map((c) => countryLabel(c))
                          .join(" · ") || "n.d."}
                      </span>
                    </div>
                  ))}
              </section>

              <section className="mk-card">
                <h2>Indicateurs officiels (Eurostat)</h2>
                {filtersFor("official")}
                <div className="mk-scroll">
                <table className="mk-table">
                  <thead>
                    <tr>
                      <th>Pays</th>
                      <th>Spécialistes TIC (% de l&apos;emploi)</th>
                      <th>Spécialistes TIC (milliers)</th>
                      <th>Postes TIC difficiles à pourvoir</th>
                      {skillHead("official")}
                    </tr>
                  </thead>
                  <tbody>
                    {[...pick(study.countries, filters.official.countries), "EU27_2020"]
                      .filter((c) => study.eurostat?.ict_share?.[c] || study.eurostat?.hard_to_fill?.[c])
                      .map((c) => {
                        const ict = study.eurostat?.ict_share?.[c];
                        const ths = study.supply?.ictThousands?.[c];
                        const htf = study.eurostat?.hard_to_fill?.[c];
                        return (
                          <tr key={c}>
                            <td>{c === "EU27_2020" ? "Moyenne UE" : countryLabel(c)}</td>
                            <td>{ict ? `${ict.value} % (${ict.year})` : "n.d."}</td>
                            <td>{ths ? Math.round(ths.value).toLocaleString("fr-FR") : "n.d."}</td>
                            <td>{htf ? `${Math.round(htf.value)} % (${htf.year})` : "n.d."}</td>
                            {skillCells("official", c)}
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                </div>
                <p className="mk-help">
                  « Difficiles à pourvoir » : part des entreprises ayant recruté des spécialistes TIC qui ont eu du mal à
                  trouver. Hors UE (Canada, Australie, Nouvelle-Zélande, Singapour) : sources nationales à ajouter. Eurostat
                  ne détaille pas par compétence : choisir des compétences ajoute leur demande (meilleur pays = 100) et leur
                  offre (développeurs pour 1 000) dans chaque pays.
                </p>
              </section>

              {study.stores && (
                <section className="mk-card">
                  <h2>Taille du marché WooCommerce (boutiques)</h2>
                  {filtersFor("stores")}
                  {Object.entries(study.stores)
                    .filter(([c, n]) => n && pick([c], filters.stores.countries).length > 0)
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .map(([c, n]) => (
                      <Fragment key={c}>
                        <div className="mk-bar">
                          <span>{countryLabel(c)}</span>
                          <div>
                            <i style={{ width: `${Math.max(1, ((n ?? 0) / storesMax) * 100)}%` }} />
                          </div>
                          <b>{(n ?? 0).toLocaleString("fr-FR")}</b>
                        </div>
                        {chosen("stores").length > 0 && (
                          <div className="mk-bar-skills">
                            {chosen("stores").map((s) => {
                              const d = cellRelative(s, c);
                              const o = supplyDensity(s, c);
                              return (
                                <span key={s}>
                                  {s} : demande {d ?? "n.d."} · offre {o ? Math.round(o) : "n.d."}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </Fragment>
                    ))}
                  {chosen("stores").length > 0 && (
                    <p className="mk-help">Demande : meilleur pays = 100 ; offre : développeurs pour 1 000 développeurs du pays.</p>
                  )}
                </section>
              )}

              <section className="mk-card">
                <h2>Sources et méthode</h2>
                <ul className="mk-sources">
                  {study.sources.map((s) => (
                    <li key={s.id}>
                      <a href={s.url} target="_blank" rel="noreferrer">
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mk-help">Collecte du {new Date(study.collectedAt).toLocaleDateString("fr-FR")}.</p>
                {study.notes && <p className="mk-help">{study.notes}</p>}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
