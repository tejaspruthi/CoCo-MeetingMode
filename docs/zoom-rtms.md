# Zoom RTMS setup

This guide connects a Zoom meeting's live transcript to CoCo Meeting Analyst. It is intentionally split into two parts:

1. **Zoom configuration** — completed in the Zoom App Marketplace by the app owner.
2. **Local configuration** — completed in this repository without committing credentials.

The app is designed so that Zoom can reach only its signed webhook route, `POST /zoom/webhook`. The meeting UI and all other API routes remain local-only.

## Before you start

- Node.js 22.13 or newer and `npm`.
- A Zoom account eligible for [Real-Time Media Streams (RTMS)](https://developers.zoom.us/docs/rtms/), including any required Zoom credits or account enablement.
- A public, stable HTTPS URL for webhook delivery. For local testing, use a tunnel with a stable domain; for production, use a small HTTPS service or reverse proxy that forwards **only** `/zoom/webhook` to this app.
- A test meeting hosted by the Zoom account that owns or has authorized the app.

## 1. Start the local app

```sh
npm install
npm run setup
npm run seed
npm run dev
```

Leave the app running on `http://localhost:4310`. The normal UI must stay local; do not publish the whole application.

## 2. Give Zoom a public webhook endpoint

Zoom must call a publicly reachable HTTPS address. Point your tunnel or reverse proxy at port `4310` and use this exact path:

```text
https://YOUR-PUBLIC-DOMAIN/zoom/webhook
```

For example, when testing with a tunnel, forward traffic to `http://localhost:4310` and copy the tunnel's HTTPS base URL. Keep that URL stable after configuring it in Zoom. Zoom validates the endpoint during setup, so changing the domain later requires updating the Marketplace app.

The server accepts the public route before its local-only guard. Requests to the UI, `/api/*`, and every other route from a public host are rejected.

## 3. Create and configure the Zoom app

1. In the [Zoom App Marketplace](https://marketplace.zoom.us/), open **Develop → Build App** and create a **General App**. RTMS requires this app type.
2. In **Basic Information**, provide the required app details and an OAuth redirect URL. Copy the app's **Client ID**, **Client Secret**, and **Secret Token**. Treat each as a password.
3. In **Event Subscriptions**, enable subscriptions and set the Event Notification Endpoint to the URL from step 2, including `/zoom/webhook`.
4. Subscribe to the RTMS lifecycle events:
   - `meeting.rtms_started`
   - `meeting.rtms_stopped`
5. In **Scopes**, add the RTMS permission required for meeting transcript access. Zoom's current scope labels can change; use the Marketplace scope picker and Zoom's [RTMS app guidance](https://developers.zoom.us/blog/rtms-recall-ai-guide/) to select the meeting RTMS and transcript/media scopes shown for your account.
6. Save the app. If your Zoom account requires it, enable RTMS and select this General App under **Settings → Zoom Apps** before testing.

Zoom's [RTMS webhook reference](https://developers.zoom.us/docs/api/rtms/events/) documents the `meeting.rtms_started` payload used by this project. The application verifies Zoom's request HMAC, rejects stale signatures, and permits events only for the exact meeting UUID you configure.

## 4. Configure the local project

Run the guided helper:

```sh
npm run setup -- --zoom
```

It creates `.env` if needed, records the public webhook URL and meeting UUID, and prints the exact Event Notification Endpoint to paste into Zoom. It never asks for, logs, or commits your secrets.

Then open `.env` and set the three values copied from the Zoom app:

```ini
ZM_RTMS_CLIENT=your_client_id
ZM_RTMS_SECRET=your_client_secret
ZOOM_WEBHOOK_SECRET=your_secret_token
```

Keep `ZOOM_MEETING_UUID` set to the **meeting UUID**, not the numeric meeting ID. This is an allowlist: RTMS events for any other meeting receive a `403` response.

Confirm the setup without printing secrets:

```sh
npm run doctor
```

## 5. Test an end-to-end meeting

1. Start the tunnel or reverse proxy, then start the local app with `npm run dev`.
2. Start the approved Zoom meeting and have another participant speak.
3. In CoCo Meeting Analyst, select **Connect Zoom** to arm capture.
4. Start RTMS from the Zoom meeting according to your account's RTMS configuration.
5. Confirm transcript items appear in the Conversation panel, then ask a CoCo question.
6. Stop capture in the app when the meeting ends.

If capture does not begin, check the webhook endpoint URL, the app's event subscriptions and scopes, the configured meeting UUID, and `npm run doctor`. Do not loosen the signature check or remove the meeting UUID allowlist to troubleshoot.

## Endpoint deployment checklist

If you host the webhook beyond a development tunnel:

- Terminate TLS at the public HTTPS endpoint.
- Forward only `POST /zoom/webhook` to the Node server on `127.0.0.1:4310`.
- Preserve the raw request body and Zoom's `x-zm-request-timestamp` and `x-zm-signature` headers; signature validation depends on them.
- Do not expose the CoCo UI or `/api/*` through the proxy.
- Keep `ZM_RTMS_SECRET` and `ZOOM_WEBHOOK_SECRET` in the deployment environment, never in GitHub or client-side code.
