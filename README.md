# CoCo Meeting Analyst

A small meeting companion for financial QBRs. During a Zoom meeting, it can ingest real-time transcripts, resolve an explicit “CoCo…” question into a constrained financial plan, query a Snowflake semantic view, and return a source-backed answer plus meeting notes.

The repository opens in a fully usable **demo mode**: 4,800 synthetic financial records, transcript replay, contextual follow-ups, evidence cards, and recap export. It does not pretend the local calculation is a Snowflake query.

## What the proof of concept covers

- Q3 recognized revenue vs. approved budget.
- EMEA Enterprise shortfall analysis.
- Contextual “exclude the largest customer” follow-up.
- Weighted gross margin by product.
- A native Snowflake semantic view with six governed metric definitions.
- Zoom RTMS adapter with signed webhook validation and meeting UUID filtering.
- CoCo Agent SDK adapter that uses schema-validated plans and refuses tools during interpretation.

The full implementation checklist and live setup instructions are in [PROJECT_PLAN.md](PROJECT_PLAN.md) and [docs/setup.md](docs/setup.md).

## Local run

```sh
npm install
cp .env.example .env
npm run seed
npm run dev
```

Open `http://localhost:4310`, then choose **Play sample meeting**. The sample asks the three core demo questions against synthetic data.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm run doctor
```

`doctor` reports missing live configuration without disclosing credentials. See [docs/setup.md](docs/setup.md) before enabling CoCo, Snowflake, or Zoom.

## Design boundary

CoCo is used for constrained interpretation in live mode. The application owns Snowflake execution, semantic query construction, result validation, evidence records, query IDs, and the user-visible answer card. This keeps the analytical result reviewable and prevents a meeting transcript from authorizing a write or broader account access.

All Meridian Cloud records are fictional. This independent proof of concept is not an official Snowflake product.
