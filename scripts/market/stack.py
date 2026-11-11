"""Stacks rentables : demande réelle (missions) face à la concurrence (développeurs), dans stack.json.

Sources :
  - ITJobsWatch : missions freelance (contract) publiées au Royaume-Uni sur
    6 mois, même période un an plus tôt, tarif journalier médian. C'est le
    seul relevé public qui compte les missions réelles par technologie ;
  - Stack Overflow Developer Survey 2025 : part des développeurs
    professionnels (monde) qui utilisent chaque technologie = la concurrence.

Ratio = missions sur 6 mois / part des développeurs (en %) : nombre de
missions pour chaque pour cent de développeurs qui pratiquent la techno.
Les plateformes d'éditeur (Salesforce, ServiceNow, Power BI...) ne figurent
pas dans le sondage : missions et tarif seulement, sans ratio.

Usage : SO_CSV=results.csv python -I stack.py   (dans scripts/market)
        puis POST de stack.json sur /api/market/stack (voir docs/MARCHE.md)
"""
import csv
import datetime
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (board.nosysoatech market study)"}
ITJW = "https://www.itjobswatch.co.uk/contracts/uk/{}.do"

# Techno -> (famille, page ITJobsWatch, libellé exact dans le sondage ou None).
TECHS = {
    "Python": ("Langages", "python", "python"),
    "Java": ("Langages", "java", "java"),
    "TypeScript": ("Langages", "typescript", "typescript"),
    "PHP": ("Langages", "php", "php"),
    "Scala": ("Langages", "scala", "scala"),
    "Kotlin": ("Langages", "kotlin", "kotlin"),
    "Swift": ("Langages", "swift", "swift"),
    "Rust": ("Langages", "rust", "rust"),
    "Django": ("Frameworks web", "django", "django"),
    "FastAPI": ("Frameworks web", "fastapi", "fastapi"),
    "Flask": ("Frameworks web", "flask", "flask"),
    "Symfony": ("Frameworks web", "symfony", "symfony"),
    "Laravel": ("Frameworks web", "laravel", "laravel"),
    "Node.js": ("Frameworks web", "node.js", "node.js"),
    "React": ("Frameworks web", "react", "react"),
    "Vue.js": ("Frameworks web", "vue.js", "vue.js"),
    "Next.js": ("Frameworks web", "next.js", "next.js"),
    "Ruby on Rails": ("Frameworks web", "ruby on rails", "ruby on rails"),
    "Flutter": ("Mobile", "flutter", "dart"),
    "React Native": ("Mobile", "react native", None),
    "WordPress": ("CMS / e-commerce", "wordpress", "wordpress"),
    "Drupal": ("CMS / e-commerce", "drupal", "drupal"),
    "Shopify": ("CMS / e-commerce", "shopify", None),
    "Magento": ("CMS / e-commerce", "magento", None),
    "Odoo": ("CMS / e-commerce", "odoo", "odoo"),
    "Databricks": ("Data", "databricks", "databricks sql"),
    "Snowflake": ("Data", "snowflake", "snowflake"),
    "dbt": ("Data", "dbt", None),
    "Apache Spark": ("Data", "apache spark", None),
    "Power BI": ("Data", "power bi", None),
    "Kubernetes": ("Cloud / DevOps", "kubernetes", "kubernetes"),
    "Terraform": ("Cloud / DevOps", "terraform", "terraform"),
    "Salesforce": ("Plateformes d'éditeur", "salesforce", None),
    "ServiceNow": ("Plateformes d'éditeur", "servicenow", None),
    "Dynamics 365": ("Plateformes d'éditeur", "dynamics 365", None),
    "IA générative": ("IA", "generative ai", None),
    "LLM": ("IA", "llm", None),
    "LangChain": ("IA", "langchain", None),
}


def num(s):
    s = s.replace(",", "").replace("£", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


VALUE = re.compile(r"^[£+\-]?[\d,.]+%?$")


def fetch(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(5 * (attempt + 1))


def itjobswatch(slug):
    """Missions sur 6 mois, même période l'an dernier, tarif médian (£/jour)."""
    page = fetch(ITJW.format(urllib.parse.quote(slug)))
    text = html.unescape(re.sub(r"<[^>]+>", "\n", page))
    lines = [l.strip() for l in text.splitlines() if l.strip()]

    # Libellé de ligne, puis ses valeurs (période actuelle, un an plus tôt) ;
    # certains libellés sont coupés par une balise (« 50<sup>th</sup> »).
    def row(label):
        for i, l in enumerate(lines):
            if l.startswith(label):
                values = [v for v in lines[i + 1:i + 8] if VALUE.match(v)]
                return [num(v) for v in values[:2]] + [None] * (2 - len(values[:2]))
        return [None, None]

    missions, prev = row("Contract jobs citing")
    rate, rate_prev = row("Median daily rate (50")
    period = re.search(r"6 months leading up to (\d+ \w+ \d{4})", text)
    end = None
    if period:
        try:
            end = datetime.datetime.strptime(period.group(1), "%d %B %Y").strftime("%d/%m/%Y")
        except ValueError:
            end = period.group(1)
    return {
        "missions": int(missions) if missions is not None else 0,
        "missionsPrev": int(prev) if prev is not None else None,
        "rate": rate,
        "ratePrev": rate_prev,
        "period": end,
    }


def survey_usage(path):
    """Part (%) des développeurs professionnels qui utilisent chaque libellé."""
    csv.field_size_limit(10 ** 9)
    cols = ["LanguageHaveWorkedWith", "DatabaseHaveWorkedWith", "PlatformHaveWorkedWith",
            "WebframeHaveWorkedWith", "SOTagsHaveWorkedWith", "OfficeStackAsyncHaveWorkedWith"]
    counts, n = {}, 0
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not (row.get("MainBranch") or "").startswith("I am a developer by profession"):
                continue
            n += 1
            seen = {v.strip().lower() for c in cols for v in (row.get(c) or "").split(";") if v.strip()}
            for v in seen:
                counts[v] = counts.get(v, 0) + 1
    return {k: round(100 * v / n, 2) for k, v in counts.items()}, n


def main():
    so_csv = os.environ.get("SO_CSV") or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not so_csv:
        sys.exit("SO_CSV manquant : chemin du results.csv du sondage Stack Overflow 2025 (voir work.py).")
    usage, respondents = survey_usage(so_csv)
    rows, period = [], None
    for tech, (family, slug, label) in TECHS.items():
        try:
            m = itjobswatch(slug)
        except Exception as e:  # une page absente ne bloque pas la collecte
            print(f"{tech} : ITJobsWatch indisponible ({e})", file=sys.stderr)
            continue
        period = period or m["period"]
        share = usage.get(label) if label else None
        rows.append({
            "tech": tech,
            "family": family,
            "missions": m["missions"],
            "missionsPrev": m["missionsPrev"],
            "rate": m["rate"],
            "ratePrev": m["ratePrev"],
            "devShare": share,
        })
        print(f"{tech:16} {m['missions']:>6} missions  {m['rate'] or '-':>6} £  devs {share if share is not None else '-'} %")
        time.sleep(1.5)  # rester poli avec ITJobsWatch
    today = datetime.date.today().isoformat()
    study = {
        "id": f"{today}-stack",
        "title": f"Stacks rentables du {today}",
        "collectedAt": today,
        "region": "Royaume-Uni",
        "period": f"6 mois jusqu'au {period}" if period else "6 derniers mois",
        "respondents": respondents,
        "rows": rows,
        "sources": [
            {"id": "itjobswatch", "label": "ITJobsWatch : missions freelance (contract) et tarifs médians, Royaume-Uni",
             "url": "https://www.itjobswatch.co.uk/contracts/uk/"},
            {"id": "so2025", "label": f"Stack Overflow Developer Survey 2025 : {respondents} développeurs professionnels",
             "url": "https://survey.stackoverflow.co/2025/"},
        ],
    }
    with open("stack.json", "w", encoding="utf-8") as f:
        json.dump(study, f, ensure_ascii=False, indent=2)
    print(f"stack.json : {len(rows)} technos")


if __name__ == "__main__":
    main()
