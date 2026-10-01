# Helpdesk API

[![CI](https://github.com/mohammed-a-ashqar/helpdesk-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mohammed-a-ashqar/helpdesk-api/actions/workflows/ci.yml)

A service-desk ticketing API for a utility (electricity) provider. It has a ticket lifecycle state machine, SLA tracking, automatic assignment and role-based access control. It is built with **Fastify, TypeScript, Drizzle ORM and PostgreSQL**.

- **157 tests** (unit + integration). The integration tests run against a real Postgres engine compiled to WASM (PGlite), so no database server is needed.
- OpenAPI 3 documentation is generated from the Zod schemas and served with Swagger UI at `/docs`.
- Errors use RFC 7807 problem details with stable `urn:problem-type:*` identifiers.

## Features

| Area                 | What it does                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**             | Registration, login, rotating refresh tokens, logout. Passwords are hashed with Argon2id, access tokens are JWTs, and auth endpoints are rate limited.     |
| **RBAC**             | `customer`, `agent` and `admin` roles. Customers see only their own tickets, staff work all tickets, and admins manage users.                              |
| **Ticket lifecycle** | An explicit state machine (`open → in_progress → waiting_on_customer → resolved → closed`, with a reopen path) that lists who may perform each transition. |
| **SLA tracking**     | First-response and resolution targets per priority, with _at-risk_ and _breached_ flags. The clock pauses while a ticket waits on the customer.            |
| **Auto-assignment**  | New tickets go to the active agent covering the ticket's category who has the fewest open tickets. The strategy is pluggable (`AssignmentStrategy`).       |
| **Audit trail**      | Every change (creation, edits, transitions, assignments) is recorded and readable by staff.                                                                |
| **Domain events**    | `ticket.created`, `ticket.status_changed` and `ticket.assigned` are published only after the transaction commits.                                          |

### SLA targets

| Priority | First response | Resolution |
| -------- | -------------- | ---------- |
| urgent   | 30 min         | 4 h        |
| high     | 1 h            | 8 h        |
| medium   | 4 h            | 24 h       |
| low      | 8 h            | 72 h       |

## API

| Method  | Path                       | Access | Description                                        |
| ------- | -------------------------- | ------ | -------------------------------------------------- |
| `GET`   | `/health`                  | public | Liveness and database readiness                    |
| `POST`  | `/auth/register`           | public | Create a customer account and start a session      |
| `POST`  | `/auth/login`              | public | Exchange email and password for tokens             |
| `POST`  | `/auth/refresh`            | public | Rotate a refresh token                             |
| `POST`  | `/auth/logout`             | public | Revoke a session                                   |
| `GET`   | `/users/me`                | any    | The authenticated user                             |
| `GET`   | `/users`                   | admin  | List users                                         |
| `POST`  | `/users`                   | admin  | Create a user with any role                        |
| `PATCH` | `/users/:id`               | admin  | Update role, status, name or categories            |
| `POST`  | `/tickets`                 | any    | Raise a ticket (auto-assigned when enabled)        |
| `GET`   | `/tickets`                 | any    | List tickets, with filters, sorting and pagination |
| `GET`   | `/tickets/:id`             | any    | A ticket with its SLA status                       |
| `PATCH` | `/tickets/:id`             | staff  | Edit title, description, category or priority      |
| `POST`  | `/tickets/:id/transitions` | any    | Move a ticket through its lifecycle                |
| `PUT`   | `/tickets/:id/assignee`    | staff  | Assign, reassign or unassign                       |
| `POST`  | `/tickets/:id/auto-assign` | staff  | Let the assignment strategy pick an agent          |
| `GET`   | `/tickets/:id/activity`    | staff  | Audit trail                                        |

Full request and response schemas are in Swagger UI at **`/docs`** (JSON at `/docs/json`).

## Architecture

```
src/
├── config/          # env parsing (Zod), SLA policy
├── db/              # Drizzle schema, migrations, unit of work
├── http/            # auth guard, error handler, OpenAPI, security headers
├── modules/
│   ├── auth/        # tokens, password hashing, sessions
│   ├── users/       # users, roles, agent categories
│   ├── tickets/
│   │   ├── domain/      # state machine, lifecycle effects, access rules (pure)
│   │   └── assignment/  # strategy, workload repository, assigner
│   └── sla/         # SLA calculator (pure)
└── shared/          # errors, clock, domain event bus
```

- **Pure domain core.** The state machine, SLA calculator and assignment strategy have no I/O, so they are unit tested in isolation.
- **Unit of work.** Each use case runs in one transaction and returns its domain events, which are published only after commit.
- **Injected clock.** Time is injected everywhere, so SLA tests fast-forward a fake clock instead of sleeping.

## Getting started

Requires **Node.js ≥ 20.19** (see `.nvmrc`) and Docker for the local database.

```bash
npm install
cp .env.example .env          # then set JWT_ACCESS_SECRET
docker compose up -d          # PostgreSQL on localhost:5432
npm run db:migrate
npm run dev                   # http://localhost:3000/docs
```

## Configuration

All variables are validated at startup (`src/config/env.ts`). See `.env.example` for the full list. The main ones are:

| Variable                 | Default | Purpose                                             |
| ------------------------ | ------- | --------------------------------------------------- |
| `DATABASE_URL`           | —       | PostgreSQL connection string                        |
| `JWT_ACCESS_SECRET`      | —       | Access-token signing secret (≥ 32 chars)            |
| `JWT_ACCESS_TTL_SECONDS` | `900`   | Access-token lifetime                               |
| `REFRESH_TOKEN_TTL_DAYS` | `14`    | Refresh-token lifetime                              |
| `CORS_ORIGINS`           | empty   | Comma-separated allowed origins                     |
| `AUTO_ASSIGN_ON_CREATE`  | `true`  | Run the assignment strategy when a ticket is raised |

## Scripts

| Command                                      | Description                  |
| -------------------------------------------- | ---------------------------- |
| `npm run dev`                                | Start with hot reload        |
| `npm run build` / `npm start`                | Compile to `dist/` and run   |
| `npm test`                                   | Run all tests                |
| `npm run test:coverage`                      | Tests with a coverage report |
| `npm run lint` / `npm run typecheck`         | ESLint / TypeScript checks   |
| `npm run format`                             | Prettier                     |
| `npm run db:generate` / `npm run db:migrate` | Create / apply migrations    |

## Author

**Mohammed Alashqar** · [github.com/mohammed-a-ashqar](https://github.com/mohammed-a-ashqar)
