import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Meeting } from '../shared/contracts.js';
mkdirSync('.runtime',{recursive:true});
const db=new DatabaseSync('.runtime/meetings.sqlite');
db.exec('CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
export function createMeeting():Meeting {return {id:randomUUID(),title:'Q3 business review',quarter:'2026-Q3',topic:'revenue',startedAt:new Date().toISOString(),capture:'idle',transcript:[],answers:[],notes:''};}
export function loadMeeting():Meeting {
 const row=db.prepare('SELECT payload FROM meetings ORDER BY rowid DESC LIMIT 1').get() as {payload:string}|undefined;
 if(!row)return createMeeting();const meeting:Meeting=JSON.parse(row.payload);meeting.capture='idle';
 for(const a of meeting.answers)if(a.status==='queued'||a.status==='querying'){a.status='failed';a.error='Server restarted. Submit this question again.';}
 return meeting;
}
export function saveMeeting(meeting:Meeting){db.prepare('INSERT INTO meetings(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(meeting.id,JSON.stringify(meeting));}
export function deleteMeeting(id:string){db.prepare('DELETE FROM meetings WHERE id=?').run(id);}
export function recap(meeting:Meeting) {
 const findings=meeting.answers.filter(a=>a.status==='answered'&&a.pinned).map(a=>`- ${a.headline}\n  - ${a.interpretation}\n  - Evidence: ${a.evidence.map(e=>e.queryId??'local synthetic calculation (not Snowflake)').join(', ')}`).join('\n');
 const unresolved=meeting.answers.filter(a=>['needs_clarification','failed'].includes(a.status)).map(a=>`- ${a.question}: ${a.error??a.headline}`).join('\n');
 return `# ${meeting.title}\n\n${meeting.quarter} · Meridian Cloud · Synthetic demonstration\n\n## Pinned analytical findings\n\n${findings||'No findings pinned.'}\n\n## Notes and follow-ups\n\n${meeting.notes||'No notes added. Owners and due dates are not inferred.'}\n\n## Open questions\n\n${unresolved||'None.'}\n\n## Discussion transcript\n\n${meeting.transcript.map(s=>`- **${s.speaker}:** ${s.text}`).join('\n')}\n`;
}
