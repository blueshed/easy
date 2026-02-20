# Easy

Domain modeling tool for applications built on the **simple** template pattern. Stores the model in a SQLite database (`model.db`) and exports specs, diagrams, and a visual site.

## Architecture

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI commands (add/remove entities, fields, methods, etc.) and `export-spec` |
| `src/db.ts` | SQLite schema and `openDb()` helper |
| `src/etl.ts` | Queries for the site API: entity/document detail, diagrams via PlantUML |
| `src/site.ts` | Bun HTTP server on port 8080 serving the model site |
| `src/index.html` | Single-page app — loads data from `/api/*` endpoints, renders dynamically |
| `src/site.css` | Dark theme styles for the site |

## Key concepts

- **Entities** map to database tables. Every entity needs an `id: number` field.
- **Documents** are the subscription unit — clients open a document and receive merge events for changes within it.
- **Expansions** define which child entities are loaded with a document (has-many, belongs-to, shallow).
- **Changes** are derived from the expansion tree — they show which documents a mutation on a given entity affects. The site shows this as "Changes" on entity pages and "Changed by" on document pages.
- **Publishes** declare which fields are included in the merge event payload for root entity mutations.
- **Permissions** use fkey path syntax to express who can call a method.
- **Checklists** verify that permission paths work via CAN/DENIED test steps.

## Running

```bash
docker compose up -d                          # start easy + plantuml
docker compose exec easy bun model <command>  # CLI commands
docker compose exec easy bun model export-spec  # Markdown spec output
# Site at http://localhost:8080
```

## Notes

- The model targets the **simple** pattern: atomic events via `pg_notify`, document-scoped fan-out, client-side merge. There are no user-targeted notifications.
- The `notifications` table still exists in the schema but is not surfaced in `export-spec` or the site. It may be removed in future.
- The detailed CLI reference is in `.claude/skills/model-app/reference.md`.
