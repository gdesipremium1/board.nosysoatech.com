"use client";

import { Fragment, useState } from "react";
import type { DevCounts, DevProfile, MarketStudy, Trend } from "@/lib/market";
import { countryLabel } from "@/lib/prospectionShared";
import MultiSelect, { pick, type Option } from "./MultiSelect";

// Working conditions: what employers offer (job ads), what the official
// statistics say, and how developers actually work, by country and by skill.
// Every table has a country filter and a skill filter. Where the source only
// has countries (Indeed, Eurostat, OECD), choosing skills adds, for those
// skills, how their developers work in the same countries (survey).

const ARRANGEMENTS = [
  { key: "remote", label: "Full remote", color: "#1baf7a" },
  { key: "hybridFlex", label: "Hybride, plutôt à distance", color: "#2a78d6" },
  { key: "hybridOnsite", label: "Hybride, plutôt sur site", color: "#eda100" },
  { key: "onsite", label: "Sur site", color: "#898781" },
] as const;

const MIN_N = 30; // below this, a survey breakdown is too thin to read

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "n.d." : `${Math.round(v)} %`;
}

// Sums raw counts (several countries and/or skills) into percentages. A
// developer using several of the summed skills counts once per skill.
function profileFromCounts(list: DevCounts[]): DevProfile | null {
  if (list.length === 0) return null;
  const n = list.reduce((s, c) => s + c.n, 0);
  const remoteN = list.reduce((s, c) => s + c.remoteN, 0);
  const share = (v: number, d: number) => (d ? Math.round((v / d) * 1000) / 10 : null);
  const sum = (part: "remote" | "status", key: string) =>
    list.reduce((s, c) => s + ((c[part] as Record<string, number | undefined>)[key] ?? 0), 0);
  return {
    n,
    remote: {
      remote: share(sum("remote", "remote"), remoteN),
      hybridFlex: share(sum("remote", "hybridFlex"), remoteN),
      hybridOnsite: share(sum("remote", "hybridOnsite"), remoteN),
      onsite: share(sum("remote", "onsite"), remoteN),
    },
    status: {
      employed: share(sum("status", "employed"), n),
      freelance: share(sum("status", "freelance"), n),
      student: share(sum("status", "student"), n),
      workStudy: share(sum("status", "workStudy"), n),
      partTime: share(sum("status", "partTime"), n),
    },
  };
}

function delta(t: Trend | null | undefined) {
  if (!t || t.yearAgo === null) return null;
  const d = t.value - t.yearAgo;
  return (
    <small className={d >= 0 ? "mk-up" : "mk-down"}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1).replace(".", ",")} pt
    </small>
  );
}

function Split({ p }: { p: DevProfile }) {
  return (
    <div className="mk-split" title={ARRANGEMENTS.map((a) => `${a.label} : ${pct(p.remote[a.key])}`).join("\n")}>
      {ARRANGEMENTS.map((a) =>
        p.remote[a.key] ? <i key={a.key} style={{ flex: p.remote[a.key] ?? 0, background: a.color }} /> : null,
      )}
    </div>
  );
}

type TableId = "postings" | "devCountry" | "devSkill" | "official";
type Filter = { countries: string[]; skills: string[] };
const EMPTY: Filter = { countries: [], skills: [] };

export default function WorkConditions({
  study,
  families,
  countryOptions,
}: {
  study: MarketStudy;
  families: [string, string[]][];
  countryOptions: Option[];
}) {
  const work = study.work;
  const [filters, setFilters] = useState<Record<TableId, Filter>>({
    postings: EMPTY,
    devCountry: EMPTY,
    devSkill: EMPTY,
    official: EMPTY,
  });
  if (!work) return null;

  const setFilter = (table: TableId, key: keyof Filter) => (values: string[]) =>
    setFilters((prev) => ({ ...prev, [table]: { ...prev[table], [key]: values } }));

  const grouped = families.length > 1;
  const devs = work.developers;
  const bySkill = devs?.bySkill ?? {};
  const counts = devs?.counts ?? {};
  const skillOptions: Option[] = families.flatMap(([f, skills]) =>
    skills.filter((s) => bySkill[s]).map((s) => ({ value: s, label: s, group: grouped ? f : undefined })),
  );
  // Survey profile for some countries and skills (empty = all).
  const profile = (countries: string[], skills: string[]): DevProfile | null =>
    profileFromCounts(
      countries.flatMap((c) =>
        (skills.length ? skills : Object.keys(counts[c] ?? {})).map((s) => counts[c]?.[s]).filter((x): x is DevCounts => !!x),
      ),
    );
  const chosenSkills = (table: TableId) => pick(skillOptions.map((o) => o.value), filters[table].skills);
  const skillFilterActive = (table: TableId) => filters[table].skills.length > 0;

  const filterBar = (table: TableId, countryOpts: Option[]) => (
    <div className="mk-filters">
      <MultiSelect label="Pays" options={countryOpts} selected={filters[table].countries} onChange={setFilter(table, "countries")} />
      {skillOptions.length > 0 && (
        <MultiSelect label="Compétences" options={skillOptions} selected={filters[table].skills} onChange={setFilter(table, "skills")} />
      )}
    </div>
  );

  // Extra columns for the country-only tables: how the developers of each
  // chosen skill work in that country.
  const skillColumnsHead = (table: TableId) =>
    skillFilterActive(table)
      ? chosenSkills(table).map((s) => (
          <th key={s} title={`Développeurs ${s} : full remote / freelance (sondage)`}>
            {s}
            <br />
            <small>remote · freelance</small>
          </th>
        ))
      : null;
  const skillColumnsCells = (table: TableId, country: string) =>
    skillFilterActive(table)
      ? chosenSkills(table).map((s) => {
          const p = profile([country], [s]);
          return (
            <td key={s} className={p && p.n < MIN_N ? "mk-thin" : undefined} title={p ? `${p.n} réponses` : "Aucune réponse"}>
              {p ? `${pct(p.remote.remote)} · ${pct(p.status.freelance)}` : "n.d."}
            </td>
          );
        })
      : null;

  const postCountriesAll = study.countries.filter((c) => work.postings?.[c]);
  const officialAll = [...study.countries, "EU27_2020"].filter(
    (c) => work.wfh?.employees?.[c] || work.partTime?.[c] || work.trainingContracts?.[c],
  );
  const officialOptions = officialAll.map((c) => ({ value: c, label: c === "EU27_2020" ? "Moyenne UE" : countryLabel(c) }));

  const legend = (
    <div className="mk-legend">
      {ARRANGEMENTS.map((a) => (
        <span key={a.key}>
          <i style={{ background: a.color }} />
          {a.label}
        </span>
      ))}
    </div>
  );

  const devRow = (label: string, p: DevProfile, title?: string) => {
    const thin = p.n < MIN_N;
    return (
      <tr key={label} className={thin ? "mk-thin" : undefined}>
        <th title={title}>{label}</th>
        <td className="mk-split-cell">
          <Split p={p} />
        </td>
        <td>{pct(p.remote.remote)}</td>
        <td>{pct(p.status.freelance)}</td>
        <td>{pct(p.status.workStudy)}</td>
        <td>{pct(p.status.partTime)}</td>
        <td className="mk-n" title={thin ? "Échantillon trop faible : à lire avec prudence" : undefined}>
          {p.n}
          {thin ? " ⚠" : ""}
        </td>
      </tr>
    );
  };

  const devHead = (first: string) => (
    <thead>
      <tr>
        <th>{first}</th>
        <th>Situation de travail</th>
        <th>Full remote</th>
        <th>Freelance</th>
        <th>Alternance</th>
        <th>Temps partiel</th>
        <th>Réponses</th>
      </tr>
    </thead>
  );

  return (
    <>
      <h2 className="mk-section">Conditions de travail : sur site, hybride, full remote · temps plein, temps partiel, alternance</h2>

      {work.postings && postCountriesAll.length > 0 && (
        <section className="mk-card">
          <h2>Offres d&apos;emploi : télétravail ou hybride proposé</h2>
          {filterBar("postings", countryOptions.filter((o) => postCountriesAll.includes(o.value)))}
          <p className="mk-help">
            Part des offres Indeed qui proposent du télétravail ou de l&apos;hybride (Indeed ne sépare pas les deux), et part
            des recherches des candidats qui le demandent. Variation sur un an en petit. Pays suivis par Indeed : Australie,
            Canada, France, Irlande. Indeed ne détaille pas par compétence : choisir des compétences ajoute, pour chacune,
            la part de ses développeurs en full remote et en freelance dans le pays (sondage).
          </p>
          <div className="mk-scroll">
            <table className="mk-table">
              <thead>
                <tr>
                  <th>Pays</th>
                  <th>Tous métiers</th>
                  <th>Développement logiciel</th>
                  <th>Informatique</th>
                  <th>Recherches des candidats</th>
                  {skillColumnsHead("postings")}
                </tr>
              </thead>
              <tbody>
                {pick(postCountriesAll, filters.postings.countries).map((c) => {
                  const p = work.postings![c];
                  return (
                    <tr key={c}>
                      <td>{countryLabel(c)}</td>
                      <td>
                        {pct(p.all.value)} {delta(p.all)}
                      </td>
                      <td>
                        <b>{pct(p.software?.value)}</b> {delta(p.software)}
                      </td>
                      <td>
                        {pct(p.it?.value)} {delta(p.it)}
                      </td>
                      <td>
                        {p.searches ? `${p.searches.value.toFixed(1).replace(".", ",")} %` : "n.d."} {delta(p.searches)}
                      </td>
                      {skillColumnsCells("postings", c)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mk-help">Données au {new Date(work.postings[postCountriesAll[0]].all.date).toLocaleDateString("fr-FR")}.</p>
        </section>
      )}

      {devs && (
        <section className="mk-card">
          <h2>Prestataires : comment travaillent les développeurs, par pays</h2>
          {filterBar("devCountry", countryOptions)}
          {legend}
          <div className="mk-scroll">
            <table className="mk-table mk-dev">
              {devHead("Pays")}
              <tbody>
                {pick(study.countries, filters.devCountry.countries).map((c) => {
                  const p = skillFilterActive("devCountry") ? profile([c], chosenSkills("devCountry")) : devs.byCountry[c];
                  return p ? devRow(countryLabel(c), p) : null;
                })}
              </tbody>
            </table>
          </div>
          <p className="mk-help">
            Stack Overflow Developer Survey 2025. Situation réelle des développeurs (pas une préférence)
            {skillFilterActive("devCountry") ? ", limitée aux développeurs des compétences choisies" : ""}. Freelance :
            indépendants et auto-entrepreneurs. Alternance : en emploi et en formation en même temps. Temps partiel : en
            emploi, moins de 30 h de travail rémunéré par semaine. ⚠ moins de {MIN_N} réponses.
          </p>
        </section>
      )}

      {devs && skillOptions.length > 0 && (
        <section className="mk-card">
          <h2>Prestataires : comment travaillent les développeurs, par compétence</h2>
          {filterBar("devSkill", countryOptions)}
          {legend}
          <div className="mk-scroll">
            <table className="mk-table mk-dev">
              {devHead("Compétence")}
              <tbody>
                {families.map(([f, skills]) => {
                  const shown = pick(skills.filter((s) => bySkill[s]), filters.devSkill.skills);
                  const rows = shown
                    .map((s) => ({
                      s,
                      p: filters.devSkill.countries.length ? profile(pick(study.countries, filters.devSkill.countries), [s]) : bySkill[s],
                    }))
                    .filter((r): r is { s: string; p: DevProfile } => !!r.p);
                  if (rows.length === 0) return null;
                  return (
                    <Fragment key={f}>
                      {grouped && (
                        <tr className="mk-family">
                          <th colSpan={7}>{f}</th>
                        </tr>
                      )}
                      {rows.map(({ s, p }) => devRow(s, p, `Mesuré par : ${bySkill[s].measuredBy}`))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mk-help">
            {filters.devSkill.countries.length ? "Réponses des pays choisis" : devs.scope}, regroupées pour avoir des
            échantillons suffisants. Le critère retenu pour chaque compétence s&apos;affiche au survol.
          </p>
        </section>
      )}

      {officialAll.length > 0 && (
        <section className="mk-card">
          <h2>Chiffres officiels : télétravail, temps partiel, alternance</h2>
          {filterBar("official", officialOptions)}
          <div className="mk-scroll">
            <table className="mk-table">
              <thead>
                <tr>
                  <th rowSpan={2}>Pays</th>
                  <th colSpan={3}>Salariés travaillant de chez eux</th>
                  <th colSpan={3}>Indépendants travaillant de chez eux</th>
                  <th colSpan={2}>Temps partiel</th>
                  <th rowSpan={2}>Contrats de formation (15-29 ans)</th>
                  {skillFilterActive("official") && <th colSpan={chosenSkills("official").length}>Développeurs (sondage)</th>}
                </tr>
                <tr>
                  <th>habituellement</th>
                  <th>parfois</th>
                  <th>jamais</th>
                  <th>habituellement</th>
                  <th>parfois</th>
                  <th>jamais</th>
                  <th>tous emplois</th>
                  <th>cadres et ingénieurs</th>
                  {skillColumnsHead("official")}
                </tr>
              </thead>
              <tbody>
                {pick(officialAll, filters.official.countries).map((c) => {
                  const e = work.wfh?.employees?.[c];
                  const s = work.wfh?.selfEmployed?.[c];
                  return (
                    <tr key={c}>
                      <td>{c === "EU27_2020" ? "Moyenne UE" : countryLabel(c)}</td>
                      <td>{pct(e?.usually)}</td>
                      <td>{pct(e?.sometimes)}</td>
                      <td>{pct(e?.never)}</td>
                      <td>{pct(s?.usually)}</td>
                      <td>{pct(s?.sometimes)}</td>
                      <td>{pct(s?.never)}</td>
                      <td>{pct(work.partTime?.[c]?.value)}</td>
                      <td>{pct(work.partTimeProfessionals?.[c]?.value)}</td>
                      <td>{pct(work.trainingContracts?.[c]?.value)}</td>
                      {c === "EU27_2020"
                        ? chosenSkills("official").length && skillFilterActive("official")
                          ? chosenSkills("official").map((sk) => <td key={sk}>—</td>)
                          : null
                        : skillColumnsCells("official", c)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mk-help">
            Eurostat (UE et Suisse) : travail à domicile « habituellement » ≈ surtout à distance, « parfois » ≈ hybride,
            « jamais » = sur site ; temps partiel des professions intellectuelles et scientifiques (dont les développeurs) ;
            contrats temporaires liés à une formation (apprentissage, alternance), en % des salariés de 15 à 29 ans. OCDE :
            temps partiel, tous emplois (y compris Australie, Canada, Nouvelle-Zélande). Les statistiques officielles ne
            détaillent pas par compétence : choisir des compétences ajoute la part de leurs développeurs en full remote et en
            freelance dans chaque pays (sondage).
          </p>
        </section>
      )}
    </>
  );
}
