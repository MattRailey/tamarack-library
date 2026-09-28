/* Railey Library — data.js
   Data & Sync tab: stats, exports, restore from a backup.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Data tab: stats, export, restore
   ============================================================ */
function renderData(){
  const L=live();
  const stat=(n,l)=>'<div class="stat"><b>'+n+'</b><span>'+l+'</span></div>';
  $('stats').innerHTML = stat(L.length.toLocaleString(),'books') + stat(L.filter(b=>b.status==='read').length.toLocaleString(),'read')
    + stat(L.filter(b=>b.loanedTo).length,'loaned out') + stat(L.filter(b=>b.needsReview).length,'need review')
    + stat(uniq(L.map(b=>b.author)).length.toLocaleString(),'authors');
  const rooms = {}; L.forEach(b=>{ const r=b.room||'(no room)'; rooms[r]=(rooms[r]||0)+1; });
  $('room-stats').innerHTML = Object.keys(rooms).length ? '<table><thead><tr><th>Room</th><th style="text-align:right">Books</th></tr></thead><tbody>'
    + Object.keys(rooms).sort(natCmp).map(r=>'<tr><td>'+esc(r)+'</td><td style="text-align:right">'+rooms[r].toLocaleString()+'</td></tr>').join('') + '</tbody></table>' : '';
}
function download(name, text, type){
  const blob = new Blob([text], {type});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('btn-export-json').onclick = ()=>download('tamarack-library-backup-'+todayLocal()+'.json', readableJSON(store), 'application/json');
$('btn-export-csv').onclick = ()=>{
  const cols=['title','author','series','seriesNo','genre','subjects','format','room','bookcase','shelf','position','status','rating','loanedTo','loanedDate','isbn','year','publisher','pages','notes','needsReview'];
  const q=v=>{ v=v==null?'':String(v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  const lines=[cols.join(',')].concat(live().sort((a,b)=>natCmp(a.room,b.room)||natCmp(a.bookcase,b.bookcase)||natCmp(a.shelf,b.shelf)||posCmp(a,b)).map(b=>cols.map(c=>q(b[c])).join(',')));
  download('tamarack-library-'+todayLocal()+'.csv', '﻿'+lines.join('\r\n'), 'text/csv');
};
$('btn-restore').onclick = ()=>$('restore-file').click();
$('restore-file').onchange = async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  try{
    const s = JSON.parse(await f.text());
    if(!validStore(s)) throw new Error('not a library backup');
    const before = live().length;
    store = mergeStores(store, s); commit();
    toast('Merged backup — '+(live().length-before)+' books added');
  }catch(err){ toast('Couldn\'t merge: '+err.message); }
};
$('btn-sync').onclick = syncNow;
$('btn-connect').onclick = dbxConnect;
$('btn-disconnect').onclick = dbxDisconnect;
$('dbx-appkey').addEventListener('change', ()=>{ lsSet(DBX_APPKEY_KEY, $('dbx-appkey').value.trim()); });
