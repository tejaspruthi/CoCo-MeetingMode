import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
export function verifyZoomSignature(raw:Buffer,timestamp:string|undefined,signature:string|undefined,secret:string,now=Date.now()) {
 if(!timestamp||!signature||!secret||!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return false;
 const expected=`v0=${createHmac('sha256',secret).update(`v0:${timestamp}:${raw.toString('utf8')}`).digest('hex')}`;
 return expected.length===signature.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(signature));
}
const payloadSchema=z.object({meeting_uuid:z.string(),rtms_stream_id:z.string(),server_urls:z.string().optional()});
export function createZoomAdapter(onText:(id:string,text:string,speaker:string)=>void,onStatus:(status:string)=>void,isArmed:()=>boolean) {
 const clients=new Map<string,{leave:()=>void}>();const seen=new Map<string,number>();
 function stop(){for(const client of clients.values())client.leave();clients.clear();onStatus('Stopped');}
 async function webhook(req:Request,res:Response){
  const secret=process.env.ZOOM_WEBHOOK_SECRET||'';
  if(!verifyZoomSignature(req.body,req.header('x-zm-request-timestamp'),req.header('x-zm-signature'),secret))return res.status(401).json({error:'Invalid webhook signature'});
  let body;try{body=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}
  if(body.event==='endpoint.url_validation'){
   const plainToken=body.payload?.plainToken;
   if(typeof plainToken!=='string')return res.sendStatus(400);
   return res.json({plainToken,encryptedToken:createHmac('sha256',secret).update(plainToken).digest('hex')});
  }
  const p=payloadSchema.safeParse(body.payload);if(!p.success)return res.sendStatus(400);
  if(p.data.meeting_uuid!==process.env.ZOOM_MEETING_UUID)return res.sendStatus(403);
  if(body.event==='meeting.rtms_stopped'){clients.get(p.data.rtms_stream_id)?.leave();clients.delete(p.data.rtms_stream_id);onStatus('Zoom stream ended');return res.sendStatus(200);}
  if(body.event!=='meeting.rtms_started')return res.sendStatus(200);
  if(!isArmed())return res.status(409).json({error:'Start Zoom capture in the local app first.'});
  if(!p.data.server_urls)return res.sendStatus(400);
  if(clients.has(p.data.rtms_stream_id))return res.sendStatus(200);
  // Acknowledge before native connection setup; joining is handled asynchronously.
  res.sendStatus(200);
  try{
   const rtms=(await import('@zoom/rtms')).default;
   const client=new rtms.Client();clients.set(p.data.rtms_stream_id,client);
   // Native callback ABI differs between published declarations and README examples.
   client.onTranscriptData((buffer:Buffer,...args:unknown[])=>{
    const metadata=args.at(-1) as {userName?:string;userId?:number};
    const timestamp=args.length===3?args[1]:args[0];
    const text=buffer.toString('utf8').trim();if(!text)return;
    const key=createHash('sha256').update(`${p.data.rtms_stream_id}|${metadata?.userId}|${timestamp}|${text}`).digest('hex');
    if(seen.has(key))return;seen.set(key,Date.now());
    for(const [k,t] of seen)if(Date.now()-t>600000)seen.delete(k);
    if(isArmed())onText(key,text,metadata?.userName||'Zoom participant');
   });
   client.onJoinConfirm((reason:number)=>onStatus(reason===0?'Connected to Zoom':`Zoom join status ${reason}`));
   client.onLeave((reason:number)=>{clients.delete(p.data.rtms_stream_id);onStatus(`Zoom disconnected (${reason}). Restart capture in Zoom to reconnect.`);});
   const ok=client.join({meeting_uuid:p.data.meeting_uuid,rtms_stream_id:p.data.rtms_stream_id,server_urls:p.data.server_urls,client:process.env.ZM_RTMS_CLIENT,secret:process.env.ZM_RTMS_SECRET,is_verify_cert:1});
   if(!ok){clients.delete(p.data.rtms_stream_id);client.leave();onStatus('Zoom connection failed. Check scopes, account access, and credentials.');}
  }catch{clients.delete(p.data.rtms_stream_id);onStatus('RTMS SDK could not connect. Check native platform support and configuration.');}
 }
 return {webhook,stop};
}
