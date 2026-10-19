/* Railey Library — recheck.js
   Recheck shelves: photograph a bookcase again when books have drifted. The photos go to photos/inbox/ with the kind
   "recheck"; Claude matches each spine to a book already in the catalog and only moves it (see DEVELOPER.md,
   "Recheck photos"), so a recheck never adds a second copy. Claude stamps checkedAt (YYYY-MM-DD) on each book seen.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

// When a book's place was last confirmed by a photo: the recheck stamp, or the day it came in.
function lastSeen(b){
  const c=b.checkedAt ? Date.parse(b.checkedAt) : NaN;
  return !isNaN(c) ? c : (+b.addedAt || 0);
}
function bookcaseRows(){
  const m=new Map();
  for(const b of live()){
    if(!b.room && !b.bookcase) continue;
    const k=(b.room||'')+'|'+(b.bookcase||'');
    if(!m.has(k)) m.set(k, { room:b.room||'', bookcase:b.bookcase||'', n:0, seen:0, checked:false, missing:0 });
    const r=m.get(k); r.n++; r.seen=Math.max(r.seen, lastSeen(b));
    if(b.checkedAt) r.checked=true;
    if(b.needsReview && /not seen at recheck/i.test(b.notes||'')) r.missing++;
  }
  // oldest first: the likeliest to have drifted
  return [...m.values()].sort((a,b)=>(a.seen||0)-(b.seen||0) || natCmp(a.room,b.room) || natCmp(a.bookcase,b.bookcase));
}
function renderRecheck(){
  const L=bookcaseRows();
  const day=t=>t ? new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}) : 'unknown';
  $('rc-list').innerHTML = L.length ? L.map((r,i)=>'<div class="sr-loc rc-row" data-i="'+i+'"><span><b>'+esc(r.room||'(no room)')+' · '+esc(r.bookcase||'(no bookcase)')+'</b> <span class="note">'+r.n+' book'+(r.n===1?'':'s')
      +(r.missing?' · '+r.missing+' not seen last time':'')+'</span></span><span class="v">'+(r.checked?'rechecked ':'catalogued ')+day(r.seen)+'</span></div>').join('')
    : '<div class="empty">No books have a place yet. Build the library from photos first.</div>';
  $('rc-list').onclick=e=>{ const el=e.target.closest('.rc-row'); if(!el) return; const r=L[+el.dataset.i];
    $('rc-room').value=r.room; $('rc-case').value=r.bookcase; $('rc-shelf').value=''; $('rc-status').textContent='';
    $('rc-take').scrollIntoView({ behavior:'smooth', block:'center' }); };
}
$('rc-take').onclick=()=>{
  if(!cloudOn()){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return; }
  if(!$('rc-room').value.trim() || !$('rc-case').value.trim()){ toast('Type the room and bookcase first, so Claude knows which books to look for'); return; }
  $('rc-file').click();
};
$('rc-file').onchange=async e=>{
  const files=[...e.target.files]; e.target.value=''; if(!files.length) return;
  const loc={ room:$('rc-room').value.trim(), bookcase:$('rc-case').value.trim(), shelf:$('rc-shelf').value.trim(), kind:'recheck' };
  const ok=await sendToInbox(files, loc, '', $('rc-status'), $('rc-sent'));
  if(ok) $('rc-status').textContent='✓ '+ok+' recheck photo'+(ok===1?'':'s')+' sent. Add more for this bookcase, or pick the next one. Then ask Claude to “check the photo inbox”.';
};
