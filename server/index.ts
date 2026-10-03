import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { DATASET_VERSION, type Answer, type Health } from '../shared/contracts.js';
import { localAnalysis, headline, interpretation } from './finance.js';
import { parseDemoQuestion, basePlan, inheritsPriorScope } from './intent.js';
import { interpretLive, liveAnalysis } from './live.js';
import { createMeeting, loadMeeting, saveMeeting, deleteMeeting, recap } from './store.js';
import { createZoomAdapter } from './zoom.js';
import replay from '../fixtures/transcript.json' with {type:'json'};
const app=express(); const port=Number(process.env.PORT||4310);
const mode=process.env.ANALYSIS_MODE==='live'?'live':'demo';
const cliAvailable=spawnSync(process.env.CORTEX_CODE_CLI_PATH||'cortex',['--version'],{timeout:3000}).status===0;
const health:Health={mode,snowflakeConfigured:!!(process.env.SNOWFLAKE_ACCOUNT&&process.env.SNOWFLAKE_USER),cortexConfigured:!!(cliAvailable&&process.env.CORTEX_CONNECTION),zoomConfigured:!!(process.env.ZM_RTMS_CLIENT&&process.env.ZM_RTMS_SECRET&&process.env.ZOOM_WEBHOOK_SECRET&&process.env.ZOOM_MEETING_UUID),liveEnabled:process.env.LIVE_ACCESS_VERIFIED==='true',datasetVersion:DATASET_VERSION};
let meeting=loadMeeting(), captureStatus='Ready';let active:AbortController|undefined;let replayTimer:ReturnType<typeof setInterval>|undefined;
const clients=new Set<express.Response>();
function snapshot(){return {meeting,health,captureStatus,overview:localAnalysis({...basePlan,quarter:meeting.quarter}).summary};}
function publish(){saveMeeting(meeting);const msg=`data: ${JSON.stringify(snapshot())}\n\n`;for(const c of clients)c.write(msg);}
function stopCapture(){if(speech){clearTimeout(speech.timer);speech=undefined;}if(replayTimer)clearInterval(replayTimer);replayTimer=undefined;meeting.capture='idle';zoom.stop();captureStatus='Stopped';}
function transcript(id:string,text:string,speaker:string,source:'zoom'|'replay'){
 if(meeting.endedAt||meeting.transcript.some(s=>s.id===id))return;
 meeting.transcript.push({id,text,speaker,timestamp:new Date().toISOString(),source});publish();
 if(/\bcoco\b/i.test(text))enqueue(text.replace(/^.*?\bcoco[,\s]*/i,''));
}
let speech:{text:string;speaker:string;timer:ReturnType<typeof setTimeout>}|undefined;
function flushSpeech(){if(!speech)return;const s=speech;clearTimeout(s.timer);speech=undefined;try{enqueue(s.text.replace(/^.*?\bcoco[,\s]*/i,''));}catch(e){captureStatus=(e as Error).message;publish();}}
const zoom=createZoomAdapter((id,text,speaker)=>{
 if(meeting.transcript.some(s=>s.id===id))return;
 meeting.transcript.push({id,text,speaker,timestamp:new Date().toISOString(),source:'zoom'});publish();
 if(speech&&speech.speaker!==speaker)flushSpeech();
 if(speech){clearTimeout(speech.timer);speech.text=text.startsWith(speech.text)?text:speech.text+' '+text;speech.timer=setTimeout(flushSpeech,1400);}
 else if(/\bcoco\b/i.test(text))speech={text,speaker,timer:setTimeout(flushSpeech,1400)};
},s=>{captureStatus=s;publish();},()=>meeting.capture==='zoom'&&!meeting.endedAt);
app.post('/zoom/webhook',express.raw({type:'application/json',limit:'128kb'}),zoom.webhook);
// Only the signed webhook may be tunneled. The entire UI/API is local-only.
app.use((req,res,next)=>{
 const host=req.headers.host?.split(':')[0];if(!['localhost','127.0.0.1'].includes(host||''))return res.status(403).json({error:'This PoC UI is local-only. Expose only /zoom/webhook.'});
 if(req.method!=='GET'&&req.method!=='HEAD'){
  const origin=req.headers.origin;if(origin!==`http://${req.headers.host}`)return res.status(403).json({error:'Same-origin request required.'});
 }
 next();
});
app.use(express.json({limit:'64kb'}));
app.get('/api/state',(_req,res)=>res.json(snapshot()));
app.get('/api/events',(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();res.write(`data: ${JSON.stringify(snapshot())}\n\n`);clients.add(res);const t=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clients.delete(res);clearInterval(t);});});
function enqueue(question:string,parentId?:string){
 if(meeting.endedAt)throw new Error('Start a new meeting before submitting questions.');
 if(meeting.answers.filter(a=>a.status==='queued'||a.status==='querying').length>=4)throw new Error('Investigation queue is full. Wait or cancel a question.');
 if(meeting.answers.length>=30)throw new Error('This demo is limited to 30 questions per meeting. Start a new meeting.');
 // Preserve analysis context only for a direct card follow-up or language that
 // clearly refers back to the preceding question. A new scoped question (for
 // example, “show overall gross margin”) must not inherit an old exclusion.
 const parent=parentId
  ? meeting.answers.find(a=>a.id===parentId)
  : inheritsPriorScope(question)
    ? [...meeting.answers].reverse().find(a=>['answered','queued','querying'].includes(a.status))
    : undefined;
 const answer:Answer={id:randomUUID(),question,parentId:parent?.id,plan:parent?.plan??{...basePlan,quarter:meeting.quarter},status:'queued',evidence:[],pinned:false,createdAt:new Date().toISOString()};
 meeting.answers.push(answer);publish();void drain();return answer;
}
async function drain(){
 if(active)return;const answer=meeting.answers.find(a=>a.status==='queued');if(!answer)return;
 const controller=new AbortController();active=controller;answer.status='querying';publish();
 const deadline=setTimeout(()=>controller.abort(),45000);
 try{
  const parent=answer.parentId?meeting.answers.find(a=>a.id===answer.parentId)?.plan:undefined;
  if(mode==='live'&&(!health.cortexConfigured||!health.snowflakeConfigured||!health.liveEnabled))throw new Error('Live mode is not configured. Run npm run doctor and complete docs/setup.md. No demo fallback was used.');
  answer.plan=mode==='demo'?parseDemoQuestion(answer.question,parent,meeting.quarter,meeting.topic):await interpretLive(answer.question,parent,meeting.quarter,meeting.topic,controller.signal);
  controller.signal.throwIfAborted();
  if(answer.plan.clarification){answer.status='needs_clarification';answer.headline=answer.plan.clarification;}
  else {
   const result=mode==='demo'?localAnalysis(answer.plan):await liveAnalysis(answer.plan,controller.signal);
   controller.signal.throwIfAborted();answer.evidence=result.evidence;answer.summary=result.summary;answer.excludedCustomer=result.excludedCustomer;
   answer.headline=headline(answer.plan,result.summary);answer.interpretation=interpretation(answer.plan,result.excludedCustomer);answer.status='answered';
  }
 }catch(error){if(controller.signal.aborted){answer.status='cancelled';answer.error='Investigation stopped or reached its deadline.';}else{answer.status='failed';answer.error=mode==='demo'?(error as Error).message:'Live analysis failed. Check local configuration and server diagnostics; no synthetic fallback was used.';console.error('[analysis]',error instanceof Error?error.name:'error');}}
 finally{clearTimeout(deadline);active=undefined;publish();void drain();}
}
app.post('/api/questions',(req,res)=>{const b=z.object({question:z.string().trim().min(3).max(1000),parentId:z.string().optional()}).parse(req.body);res.json(enqueue(b.question,b.parentId));});
app.post('/api/answers/:id/cancel',(req,res)=>{const a=meeting.answers.find(x=>x.id===req.params.id);if(!a)return res.sendStatus(404);if(a.status==='querying')active?.abort();if(['queued','querying'].includes(a.status))a.status='cancelled';publish();res.json({ok:true});});
app.post('/api/answers/:id/pin',(req,res)=>{const a=meeting.answers.find(x=>x.id===req.params.id);if(!a)return res.sendStatus(404);a.pinned=!a.pinned;publish();res.json({ok:true});});
app.post('/api/meeting/context',(req,res)=>{const b=z.object({topic:z.enum(['revenue','margin']).optional(),notes:z.string().max(20000).optional()}).parse(req.body);Object.assign(meeting,b);publish();res.json({ok:true});});
app.post('/api/capture/replay',(_req,res)=>{if(meeting.endedAt)return res.status(409).json({error:'Start a new meeting first.'});stopCapture();meeting.capture='replay';captureStatus='Replaying sample QBR';let i=0;const run=randomUUID();
 const tick=()=>{if(i>=replay.length){if(replayTimer)clearInterval(replayTimer);replayTimer=undefined;meeting.capture='idle';captureStatus='Replay complete';publish();return;}const s=replay[i++];try{transcript(`${run}-${i}`,s.text,s.speaker,'replay');}catch(e){captureStatus=(e as Error).message;publish();}};
 tick();replayTimer=setInterval(tick,4500);publish();res.json({ok:true});});
app.post('/api/capture/zoom',(_req,res)=>{if(!health.zoomConfigured)return res.status(409).json({error:'Zoom credentials and meeting UUID are missing. See docs/setup.md.'});if(meeting.endedAt)return res.status(409).json({error:'Start a new meeting first.'});stopCapture();meeting.capture='zoom';captureStatus='Armed. Start RTMS in your Zoom meeting.';publish();res.json({ok:true});});
app.post('/api/capture/stop',(_req,res)=>{stopCapture();publish();res.json({ok:true});});
app.post('/api/meeting/end',(_req,res)=>{stopCapture();active?.abort();for(const a of meeting.answers)if(a.status==='queued')a.status='cancelled';meeting.endedAt=new Date().toISOString();publish();res.json({ok:true});});
app.post('/api/meeting/new',(_req,res)=>{if(active)return res.status(409).json({error:'Cancel the active investigation before starting a new meeting.'});stopCapture();meeting=createMeeting();publish();res.json({ok:true});});
app.post('/api/meeting/delete',(_req,res)=>{if(active)return res.status(409).json({error:'Cancel the active investigation first.'});stopCapture();deleteMeeting(meeting.id);meeting=createMeeting();publish();res.json({ok:true});});
app.get('/api/meeting/export',(_req,res)=>{res.setHeader('Content-Disposition','attachment; filename="qbr-recap.md"');res.type('text/markdown').send(recap(meeting));});
app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API route'}));
app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:err instanceof z.ZodError?'Invalid request':err.message}));
if(process.env.NODE_ENV==='production'){
 app.use(express.static(resolve('dist')));app.get('/{*splat}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
}else{
 const {createServer:createViteServer}=await import('vite');const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);
}
const server=createServer(app);server.listen(port,'127.0.0.1',()=>console.log(`CoCo Meeting Analyst: http://localhost:${port} · ${mode.toUpperCase()} mode`));
function shutdown(){stopCapture();active?.abort();saveMeeting(meeting);server.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
