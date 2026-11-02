"""Collecte d'une étude de marché : Google Trends (sujets), Eurostat, StoreCensus.

Sortie : market.json, à envoyer au board (POST /api/market, voir docs/MARCHE.md).

Deux mesures Google Trends par compétence :
  - trends   : indice 0-100 par pays, relatif au pays où l'intérêt est le plus
               fort -> compare les PAYS pour une compétence ;
  - vsAnchor : intérêt rapporté à un sujet de référence (React) mesuré dans la
               même requête -> compare les COMPÉTENCES au sein d'un pays.
"""
import datetime
import json
import os
import re
import time
import urllib.request

from pytrends.request import TrendReq

COUNTRIES = ["FR", "BE", "CH", "LU", "MC", "CA", "IE", "AU", "NZ", "SG"]

# Familles de profils (ordre d'affichage) -> compétences.
FAMILIES = {
    "Back-end": ["PHP", "Symfony", "Laravel", "Python", "Django", "Node.js", "Java", "Spring Framework", ".NET", "Ruby on Rails", "Go"],
    "Front-end": ["React", "Angular", "Vue.js", "TypeScript", "Next.js"],
    "Mobile": ["React Native", "Flutter", "Swift", "Kotlin"],
    "E-commerce / CMS": ["WordPress", "WooCommerce", "Magento", "PrestaShop", "Shopify", "Drupal"],
    "Data / IA": ["SQL", "Power BI", "Machine learning", "Data engineering", "Apache Spark"],
    "Cloud / DevOps": ["Amazon Web Services", "Microsoft Azure", "Google Cloud Platform", "Kubernetes", "Docker", "Terraform"],
    "Cybersécurité": ["Computer security", "Penetration test"],
    "ERP / CRM": ["SAP", "Salesforce", "Odoo", "Microsoft Dynamics 365"],
    "Test / QA": ["Software testing", "Selenium"],
    "Design / UX": ["User experience design", "Figma"],
    "Gestion de projet": ["Scrum", "Product owner"],
}
SKILLS = [s for skills in FAMILIES.values() for s in skills]
ANCHOR = "React"

# Types de suggestions Google à écarter (homonymes : film, groupe, ville...).
BAD_TYPES = ("film", "song", "band", "album", "musician", "singer", "city", "river", "bird", "fruit", "video game",
             "tv", "character", "novel", "book", "actor", "game", "town", "village", "football", "footballer",
             "chemical element", "element", "metal")

# Noms trop ambigus et sans sujet Google utilisable (« Go » donne l'or,
# « Selenium » l'élément chimique, « Swift » la chanteuse ; le sujet Kotlin
# renvoie 0 partout) : on mesure un mot-clé propre au métier à la place.
KEYWORDS = {
    "Go": "golang",
    "Swift": "swiftui",
    "Selenium": "selenium webdriver",
    "Kotlin": "kotlin",
}

# ONLY=Go,Swift : ne recollecte que ces compétences et les fusionne dans le
# market.json existant (après une coupure réseau ou un mauvais sujet).
ONLY = [s.strip() for s in os.environ.get("ONLY", "").split(",") if s.strip()]

STORECENSUS = {"FR": "france", "BE": "belgium", "CH": "switzerland", "LU": "luxembourg", "MC": "monaco",
               "CA": "canada", "IE": "ireland", "AU": "australia", "NZ": "new-zealand", "SG": "singapore"}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode("utf-8")


def with_retry(fn, label):
    for attempt in range(4):
        try:
            return fn()
        except Exception as e:  # 429 de Google Trends le plus souvent
            wait = 60 * (attempt + 1)
            print(f"  {label} : {e.__class__.__name__}, nouvel essai dans {wait} s", flush=True)
            time.sleep(wait)
    print(f"  {label} : abandon", flush=True)
    return None


if ONLY:
    out = json.load(open("market.json", encoding="utf-8"))
    out["skills"], out["families"] = SKILLS, FAMILIES
else:
    out = {"collectedAt": datetime.date.today().isoformat(), "countries": COUNTRIES, "skills": SKILLS,
           "families": FAMILIES, "anchor": ANCHOR, "trends": {}, "vsAnchor": {}, "topics": {},
           "eurostat": {}, "stores": {}, "sources": []}
TARGETS = ONLY or SKILLS

t = TrendReq(hl="en-US", tz=0, timeout=(10, 30))

# 1. Sujet Google (mid) de chaque compétence (la référence en a toujours besoin).
mids = {}
for skill in dict.fromkeys(TARGETS + [ANCHOR]):
    if skill in KEYWORDS:
        mids[skill] = KEYWORDS[skill]
        out["topics"][skill] = f"{KEYWORDS[skill]} (mot-clé)"
        continue
    sugg = with_retry(lambda: t.suggestions(skill), f"suggestions {skill}") or []
    ok = [s for s in sugg if not any(b in (s.get("type") or "").lower() for b in BAD_TYPES)]
    pick = next((s for s in ok if s.get("title", "").lower() == skill.lower()), None)
    if pick is None:
        pick = next((s for s in ok if skill.lower() in s.get("title", "").lower()), None)
    mids[skill] = pick["mid"] if pick else skill
    out["topics"][skill] = f'{pick["title"]} ({pick.get("type", "")})' if pick else f"{skill} (mot-clé)"
    time.sleep(1)
print("sujets :", json.dumps({s: out["topics"][s] for s in mids}, ensure_ascii=False), flush=True)


def by_country(df, col):
    df = df[df["geoCode"].isin(COUNTRIES)]
    return {row["geoCode"]: int(row[col]) for _, row in df.iterrows()}


# 2. Indice par pays, une compétence par requête (compare les pays).
for skill in TARGETS:
    def run():
        t.build_payload([mids[skill]], timeframe="today 12-m", geo="")
        return t.interest_by_region(resolution="COUNTRY", inc_low_vol=True, inc_geo_code=True)
    df = with_retry(run, f"pays {skill}")
    if df is not None:
        out["trends"][skill] = by_country(df, mids[skill])
        print(skill, out["trends"][skill], flush=True)
    time.sleep(6)

# 3. Comparaison entre compétences : lots de 4 + la référence dans chaque
#    requête ; on garde le rapport compétence / référence par pays.
others = [s for s in TARGETS if s != ANCHOR]
for i in range(0, len(others), 4):
    batch = others[i:i + 4]
    def run():
        t.build_payload([mids[ANCHOR]] + [mids[s] for s in batch], timeframe="today 12-m", geo="")
        return t.interest_by_region(resolution="COUNTRY", inc_low_vol=True, inc_geo_code=True)
    df = with_retry(run, f"lot {batch}")
    if df is None:
        continue
    anchor = by_country(df, mids[ANCHOR])
    for s in batch:
        vals = by_country(df, mids[s])
        out["vsAnchor"][s] = {c: round(vals[c] / anchor[c], 3) for c in vals if anchor.get(c)}
    print("lot", batch, flush=True)
    time.sleep(6)
out["vsAnchor"][ANCHOR] = {c: 1.0 for c in COUNTRIES}
if not ONLY:  # en mode complément, sources, Eurostat et boutiques sont déjà là
    out["sources"].append({"id": "trends", "label": "Google Trends (sujets, 12 derniers mois)", "url": "https://trends.google.com"})


    # 4. Eurostat (officiel).
    def jsonstat(ds, params):
        q = "&".join(f"{k}={v}" for k, vals in params.items() for v in (vals if isinstance(vals, list) else [vals]))
        data = json.loads(get(f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{ds}?format=JSON&lang=EN&{q}"))
        ids, sizes = data["id"], data["size"]
        geo_idx = data["dimension"]["geo"]["category"]["index"]
        time_lab = list(data["dimension"]["time"]["category"]["index"].keys())
        res = {}
        for geo, gi in geo_idx.items():
            for ti in range(len(time_lab)):
                pos = 0
                for d, n in zip(ids, sizes):
                    pos = pos * n + (gi if d == "geo" else ti if d == "time" else 0)
                v = data["value"].get(str(pos))
                if v is not None:
                    res[geo] = {"value": v, "year": time_lab[ti]}
        return res


    eu = ["FR", "BE", "LU", "IE", "CH", "EU27_2020"]
    out["eurostat"]["ict_share"] = jsonstat("isoc_sks_itspt", {"geo": eu, "unit": "PC_EMP", "lastTimePeriod": 1})
    out["eurostat"]["hard_to_fill"] = jsonstat("isoc_ske_itrcrn2", {"geo": eu, "indic_is": "E_ITSPVAC2", "unit": "PC_ENT_ITSPRCR2",
                                                                    "nace_r2": "C10-S951_X_K", "size_emp": "GE10", "lastTimePeriod": 1})
    out["sources"].append({"id": "eurostat", "label": "Eurostat : isoc_sks_itspt, isoc_ske_itrcrn2", "url": "https://ec.europa.eu/eurostat"})

    # 5. StoreCensus : boutiques WooCommerce par pays.
    for code, slug in STORECENSUS.items():
        m = re.search(r"([0-9][0-9,]*) WooCommerce stores", get(f"https://www.storecensus.com/woocommerce-stores/country/{slug}"))
        out["stores"][code] = int(m.group(1).replace(",", "")) if m else None
        time.sleep(1)
    out["sources"].append({"id": "storecensus", "label": "StoreCensus : boutiques WooCommerce par pays", "url": "https://www.storecensus.com"})

json.dump(out, open("market.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("OK", len(out["trends"]), "compétences")
