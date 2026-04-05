# Changelog

## 0.6.0

- Add agentic context: tasks (dependency DAG), memories (tag+content), flags (status indicators) — 3 new schemas
- Add use cases view: UML-style actors with colour-coded connections to document/entity groups
- Delta-doc WebSocket: server broadcasts `{schema, op}`, client dispatches to affected views only
- Route-aware navigation: sub-views preserved on reload, auto-select first item on documents/checklists
- Custom SVG diagrams: entity schema, entity detail, document expansion tree — all with clickable navigation
- PlantUML now optional — client renders all diagrams natively, compose dependency commented out
- Extract PlantUML to `src/plantuml.ts`, etl.ts uses `withDb()` for graceful missing-db handling
- Move views to `src/client/views/`, legacy app to `src/legacy/`
- Toast notifications on 404 navigation to deleted items
- Consistent empty states with CLI hints across all views
- `bun model skills [target-dir]` — copy skills from Docker image to local project
- `bun run typecheck` script added
- 181 tests, 81.5% coverage — new test files for save.ts and agentic schemas
- Agentic skill added for managing tasks/memories/flags

## 0.5.4

- Bump dependencies: tailwindcss 4.2.2, yaml 2.8.3, bun-types 1.3.11
- Update docs: replace references to removed `index.html` and `reference.ts` with `app.tsx` / `app.html`

## 0.5.3

- Fix ChecklistPage: replace `when()` with `effect()` + `replaceChildren()` for same-pattern navigation — `when()` only rebuilds on falsy→truthy transitions, not when data changes while truthy

## 0.5.2

- Update `@blueshed/railroad` to v0.4.0 — replace `text()` with function children, remove deprecated imports
- Fix parameterized route navigation (docs, entities, checklists) — use `params$` signal from `routes()` instead of independent `route()` calls
- Fix validation rejecting natural key fields that have defaults (e.g. relation label)

## 0.5.1

- Add v2 migration for `documents.description` column — prevents errors on databases created before v0.5.0
- Copy `tsconfig.json` into Docker image so Bun resolves JSX import source correctly

## 0.5.0

- Rewrite frontend with `@blueshed/railroad` — signals, JSX components, and hash-based routing replace monolithic `index.html`
- SSE updates signals in-place instead of full page reload
- Fix PlantUML diagram links to use `/entity/:name` hash routes
- Add `tsconfig.json` with `jsxImportSource: @blueshed/railroad`

## 0.4.3

- Document checklist confirmed bitmask for tracking test status (1=API, 2=UX)

## 0.4.2

- Add `/api/ai` endpoint for AI agent documentation

## 0.4.1

- Add YAML import, SSE live reload, and input validation

## 0.4.0

- Rewrite CLI to generic save/delete engine with 13 declarative schemas
- Natural key upsert with coalescing
- Nested children, compound FK resolution, shorthand syntax
