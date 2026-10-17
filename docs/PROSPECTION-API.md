# API Prospection

Panneau `/prospection` du board : suivi des prospects, des brouillons, des
envois, des relances et des réponses. Réservé aux rôles **admin** et
**manager**.

## Stockage

- `data/prospects.json` : une fiche par prospect (état courant).
- `data/prospect-events.json` : journal **en ajout seul**. Rien n'y est
  jamais supprimé : supprimer un brouillon, archiver un prospect… est
  lui-même un événement. C'est ce journal qu'on exporte pour l'analyse.

Les deux fichiers sont dans `data/`, donc persistés par le volume Docker et
exclus de git, comme `board.json`.

## Authentification

1. **Session** (interface web) : cookie `board_session`, rôle admin ou manager.
2. **Clé d'API** (automatisation, ex. Claude) :
   `Authorization: Bearer <PROSPECTION_API_KEY>`. Variable d'environnement
   de 16 caractères minimum ; tant qu'elle est vide, l'accès par clé est
   désactivé. L'auteur inscrit dans l'historique vient de l'en-tête
   `X-Actor` (`claude` par défaut).

Générer une clé :

```bash
openssl rand -hex 24
```

## Endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| GET | `/api/prospection/prospects` | `{ prospects, events }` complet |
| POST | `/api/prospection/prospects` | Créer : `{ prospect }`, `{ prospects: [...] }` ou import `{ csv, source }`. Doublons (même SIREN, sinon même nom) ignorés. |
| GET | `/api/prospection/prospects/{id}` | `{ prospect, events }` |
| PATCH | `/api/prospection/prospects/{id}` | Modifier des champs (trace `prospect_updated`) |
| POST | `/api/prospection/prospects/{id}/events` | Ajouter un événement (l'étape suit automatiquement) |
| GET | `/api/prospection/export?format=csv&dataset=prospects` | Export CSV prospects |
| GET | `/api/prospection/export?format=csv&dataset=events` | Export CSV historique |
| GET | `/api/prospection/export?format=json` | Export JSON complet |

### Événements

`type` parmi : `prospect_created`, `prospect_updated`, `imported`,
`draft_created`, `draft_updated`, `draft_deleted`, `send_authorized`,
`email_sent`, `follow_up_sent`, `reply_received`, `message_deleted`,
`meeting_scheduled`, `won`, `lost`, `stage_changed` (avec `stage`),
`archived`, `restored`, `note`.

Champs optionnels : `channel` (email, linkedin, telephone, whatsapp,
formulaire, autre), `subject`, `body`, `gmailDraftId`, `gmailMessageId`,
`gmailThreadId`, `sentiment` (positive, neutre, negative), `note`.

Effets sur l'étape : `draft_created` → Brouillon prêt · `email_sent` →
Envoyé (relance prévue à J+4) · `follow_up_sent` → Relancé (J+6) ·
`reply_received` → Répondu · `meeting_scheduled` → RDV · `won` / `lost` ·
`draft_deleted` → retour à l'étape précédente.

### Exemple : enregistrer un brouillon Gmail

```bash
curl -X POST "$BOARD_URL/api/prospection/prospects/$ID/events" \
  -H "Authorization: Bearer $PROSPECTION_API_KEY" \
  -H "X-Actor: claude" -H "Content-Type: application/json" \
  -d '{"type":"draft_created","channel":"email","subject":"Renfort Symfony / React en remote","gmailDraftId":"r-123"}'
```

## Import

CSV (séparateur `,` ou `;` détecté automatiquement) ou JSON. Les colonnes
connues sont reconnues (notre propre export, l'onglet « Top 50 contacts »
de l'Excel ESN, noms usuels : nom, ville, email, site web…) ; les autres
sont conservées dans `custom` et ressortent à l'export.
