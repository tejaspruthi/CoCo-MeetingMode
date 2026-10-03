import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { execute } from '../server/live.js';
// Explicit provisioning command, separate from app startup. Fixed demo objects only.
if(!process.argv.includes('--provision'))throw new Error('Provisioning requires: npm run snowflake:setup -- --provision. Set SNOWFLAKE_ROLE to your provisioning role for this command only.');
for(const file of ['sql/01-bootstrap.sql','data/load.sql','sql/02-semantic-view.sql']){
 const sql=readFileSync(file,'utf8').replace(/^\s*--.*$/gm,'');
 // Statements contain quoted comments with semicolons; split outside SQL string literals.
 const statements:string[]=[];let buffer='',quoted=false;
 for(let i=0;i<sql.length;i++){const ch=sql[i];if(ch==="'"){if(quoted&&sql[i+1]==="'"){buffer+="''";i++;continue;}quoted=!quoted;}if(ch===';'&&!quoted){if(buffer.trim())statements.push(buffer);buffer='';}else buffer+=ch;}
 if(buffer.trim())statements.push(buffer);
 for(const stmt of statements)await execute(stmt);
 console.log(`Applied ${file}`);
}
console.log('Provisioned demo. Restore runtime role COCO_QBR_READER and validate the golden queries before enabling LIVE_ACCESS_VERIFIED.');
