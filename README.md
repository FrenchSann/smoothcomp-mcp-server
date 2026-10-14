# smoothcomp-mcp-server

Serveur MCP pour [Smoothcomp](https://smoothcomp.com) : trouver les prochaines compétitions (JJB, grappling, lutte, judo, MMA, sambo…) dans une zone géographique, voir leurs catégories et ce qu'il faut pour y participer (licence FFL/FFLDA, FFJDA, adhésion fédérale, certificat médical…).

## Outils

| Outil | Rôle |
|---|---|
| `smoothcomp_search_events` | Compétitions à venir filtrées par lieu (`near` + `radius_km`, ou `latitude`/`longitude`), pays, ville, dates, sport, titre |
| `smoothcomp_list_sports` | Sports/disciplines Smoothcomp (ID, nom, nombre d'événements à venir) |
| `smoothcomp_get_event` | Fiche complète : dates, lieu, organisateur, inscriptions, remboursement, tarifs, texte d'info |
| `smoothcomp_get_event_categories` | Options d'inscription (tarifs, âges) + divisions existantes (ceinture/âge/poids, nombre d'inscrits) |
| `smoothcomp_get_event_requirements` | Conditions de participation extraites du texte de l'organisateur : licence/adhésion, certificat médical, assurance, pièce d'identité, autorisation parentale, équipement, niveau, pesée |

Tous les outils sont en lecture seule et acceptent `response_format: "markdown" | "json"`.

## Installation

```bash
npm install
npm run build
```

### Claude Code

```bash
claude mcp add smoothcomp --scope user -- node C:/Users/eliaz/smoothcomp-mcp-server/dist/index.js
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "smoothcomp": {
      "command": "node",
      "args": ["C:/Users/eliaz/smoothcomp-mcp-server/dist/index.js"]
    }
  }
}
```

## Exemples de demandes

- « Quelles compétitions de grappling ont lieu à moins de 100 km de Lyon d'ici fin décembre ? »
- « Pour le BIG Best in Grappling (35411), quelle licence faut-il ? »
- « Quelles catégories No-Gi sont ouvertes à l'Open de Val-de-Reuil, et combien d'inscrits ? »

## Fonctionnement et limites

Smoothcomp n'a pas d'API publique. Le serveur utilise les mêmes données que le site :

- **Liste des événements** : la page `/en/events/upcoming` contient tous les événements à venir (~1 600, avec coordonnées GPS). Elle est gardée en cache 30 min.
- **Détails** : `/event/{id}/getInfoPanelsData` et `/event/{id}/getCmsData` (JSON).
- **Divisions** : `/event/{id}/participants-new` (paginé, 5 par page). Smoothcomp ne crée une division qu'au premier inscrit, donc la liste reflète les catégories déjà demandées, pas toutes les catégories de poids possibles. Les noms des athlètes ne sont pas renvoyés.
- **Conditions de participation** : détectées par mots-clés (FR/EN/ES/PT/IT/DE) dans le texte libre de l'organisateur. Une condition non écrite sur Smoothcomp ne peut pas être trouvée ; vérifiez avec `include_full_text: true` ou contactez l'organisateur.
- **Géocodage** (`near`) : OpenStreetMap Nominatim, résultats en cache 24 h.
- Les pages HTML des événements sont protégées par Cloudflare ; le serveur ne les utilise pas. Si Smoothcomp change son site, les extracteurs dans `src/services/smoothcomp.ts` devront être adaptés.
