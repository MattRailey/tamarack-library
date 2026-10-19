// Matt's commands for the friends service.
//   node admin.mjs invite "Smith Library" ["The Smiths' Books"]   → invite code + link (2 phones, 30 days)
//   node admin.mjs list                                            → libraries, phones and open codes
//   node admin.mjs revoke <phone id>                               → shut out one phone (lost or replaced)
//   node admin.mjs revoke-library "Smith Library"                  → shut out every phone of a library
// Needs two settings, once per computer:  set TAMARACK_SERVICE=https://tamarack-friends.<you>.workers.dev
//                                          set TAMARACK_ADMIN=<the ADMIN_SECRET you stored>
const base = (process.env.TAMARACK_SERVICE || '').replace(/\/+$/, '');
const secret = process.env.TAMARACK_ADMIN || '';
if (!base || !secret) { console.log('Set TAMARACK_SERVICE and TAMARACK_ADMIN first (see the top of this file).'); process.exit(1); }
const [cmd, a, b] = process.argv.slice(2);
const call = async (p, body) => {
  const r = await fetch(base + '/admin/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': secret }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { console.log('Error:', j.error || r.status); process.exit(1); } return j;
};
if (cmd === 'invite' && a) {
  const j = await call('invite', { lib: a, title: b || a, uses: 2, days: 30 });
  console.log(`\nInvite for ${a}\n  Code: ${j.code}\n  Link: ${j.link}\n\nGood for two phones (a couple) for 30 days. Each phone can add more later from the app.\n`);
} else if (cmd === 'list') {
  const j = await call('list');
  const libs = {};
  for (const d of j.devices) (libs[d.lib] = libs[d.lib] || []).push(d);
  for (const [lib, ds] of Object.entries(libs)) { console.log('\n' + lib); for (const d of ds) console.log(`  ${d.id}  ${d.name}  joined ${new Date(d.at).toLocaleDateString()}`); }
  if (j.codes.length) { console.log('\nOpen codes'); for (const c of j.codes) console.log(`  ${c.code}  ${c.lib}  ${c.uses} use(s) left, expires ${new Date(c.exp).toLocaleDateString()}`); }
  console.log('');
} else if (cmd === 'revoke' && a) console.log('Phones shut out:', (await call('revoke', { id: a })).revoked);
else if (cmd === 'revoke-library' && a) console.log('Phones shut out:', (await call('revoke', { lib: a })).revoked);
else console.log('Commands: invite "<Library name>" ["<Title>"] | list | revoke <phone id> | revoke-library "<Library name>"');
