"""Small, local-first CoCo meeting companion.

Run with: uvicorn coco_meeting:app --reload --port 8000
"""
import asyncio
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse

load_dotenv()
app = FastAPI(title="CoCo Meeting Agent")

# Intentionally local and ephemeral for the first prototype. Restarting clears a meeting.
STATE: Dict[str, Any] = {"transcript": [], "artifacts": [], "bot_id": None, "status": "Ready", "events": []}
ACTIVE_RTMS: Dict[str, Any] = {}
# The current CoCo Python SDK passes a Linux-only `user` keyword to asyncio's
# process launcher. Serialize requests while this small macOS compatibility shim
# is active so it cannot affect unrelated subprocesses.
COCO_LAUNCH_LOCK = asyncio.Lock()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_event(message: str) -> None:
    """Keep a short, non-sensitive lifecycle trail for RTMS troubleshooting."""
    STATE["events"].append({"at": now(), "message": message})
    del STATE["events"][:-20]


def config(name: str) -> str:
    return os.getenv(name, "").strip()


def zoom_signature(meeting_uuid: str, stream_id: str) -> str:
    client_id, client_secret = config("ZOOM_CLIENT_ID"), config("ZOOM_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET are required for RTMS.")
    payload = "%s,%s,%s" % (client_id, meeting_uuid, stream_id)
    return hmac.new(client_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def verify_zoom_webhook(headers: Any, body: bytes) -> bool:
    """Verify Zoom's v0 webhook signature before accepting RTMS events."""
    secret, timestamp, provided = (config("ZOOM_WEBHOOK_SECRET_TOKEN"),
                                   headers.get("x-zm-request-timestamp"),
                                   headers.get("x-zm-signature"))
    if not (secret and timestamp and provided):
        return False
    signed = b"v0:" + timestamp.encode() + b":" + body
    expected = "v0=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided)


async def ingest_transcript(meeting_uuid: str, content: Dict[str, Any]) -> None:
    """Store a Zoom RTMS transcript message and route an explicit CoCo request."""
    text = str(content.get("data", "")).strip()
    if not text:
        return
    fingerprint = "%s|%s|%s" % (meeting_uuid, content.get("timestamp", ""), text)
    utterance_id = hashlib.sha256(fingerprint.encode()).hexdigest()
    if any(item["id"] == utterance_id for item in STATE["transcript"]):
        return
    utterance = {"id": utterance_id, "speaker": content.get("user_name") or "Unknown speaker",
                 "text": text, "at": now()}
    STATE["transcript"].append(utterance)
    marker = text.lower().find("coco")
    if marker >= 0:
        question = text[marker + len("coco"):].lstrip(" ,:.-")
        if question:
            asyncio.create_task(run_coco(question, utterance_id))


async def connect_rtms_media(media_url: str, meeting_uuid: str, stream_id: str, signaling: Any) -> None:
    async with websockets.connect(media_url) as media:
        record_event("RTMS transcript-media connection opened")
        ACTIVE_RTMS.setdefault(meeting_uuid, {})["media"] = media
        await media.send(json.dumps({"msg_type": 3, "protocol_version": 1, "sequence": 0,
            "meeting_uuid": meeting_uuid, "rtms_stream_id": stream_id,
            "signature": zoom_signature(meeting_uuid, stream_id), "media_type": 8,
            "payload_encryption": False}))
        async for raw in media:
            message = json.loads(raw)
            if message.get("msg_type") == 4 and message.get("status_code") == 0:
                await signaling.send(json.dumps({"msg_type": 7, "rtms_stream_id": stream_id}))
                STATE["status"] = "Receiving live Zoom transcript"
                record_event("RTMS transcript stream is active")
            elif message.get("msg_type") == 12:
                await media.send(json.dumps({"msg_type": 13, "timestamp": message.get("timestamp")}))
            elif message.get("msg_type") == 17:
                await ingest_transcript(meeting_uuid, message.get("content") or {})


async def connect_rtms(meeting_uuid: str, stream_id: str, signaling_url: str) -> None:
    """Follow Zoom's RTMS signaling → transcript-media WebSocket handshake."""
    try:
        async with websockets.connect(signaling_url) as signaling:
            record_event("RTMS signaling connection opened")
            ACTIVE_RTMS.setdefault(meeting_uuid, {})["signaling"] = signaling
            await signaling.send(json.dumps({"msg_type": 1, "protocol_version": 1, "sequence": 0,
                "meeting_uuid": meeting_uuid, "rtms_stream_id": stream_id,
                "signature": zoom_signature(meeting_uuid, stream_id)}))
            async for raw in signaling:
                message = json.loads(raw)
                if message.get("msg_type") == 2 and message.get("status_code") == 0:
                    url = (message.get("media_server", {}).get("server_urls", {}).get("transcript"))
                    if url:
                        record_event("RTMS signaling handshake accepted")
                        asyncio.create_task(connect_rtms_media(url, meeting_uuid, stream_id, signaling))
                elif message.get("msg_type") == 12:
                    await signaling.send(json.dumps({"msg_type": 13, "timestamp": message.get("timestamp")}))
    except Exception as error:
        STATE["status"] = "RTMS connection failed: " + str(error)
        record_event("RTMS connection failed: " + str(error))
    finally:
        ACTIVE_RTMS.pop(meeting_uuid, None)


async def run_coco(question: str, transcript_id: str) -> None:
    """Run one read-only Snowflake CoCo request and retain its final answer."""
    artifact = {"id": str(uuid.uuid4()), "transcript_id": transcript_id, "question": question,
                "status": "running", "answer": None, "details": None, "at": now()}
    STATE["artifacts"].append(artifact)
    connection_name = config("SNOWFLAKE_CONNECTION_NAME")
    if not connection_name:
        artifact.update(status="needs_configuration", answer="CoCo is not configured yet.",
                        details="Set SNOWFLAKE_CONNECTION_NAME to the restricted Snowflake connection name.")
        return
    try:
        from cortex_code_agent_sdk import AssistantMessage, CortexCodeAgentOptions, ResultMessage, TextBlock, query

        options = CortexCodeAgentOptions(
            connection=connection_name,
            cli_path=config("CORTEX_CODE_CLI_PATH") or "/Users/tejas/.local/bin/cortex",
            # The CoCo SDK exposes Snowflake SQL as a built-in tool. No shell or file tools are enabled.
            allowed_tools=["SQL"],
            max_turns=6,
            append_system_prompt=(
                "You are a read-only meeting data assistant. Use only Snowflake SQL. "
                "Never attempt INSERT, UPDATE, DELETE, MERGE, CREATE, ALTER, DROP, GRANT, REVOKE, "
                "COPY, CALL, or any command that changes data or access. "
                "Use DEMO_FINANCE.PUBLIC unless the user explicitly asks about another permitted dataset. "
                "For this demo, do not inspect metadata before your first query. The relevant tables are: "
                "CUSTOMERS(CUSTOMER_ID, CUSTOMER_NAME, SEGMENT, INDUSTRY, REGION, SIGNUP_DATE); "
                "TRANSACTIONS(TRANSACTION_DATE, CATEGORY, AMOUNT, CURRENCY, MERCHANT, IS_RECURRING); "
                "MONTHLY_BUDGETS(BUDGET_MONTH, DEPARTMENT, CATEGORY, BUDGET_AMOUNT); "
                "REVENUE_PLAN(FISCAL_QUARTER, GEOGRAPHY, REVENUE_PLAN, REVENUE_ACTUAL, CUSTOMER_COUNT_PLAN, CUSTOMER_COUNT_ACTUAL); "
                "QUARTERLY_FINANCE_SUMMARY(FISCAL_QUARTER, REVENUE_PLAN, REVENUE_ACTUAL, BEAT_MISS_AMOUNT); "
                "GEOGRAPHY_PERFORMANCE(GEOGRAPHY, FULL_YEAR_REVENUE_PLAN, FULL_YEAR_REVENUE_ACTUAL, FULL_YEAR_BEAT_MISS_AMOUNT). "
                "Fiscal-quarter values use the form 2024-Q3. Prefer one SELECT statement; use a second query only if the first fails. "
                "Give a concise answer of at most 100 words, without narrating your tool use. Include SQL only if the user asks for it."
            ),
        )
        answer_parts = []
        result_message = None
        async with COCO_LAUNCH_LOCK:
            original_create_process = asyncio.create_subprocess_exec

            async def create_process_without_user(*args: Any, **kwargs: Any) -> Any:
                kwargs.pop("user", None)
                return await original_create_process(*args, **kwargs)

            asyncio.create_subprocess_exec = create_process_without_user
            try:
                async for message in query(prompt=question, options=options):
                    if isinstance(message, AssistantMessage):
                        answer_parts.extend(block.text for block in message.content if isinstance(block, TextBlock))
                    elif isinstance(message, ResultMessage):
                        result_message = message
            finally:
                asyncio.create_subprocess_exec = original_create_process
        if result_message and result_message.is_error:
            raise RuntimeError("; ".join(result_message.errors or ["CoCo did not complete the request."]))
        answer = (result_message.result if result_message and result_message.result else "\n".join(answer_parts)).strip()
        if not answer:
            raise RuntimeError("CoCo returned no answer.")
        artifact.update(status="complete", answer=answer,
                        details={"turns": result_message.num_turns} if result_message else None)
    except Exception as error:
        artifact.update(status="failed", answer="CoCo request failed.", details=str(error))


@app.get("/", response_class=HTMLResponse)
async def home() -> str:
    return PAGE


@app.get("/oauth/callback", response_class=HTMLResponse)
async def oauth_callback() -> str:
    return "<h2>CoCo Meeting Agent is installed in Zoom.</h2><p>You can close this tab and return to Zoom.</p>"


@app.get("/api/state")
async def state() -> Dict[str, Any]:
    return STATE


@app.post("/api/transcript/clear")
async def clear_transcript() -> Dict[str, bool]:
    """Clear only the visible transcript; an active RTMS connection continues streaming."""
    STATE["transcript"].clear()
    return {"ok": True}


@app.post("/api/artifacts/clear")
async def clear_artifacts() -> Dict[str, bool]:
    """Clear only CoCo answers; the transcript and active RTMS stream remain intact."""
    STATE["artifacts"].clear()
    return {"ok": True}


@app.post("/api/zoom/meeting")
async def create_zoom_meeting(request: Request) -> Dict[str, Any]:
    """Creates a meeting; opening start_url launches the host's normal Zoom client."""
    token = config("ZOOM_ACCESS_TOKEN")
    if not token:
        raise HTTPException(400, "Set ZOOM_ACCESS_TOKEN first.")
    title = (await request.json()).get("topic", "CoCo meeting")
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.zoom.us/v2/users/me/meetings",
            headers={"Authorization": "Bearer " + token}, json={"topic": title, "type": 1})
    if response.status_code >= 300:
        raise HTTPException(response.status_code, response.text)
    return response.json()


@app.post("/api/snowflake/check")
async def snowflake_check() -> Dict[str, Any]:
    """Prove the named, restricted Snowflake connection works; never runs user SQL."""
    connection_name = config("SNOWFLAKE_CONNECTION_NAME")
    if not connection_name:
        raise HTTPException(400, "Set SNOWFLAKE_CONNECTION_NAME first.")
    password = config("SNOWFLAKE_PASSWORD")
    try:
        import snowflake.connector
        connection_options = {"connection_name": connection_name}
        if password:
            connection_options["password"] = password
        with snowflake.connector.connect(**connection_options) as connection:
            cursor = connection.cursor()
            try:
                cursor.execute("SELECT CURRENT_USER(), CURRENT_ROLE(), CURRENT_WAREHOUSE()")
                user, role, warehouse = cursor.fetchone()
            finally:
                cursor.close()
        return {"connected": True, "user": user, "role": role, "warehouse": warehouse}
    except Exception as error:
        raise HTTPException(502, "Snowflake connection failed: " + str(error))


@app.post("/webhooks/zoom/")
async def zoom_webhook(request: Request) -> Dict[str, Any]:
    raw = await request.body()
    event = json.loads(raw)
    if event.get("event") == "endpoint.url_validation":
        plain = event.get("payload", {}).get("plainToken", "")
        secret = config("ZOOM_WEBHOOK_SECRET_TOKEN")
        if not plain or not secret:
            raise HTTPException(400, "Zoom webhook secret token is missing.")
        encrypted = hmac.new(secret.encode(), plain.encode(), hashlib.sha256).hexdigest()
        return {"plainToken": plain, "encryptedToken": encrypted}
    if not verify_zoom_webhook(request.headers, raw):
        raise HTTPException(401, "Zoom webhook signature verification failed")
    payload = event.get("payload") or {}
    if event.get("event") == "meeting.rtms_started":
        required = (payload.get("meeting_uuid"), payload.get("rtms_stream_id"), payload.get("server_urls"))
        if not all(required):
            raise HTTPException(400, "RTMS start event is missing stream details.")
        STATE["status"] = "Connecting to Zoom RTMS…"
        record_event("Zoom sent RTMS started")
        asyncio.create_task(connect_rtms(*required))
    elif event.get("event") == "meeting.rtms_stopped":
        connections = ACTIVE_RTMS.pop(payload.get("meeting_uuid"), {})
        for connection in connections.values():
            await connection.close()
        STATE["status"] = "Zoom RTMS stopped"
        record_event("Zoom sent RTMS stopped (reason %s)" % payload.get("stop_reason"))
    return {"ok": True}


@app.post("/api/demo")
async def demo() -> Dict[str, bool]:
    utterance = {"id": str(uuid.uuid4()), "speaker": "Tejas",
                 "text": "CoCo, what was EMEA enterprise revenue versus budget?", "at": now()}
    STATE["transcript"].append(utterance)
    asyncio.create_task(run_coco("what was EMEA enterprise revenue versus budget?", utterance["id"]))
    return {"ok": True}


PAGE = r'''<!doctype html><title>CoCo Meeting Agent</title><style>
body{font:15px system-ui,sans-serif;max-width:1080px;margin:36px auto;padding:0 20px;background:#f5f7f6;color:#17372f}h1{margin-bottom:4px}.muted{color:#667a74}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}section{background:white;border:1px solid #dbe5df;border-radius:12px;padding:18px;min-height:360px}input{box-sizing:border-box;width:100%;padding:10px;margin:8px 0;border:1px solid #b7cac0;border-radius:7px}button{background:#1d604f;color:white;border:0;border-radius:7px;padding:10px 13px;cursor:pointer}article{border-left:3px solid #9bbdae;padding:9px 11px;margin:10px 0;background:#f8fbf9}.artifact{border-left-color:#e3ad4d}.time{font-size:12px;color:#74877f;float:right}.status{font-size:13px;color:#426c60}details{margin-top:20px;background:white;border:1px solid #dbe5df;border-radius:12px;padding:14px 18px}summary{cursor:pointer;font-weight:600}.answer{white-space:pre-wrap;line-height:1.48;margin:12px 0 4px}.answer code{background:#e9f0ec;border-radius:4px;padding:1px 4px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.answer ul{margin:7px 0;padding-left:20px}.answer table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}.answer th,.answer td{padding:6px;text-align:left;border-bottom:1px solid #dbe5df}.answer th{background:#edf4f0}</style>
<h1>CoCo Meeting Agent</h1><p class=muted>Zoom RTMS transcript → “CoCo” request → CoCo artifact</p>
<p class=status id=status>Ready</p><p><button onclick="clearTranscript()">Clear transcript</button> <button onclick="clearArtifacts()">Clear CoCo artifacts</button></p>
<p class=muted>When your RTMS app starts in Zoom, the live transcript appears here automatically.</p>
<main><section><h2>Transcript</h2><div id=transcript></div></section><section><h2>CoCo artifacts</h2><div id=artifacts></div><h3>RTMS diagnostics</h3><div id=events></div></section></main>
<details><summary>Demo and Zoom controls</summary><p><button onclick="fetch('/api/demo',{method:'POST'}).then(load)">Add demo command</button> <button onclick="snowflake()">Check Snowflake</button></p><p><input id=topic placeholder="New Zoom meeting title"><button onclick="zoom()">Create Zoom meeting</button></p></details>
<script>const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function inline(s){return esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}
function formatAnswer(value){let lines=String(value??'').split(/\r?\n/),out=[],table=[];const flush=()=>{if(!table.length)return;let rows=table.filter(x=>!/^\s*\|?\s*:?-{3,}/.test(x));let cells=rows.map(x=>x.trim().replace(/^\||\|$/g,'').split('|').map(y=>y.trim()));if(cells.length>1)out.push('<table><thead><tr>'+cells[0].map(x=>'<th>'+inline(x)+'</th>').join('')+'</tr></thead><tbody>'+cells.slice(1).map(r=>'<tr>'+r.map(x=>'<td>'+inline(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>');else out.push('<div>'+inline(table[0])+'</div>');table=[]};for(let line of lines){if(line.includes('|'))table.push(line);else{flush();if(/^\s*-\s+/.test(line))out.push('<ul><li>'+inline(line.replace(/^\s*-\s+/,''))+'</li></ul>');else out.push('<div>'+inline(line||' ')+'</div>')}}flush();return out.join('')}
async function load(){let s=await fetch('/api/state').then(r=>r.json());status.textContent=s.status;transcript.innerHTML=s.transcript.map(x=>`<article><b>${esc(x.speaker)}</b><span class=time>${new Date(x.at).toLocaleTimeString()}</span><br>${esc(x.text)}</article>`).join('')||'<p class=muted>Waiting for Zoom RTMS…</p>';artifacts.innerHTML=s.artifacts.map(x=>`<article class=artifact><b>${esc(x.status)}</b><br><span class=muted>“${esc(x.question)}”</span><div class=answer>${formatAnswer(x.answer||'Running…')}</div>${x.details?'<small>'+esc(typeof x.details==='string'?x.details:JSON.stringify(x.details))+'</small>':''}</article>`).join('')||'<p class=muted>Say “CoCo, …” in the meeting.</p>';events.innerHTML=(s.events||[]).slice().reverse().map(x=>`<p class=muted><span class=time>${new Date(x.at).toLocaleTimeString()}</span>${esc(x.message)}</p>`).join('')||'<p class=muted>No RTMS events yet.</p>'}
async function clearTranscript(){let r=await fetch('/api/transcript/clear',{method:'POST'});if(!r.ok)return alert('Could not clear the transcript.');load()}
async function clearArtifacts(){let r=await fetch('/api/artifacts/clear',{method:'POST'});if(!r.ok)return alert('Could not clear CoCo artifacts.');load()}
async function zoom(){let r=await fetch('/api/zoom/meeting',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topic:topic.value})});let x=await r.json();if(!r.ok)return alert(JSON.stringify(x));window.open(x.start_url,'_blank')}
async function snowflake(){let r=await fetch('/api/snowflake/check',{method:'POST'});let x=await r.json();alert(r.ok?`Connected as ${x.user} with ${x.role} on ${x.warehouse}`:JSON.stringify(x))}
load();setInterval(load,1500);</script>'''
