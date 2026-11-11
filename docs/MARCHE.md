# Études de marché (`/marche`)

Espace « Marché » du board : quelles compétences tech sont demandées, où, et
combien de prestataires les proposent déjà. Sert à choisir les profils à
placer (nous ou des partenaires) et les pays où les proposer. Réservé aux
rôles **admin** et **manager** (mêmes règles que la prospection).

## Principe

Chaque collecte produit une **étude datée** (instantané), stockée dans
`data/market-studies.json` (volume Docker, hors git). Les études
s'accumulent : on garde l'historique pour suivre l'évolution. Une collecte
relancée avec le même `id` remplace l'étude correspondante.

Les compétences sont rangées par **familles** (back-end, front-end, mobile,
e-commerce / CMS, data / IA, cloud / DevOps, cybersécurité, ERP / CRM, test,
design, gestion de projet), définies dans `scripts/market/collect.py`.

La page affiche, pour l'étude choisie (filtre par famille) :

- **Demande** : matrice compétences × pays (intérêt de recherche Google
  Trends), en mode « meilleur pays = 100 » ou indice brut, avec la ligne
  **« Notre taux de réponse »** calculée en direct depuis la prospection
  (affichée à partir de 5 prospects contactés) ;
- **Offre** : développeurs par compétence et par pays (GitHub), en nombre,
  pour 1 000 développeurs, ou **demande ÷ offre** (au-dessus de 1 : le pays
  cherche la compétence plus qu'il n'a de développeurs pour elle, c'est là
  qu'un prestataire à distance a le plus de place) ;
- **Profils les plus recherchés par pays** : les compétences comparées entre
  elles au sein d'un pays ;
- les **pays en tête** par compétence, les **indicateurs officiels
  Eurostat**, la **taille du marché WooCommerce**, les **sources**.

## Sources

| Mesure | Source | Remarque |
|---|---|---|
| Demande : intérêt de recherche | Google Trends (sujets, 12 mois) | Compare les pays pour une compétence |
| Demande : profils comparés dans un pays | Google Trends, chaque lot mesuré avec React comme référence | Rapport à React |
| Offre : développeurs par langage | GitHub Innovation Graph (dernier trimestre) | Chaque compétence est mesurée par son langage (Twig = Symfony, Blade = Laravel, Smarty = PrestaShop, Liquid = Shopify, Dart = Flutter, HCL = Terraform, Apex = Salesforce…) |
| Spécialistes TIC (% emploi, milliers) | Eurostat `isoc_sks_itspt` | UE + Suisse |
| Postes TIC difficiles à pourvoir | Eurostat `isoc_ske_itrcrn2` (`E_ITSPVAC2`) | Enquête bisannuelle, certains pays absents |
| Boutiques WooCommerce | StoreCensus | Marché client direct |

Limites : Monaco a des volumes trop faibles pour Google Trends et GitHub.
Les compétences sans langage propre (cloud, cybersécurité, Power BI, SAP,
test, design, gestion de projet) n'ont pas de mesure d'offre. Les noms
ambigus sont mesurés par un mot-clé métier (`golang`, `swiftui`,
`selenium webdriver`, `kotlin`).

## Conditions de travail (`scripts/market/work.py`)

Bloc « Conditions de travail » de la page : sur site / hybride / full remote,
temps plein / temps partiel / alternance, côté employeurs et côté
prestataires. Chaque tableau a ses filtres pays (et compétences).

| Mesure | Source | Couverture |
|---|---|---|
| Offres proposant télétravail ou hybride (tous métiers, développement logiciel, informatique) et recherches des candidats qui le demandent | Indeed Hiring Lab, Remote Tracker (CC BY 4.0) | AU, CA, FR, IE |
| Travail à domicile habituel / parfois / jamais, salariés et indépendants | Eurostat `lfsa_ehomp` | UE + Suisse |
| Temps partiel des professions intellectuelles (ISCO 2) | Eurostat `lfsa_epgais` | UE + Suisse |
| Contrats temporaires liés à une formation (alternance), 15-29 ans | Eurostat `lfsa_etgar` | UE + Suisse |
| Temps partiel, tous emplois | OCDE `DF_FTPT_COMMON_INC` | Pays de l'OCDE (pas Singapour, Monaco) |
| Situation réelle des développeurs (full remote, hybride, sur site), freelance, alternance, temps partiel, par pays et par compétence | Stack Overflow Developer Survey 2025 | 10 pays (échantillon < 30 signalé) |

Indeed ne distingue pas télétravail et hybride. Dans le sondage Stack
Overflow, l'alternance = en emploi et en formation ; le temps partiel = en
emploi et moins de 30 h rémunérées par semaine. Magento, PrestaShop, Shopify
et quelques autres n'y figurent pas (pas de mesure par compétence).

```bash
docker run --rm -v "$PWD:/w" -w /w python:3.12-slim python -I work.py
```

Le script télécharge le sondage Stack Overflow (≈ 140 Mo) ; `SO_CSV=chemin`
permet de réutiliser un fichier déjà téléchargé.

## Relancer une collecte

```bash
cd scripts/market
docker run --rm -v "$PWD:/w" -w /w python:3.12-slim \
  sh -c "pip install -q pytrends 'urllib3<2' && python -I collect.py && python -I supply.py"
```

Compter une quinzaine de minutes (Google Trends impose des pauses ; en cas
d'erreur 429, le script réessaie seul). Pour ne refaire que quelques
compétences après une coupure, ajouter `-e ONLY="Go,Kotlin"` : elles sont
recollectées et fusionnées dans le `market.json` existant.

Ajouter ensuite `id`, `title` (et `notes`) à `market.json`, puis l'envoyer :

```bash
curl -X POST "$BOARD_URL/api/market" \
  -H "Authorization: Bearer $PROSPECTION_API_KEY" \
  -H "Content-Type: application/json" --data-binary @market.json
```

## Stacks rentables (`/marche/stack`)

Deuxième page du module : quelles technos offrent le plus de **missions
réelles** pour le moins de **concurrence**.

| Mesure | Source | Remarque |
|---|---|---|
| Demande : missions freelance sur 6 mois, même période un an plus tôt, tarif médian | ITJobsWatch (Royaume-Uni) | Seul relevé public des missions par techno ; indicateur de tendance pour nos marchés |
| Concurrence : part des développeurs professionnels qui pratiquent la techno | Stack Overflow Developer Survey 2025 (monde) | Plateformes d'éditeur (Salesforce, ServiceNow, Power BI, Dynamics) et dbt absents : concurrence non mesurée |

Ratio = missions ÷ part des développeurs (en %). Verdicts : ratio ≥ 150 et
missions en hausse = « forte demande, peu de concurrence » ; ratio ≥ 30 =
« bon équilibre » ; en dessous = « concurrence forte » ; missions en baisse de
plus de 20 % sur un an = « en recul ». La page propose un nuage de points
(échelles logarithmiques), un tableau triable et des filtres par famille et
par verdict. La liste des technos suivies est dans `TECHS` de
`scripts/market/stack.py`.

```bash
cd scripts/market
docker run --rm -v "$PWD:/w" -w /w -v "<dossier du results.csv>:/so:ro" \
  -e SO_CSV=/so/results.csv python:3.12-slim python -I stack.py
curl -X POST "$BOARD_URL/api/market/stack" \
  -H "Authorization: Bearer $PROSPECTION_API_KEY" \
  -H "Content-Type: application/json" --data-binary @stack.json
```

## API

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/market` | `{ studies }`, de la plus récente à la plus ancienne |
| POST | `/api/market` | Ajoute (ou remplace par `id`) une étude |
| GET | `/api/market/stack` | Études « Stacks rentables » `{ studies }` |
| POST | `/api/market/stack` | Ajoute (ou remplace par `id`) une étude produite par `stack.py` |

Champs d'une étude : `id`, `title`, `collectedAt` (AAAA-MM-JJ), `countries`,
`skills`, `families`, `trends` (`{ compétence: { pays: indice } }`),
`anchor` et `vsAnchor` (comparaison entre compétences), `topics`,
`eurostat` (`ict_share`, `hard_to_fill`), `stores`, `supply` (`period`,
`developers`, `languages`, `skillLanguages`, `ictThousands`), `sources`,
`notes`.

## Pistes suivantes

- Offres d'emploi chiffrées par compétence et pays : API Adzuna (clé
  gratuite à créer), Indeed Hiring Lab.
- Offre freelance : nombre de profils par compétence sur Malt et Upwork.
- Sources officielles hors UE : Jobs and Skills Australia, Guichet-Emplois
  Canada, MBIE (Nouvelle-Zélande), Ministry of Manpower (Singapour),
  France Travail (BMO).
- Valeur : TJM par compétence (Malt, Free-Work).
- Score combiné pays × compétence.
