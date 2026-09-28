/* Railey Library — photos.js
   Sending shelf and title-page photos to the Dropbox photo inbox for Claude.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Photos for Claude — shelf / spine / title-page pictures go to
   <library folder>/photos/inbox/, labeled with where they were taken.
   ============================================================ */
function openPhotos(){
  const L=ui.phLoc||{};
  $('ph-room').value=L.room||$('f-room').value||''; $('ph-case').value=L.bookcase||$('f-case').value||''; $('ph-shelf').value=L.shelf||'';
  $('ph-kind').value=L.kind||'shelf'; $('ph-note').value=''; $('ph-status').textContent='';
  $('ph-bg').classList.add('open'); lockPage();
}
$('btn-photos').onclick=openPhotos;
$('ph-close').onclick=()=>{ $('ph-bg').classList.remove('open'); unlockPage(); };
$('ph-take').onclick=async()=>{ if(!(await dbxToken())){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return; } $('ph-file').click(); };
$('ph-file').onchange=async e=>{
  const files=[...e.target.files]; e.target.value=''; if(!files.length) return;
  const loc={ room:$('ph-room').value.trim(), bookcase:$('ph-case').value.trim(), shelf:$('ph-shelf').value.trim(), kind:$('ph-kind').value };
  ui.phLoc=loc; lsSet(UI_KEY, JSON.stringify(ui));
  await sendToInbox(files, loc, $('ph-note').value.trim(), $('ph-status'), $('ph-sent'));
  $('ph-note').value='';
};
async function sendToInbox(files, loc, note, statusEl, listEl){
  const t=await dbxToken(); if(!t){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return 0; }
  const slug=s=>String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
  const d=new Date(), stamp=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+String(d.getSeconds()).padStart(2,'0');
  const base=[stamp, slug(loc.room)||'no-room', slug(loc.bookcase)||'no-bookcase', loc.shelf?'shelf-'+slug(loc.shelf):'', loc.kind, note?slug(note):''].filter(Boolean).join(' ');
  let ok=0, fail=0;
  for(let i=0;i<files.length;i++){
    statusEl.textContent='Sending '+(i+1)+' of '+files.length+'…';
    try{
      const blob=await shrinkPhoto(files[i], loc.kind==='book'?1800:2600);
      const path=dbxFolder()+'/photos/inbox/'+base+(files.length>1?' '+(i+1):'')+'.jpg';
      const r=await fetch('https://content.dropboxapi.com/2/files/upload',{ method:'POST', headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
        'Dropbox-API-Arg':dbxArg({ path, mode:'add', autorename:true, mute:true }) }, body:blob });
      if(!r.ok) throw new Error('HTTP '+r.status);
      ok++;
      const url=URL.createObjectURL(blob);
      listEl && listEl.insertAdjacentHTML('afterbegin','<div class="ph-item"><img src="'+url+'" alt=""><span>✓ '+esc([loc.room,loc.bookcase,loc.shelf?'Shelf '+loc.shelf:''].filter(Boolean).join(' · ')||'Sent')+(note?' — '+esc(note):'')+'</span></div>');
    }catch(err){ fail++; }
  }
  if(note){
    // keep the note with the photos as a small text file too
    try{ await fetch('https://content.dropboxapi.com/2/files/upload',{ method:'POST', headers:{ 'Authorization':'Bearer '+t.access_token, 'Content-Type':'application/octet-stream',
      'Dropbox-API-Arg':dbxArg({ path:dbxFolder()+'/photos/inbox/'+base+' NOTE.txt', mode:'add', autorename:true, mute:true }) }, body:new Blob([note+'\n\n'+JSON.stringify(loc)]) }); }catch(e){}
  }
  statusEl.textContent = fail ? ok+' sent, '+fail+' failed — try those again.' : ok+' photo'+(ok===1?'':'s')+' sent to the inbox. Add more, or close when you’re done.';
  return ok;
}

// from the scanner: a full-resolution photo of the shelf, labeled with the room/bookcase/shelf typed above
$('sc-shelfphoto').onclick=async()=>{
  if(!(await dbxToken())){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return; }
  stopCamera(); $('sc-file').click();
};
$('sc-file').onchange=async e=>{
  const files=[...e.target.files]; e.target.value='';
  if(files.length){
    const loc={ room:$('sc-room').value.trim(), bookcase:$('sc-case').value.trim(), shelf:$('sc-shelf').value.trim(), kind:'shelf' };
    const ok=await sendToInbox(files, loc, '', $('sc-phstatus'), null);
    if(ok) $('sc-phstatus').textContent='✓ Shelf photo sent to photos/inbox'+(loc.room?' ('+[loc.room,loc.bookcase,loc.shelf?'Shelf '+loc.shelf:''].filter(Boolean).join(' · ')+')':'')+'. Take another, or keep scanning.';
  }
  if($('scan-bg').classList.contains('open')) startCamera();
};
