# Database Guidelines

> Database patterns and conventions for this project.

---

## Scenario: Server Prisma Schema and Migrations

### 1. Scope / Trigger

- Trigger: server database schema or migration changes under `packages/server/prisma/`.
- Applies to: Prisma schema, generated migrations, and commands that touch the local Postgres dev database.

### 2. Signatures

- Schema file: `packages/server/prisma/schema.prisma`
- Migration directory: `packages/server/prisma/migrations/<timestamp>_<name>/migration.sql`
- Migration lock: `packages/server/prisma/migrations/migration_lock.toml`
- Dev migrate command: `pnpm -F @tengyu-aipod/server exec prisma migrate dev --name <name>`
- Client generation command: `pnpm -F @tengyu-aipod/server prisma:generate`

### 3. Contracts

- Required env key: `DATABASE_URL`, loaded from `packages/server/.env` for local development.
- Local database target: Postgres via `docker-compose.dev.yml`.
- Prisma datasource provider: `postgresql`.
- Prisma table names must use `@@map("<snake_case_table>")` when the model name is PascalCase.
- Field names in the server schema follow the snake_case contract from `docs/spec/08-server.md`.
- JSON payload fields in the v1 server schema are stored as `String @db.Text`; do not silently switch them to Prisma `Json` unless the project spec is updated first.

### 4. Validation & Error Matrix

- Docker Postgres not running -> start it with `docker compose -f docker-compose.dev.yml up -d` before migrating.
- Migration drift from old local-only tables -> reset the local dev volume only after confirming the drift is not committed schema history.
- Missing `DATABASE_URL` -> Prisma commands fail before touching the database; do not commit `.env`.
- Schema edited without migration -> run `prisma migrate dev`; do not hand-write a partial migration unless Prisma cannot express the change.

### 5. Good/Base/Bad Cases

- Good: edit `schema.prisma`, run `migrate dev --name <task-name>`, commit schema plus generated migration files together.
- Base: run `prisma:generate` after migration so type-check sees the current Prisma Client.
- Bad: commit generated client output, `.env`, local database files, or a schema-only change with no migration.

### 6. Tests Required

- `pnpm -F @tengyu-aipod/server exec prisma migrate dev --name <name>`
- `pnpm -F @tengyu-aipod/server prisma:generate`
- `pnpm -F @tengyu-aipod/server type-check`
- For slice-level verification after CI activation: `pnpm lint`, `pnpm type-check`, `pnpm test`

### 7. Wrong vs Correct

#### Wrong

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat: update schema"
```

#### Correct

```bash
pnpm -F @tengyu-aipod/server exec prisma migrate dev --name init
pnpm -F @tengyu-aipod/server prisma:generate
pnpm -F @tengyu-aipod/server type-check
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations
```

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

---

## Migrations

Use Prisma-generated migrations for server database changes. Commit `schema.prisma`, the generated migration directory, and `migration_lock.toml` together.

---

## Naming Conventions

Server Prisma models use PascalCase model names mapped to snake_case Postgres table names with `@@map`. The field names for the activation and cloud-dispatch schema intentionally follow `docs/spec/08-server.md` snake_case names.

---

## Common Mistakes

<!-- Database-related mistakes your team has made -->

(To be filled by the team)
