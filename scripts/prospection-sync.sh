#!/usr/bin/env bash
# Reporte le board local sur le board en ligne, sans rien casser, perdre ni doubler.
#
#   LOCAL_KEY=... ONLINE_KEY=... scripts/prospection-sync.sh           # aperçu seul
#   LOCAL_KEY=... ONLINE_KEY=... scripts/prospection-sync.sh --apply   # import réel
#
# 1. exporte tout le board local (prospects, historique, « Ne plus contacter ») ;
# 2. envoie l'export en aperçu au board en ligne (?dryRun=1 : rien n'est écrit) ;
# 3. avec --apply seulement, lance l'import réel : le serveur fait d'abord une
#    sauvegarde (data/backups/), fusionne sans doublon et ne supprime rien.
# Relancer le script ne change rien si tout est déjà en ligne.
set -euo pipefail

LOCAL_URL="${LOCAL_URL:-http://localhost:3001}"
ONLINE_URL="${ONLINE_URL:-https://board.nosysoatech.com}"
: "${LOCAL_KEY:?LOCAL_KEY manquant (PROSPECTION_API_KEY du board local)}"
: "${ONLINE_KEY:?ONLINE_KEY manquant (PROSPECTION_API_KEY du board en ligne)}"

export_file="$(mktemp)"
trap 'rm -f "$export_file"' EXIT

curl -sf -H "Authorization: Bearer $LOCAL_KEY" "$LOCAL_URL/api/prospection/export?format=json" -o "$export_file" \
  || { echo "Export local impossible ($LOCAL_URL)." >&2; exit 1; }

import() {
  curl -sf -H "Authorization: Bearer $ONLINE_KEY" -H "X-Actor: sync" -H "Content-Type: application/json; charset=utf-8" \
    -X POST --data-binary @"$export_file" "$ONLINE_URL/api/prospection/import$1" \
    || { echo "Import refusé par $ONLINE_URL (clé absente ou différente ?)." >&2; exit 1; }
  echo
}

echo "Aperçu (rien n'est écrit) :"
import "?dryRun=1"
if [ "${1:-}" = "--apply" ]; then
  echo "Import réel :"
  import ""
else
  echo "Relancer avec --apply pour importer."
fi
