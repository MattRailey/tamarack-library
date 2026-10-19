/* Railey Library — admin.js
   "Invite a friend" (Data & Sync): Matt's controls for the friends service, in place of worker/admin.mjs.
   The admin secret is typed once per device (a password field, so a password manager can keep it) and kept in this
   browser only (ADMIN_KEY). It never goes into the catalog, Dropbox or a link. Hidden on friends' phones.
   The secret can make invites and switch phones off; it can't read any library.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

const ADMIN_KEY='tamarack_library_admin';
function adminSecret(){ return lsGet(ADMIN_KEY)||''; }
async function adminCall(ep, body){
  const r=await fetch(friendServer().replace(/\/+$/,'')+'/admin/'+ep, { method:'POST',
    headers:{ 'Content-Type':'application/json', 'X-Admin':adminSecret() }, body:JSON.stringify(body||{}) });
  const j=await r.json().catch(()=>({}));
  if(r.status===401) throw Object.assign(new Error('The service didn’t accept that password. Check it, or paste it again.'), { badSecret:true });
  if(!r.ok) throw new Error(j.error || 'HTTP '+r.status);
  return j;
}
function adminMsg(t){ $('adm-msg').textContent=t||''; }
function adminFail(e){
  if(e.badSecret){ try{ localStorage.removeItem(ADMIN_KEY); }catch(x){} renderAdmin(); }
  adminMsg(e instanceof TypeError ? 'Couldn’t reach the library service. Check the connection and try again.' : e.message);
}
// Shown on devices with their own Dropbox (Matt's), never on a friend's phone; folded away until opened.
function renderAdmin(){
  const show=!!friendServer() && !friendCfg();
  $('adm-card').classList.toggle('hide', !show);
  if(!show) return;
  const has=!!adminSecret();
  $('adm-login').classList.toggle('hide', has);
  $('adm-tools').classList.toggle('hide', !has);
  if(has && $('adm-card').open) adminList();
}
$('adm-refresh').onclick=()=>adminList();
$('adm-card').addEventListener('toggle', ()=>{ if($('adm-card').open && adminSecret()) adminList(); });
// a real form, so Dashlane / iCloud Keychain offer to save the secret and fill it next time
$('adm-login').onsubmit=async e=>{
  e.preventDefault();
  const s=$('adm-secret').value.trim();
  if(s.length<16){ adminMsg('That’s too short to be the password.'); return; }
  lsSet(ADMIN_KEY, s); $('adm-secret').value='';
  adminMsg('Checking…');
  try{ await adminCall('list'); adminMsg(''); renderAdmin(); toast('Password saved on this device'); }
  catch(err){ adminFail(err); }
};
$('adm-forget').onclick=()=>{ if(!confirm('Forget the password on this device? You can paste it again any time.')) return;
  try{ localStorage.removeItem(ADMIN_KEY); }catch(e){} adminMsg(''); $('adm-invite-out').innerHTML=''; renderAdmin(); };

$('adm-invite').onclick=async()=>{
  const lib=$('adm-lib').value.trim(), title=$('adm-title').value.trim();
  if(!lib){ adminMsg('Type the library’s name first, e.g. Smith Library.'); return; }
  const btn=$('adm-invite'); btn.disabled=true; adminMsg('Making the invite…');
  try{
    const j=await adminCall('invite', { lib, title:title||lib, uses:2, days:30 });
    adminMsg('');
    const text='Here’s your invite to '+(title||lib)+'. Open this link on your phone (code '+j.code+'):';
    $('adm-invite-out').innerHTML='<div class="wz-invite"><div class="note" style="margin:0;">Invite for <b>'+esc(lib)+'</b>: good for two phones (a couple) for 30 days.</div>'
      +'<div class="wz-code">'+esc(j.code)+'</div><input readonly id="adm-link" value="'+esc(j.link)+'">'
      +'<div class="row" style="margin-top:8px;">'+(navigator.share?'<button id="adm-share">Share invite</button>':'')+'<button class="secondary" id="adm-copy">Copy link</button></div></div>';
    if($('adm-share')) $('adm-share').onclick=()=>navigator.share({ title:title||lib, text, url:j.link }).catch(()=>{});
    $('adm-copy').onclick=async()=>{ try{ await navigator.clipboard.writeText(text+' '+j.link); toast('Invite copied'); }catch(e){ $('adm-link').select(); } };
    adminList();
  }catch(e){ adminFail(e); }
  btn.disabled=false;
};

let admData=null;
async function adminList(){
  $('adm-list').innerHTML='<p class="note">Loading…</p>';
  try{ admData=await adminCall('list'); }catch(e){ $('adm-list').innerHTML=''; adminFail(e); return; }
  const libs=new Map(), add=l=>{ if(!libs.has(l)) libs.set(l,{ phones:[], codes:[] }); return libs.get(l); };
  admData.devices.forEach(d=>add(d.lib).phones.push(d));
  admData.codes.forEach(c=>add(c.lib).codes.push(c));
  const day=t=>t?new Date(t).toLocaleDateString(undefined,{ day:'numeric', month:'short', year:'numeric' }):'';
  $('adm-list').innerHTML = libs.size ? [...libs.entries()].sort((a,b)=>natCmp(a[0],b[0])).map(([lib,x])=>
    '<div class="sr-item"><h4>'+esc(lib)+' <span class="note" style="font-weight:400;">· '+x.phones.length+' phone'+(x.phones.length===1?'':'s')+'</span></h4>'
    +x.phones.map(d=>'<div class="sr-loc adm-row"><span>'+esc(d.name||'Phone')+' <span class="note">joined '+day(d.at)+'</span></span><button class="secondary adm-off" data-id="'+esc(d.id)+'" data-name="'+esc(d.name||'Phone')+'" data-lib="'+esc(lib)+'">Switch off</button></div>').join('')
    +x.codes.map(c=>'<div class="sr-loc adm-row"><span>Open invite <b>'+esc(c.code)+'</b> <span class="note">'+c.uses+' use'+(c.uses===1?'':'s')+' left, until '+day(c.exp)+'</span></span></div>').join('')
    +'<div class="row" style="margin-top:6px;"><button class="secondary adm-more" data-lib="'+esc(lib)+'">Invite another</button>'
    +(x.phones.length?'<button class="danger adm-all" data-lib="'+esc(lib)+'">Switch off every phone</button>':'')+'</div></div>').join('')
    : '<p class="note">No friends’ libraries yet.</p>';
}
$('adm-list').onclick=async e=>{
  const off=e.target.closest('.adm-off'), all=e.target.closest('.adm-all'), more=e.target.closest('.adm-more');
  if(more){ $('adm-lib').value=more.dataset.lib; $('adm-title').value=''; $('adm-lib').scrollIntoView({ behavior:'smooth', block:'center' }); return; }
  try{
    if(off){
      if(!confirm('Switch off “'+off.dataset.name+'” in '+off.dataset.lib+'? That phone can’t open the library any more (within about a minute). The books stay safe for the other phones.')) return;
      await adminCall('revoke', { id:off.dataset.id }); toast('Phone switched off');
    }
    if(all){
      if(!confirm('Switch off EVERY phone in '+all.dataset.lib+'? The books stay in your Dropbox; they’d need new invites to get back in.')) return;
      const j=await adminCall('revoke', { lib:all.dataset.lib }); toast((j.revoked||0)+' phone'+(j.revoked===1?'':'s')+' switched off');
    }
    if(off||all) adminList();
  }catch(err){ adminFail(err); }
};
