// One-time: sign the friends service in to YOUR Dropbox and print the refresh token to store as a secret.
// Usage: node get-token.mjs <DROPBOX_APP_KEY>
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const key = process.argv[2];
if (!key) { console.log('Usage: node get-token.mjs <DROPBOX_APP_KEY>'); process.exit(1); }
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const verifier = b64url(crypto.randomBytes(48));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const url = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({ client_id: key, response_type: 'code',
  code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline' });
console.log('\n1. Open this link, sign in to Dropbox and tap Allow:\n\n' + url + '\n');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('2. Paste the code Dropbox shows you: ')).trim(); rl.close();
const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: key, code_verifier: verifier }) });
const j = await r.json();
if (!j.refresh_token) { console.log('\nThat did not work:', j.error_description || j.error || JSON.stringify(j)); process.exit(1); }
console.log('\n3. Done. Store it with:  npx wrangler secret put DBX_REFRESH_TOKEN   and paste:\n\n' + j.refresh_token + '\n');
