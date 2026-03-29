# Changelog

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
