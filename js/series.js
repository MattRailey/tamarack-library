/* Railey Library — series.js
   Series split across locations, and duplicates (Epilogue → Import & Export tabs).
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Series split across locations
   ============================================================ */
const SET_NOTES = ['The Story of Civilization','Library of America','Edition de Luxe','The Bookhouse for Children','boxed set','Schaum\'s Outline'];
function seriesKey(b){
  if(b.series && String(b.series).trim()) return String(b.series).trim();
  const t = String(b.title||'');
  if(t.startsWith('(')) return '';
  let m = t.match(/^(.+?),?\s+(?:Vol\.?|Volume|Vols\.?|Book)\s+[\dIVXLC]+/i);
  if(m) return m[1].replace(/[,:]\s*$/,'').trim();
  m = t.match(/^(.+?)\s*\((?:volume|volume number[^)]*)\)/i);
  if(m) return m[1].trim();
  m = t.match(/^(?:Number|No\.)\s+\w+\s+(Joy Street)$/i);
  if(m) return 'Joy Street';
  m = t.match(/^(.+?):\s+(?:Songs|Study Material|French|Italian|Spanish|German|American)\b/);
  if(m && /Library|Drawings/.test(m[1])) return m[1].trim();
  const n = String(b.notes||'');
  for(const k of SET_NOTES){ if(n.toLowerCase().includes(k.toLowerCase()) && !/second copy/i.test(n) && k!=='boxed set' && k!=='Schaum\'s Outline') return k; }
  return '';
}
function seriesGroups(){
  const groups = new Map();
  for(const b of live()){
    const k = seriesKey(b); if(!k) continue;
    const key = normKey(k);
    if(!groups.has(key)) groups.set(key, {name:k, books:[]});
    groups.get(key).books.push(b);
  }
  return [...groups.values()].filter(g=>g.books.length>1);
}
// Volume number or name, for sorting a series and labelling its books ("3", "IV", "Book 2").
function volOf(b){
  if(b.seriesNo!=null && String(b.seriesNo).trim()) return String(b.seriesNo).trim();
  const m=String(b.title).match(/(?:Vol\.?|Volume|Vols\.?|Book|Number|No\.)\s+([\w&, ]+?)(?:[:(]|$)/i); return m?m[1].trim():'';
}
function renderSplitSeries(){
  const byShelf = $('sr-byshelf').checked, room = $('sr-room').value;
  const where = b=>[b.room||'(no room)', b.bookcase||'(no bookcase)'].concat(byShelf?[b.shelf?'Shelf '+b.shelf:'(no shelf)']:[]).join(' → ');
  const out = [];
  for(const g of seriesGroups()){
    if(room && !g.books.some(b=>b.room===room)) continue;
    const locs = new Map();
    for(const b of g.books){ const l=where(b); if(!locs.has(l)) locs.set(l, []); locs.get(l).push(b); }
    if(locs.size < 2) continue;
    const vol = b=>volOf(b)||'￿'+normKey(b.title);
    for(const bs of locs.values()) bs.sort((a,b)=>natCmp(vol(a),vol(b)));
    // the place with the most books first: that's where the rest probably belong
    out.push({ name:g.name, count:g.books.length, ids:g.books.slice().sort((a,b)=>natCmp(vol(a),vol(b))).map(b=>b.id), locs:[...locs.entries()].sort((a,b)=>b[1].length-a[1].length || natCmp(a[0],b[0])) });
  }
  out.sort((a,b)=>b.count-a.count || natCmp(a.name,b.name));
  if(!out.length){ $('sr-list').innerHTML = '<div class="card empty">'+(room?'Every series with books in '+esc(room)+' is together in one place.':'Every series is together in one place.')+'</div>'; return; }
  $('sr-list').innerHTML = '<p class="summary" style="margin:0 0 8px;">'+out.length+' series split up</p>' + out.map((g,gi)=>
    '<div class="sr-item"><h4>'+esc(g.name)+' <span class="note" style="font-weight:400;">· '+g.count+' books in '+g.locs.length+' places</span></h4>'+
    g.locs.map(([loc,bs],li)=>'<div class="sr-place"><div class="sr-where">'+esc(loc)+(li===0?' <span class="note">· most of the series</span>':'')+'</div>'+
      bs.map(b=>{ const v=volOf(b), sh=byShelf?'':(b.shelf?'shelf '+b.shelf:''), spot=b.position?'#'+b.position:'';
        return '<div class="sr-loc" data-g="'+gi+'" data-id="'+b.id+'"><span>'+(v?'<b>'+esc(v)+'</b> · ':'')+esc(b.title)+'</span><span class="v">'+esc([sh,spot].filter(Boolean).join(' '))+'</span></div>'; }).join('')+
    '</div>').join('')+'</div>').join('');
  $('sr-list').onclick = e=>{ const el=e.target.closest('.sr-loc'); if(!el) return; openBook(el.dataset.id, out[+el.dataset.g].ids); };
}
function fillSeriesRooms(){
  const cur=$('sr-room').value, rooms=[...new Set(live().map(b=>b.room).filter(Boolean))].sort(natCmp);
  $('sr-room').innerHTML='<option value="">Anywhere in the house</option>'+rooms.map(r=>'<option'+(r===cur?' selected':'')+'>'+esc(r)+'</option>').join('');
}
function dupGroups(){
  const g=new Map();
  for(const b of live()){
    if(String(b.title||'').startsWith('(') || /\?|\(volume|volume number|— title/i.test(b.title)) continue;   // unknown volumes aren't real duplicates
    const t=normKey(String(b.title).replace(/\s*\((?:nancy drew|hardy boys|boxcar children|dana girls)[^)]*\)/i,''));
    const a=normKey(String(b.author||'').split(/[,&;(]| and /)[0]).split(' ').pop()||'';
    const k=t+'|'+a; if(!t) continue;
    if(!g.has(k)) g.set(k,[]); g.get(k).push(b);
  }
  return [...g.values()].filter(x=>x.length>1).sort((x,y)=>y.length-x.length || natCmp(normKey(x[0].title),normKey(y[0].title)));
}
function renderDups(){
  const gs=dupGroups();
  if(!gs.length){ $('dp-list').innerHTML='<div class="card empty">No duplicates found.</div>'; return; }
  const extra=gs.reduce((s,x)=>s+x.length-1,0);
  $('dp-list').innerHTML='<p class="summary" style="margin:0 0 8px;">'+gs.length+' titles with more than one copy ('+extra+' extra copies)</p>'+gs.map((x,gi)=>
    '<div class="sr-item"><h4>'+esc(x[0].title)+' <span class="note" style="font-weight:400;">· '+esc(x[0].author||'')+' · '+x.length+' copies</span></h4>'+
    x.map((b,bi)=>'<div class="sr-loc" data-g="'+gi+'" data-b="'+bi+'"><span>'+esc(locText(b))+'</span><span class="v">'+esc(b.notes||'')+'</span></div>').join('')+'</div>').join('');
  $('dp-list').onclick=e=>{ const el=e.target.closest('.sr-loc'); if(!el) return; const x=gs[+el.dataset.g];
    openBook(x[+el.dataset.b].id, x.map(b=>b.id)); };
}
$('dp-list').onclick=null;
$('sr-byshelf').onchange = renderSplitSeries;
$('sr-room').onchange = renderSplitSeries;

/* ============================================================
   Loaned books (Epilogue tab): who has what, since when; searchable
   ============================================================ */
function loanDays(b){ const t=Date.parse(b.loanedDate||''); return isNaN(t) ? null : Math.max(0, Math.floor((Date.now()-t)/864e5)); }
function renderLoans(){
  const all=live().filter(b=>String(b.loanedTo||'').trim());
  const q=norm($('ln-q').value).trim().split(/\s+/).filter(Boolean);
  const L=all.filter(b=>{ const hay=norm([b.title, b.author, b.loanedTo].join(' ')); return q.every(w=>hay.includes(w)); })
    .sort((a,b)=>(Date.parse(a.loanedDate||'')||Infinity)-(Date.parse(b.loanedDate||'')||Infinity) || natCmp(a.loanedTo,b.loanedTo));
  const people=new Set(all.map(b=>normKey(b.loanedTo)));
  $('ln-summary').textContent = all.length ? all.length+' book'+(all.length===1?'':'s')+' out with '+people.size+' '+(people.size===1?'person':'people')+'.' : '';
  const day=b=>{ const t=Date.parse(b.loanedDate||''); if(isNaN(t)) return 'date not noted'; const d=loanDays(b);
    return fmtLocalDate(b.loanedDate)+' · '+(d===0?'today':d===1?'1 day':d<60?d+' days':Math.round(d/30)+' months'); };
  $('ln-list').innerHTML = !all.length ? '<div class="card empty">No books are loaned out.</div>'
    : !L.length ? '<div class="card empty">No loaned books match “'+esc($('ln-q').value)+'”.</div>'
    : L.map(b=>'<div class="sr-item ln-item" data-id="'+b.id+'"><div class="ln-row"><div style="min-width:0;"><b>'+esc(b.title)+'</b>'+(b.author?' <span class="note">· '+esc(b.author)+'</span>':'')
      +'<div class="note" style="margin:2px 0 0;">Lives at '+esc(locText(b))+'</div></div><div class="ln-who"><b>'+esc(b.loanedTo)+'</b><span class="note">'+esc(day(b))+'</span></div></div></div>').join('');
  $('ln-list').onclick=e=>{ const el=e.target.closest('.ln-item'); if(el) openBook(el.dataset.id, L.map(b=>b.id)); };
}
$('ln-q').addEventListener('input', ()=>{ clearTimeout(renderLoans._t); renderLoans._t=setTimeout(renderLoans, 120); });
