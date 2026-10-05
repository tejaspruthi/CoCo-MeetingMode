import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const envPath = '.env';
const zoomMode = process.argv.includes('--zoom');

function setEnvValue(source: string, key: string, value: string) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(source) ? source.replace(pattern, line) : `${source.replace(/\n?$/, '\n')}${line}\n`;
}

function webhookUrl(baseUrl: string) {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:') throw new Error('The public endpoint must use HTTPS.');
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}/zoom/webhook`;
}

if (process.argv.includes('--help')) {
  console.log('Usage: npm run setup [-- --zoom]');
  console.log('Without --zoom, creates .env from .env.example when needed.');
  console.log('With --zoom, records a public HTTPS base URL and meeting UUID; credentials stay manual.');
  process.exit(0);
}

if (!existsSync(envPath)) {
  copyFileSync('.env.example', envPath);
  console.log('Created .env from .env.example. It is ignored by Git.');
} else {
  console.log('.env already exists; existing settings will be preserved.');
}

if (!zoomMode) {
  console.log('Next: edit .env, then run `npm run setup -- --zoom` for the Zoom-specific checklist.');
  process.exit(0);
}

const rl = createInterface({ input, output });
try {
  const baseUrl = (await rl.question('Public HTTPS base URL (for example, https://example.ngrok.app): ')).trim();
  const meetingUuid = (await rl.question('Exact Zoom meeting UUID to allow: ')).trim();
  if (!baseUrl || !meetingUuid) throw new Error('Both the public HTTPS URL and the meeting UUID are required.');

  let env = readFileSync(envPath, 'utf8');
  env = setEnvValue(env, 'ZOOM_WEBHOOK_URL', webhookUrl(baseUrl));
  env = setEnvValue(env, 'ZOOM_MEETING_UUID', meetingUuid);
  writeFileSync(envPath, env);

  console.log(`\nZoom Event Notification Endpoint: ${webhookUrl(baseUrl)}`);
  console.log('Saved ZOOM_WEBHOOK_URL and ZOOM_MEETING_UUID in .env.');
  console.log('Add ZM_RTMS_CLIENT, ZM_RTMS_SECRET, and ZOOM_WEBHOOK_SECRET to .env manually.');
  console.log('Then run `npm run doctor`, start `npm run dev`, and follow docs/zoom-rtms.md.');
} finally {
  rl.close();
}
