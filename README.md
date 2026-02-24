# Easy

Domain modeling tool for applications built on the [simple](https://github.com/blueshed/simple) template. Define your domain model — entities, documents, methods, permissions — and export specs or browse an interactive site.

> **Simple** — the app template. **Easy** — the modeling tool.
> Design with Easy, build with Simple.

## Quick start

```bash
docker compose up -d
docker compose exec easy bun model save entity '{"name":"Room","fields":[{"name":"id","type":"number"},{"name":"name","type":"string"}]}'
docker compose exec easy bun model save method '{"entity":"Room","name":"rename","args":[{"name":"name","type":"string"}],"publishes":["name"]}'
docker compose exec easy bun model export
```

Or open http://localhost:8080 to browse the model site.

## Using with Simple

```bash
bun create blueshed/simple my-app
cd my-app
# Add easy services to your compose.yml (see below), then:
docker compose up -d
docker compose exec easy bun model save entity '{"name":"User","fields":[{"name":"id","type":"number"},{"name":"name","type":"string"}]}'
docker compose exec easy bun model export > spec.md
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

All commands: `docker compose exec easy bun model <command> [args]`

```
Mutations:
  save <schema> <json>               Upsert by natural key (coalescing)
  delete <schema> <json>             Remove by natural key

Queries:
  list [schema]                      List all, or items of a schema type
  get <schema> <key>                 Get one item as JSON
  export                             Markdown spec to stdout

Maintenance:
  doctor [--fix]                     Report/repair orphaned references

Batch:
  batch                              JSONL from stdin: ["save","entity",{...}]

Schemas: entity, field, relation, story, document, expansion, method,
         publish, notification, permission, checklist, check, metadata
```

### Save examples

```bash
# Entity with fields inline
bun model save entity '{"name":"Room","fields":[{"name":"id","type":"number"},{"name":"name","type":"string"}]}'

# Relation
bun model save relation '{"from":"Room","to":"Message","label":"messages","cardinality":"*"}'

# Document with expansions
bun model save document '{"name":"RoomDoc","entity":"Room","expansions":[{"name":"messages","entity":"Message","foreign_key":"room_id"}]}'

# Method with publishes shorthand
bun model save method '{"entity":"Room","name":"rename","args":[{"name":"name","type":"string"}],"publishes":["name"]}'

# Story with links
bun model save story '{"actor":"member","action":"send a message","links":[{"type":"entity","name":"Room"}]}'

# Checklist with checks
bun model save checklist '{"name":"Access","checks":[{"actor":"member","method":"Room.rename"},{"actor":"outsider","method":"Room.rename","denied":true}]}'

# Metadata
bun model save metadata '{"key":"theme","value":"Dark navy palette"}'
```

### Delete

```bash
bun model delete field '{"entity":"Room","name":"capacity"}'
bun model delete entity '{"name":"Room"}'
```

## Model site

The site at http://localhost:8080 shows:

- **Stories** with linked artifacts
- **Use case** and **entity** diagrams (via PlantUML)
- **Document** pages with expansion trees, changed-by entities, methods, and linked stories
- **Entity** pages with fields, change targets, methods (with permissions and publishes), and related documents
- **Checklists** with CAN/DENIED checks and API/UX confirmation tracking
- **Reference** — full CLI command reference with syntax, descriptions, and examples

## How it works

The model is stored in `model.db` (SQLite with foreign keys enabled, mounted as a volume). The CLI writes to it, the site reads from it. `export` produces a standalone Markdown spec suitable for `/implement` in a Simple project.

### Coalescing upsert

Save merges by natural key. Scalar fields are coalesced — only provided fields are updated. Array children are merged by their own natural keys — existing children not in the array are left alone.

### Change targets

Every entity shows which documents it affects when mutated. This is derived from the document expansion tree:

- **Root entities** affect the documents they own (e.g. `PostDetail(id)`)
- **Child entities** affect documents via their expansion path (e.g. `PostFeed(post_id)` -> `post_tags`)

In the simple pattern, each change target maps to a `pg_notify` target — the server fans out the event to clients with that document open, and the client merges the changed row into its local state.

### Batch operations

Pipe JSONL to load a model quickly:

```bash
cat <<'EOF' | docker compose exec -T easy bun model batch
["save","entity",{"name":"Room"}]
["save","field",{"entity":"Room","name":"id","type":"number"}]
["save","field",{"entity":"Room","name":"name","type":"string"}]
["save","method",{"entity":"Room","name":"rename","args":[{"name":"name","type":"string"}],"publishes":["name"]}]
EOF
```

### Database maintenance

The `doctor` command reports orphaned references — story links, checks, or check dependencies pointing to deleted entities, methods, or documents. Use `--fix` to remove them:

```bash
docker compose exec easy bun model doctor
docker compose exec easy bun model doctor --fix
```

## Architecture

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI dispatcher — 7 commands |
| `src/schemas.ts` | Schema registry — declarative definitions |
| `src/save.ts` | Generic save/delete engine |
| `src/query.ts` | List, get, export, doctor |
| `src/db.ts` | SQLite schema, foreign keys, and `openDb()` helper |
| `src/etl.ts` | Site API queries and PlantUML diagram generation |
| `src/site.ts` | Bun HTTP server on port 8080 with parameterized routes |
| `src/reference.ts` | Structured CLI reference data served to the site |
| `src/index.html` | Single-page visualization app |
| `src/site.css` | Dark theme styles |
