# Feature Request: Enable Foreign Keys and Fix Orphaned References

## Problem

When a method (or entity, or document) is removed and re-created via the CLI, any **story links**, **checklist checks**, and **check dependencies** that referenced the old internal ID become orphaned. They show as `id:XX` in `list-stories` and `???` in `export-spec` output.

This happens routinely during modeling because `remove-method` + `add-method` is the only way to change a method's arguments — and the new method gets a new auto-increment ID.

### Root cause

**`PRAGMA foreign_keys` is `0` (disabled).** SQLite requires this pragma to be set to `1` on every connection for FK constraints (`ON DELETE CASCADE`, `ON DELETE SET NULL`) to fire. With it off, deleting a method leaves dangling references everywhere.

Even with foreign keys enabled, `story_links.target_id` is a **polymorphic FK** (target_type = method | entity | document) with no actual `REFERENCES` constraint, so it will never cascade regardless.

### Current schema issues

| Table | Column | FK Constraint | Would work with `PRAGMA foreign_keys=1`? |
|---|---|---|---|
| `checks.method_id` | `REFERENCES methods(id) ON DELETE SET NULL` | Yes — would NULL out the method_id when a method is deleted |
| `check_deps.depends_on_id` | `REFERENCES checks(id) ON DELETE CASCADE` | Yes — would remove dep rows when a check is deleted |
| `check_deps.check_id` | `REFERENCES checks(id) ON DELETE CASCADE` | Yes |
| `story_links.target_id` | No REFERENCES (polymorphic) | **No** — needs application-level cleanup |
| `publishes.method_id` | `REFERENCES methods(id) ON DELETE CASCADE` | Yes |
| `method_permissions.method_id` | `REFERENCES methods(id) ON DELETE CASCADE` | Yes |

### Current orphan count (our model)

- **22 orphaned story_links** (stories #5, #7, #8, #9, #16, #18) — methods, documents, entities
- **4 orphaned check_deps** — pointing to deleted checks
- **3 orphaned checks** — pointing to deleted methods (method_id 3, 4)

### Impact

- `export-spec` outputs `???` for broken check→method references
- `list-stories` shows `method: id:XX` / `entity: id:XX` / `document: id:XX` for broken story links
- `unlink-story` cannot remove stale links — it resolves by name, and the target no longer exists
- `remove-check` can remove broken checks, but there is no way to find them except by exporting and searching for `???`
- Users must manually track which checks/stories referenced a method before rebuilding it, then re-add all links after — error-prone and tedious

## Proposed Fix

### 1. Enable foreign keys on every connection

```typescript
db.exec("PRAGMA foreign_keys = ON");
```

Add this immediately after opening the SQLite connection. This makes all existing `ON DELETE CASCADE` and `ON DELETE SET NULL` constraints work.

### 2. Clean up orphaned story_links on delete

Since `story_links.target_id` is polymorphic and can't use a real FK, add application-level cleanup when removing methods, entities, and documents:

```typescript
// In remove-method handler, after deleting the method:
db.exec(`DELETE FROM story_links WHERE target_type = 'method' AND target_id = ?`, [deletedMethodId]);

// In remove-entity handler:
db.exec(`DELETE FROM story_links WHERE target_type = 'entity' AND target_id = ?`, [deletedEntityId]);

// In remove-document handler:
db.exec(`DELETE FROM story_links WHERE target_type = 'document' AND target_id = ?`, [deletedDocumentId]);
```

### 3. Clean up orphaned check method references on export (defensive)

In `export-spec`, treat `method_id = NULL` checks as broken and either:
- Skip them with a warning, or
- Flag them clearly (e.g., `⚠ unlinked check`) so the user knows to fix them

### 4. (Optional) Add a `cleanup` or `doctor` command

```bash
bun model doctor
```

That reports and optionally removes:
- `story_links` where target no longer exists
- `checks` where `method_id` is NULL or points to a deleted method
- `check_deps` where either side no longer exists

This would also be useful for one-time cleanup of existing model databases.

### 5. (Optional) Warn on remove-method

When removing a method, list what will be affected:

```
Removing Event.saveEvent (id: 16)...
  ⚠ 2 story links will be removed (stories #5, #7)
  ⚠ 3 checklist checks reference this method
Proceed? [y/N]
```

## Workaround (current)

Fix the existing orphans directly in SQLite:

```sql
PRAGMA foreign_keys = ON;

-- Remove orphaned story_links
DELETE FROM story_links WHERE
  (target_type = 'method' AND target_id NOT IN (SELECT id FROM methods)) OR
  (target_type = 'entity' AND target_id NOT IN (SELECT id FROM entities)) OR
  (target_type = 'document' AND target_id NOT IN (SELECT id FROM documents));

-- Remove orphaned check_deps
DELETE FROM check_deps WHERE depends_on_id NOT IN (SELECT id FROM checks);

-- Remove orphaned checks (method_id points to deleted method)
DELETE FROM checks WHERE method_id IS NOT NULL AND method_id NOT IN (SELECT id FROM methods);
```
