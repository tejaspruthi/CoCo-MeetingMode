# CoCo Meeting Analyst

CoCo is a meeting companion for financial QBRs. Ask a plain-English question during a meeting and get a concise, source-backed answer—plus evidence and a meeting recap.

It opens in a ready-to-use **demo mode** with fictional data, a sample transcript, contextual follow-up questions, and exportable meeting notes. No live Snowflake, Zoom, or AI credentials are required to explore it.

> All Meridian Cloud records and meeting content in this repository are fictional. This is an independent proof of concept, not an official Snowflake product.

## What you can try

- Compare Q3 recognized revenue with approved budget.
- Investigate the EMEA Enterprise shortfall.
- Ask a contextual follow-up such as “exclude the largest customer.”
- Review weighted gross margin by product.
- Replay a sample meeting and export the recap.

In live mode, CoCo can connect to a governed Snowflake semantic view and Zoom RTMS. The app produces reviewable answers with source evidence rather than treating a transcript as authorization for broad data access.

## Quick start

### Prerequisites

- Node.js 22.13 or newer
- npm

### Run the demo

```sh
npm install
cp .env.example .env
npm run seed
npm run dev
```

Open [http://localhost:4310](http://localhost:4310), then select **Play sample meeting**. The replay runs against synthetic financial data stored locally.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the local application. |
| `npm run seed` | Loads the synthetic demo data. |
| `npm test` | Runs the finance behavior tests. |
| `npm run typecheck` | Checks the TypeScript code. |
| `npm run build` | Creates a production web build. |
| `npm run doctor` | Reports missing live-mode setup without printing credentials. |
| `npm run snowflake:setup` | Prepares the Snowflake demo setup when live access is configured. |

## Project map

| Location | Purpose |
| --- | --- |
| `apps/web/` | React meeting experience. |
| `server/` | API, finance logic, live integrations, and evidence handling. |
| `shared/` | Shared contracts between the app and server. |
| `data/`, `sql/` | Synthetic data and Snowflake semantic-view setup. |
| `fixtures/` | Sample transcript and expected demo behavior. |
| `tests/` | Automated finance tests. |
| `docs/setup.md` | Detailed instructions for optional Snowflake, Zoom, and CoCo live integrations. |

## Privacy and credentials

The repository is set up to keep local secrets out of Git:

- `.env`, `.env.*`, Python virtual environments, caches, build directories, and logs are ignored.
- `.env.example` contains configuration names and safe example values only; copy it to `.env` for local use.
- `npm run doctor` checks configuration availability without disclosing credential values.
- Demo mode uses only the included fictional fixtures and synthetic financial data.

Before sharing or publishing, run this quick check:

```sh
git status --short
git check-ignore -v .env
git grep -n -i -E 'api[_-]?key|secret|password|access[_-]?token' || true
```

If you enable live services, keep all tokens, passwords, client secrets, and private-key paths in your untracked `.env`. See [docs/setup.md](docs/setup.md) for the full setup flow.

## Design boundary

CoCo is used for constrained interpretation in live mode. The application owns Snowflake execution, semantic-query construction, result validation, evidence records, query IDs, and the user-visible answer card. This keeps analytical results reviewable and prevents a meeting transcript from authorizing writes or broader account access.

## More detail

- [Live integration setup](docs/setup.md)
- [Project plan and implementation checklist](PROJECT_PLAN.md)
- [Python MVP notes](PYTHON_MVP.md)
