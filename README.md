# CoCo Meeting Analyst

CoCo is a live meeting companion for financial QBRs. It receives an authorized Zoom RTMS transcript, interprets a question with CoCo, and returns a source-backed answer from a governed Snowflake semantic view—plus evidence and a meeting recap.

This repository intentionally has **no local-answer demo mode**. The app stays in a setup state until Zoom, CoCo, and Snowflake are configured; it never substitutes fictional or local calculations for a live result.

> This is an independent proof of concept, not an official Snowflake product.

## What it does

- Ingests live meeting transcripts through Zoom RTMS.
- Detects questions addressed to CoCo and interprets their analytical intent.
- Executes constrained, read-only Snowflake semantic queries.
- Displays query-backed evidence and exports meeting notes.
- Limits Zoom events to one explicit meeting UUID and verifies every webhook signature.

## Setup

### Prerequisites

- Node.js 22.13 or newer
- npm
- A Snowflake account with a restricted runtime identity and semantic view
- A Zoom General App with RTMS access
- A public HTTPS endpoint for the Zoom webhook

### 1. Prepare local configuration

```sh
npm install
npm run setup
```

This creates an untracked `.env` from the safe template. Add your Snowflake and CoCo configuration, then use the guided Zoom helper:

```sh
npm run setup -- --zoom
```

### 2. Configure the services

Follow these guides in order:

1. [Snowflake and CoCo live setup](docs/setup.md)
2. [Zoom RTMS app, webhook, endpoint, and test setup](docs/zoom-rtms.md)

The Zoom guide explains the exact `/zoom/webhook` endpoint, the required RTMS lifecycle events, and how to keep the rest of the application local-only.

### 3. Validate and run

```sh
npm run doctor
npm test
npm run typecheck
npm run dev
```

Open [http://localhost:4310](http://localhost:4310). The connection checklist indicates what remains before you can arm Zoom capture. Once configured, select **Connect Zoom** before enabling RTMS for the approved meeting.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run setup` | Creates a local `.env` from the safe template. |
| `npm run setup -- --zoom` | Guides local Zoom webhook and meeting-UUID configuration. |
| `npm run doctor` | Reports missing live configuration without printing credentials. |
| `npm run dev` | Starts the local application. |
| `npm test` | Runs the finance behavior tests. |
| `npm run typecheck` | Checks the TypeScript code. |
| `npm run build` | Creates a production web build. |
| `npm run seed` | Generates optional sample data for the isolated Snowflake setup. |
| `npm run snowflake:setup -- --provision` | Provisions the optional isolated Snowflake sample environment. |

## Project map

| Location | Purpose |
| --- | --- |
| `apps/web/` | React meeting workspace and connection checklist. |
| `server/` | API, RTMS webhook verification, live integrations, and evidence handling. |
| `shared/` | Shared contracts between the app and server. |
| `docs/setup.md` | Snowflake and CoCo setup. |
| `docs/zoom-rtms.md` | Zoom app, RTMS, HTTPS endpoint, and webhook setup. |
| `data/`, `sql/` | Optional isolated Snowflake sample environment. |

## Privacy and credentials

- `.env`, `.env.*`, local environments, caches, build directories, and logs are ignored by Git.
- `.env.example` contains configuration names only—never copy real values into it.
- `npm run doctor` reports only whether values are present; it never prints them.
- Zoom webhooks require a valid HMAC signature and are rejected unless they match the configured meeting UUID.
- The public HTTPS route is limited to `POST /zoom/webhook`; the UI and other APIs remain local-only.

Before publishing a change, run:

```sh
git status --short
git check-ignore -v .env
git grep -n -i -E 'api[_-]?key|secret|password|access[_-]?token' || true
```

## Design boundary

CoCo is used for constrained interpretation. The application owns Snowflake execution, semantic-query construction, result validation, evidence records, query IDs, and the user-visible answer card. A meeting transcript cannot authorize writes or broader account access.
