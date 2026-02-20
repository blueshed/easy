---
name: model-app
description: Model an application by decomposing user requirements into stories, entities, documents, methods, and notifications using the Easy CLI. Use when the user wants to design or model a new app, add features to a model, or work with the model database.
---

# Model a Folly Application

Decompose application requirements into Folly ORB concepts using the `bun model` CLI. The modeler stores the design in SQLite and generates diagrams and specs.

## What is Folly?

Folly is a WebSocket-first Object Request Broker. NOT REST, NOT HTTP. Everything flows through a single WebSocket connection using a wire protocol: RESOLVE, RMI, DOCUMENT, RESULT, UPDATE, NOTIFY. The client resolves object graphs and calls methods on entities. The server persists to SQLite or PostgreSQL, broadcasts property changes, and sends targeted notifications.

## Folly Concepts

| Concept | What it is | Example |
|---|---|---|
| **Entity** | A database table with typed fields | `Room (id, name, created_by)` |
| **Document** | An object graph entry point via `server.document()` — what clients resolve per screen | `RoomChat` resolves a Room with messages + members |
| **Expansion** | Child entity loaded with a document (has-many or belongs-to, nestable) | `messages` (has-many via room_id), `sender` (belongs-to via sender_id) |
| **Method** | RMI handler on an entity, receives MethodContext | `sendMessage(body) → {id}` on Room |
| **Publish** | `ctx.publish(prop, value)` — UPDATE broadcast to all entity subscribers | Property changed → everyone watching sees it |
| **Notify** | `ctx.notify(channel, payload, userIds)` — targeted NOTIFY to specific users | Event happened → specific people get told |
| **Auth** | Token-based WebSocket auth, public vs protected documents | `auth: { verify, public: ['RoomList'] }` |
| **Story** | User requirement that decomposes into the above | "As a member, I can send a message" |

**NOT modeled**: HTTP routes (escape hatch for auth bootstrap only), client-side components, CSS, Signals, SQL queries.

## Decomposition Order

Always work top-down in this order:

1. **Stories** — identify actors and what they can do
2. **Entities** — extract nouns from stories, add fields
3. **Relations** — has-many / belongs-to between entities
4. **Documents** — what object graphs does each screen need?
5. **Expansions** — which related entities load with each document?
6. **Methods** — what actions can users take on each entity?
7. **Publish / Notify** — real-time updates and targeted notifications
8. **Story links** — connect each story to its artifacts
9. **Checklists** — CAN/DENIED checks that verify permission paths through the document graph (see guidance below)
10. **Export** — `bun model export-spec` to generate the spec

## Actor Conventions

- **visitor** — unauthenticated, can only access public documents (e.g. RoomList with `--public`)
- Named roles (member, admin, creator) — authenticated via token on WebSocket connect
- Permission flags on methods (e.g. `--permission creator`) for owner-only actions

## Publish vs Notify

- **Publish** (`ctx.publish(prop, value)`) — broadcasts a property change to *all subscribers* of an entity. Every client viewing that entity sees the update. Use for property mutations: rename, status change, moving an item. Maps to the `UPDATE` wire message.
- **Notify** (`ctx.notify(channel, payload, userIds)`) — sends a targeted event to *specific users* by ID. Not tied to subscriptions. Use for events: new message arrived, member joined, room deleted. Maps to the `NOTIFY` wire message. Client listens with `orb.on(channel, callback)`.

Rule of thumb: if a method changes an existing property, **publish**. If a method creates something new or triggers an event, **notify**.

## Key Principles

- Stories drive everything — start with what users need
- Documents are screens — each maps to a client `orb.resolve()` call
- Entities own methods — methods go on the entity they mutate, not the document
- Publish for property changes — all subscribers see the update
- Notify for events — targeted to specific users
- Auth from actors — visitor stories → public documents; named roles → auth required

## Permission Paths

Permission paths use a DSL (adapted from [DZQL](../../../../../../blueshed/dzql)) to express who can call a method. A path resolves to a set of user IDs — if the current user is in that set, access is granted. Multiple paths on the same method use OR logic.

### Syntax

```
@field->table[filter]{temporal}.target_field
```

| Component | Syntax | Meaning |
|---|---|---|
| Start field | `@field` | Begin from a column on the entity being acted on |
| Traverse | `->table` | Follow a foreign key to a related table |
| Filter (literal) | `[field='value']` | WHERE clause with a literal value |
| Filter (current user) | `[user_id=$]` | WHERE clause matching the authenticated user's ID |
| Filter (multi) | `[org_id=$,role='admin']` | Multiple conditions (AND) |
| Temporal | `{active}` | Only rows where `valid_from <= NOW() AND (valid_to IS NULL OR valid_to > NOW())` |
| Project | `.target_field` | Extract this column as the resolved user ID |

### Examples

**Direct ownership** — entity has a `user_id` column:
```
@user_id
```

**Organisation membership** — user acts for the org that owns this entity:
```
@owner_id->acts_for[org_id=$]{active}.user_id
```
Reads: "Take the entity's `owner_id`, look up `acts_for` rows where `org_id` matches and the row is active, return `user_id` — if the current user is in that set, allow."

**Multi-hop** — traverse through an intermediate entity:
```
@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
```
Reads: "Take `venue_id`, look up the venue's `org_id`, then check acts_for membership."

**Role-restricted** — only admins of the org:
```
@owner_id->acts_for[org_id=$,role='admin']{active}.user_id
```

### CLI

```bash
bun model add-permission Organisation.createVenue "@owner_id->acts_for[org_id=$]{active}.user_id" "User must be active member of the organisation"
```

### Notifications use the same paths

The same path syntax determines who receives notifications. The path resolves to user IDs and those users get the NOTIFY message.

## Checklists — Avoiding Overlap

Methods already capture permissions, publish, and notify as the **single source of truth**. Checklists are integration test scenarios — they should NOT restate what methods already describe. If a checklist check just says "method X notifies Y", that's a duplication that can become stale and misleading when the method definition changes.

**DO use checklists for:**
- **Denied paths** — proving someone *can't* do something (e.g. "user B cannot see user A's tickets")
- **Document-level behaviour** — what appears/disappears from collection queries after an action (e.g. "claimed ticket disappears from OpenTickets")
- **Sequenced flows** — ordered multi-step scenarios using `--after` dependencies
- **Cross-cutting concerns** — behaviour that spans multiple methods or documents

**AVOID in checklists:**
- Restating that a method publishes a property (already on the method)
- Restating that a method sends a notification (already on the method)
- Restating permission checks (already on the method)

When in doubt, ask: "Is this already expressed on a method?" If yes, don't add a checklist check for it.

For full CLI reference and detailed examples, see [reference.md](reference.md).
