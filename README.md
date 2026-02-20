# Easy

Domain modeling tool for applications built on the [simple](https://github.com/blueshed/simple) template. Define your domain model — entities, documents, methods, permissions — and export specs or browse an interactive site.

> **Simple** — the app template. **Easy** — the modeling tool.
> Design with Easy, build with Simple.

## Quick start

```bash
docker compose up -d
docker compose exec easy bun model add-entity Room
docker compose exec easy bun model add-field Room id number
docker compose exec easy bun model add-field Room name string
docker compose exec easy bun model add-method Room rename '[{"name":"name","type":"string"}]' boolean
docker compose exec easy bun model add-publish Room.rename name
docker compose exec easy bun model export-spec
```

Or open http://localhost:8080 to browse the model site.

## Using with Simple

```bash
bun create blueshed/simple my-app
cd my-app
# Add easy services to your compose.yml (see below), then:
docker compose up -d
docker compose exec easy bun model add-entity User ...
docker compose exec easy bun model export-spec > spec.md
# Now use /implement in Claude to build from the spec
```

Add to your project's `compose.yml`:

```yaml
  easy:
    image: ghcr.io/blueshed/easy:latest
    ports:
      - "8080:8080"
    environment:
      PLANTUML_URL: http://plantuml:8080
    volumes:
      - ./model.db:/app/model.db
    depends_on:
      - plantuml

  plantuml:
    image: plantuml/plantuml-server:jetty
```

## Commands

```
Entities:     add-entity, add-field, add-relation, remove-*
Stories:      add-story, remove-story, link-story, unlink-story
Documents:    add-document, remove-document
Expansions:   add-expansion, remove-expansion
Methods:      add-method, remove-method, add-permission, remove-permission
Publish:      add-publish
Checklists:   add-checklist, add-check, add-check-dep, confirm-check
Listing:      list, list-stories, list-documents, list-checks
Export:        export-spec
Batch:         batch (reads JSONL from stdin)
```

All commands: `docker compose exec easy bun model <command> [args]`

## Model site

The site at http://localhost:8080 shows:

- **Stories** with linked artifacts
- **Use case** and **entity** diagrams (via PlantUML)
- **Document** pages with expansion trees, changed-by entities, methods, and linked stories
- **Entity** pages with fields, change targets, methods (with permissions and publishes), and related documents
- **Checklists** with CAN/DENIED checks and API/UX confirmation tracking

## How it works

The model is stored in `model.db` (SQLite, mounted as a volume). The CLI writes to it, the site reads from it. `export-spec` produces a standalone Markdown spec suitable for `/implement` in a Simple project.

### Change targets

Every entity shows which documents it affects when mutated. This is derived from the document expansion tree:

- **Root entities** affect the documents they own (e.g. `PostDetail(id)`)
- **Child entities** affect documents via their expansion path (e.g. `PostFeed(post_id)` -> `post_tags`)

In the simple pattern, each change target maps to a `pg_notify` target — the server fans out the event to clients with that document open, and the client merges the changed row into its local state.

### Batch operations

Pipe JSONL to load a model quickly:

```bash
cat <<'EOF' | docker compose exec -T easy bun model batch
["add-entity","Room"]
["add-field","Room","id","number"]
["add-field","Room","name","string"]
["add-method","Room","rename","[{\"name\":\"name\",\"type\":\"string\"}]","boolean"]
["add-publish","Room.rename","name"]
EOF
```

## Architecture

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI commands and `export-spec` |
| `src/db.ts` | SQLite schema and `openDb()` helper |
| `src/etl.ts` | Site API queries and PlantUML diagram generation |
| `src/site.ts` | Bun HTTP server on port 8080 |
| `src/index.html` | Single-page visualization app |
| `src/site.css` | Dark theme styles |
