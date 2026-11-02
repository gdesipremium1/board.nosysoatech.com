"""Conditions de travail : sur site / hybride / full remote, temps plein /
temps partiel / alternance, côté offres (employeurs) et côté prestataires.
Ajoute un bloc « work » à market.json.

Sources :
  Demande (employeurs)
    - Indeed Hiring Lab, Remote Tracker (CC BY 4.0) : part des offres d'emploi
      proposant du télétravail ou de l'hybride, tous métiers et développement
      logiciel / informatique ; part des recherches des candidats qui visent
      le télétravail. Pays couverts : AU, CA, FR, IE.
  Officiel (population en emploi)
    - Eurostat lfsa_ehomp : travail à domicile « habituellement », « parfois »,
      « jamais », pour les salariés et pour les indépendants (UE + Suisse) ;
    - Eurostat lfsa_epgais : temps partiel chez les professions intellectuelles
      et scientifiques (ISCO 2, dont les développeurs) ;
    - Eurostat lfsa_etgar : contrats temporaires liés à une formation
      (apprentissage, alternance), en % des salariés de 15-29 ans ;
    - OCDE DF_FTPT : taux de temps partiel (tous pays de l'OCDE).
  Offre (développeurs)
    - Stack Overflow Developer Survey 2025 (49 000 réponses) : situation de
      travail, statut (salarié, freelance, étudiant), alternance et temps
      partiel, par pays et par compétence.

Usage : python -I work.py  (après collect.py, dans le même dossier).
        SO_CSV=chemin/results.csv pour réutiliser un fichier déjà téléchargé.
"""
import collections
import csv
import io
import json
import os
import urllib.request

csv.field_size_limit(10**8)
UA = {"User-Agent": "Mozilla/5.0 (board.nosysoatech market study)"}


def get(url, timeout=180):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8")


study = json.load(open("market.json", encoding="utf-8"))
COUNTRIES = study["countries"]
work = {"sources": []}

# ---- 1. Indeed Hiring Lab : offres et recherches remote/hybride -------------
RT = "https://raw.githubusercontent.com/hiring-lab/remote-tracker/main/"


def latest_and_year_ago(rows, key):
    """Dernière valeur et valeur un an plus tôt, par clé (pays ou pays+secteur)."""
    out = {}
    by_key = collections.defaultdict(list)
    for r in rows:
        by_key[key(r)].append(r)
    for k, rs in by_key.items():
        rs.sort(key=lambda r: r["date"])
        last = rs[-1]
        year_ago_date = f"{int(last['date'][:4]) - 1}{last['date'][4:]}"
        prev = next((r for r in reversed(rs) if r["date"] <= year_ago_date), None)
        out[k] = {"date": last["date"], "value": round(float(last[list(last)[-1]]), 1),
                  "yearAgo": round(float(prev[list(prev)[-1]]), 1) if prev else None}
    return out


postings = latest_and_year_ago(
    [r for r in csv.DictReader(io.StringIO(get(RT + "remote_postings.csv"))) if r["jobcountry"] in COUNTRIES],
    lambda r: r["jobcountry"])
sector_rows = [r for r in csv.DictReader(io.StringIO(get(RT + "remote_postings_sector.csv", 600)))
               if r["jobcountry"] in COUNTRIES and r["normtitlecategory_consistent"] in ("techsoftware", "techinfo")]
sectors = latest_and_year_ago(sector_rows, lambda r: (r["jobcountry"], r["normtitlecategory_consistent"]))
searches = latest_and_year_ago(
    [r for r in csv.DictReader(io.StringIO(get(RT + "remote_searches.csv"))) if r["jobcountry"] in COUNTRIES],
    lambda r: r["jobcountry"])
work["postings"] = {
    c: {"all": postings[c], "software": sectors.get((c, "techsoftware")), "it": sectors.get((c, "techinfo")),
        "searches": searches.get(c)}
    for c in COUNTRIES if c in postings
}
work["sources"].append({"id": "indeed", "label": "Indeed Hiring Lab, Remote Tracker : offres et recherches télétravail / hybride",
                        "url": "https://github.com/hiring-lab/remote-tracker"})
print("indeed", json.dumps(work["postings"])[:400], flush=True)

# ---- 2. Eurostat ------------------------------------------------------------
EU_GEOS = [c for c in COUNTRIES if c in ("FR", "BE", "CH", "LU", "IE")] + ["EU27_2020"]


def eurostat(ds, params):
    """{geo: {"value", "year"}} pour la dernière année, autres dimensions fixées."""
    q = "&".join(f"{k}={v}" for k, vals in params.items() for v in (vals if isinstance(vals, list) else [vals]))
    data = json.loads(get(f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{ds}?format=JSON&lang=EN&{q}"))
    ids, sizes, dims = data["id"], data["size"], data["dimension"]
    year = list(dims["time"]["category"]["index"].keys())[-1]
    res = {}
    for geo, gi in dims["geo"]["category"]["index"].items():
        pos = 0
        for d, n in zip(ids, sizes):
            pos = pos * n + (gi if d == "geo" else n - 1 if d == "time" else 0)
        v = data["value"].get(str(pos))
        if v is not None:
            res[geo] = {"value": v, "year": year}
    return res


wfh = {}
for status, label in (("SAL", "employees"), ("SELF", "selfEmployed")):
    wfh[label] = {}
    for freq, key in (("USU", "usually"), ("SMT", "sometimes"), ("NVR", "never")):
        for geo, v in eurostat("lfsa_ehomp", {"geo": EU_GEOS, "unit": "PC", "sex": "T", "age": "Y15-64",
                                              "wstatus": status, "frequenc": freq, "lastTimePeriod": 1}).items():
            wfh[label].setdefault(geo, {})[key] = v["value"]
            wfh[label][geo]["year"] = v["year"]
work["wfh"] = wfh

# Temps partiel chez les ISCO 2 (milliers -> %).
pt = eurostat("lfsa_epgais", {"geo": EU_GEOS, "unit": "THS_PER", "sex": "T", "age": "Y15-64", "isco08": "OC2",
                              "worktime": "PT", "lastTimePeriod": 1})
tot = eurostat("lfsa_epgais", {"geo": EU_GEOS, "unit": "THS_PER", "sex": "T", "age": "Y15-64", "isco08": "OC2",
                               "worktime": "TOTAL", "lastTimePeriod": 1})
work["partTimeProfessionals"] = {g: {"value": round(pt[g]["value"] / tot[g]["value"] * 100, 1), "year": pt[g]["year"]}
                                 for g in pt if g in tot and tot[g]["value"]}
# Contrats temporaires liés à une formation (alternance, apprentissage).
work["trainingContracts"] = eurostat("lfsa_etgar", {"geo": EU_GEOS, "unit": "PC_SAL", "sex": "T", "age": "Y15-29",
                                                    "reason": "EDUC_TNG", "lastTimePeriod": 1})
work["sources"].append({"id": "eurostat-work", "label": "Eurostat : lfsa_ehomp (travail à domicile), lfsa_epgais (temps partiel ISCO 2), lfsa_etgar (contrats de formation)",
                        "url": "https://ec.europa.eu/eurostat"})
print("eurostat", json.dumps({k: work[k] for k in ("partTimeProfessionals", "trainingContracts")})[:400], flush=True)

# ---- 3. OCDE : taux de temps partiel -----------------------------------------
ISO3 = {"FR": "FRA", "BE": "BEL", "CH": "CHE", "LU": "LUX", "CA": "CAN", "IE": "IRL", "AU": "AUS", "NZ": "NZL"}
# Incidence (part des emplois à temps partiel), salariés, tous âges et sexes.
oecd = get("https://sdmx.oecd.org/public/rest/data/OECD.ELS.SAE,DSD_FTPT@DF_FTPT_COMMON_INC,1.0/" + "+".join(ISO3.values())
           + "..........?startPeriod=2022&dimensionAtObservation=AllDimensions&format=csvfilewithlabels")
part_time = {}
back = {v: k for k, v in ISO3.items()}
for r in csv.DictReader(io.StringIO(oecd)):
    if (r["MEASURE"] == "EMP" and r["WORK_TIME_ARNGMNT"] == "PT" and r["UNIT_MEASURE"] == "PT_POP_SUB"
            and r["SEX"] == "_T" and r["AGE"] == "_T" and r["METHODOLOGY"] == "OECD_DEF" and r["OBS_VALUE"]):
        c = back[r["REF_AREA"]]
        if c not in part_time or r["TIME_PERIOD"] > part_time[c]["year"]:
            part_time[c] = {"value": round(float(r["OBS_VALUE"]), 1), "year": r["TIME_PERIOD"]}
work["partTime"] = part_time
work["sources"].append({"id": "oecd", "label": "OCDE : emploi à temps partiel (définition harmonisée)", "url": "https://data-explorer.oecd.org"})
print("oecd", part_time, flush=True)

# ---- 4. Stack Overflow Developer Survey 2025 ---------------------------------
SO_COUNTRIES = {"France": "FR", "Belgium": "BE", "Switzerland": "CH", "Luxembourg": "LU", "Monaco": "MC",
                "Canada": "CA", "Ireland": "IE", "Australia": "AU", "New Zealand": "NZ", "Singapore": "SG"}
# Compétence -> (colonne du sondage, valeur). DevType pour les métiers sans techno propre.
SKILL_SO = {
    "PHP": ("LanguageHaveWorkedWith", "PHP"), "Symfony": ("WebframeHaveWorkedWith", "Symfony"),
    "Laravel": ("WebframeHaveWorkedWith", "Laravel"), "Python": ("LanguageHaveWorkedWith", "Python"),
    "Django": ("WebframeHaveWorkedWith", "Django"), "Node.js": ("WebframeHaveWorkedWith", "Node.js"),
    "Java": ("LanguageHaveWorkedWith", "Java"), "Spring Framework": ("WebframeHaveWorkedWith", "Spring Boot"),
    ".NET": ("WebframeHaveWorkedWith", "ASP.NET Core"), "Ruby on Rails": ("WebframeHaveWorkedWith", "Ruby on Rails"),
    "Go": ("LanguageHaveWorkedWith", "Go"), "React": ("WebframeHaveWorkedWith", "React"),
    "Angular": ("WebframeHaveWorkedWith", "Angular"), "Vue.js": ("WebframeHaveWorkedWith", "Vue.js"),
    "TypeScript": ("LanguageHaveWorkedWith", "TypeScript"), "Next.js": ("WebframeHaveWorkedWith", "Next.js"),
    "Flutter": ("LanguageHaveWorkedWith", "Dart"), "Swift": ("LanguageHaveWorkedWith", "Swift"),
    "Kotlin": ("LanguageHaveWorkedWith", "Kotlin"), "WordPress": ("WebframeHaveWorkedWith", "WordPress"),
    "WooCommerce": ("WebframeHaveWorkedWith", "WordPress"), "Drupal": ("WebframeHaveWorkedWith", "Drupal"),
    "SQL": ("LanguageHaveWorkedWith", "SQL"),
    "Amazon Web Services": ("PlatformHaveWorkedWith", "Amazon Web Services (AWS)"),
    "Microsoft Azure": ("PlatformHaveWorkedWith", "Microsoft Azure"),
    "Google Cloud Platform": ("PlatformHaveWorkedWith", "Google Cloud"),
    "Kubernetes": ("PlatformHaveWorkedWith", "Kubernetes"), "Docker": ("PlatformHaveWorkedWith", "Docker"),
    "Terraform": ("PlatformHaveWorkedWith", "Terraform"),
    "Machine learning": ("DevType", "Data scientist"), "Data engineering": ("DevType", "Data engineer"),
    "Power BI": ("DevType", "Data or business analyst"),
    "Computer security": ("DevType", "security"), "Penetration test": ("DevType", "security"),
    "Software testing": ("DevType", "QA or test"), "Selenium": ("DevType", "QA or test"),
    "User experience design": ("DevType", "Designer"), "Figma": ("DevType", "Designer"),
    "Scrum": ("DevType", "Project manager"), "Product owner": ("DevType", "Product manager"),
}
REMOTE = {
    "Remote": "remote",
    "Hybrid (some in-person, leans heavy to flexibility)": "hybridFlex",
    "Your choice (very flexible, you can come in when you want or just as needed)": "hybridFlex",
    "Hybrid (some remote, leans heavy to in-person)": "hybridOnsite",
    "In-person": "onsite",
}


def new_acc():
    return {"n": 0, "remoteN": 0, "remote": collections.Counter(), "status": collections.Counter()}


def add(acc, row):
    acc["n"] += 1
    rw = REMOTE.get(row.get("RemoteWork", ""))
    if rw:
        acc["remoteN"] += 1
        acc["remote"][rw] += 1
    emp = row.get("Employment", "")
    addl = row.get("EmploymentAddl", "")
    working = "Employed" in emp or "Independent contractor" in emp
    if "Employed" in emp:
        acc["status"]["employed"] += 1
    if "Independent contractor" in emp:
        acc["status"]["freelance"] += 1
    if "Student" in emp:
        acc["status"]["student"] += 1
    # Alternance : en emploi et en formation en même temps.
    if working and "Attending school" in addl:
        acc["status"]["workStudy"] += 1
    # Temps partiel : en emploi et moins de 30 h de travail rémunéré par semaine.
    if working and "Engaged in paid work (" in addl:
        acc["status"]["partTime"] += 1


def finish(acc):
    pct = lambda n, d: round(n / d * 100, 1) if d else None
    return {"n": acc["n"],
            "remote": {k: pct(acc["remote"][k], acc["remoteN"]) for k in ("remote", "hybridFlex", "hybridOnsite", "onsite")},
            "status": {k: pct(acc["status"][k], acc["n"]) for k in ("employed", "freelance", "student", "workStudy", "partTime")}}


def raw(acc):
    """Comptes bruts (et non %) : la page les additionne selon les filtres."""
    return {"n": acc["n"], "remoteN": acc["remoteN"], "remote": dict(acc["remote"]), "status": dict(acc["status"])}


so_path = os.environ.get("SO_CSV")
if not so_path:
    so_path = "so_results_2025.csv"
    if not os.path.exists(so_path):
        urllib.request.urlretrieve("https://github.com/StackExchange/Survey/raw/refs/heads/main/packages/archive/2025/results.csv", so_path)

by_country = collections.defaultdict(new_acc)
by_skill = collections.defaultdict(new_acc)
by_country_skill = collections.defaultdict(new_acc)
with open(so_path, encoding="utf-8") as f:
    for row in csv.DictReader(f):
        c = SO_COUNTRIES.get(row.get("Country", ""))
        if not c:
            continue
        add(by_country[c], row)
        for skill, (col, val) in SKILL_SO.items():
            cell = row.get(col, "")
            hit = val in cell.split(";") if col != "DevType" else val.lower() in cell.lower()
            if hit:
                add(by_skill[skill], row)
                add(by_country_skill[(c, skill)], row)

counts = {}
for (c, s), a in by_country_skill.items():
    if s in study["skills"]:
        counts.setdefault(c, {})[s] = raw(a)

work["developers"] = {
    "byCountry": {c: finish(a) for c, a in by_country.items()},
    "bySkill": {s: {**finish(a), "measuredBy": SKILL_SO[s][1]} for s, a in by_skill.items() if s in study["skills"]},
    # Pays x compétence en comptes bruts, pour filtrer sur les deux à la fois.
    "counts": counts,
    "scope": "Réponses des 10 pays de l'étude",
}
work["sources"].append({"id": "so2025", "label": "Stack Overflow Developer Survey 2025 : situation de travail et statut des développeurs",
                        "url": "https://survey.stackoverflow.co/2025"})
print("SO pays", {c: v["n"] for c, v in work["developers"]["byCountry"].items()}, flush=True)

study["work"] = work
study["sources"] = [s for s in study["sources"] if s["id"] not in {x["id"] for x in work["sources"]}] + work["sources"]
json.dump(study, open("market.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("OK")
