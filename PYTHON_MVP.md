# CoCo Meeting Agent — Python MVP

This intentionally leaves the existing Node proof-of-concept alone. The MVP is one Python application, `coco_meeting.py`, with a tiny HTML dashboard and Zoom RTMS receiver in the same process.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.python.example .env
.venv/bin/uvicorn coco_meeting:app --reload --port 8000
```

Open `http://127.0.0.1:8000`. **Add demo command** proves the transcript-to-artifact path without external credentials.

## Connect Zoom RTMS

1. Create a user-managed **General app** in the Zoom App Marketplace, add `meeting:read:meeting_transcript`, and enable the RTMS Started and Stopped event subscriptions.
2. Create a stable public HTTPS tunnel to port 8000. Configure the app's event URL as `https://YOUR-TUNNEL/webhooks/zoom/`; Zoom validates this route automatically.
3. Add the app's Client ID, Client Secret, and webhook Secret Token to `.env`, then restart the app.
4. Install the app locally, enable the Zoom setting that permits apps to share real-time meeting content, and configure the app to auto-start in Zoom Apps settings.

The app verifies Zoom's webhook HMAC before accepting RTMS start/stop events. On a start event it completes Zoom's signaling and transcript-media WebSocket handshakes, receives transcript packets, and routes explicit “CoCo …” requests.

## Connect Zoom and CoCo

- Set a short-lived `ZOOM_ACCESS_TOKEN` to make **Create Zoom meeting** create a meeting and open the returned host `start_url`. A Zoom OAuth refresh flow is deliberately not part of this first script.
- Create a named, restricted Snowflake connection in `~/.snowflake/connections.toml`, set its name as `SNOWFLAKE_CONNECTION_NAME`, then select **Check Snowflake**. The script only runs `CURRENT_USER`, `CURRENT_ROLE`, and `CURRENT_WAREHOUSE`; it has no free-form SQL endpoint.
- Set `COCO_COMMAND` only after choosing the exact approved CoCo/Cortex runner available in your environment. The adapter passes JSON on standard input and records text output or JSON fields `answer`, `query_id`, `sql`, and `references`. This avoids inventing an unsupported Python CoCo SDK command.

Snowflake is intentionally not queried directly by the dashboard. CoCo should use the restricted Snowflake connection/role you configure for its runner, rather than exposing arbitrary SQL execution from meeting speech.
