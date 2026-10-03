# Live-service setup

The app runs in safe local demo mode by default. It uses a synthetic data generator and labels every answer as a local calculation. It does not call Snowflake, CoCo, or Zoom until you configure each service.

## 1. Install and configure CoCo

Install the CoCo CLI using Snowflake's official instructions, then sign in to an account that has CoCo access. A standard Snowflake trial does not provide CoCo CLI access; use the dedicated CoCo CLI trial or a paid account.

Create a named connection called `qbr` in `~/.snowflake/connections.toml` using your preferred approved authentication method. Do not put the connection password or private key in this repository.

Run:

```sh
npm run doctor
```

It should report that the CLI and named connection are available. It deliberately never prints credentials.

## 2. Create the isolated Snowflake demo data

Copy `.env.example` to `.env` and set the Snowflake account, user, and provisioning role details for this one command. The provisioning identity needs permission to create the demo database, warehouse, role, table, and semantic view.

Generate the data file:

```sh
npm run seed
```

Provision the objects:

```sh
npm run snowflake:setup -- --provision
```

The command applies `sql/01-bootstrap.sql`, `data/load.sql`, and `sql/02-semantic-view.sql`. It creates only the `COCO_QBR_DEMO` database, `COCO_QBR_WH` warehouse, and `COCO_QBR_READER` role defined in those files.

After provisioning, explicitly assign `COCO_QBR_READER` to the user or service identity that will run the application. Set `SNOWFLAKE_ROLE=COCO_QBR_READER` and restore the runtime warehouse configuration. Do not grant a broad administrative role to the app.

Before enabling live mode, manually run the generated golden queries from `fixtures/expected.json` and verify the semantic view returns matching results. Then change both settings in `.env`:

```ini
ANALYSIS_MODE=live
LIVE_ACCESS_VERIFIED=true
```

Restart the application. Live mode fails closed: it will never show local synthetic results in place of a failed Snowflake query.

## 3. Connect Zoom RTMS

In Zoom Marketplace, create an RTMS-enabled General app, add the required RTMS transcript scope, and subscribe to the RTMS start and stop webhook events. Developer Pack credits are needed for RTMS. RTMS with transcripts is currently listed as $0.02 per active streaming minute.

The Zoom webhook must reach only this app's `POST /zoom/webhook` route via HTTPS. The UI and all other local APIs must remain on `localhost`. Configure a tunnel or deployment that routes that exact path without exposing the rest of the server.

Set the RTMS client ID/secret, webhook secret, and the exact intended meeting UUID in `.env`. The app verifies Zoom's HMAC signature and rejects a webhook for a different meeting UUID. In the local UI, choose **Connect Zoom** before starting RTMS in the meeting.

For the first validation, use a meeting hosted by the app owner. Confirm that a second participant's transcript enters the Conversation panel, ask “CoCo, how much did EMEA enterprise miss budget?”, and inspect the answer's Snowflake query ID.

## Run and validate

```sh
npm run dev
npm test
npm run typecheck
npm run build
```

Visit `http://localhost:4310`. Use **Play sample meeting** for the self-contained demonstration. A real meeting requires all three live configuration stages above.
