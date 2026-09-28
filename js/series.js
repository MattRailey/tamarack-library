/* Railey Library — series.js
   Series split across locations, and possible duplicates.
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
function renderSplitSeries(){
  const byShelf = $('sr-byshelf').checked;
  const groups = new Map();
  for(const b of live()){
    const k = seriesKey(b); if(!k) continue;
    const key = normKey(k);
    if(!groups.has(key)) groups.set(key, {name:k, books:[]});
    groups.get(key).books.push(b);
  }
  const out = [];
  for(const g of groups.values()){
    if(g.books.length < 2) continue;
    const locs = new Map();
    for(const b of g.books){
      const loc = [b.room||'(no room)', b.bookcase||'(no bookcase)'].concat(byShelf?[b.shelf?'Shelf '+b.shelf:'(no shelf)']:[]).join(' → ');
      if(!locs.has(loc)) locs.set(loc, []);
      locs.get(loc).push(b);
    }
    if(locs.size > 1) out.push({ name:g.name, count:g.books.length, locs:[...locs.entries()].sort((a,b)=>b[1].length-a[1].length) });
  }
  out.sort((a,b)=>b.count-a.count || natCmp(a.name,b.name));
  if(!out.length){ $('sr-list').innerHTML = '<div class="empty">Every series is together in one place.</div>'; return; }
  const volOf = b=>{ const m=String(b.title).match(/(?:Vol\.?|Volume|Vols\.?|Book|Number|No\.)\s+([\w&, ]+?)(?:[:(]|$)/i); return m?m[1].trim():''; };
  $('sr-list').innerHTML = '<p class="summary" style="margin:0 0 8px;">'+out.length+' series split up</p>' + out.map((g,gi)=>
    '<div class="sr-item"><h4>'+esc(g.name)+' <span class="note" style="font-weight:400;">· '+g.count+' books in '+g.locs.length+' places</span></h4>'+
    g.locs.map(([loc,bs],li)=>{ const vols = bs.map(volOf).filter(Boolean);
      return '<div class="sr-loc" data-g="'+gi+'" data-l="'+li+'"><span>'+esc(loc)+'</span><span class="v">'+bs.length+(vols.length?' · '+esc(vols.slice(0,8).join(', '))+(vols.length>8?'…':''):'')+'</span></div>'; }).join('')+
    '</div>').join('');
  $('sr-list').onclick = e=>{
    const el = e.target.closest('.sr-loc'); if(!el) return;
    const bs = out[+el.dataset.g].locs[+el.dataset.l][1];
    $('series-bg').classList.remove('open');
    openBook(bs[0].id, out[+el.dataset.g].locs.flatMap(x=>x[1]).map(b=>b.id));
  };
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
  if(!gs.length){ $('dp-list').innerHTML='<div class="empty">No duplicates found.</div>'; return; }
  const extra=gs.reduce((s,x)=>s+x.length-1,0);
  $('dp-list').innerHTML='<p class="summary" style="margin:0 0 8px;">'+gs.length+' titles with more than one copy ('+extra+' extra copies)</p>'+gs.map((x,gi)=>
    '<div class="sr-item"><h4>'+esc(x[0].title)+' <span class="note" style="font-weight:400;">· '+esc(x[0].author||'')+' · '+x.length+' copies</span></h4>'+
    x.map((b,bi)=>'<div class="sr-loc" data-g="'+gi+'" data-b="'+bi+'"><span>'+esc(locText(b))+'</span><span class="v">'+esc(b.notes||'')+'</span></div>').join('')+'</div>').join('');
  $('dp-list').onclick=e=>{ const el=e.target.closest('.sr-loc'); if(!el) return; const x=gs[+el.dataset.g];
    $('dups-bg').classList.remove('open'); openBook(x[+el.dataset.b].id, x.map(b=>b.id)); };
}
$('btn-dups').onclick = ()=>{ renderDups(); $('dups-bg').classList.add('open'); lockPage(); };
$('dp-close').onclick = ()=>{ $('dups-bg').classList.remove('open'); unlockPage(); };
$('dups-bg').addEventListener('click', e=>{ if(e.target===$('dups-bg')) $('dp-close').onclick(); });
$('btn-series').onclick = ()=>{ renderSplitSeries(); $('series-bg').classList.add('open'); };
$('sr-byshelf').onchange = renderSplitSeries;
$('sr-close').onclick = ()=>$('series-bg').classList.remove('open');
$('series-bg').addEventListener('click', e=>{ if(e.target===$('series-bg')) $('series-bg').classList.remove('open'); });
