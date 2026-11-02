"""Offre : compétences des prestataires par pays, ajoutées à market.json.

Sources :
  - GitHub Innovation Graph (données ouvertes publiées par GitHub) : nombre de
    développeurs actifs par pays, et nombre de développeurs ayant poussé du
    code par langage et par pays (dernier trimestre publié) ;
  - Eurostat isoc_sks_itspt : spécialistes TIC employés (milliers de personnes).

Chaque compétence est rattachée au langage qui la signale le mieux (Twig pour
Symfony, Blade pour Laravel, Smarty pour PrestaShop...). Les compétences sans
langage propre (cloud, sécurité, UX, gestion de projet) restent sans mesure.

Usage : python -I supply.py  (après collect.py, dans le même dossier)
"""
import csv
import io
import json
import urllib.request

RAW = "https://raw.githubusercontent.com/github/innovationgraph/main/data/"
UA = {"User-Agent": "Mozilla/5.0 (board.nosysoatech market study)"}

SKILL_LANGUAGES = {
    "PHP": ["PHP"], "Symfony": ["Twig"], "Laravel": ["Blade"], "Python": ["Python"], "Django": ["Python"],
    "Node.js": ["JavaScript"], "Java": ["Java"], "Spring Framework": ["Java"], ".NET": ["C#"],
    "Ruby on Rails": ["Ruby"], "Go": ["Go"],
    "React": ["TypeScript"], "Angular": ["TypeScript"], "Vue.js": ["Vue"], "TypeScript": ["TypeScript"],
    "Next.js": ["TypeScript"],
    "React Native": ["TypeScript"], "Flutter": ["Dart"], "Swift": ["Swift"], "Kotlin": ["Kotlin"],
    "WordPress": ["PHP"], "WooCommerce": ["PHP"], "Magento": ["PHP"], "PrestaShop": ["Smarty"],
    "Shopify": ["Liquid"], "Drupal": ["PHP"],
    "SQL": ["PLpgSQL", "TSQL", "PLSQL"], "Machine learning": ["Jupyter Notebook"], "Data engineering": ["Python"],
    "Apache Spark": ["Scala"],
    "Kubernetes": ["Dockerfile"], "Docker": ["Dockerfile"], "Terraform": ["HCL"],
    "Salesforce": ["Apex"], "Odoo": ["Python"], "Microsoft Dynamics 365": ["C#"],
}


def fetch_csv(name):
    req = urllib.request.Request(RAW + name, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        return list(csv.DictReader(io.StringIO(r.read().decode("utf-8"))))


study = json.load(open("market.json", encoding="utf-8"))
countries = set(study["countries"])

# Dernier trimestre publié.
devs_rows = fetch_csv("developers.csv")
latest = max((int(r["year"]), int(r["quarter"])) for r in devs_rows)
period = f"{latest[0]}-T{latest[1]}"
is_latest = lambda r: (int(r["year"]), int(r["quarter"])) == latest

developers = {r["iso2_code"]: int(r["developers"]) for r in devs_rows if is_latest(r) and r["iso2_code"] in countries}

wanted = {lang for langs in SKILL_LANGUAGES.values() for lang in langs}
languages = {}
for r in fetch_csv("languages.csv"):
    if is_latest(r) and r["iso2_code"] in countries and r["language"] in wanted:
        languages.setdefault(r["language"], {})[r["iso2_code"]] = int(r["num_pushers"])

# Eurostat : spécialistes TIC (milliers de personnes), UE + Suisse.
q = "&".join(f"geo={g}" for g in ["FR", "BE", "LU", "IE", "CH"]) + "&unit=THS_PER&lastTimePeriod=1"
with urllib.request.urlopen(f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_sks_itspt?format=JSON&lang=EN&{q}", timeout=60) as r:
    data = json.loads(r.read().decode("utf-8"))
geo_idx = data["dimension"]["geo"]["category"]["index"]
year = list(data["dimension"]["time"]["category"]["index"].keys())[0]
ict_thousands = {g: {"value": data["value"][str(i)], "year": year} for g, i in geo_idx.items() if str(i) in data["value"]}

study["supply"] = {
    "period": period,
    "developers": developers,
    "languages": languages,
    "skillLanguages": {s: langs for s, langs in SKILL_LANGUAGES.items() if s in study["skills"]},
    "ictThousands": ict_thousands,
}
study["sources"] = [s for s in study["sources"] if s["id"] not in ("github", "eurostat-supply")] + [
    {"id": "github", "label": f"GitHub Innovation Graph : développeurs et langages par pays ({period})",
     "url": "https://innovationgraph.github.com"},
    {"id": "eurostat-supply", "label": "Eurostat isoc_sks_itspt : spécialistes TIC employés (milliers)",
     "url": "https://ec.europa.eu/eurostat"},
]
json.dump(study, open("market.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("offre", period, "développeurs :", developers)
print("langages :", {k: len(v) for k, v in languages.items()})
