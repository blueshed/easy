# Easy

Domain modeling tool for applications built on the **simple** template pattern. Stores the model in a SQLite database (`model.db`) with foreign keys enabled, and exports specs, diagrams, and a visual site.

## Architecture

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI commands (add/remove entities, fields, methods, etc.), `export-spec`, and `doctor` |
| `src/db.ts` | SQLite schema, `PRAGMA foreign_keys = ON`, and `openDb()` helper |
| `src/etl.ts` | Queries for the site API: entity/document detail, diagrams via PlantUML |
| `src/site.ts` | Bun HTTP server on port 8080 using parameterized routes (`/api/entities/:name`, etc.) |
| `src/reference.ts` | Structured CLI reference data (command groups with syntax, descriptions, flags, examples) |
| `src/index.html` | Single-page app — loads data from `/api/*` endpoints, renders dynamically |
| `src/site.css` | Dark theme styles for the site |

## Key concepts

- **Entities** map to database tables. Every entity needs an `id: number` field.
- **Documents** are the subscription unit — clients open a document and receive merge events for changes within it. Flags: `--collection`, `--public`, `--cursor`, `--stream`, `--description`.
- **Expansions** define which child entities are loaded with a document (has-many, belongs-to, shallow).
- **Changes** are derived from the expansion tree — they show which documents a mutation on a given entity affects. The site shows this as "Changes" on entity pages and "Changed by" on document pages.
- **Publishes** declare which fields are included in the merge event payload for root entity mutations.
- **Notifications** declare cross-document alerts sent by methods (channel, recipients, payload).
- **Permissions** use fkey path syntax to express who can call a method.
- **Checklists** verify that permission paths work via CAN/DENIED test steps.
- **Metadata** is a key-value store for project-level settings (theme, app name, etc.).

## Running

```bash
docker compose up -d                          # start easy + plantuml
docker compose exec easy bun model <command>  # CLI commands
docker compose exec easy bun model export-spec  # Markdown spec output
# Site at http://localhost:8080
```

## Docker

Easy is published as `ghcr.io/blueshed/easy`. The GitHub Actions workflow (`.github/workflows/publish.yml`) builds and pushes on `v*` tags:

```bash
git tag v0.3.3 && git push origin v0.3.3
```

This produces tags: `0.3.3`, `0.3`, and `latest`.

In a Simple project, users uncomment the `easy` and `plantuml` services in `compose.yml` to add modeling. The container mounts `model.db` as a volume for persistence.

## Integration with Simple

Easy's `export-spec` output is consumed by Simple's `/implement` skill. The full pipeline:

1. Define the domain model with Easy (`bun model` commands or the visual site)
2. Export: `docker compose exec easy bun model export-spec > spec.md`
3. In the Simple project, run `/implement` to build schema, functions, and components from the spec

## Notes

- The model targets the **simple** pattern: atomic events via `pg_notify`, document-scoped fan-out, client-side merge.
- Foreign keys are enforced via `PRAGMA foreign_keys = ON` on every connection. Deleting entities/documents/methods also cleans up polymorphic `story_links` at the application level.
- The `doctor` command reports orphaned references; `doctor --fix` removes them.
- The detailed CLI reference is in `.claude/skills/model-app/reference.md` and also served on the site at `#reference`.
