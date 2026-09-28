/* Railey Library — search.js
   Search index, ranking, typo tolerance and the filters.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Search / filter
   ============================================================ */
function locText(b){
  const p=[];
  if(b.room) p.push(b.room);
  if(b.bookcase) p.push(/^[\w-]{1,3}$/.test(String(b.bookcase)) ? 'Case '+b.bookcase : String(b.bookcase));
  if(b.shelf) p.push('Shelf '+b.shelf);
  if(b.position) p.push(sideText(b));
  return p.join(' · ') || 'No location yet';
}
// Position shown from the nearer end of the shelf: left half counts from the left,
// right half counts from the right (stacked 5a/5b share one slot). Stored position stays "from left".
// Filled slot numbers per shelf, built once per change of the catalog (not once per book shown).
// Only books still in the house count — sold ones no longer take up a spot.
let _slots=null, _slotsFor=null, _slotsKey='';
function shelfSlots(b){
  const key=store.updatedAt+'|'+store.books.length;
  if(!_slots || _slotsFor!==store || _slotsKey!==key){
    _slots=new Map(); _slotsFor=store; _slotsKey=key;
    for(const x of live()){ const mm=String(x.position||'').trim().match(/^(\d+)/); if(!mm) continue;
      const k=x.room+'|'+x.bookcase+'|'+x.shelf; if(!_slots.has(k)) _slots.set(k,new Set()); _slots.get(k).add(+mm[1]); }
    for(const [k,s] of _slots) _slots.set(k,[...s].sort((a,c)=>a-c));
  }
  return _slots.get(b.room+'|'+b.bookcase+'|'+b.shelf) || [];
}
function sideText(b){
  const m = String(b.position||'').trim().match(/^(\d+)\s*([a-z]*)$/i);
  if(!m) return '#'+b.position;
  const n = +m[1], suf = m[2] ? m[2].toLowerCase() : '';
  let order = shelfSlots(b);
  if(!order.includes(n)) order = order.concat(n).sort((a,c)=>a-c);
  const k = order.indexOf(n)+1, N = order.length;
  if(N<2 || k <= Math.ceil(N/2)) return '#'+k+suf+' from left';
  return '#'+(N-k+1)+suf+' from right';
}
function words(s){ return norm(s).replace(/[^a-z0-9]+/g,' ').trim(); }
// ---- search index: each book split into weighted fields of whole words ----
const STOP = new Set(['the','a','an','of','and','in','on','to','for','with','by']);
const IDX = new WeakMap();
function compactInitials(a){ return a.replace(/\b(\w) (?=\w\b)/g,'$1'); }   // "j r r tolkien" -> "jrr tolkien"
function bookIndex(b){
  let ix = IDX.get(b); if(ix) return ix;
  const a = words(b.author);
  const F = (w, text)=>({ w, words: words(text).split(' ').filter(Boolean) });
  ix = {
    title:  [F(10, b.title), F(6, b.series)],
    author: [F(9, a + ' ' + compactInitials(a))],
    all:    null,
    titleStr: ' '+words(b.title)+' '
  };
  ix.all = ix.title.concat(ix.author, [F(4, b.subjects), F(4, b.genre), F(2, b.about), F(1, b.notes), F(1, b.loanedTo),
           F(1, b.publisher), F(1, b.year), F(1, b.isbn), F(1, b.room), F(1, b.bookcase), F(1, b.format)]);
  IDX.set(b, ix); return ix;
}
function hay(b){ return bookIndex(b).all.map(f=>f.words.join(' ')).join(' '); }   // used by the Shelves highlighter
function edit1(a,b){ // true if one typo apart: a missing/extra/wrong letter, or two letters swapped
  if(a===b) return true;
  const la=a.length, lb=b.length; if(Math.abs(la-lb)>1) return false;
  if(la===lb){ const d=[]; for(let k=0;k<la;k++) if(a[k]!==b[k]){ d.push(k); if(d.length>2) return false; }
    if(d.length===2 && d[1]===d[0]+1 && a[d[0]]===b[d[1]] && a[d[1]]===b[d[0]]) return true; }
  let i=0,j=0,d=0;
  while(i<la && j<lb){
    if(a[i]===b[j]){ i++; j++; continue; }
    if(++d>1) return false;
    if(la>lb) i++; else if(lb>la) j++; else { i++; j++; }
  }
  return d + (la-i) + (lb-j) <= 1;
}
// Best weight a token earns in these fields. Exact word > word starting with it > (fuzzy only) one typo away.
function tokScore(fields, tok, fuzzy){
  let best=0;
  for(const f of fields){
    for(const w of f.words){
      let sc=0;
      if(w===tok) sc=f.w+1;
      else if(w.startsWith(tok)) sc=f.w;
      else if(fuzzy && f.w>=6 && tok.length>=5 && w.length>=5 && w[0]===tok[0] && edit1(w,tok)) sc=f.w-1;
      if(sc>best) best=sc;
    }
  }
  return best;
}
let lastFuzzy=false;
function filtered(){
  let q = words($('f-q').value).split(' ').filter(Boolean);
  if(q.some(t=>!STOP.has(t))) q = q.filter(t=>!STOP.has(t));      // "the hobbit" -> "hobbit"
  const scope = ui.scope || 'all';
  const f = { room:$('f-room').value, bc:$('f-case').value, shelf:$('f-shelf').value, status:$('f-status').value,
    genre:$('f-genre').value, loan:$('f-loan').value, rating:$('f-rating').value, review:$('f-review').checked };
  const out=[], pool=[];
  for(const b of live()){
    if(f.room && b.room!==f.room) continue;
    if(f.bc && b.bookcase!==f.bc) continue;
    if(f.shelf && String(b.shelf)!==f.shelf) continue;
    if(f.status && (b.status||'unread')!==f.status) continue;
    if(f.genre && b.genre!==f.genre) continue;
    if(f.loan==='out' && !b.loanedTo) continue;
    if(f.loan==='in' && b.loanedTo) continue;
    if(f.rating!==''){ const r=+b.rating||0, m=+f.rating; if(m===0 ? r!==0 : r<m) continue; }
    if(f.review && !b.needsReview) continue;
    if(ui.coll && !collsOf(b).includes(ui.coll)) continue;
    pool.push(b);
  }
  // Every word must match the start of a word in the chosen fields. Only if nothing at all
  // matches do we allow a single typo, and only in titles/authors, same first letter.
  lastFuzzy=false;
  const phrase = ' '+q.join(' ');
  for(const fuzzy of [false, true]){
    if(fuzzy && (out.length || !q.length)) break;
    for(const b of pool){
      let score=0;
      if(q.length){
        const ix=bookIndex(b), fields = scope==='title'?ix.title : scope==='author'?ix.author : ix.all;
        let ok=true;
        for(const tok of q){ const sc=tokScore(fields, tok, fuzzy); if(!sc){ ok=false; break; } score+=sc; }
        if(!ok) continue;
        if(ix.titleStr.includes(phrase+' ')) score += 15;              // whole phrase in the title
        if(ix.titleStr.startsWith(phrase)) score += 10;                // title starts with it
      }
      out.push({b,score});
    }
    if(fuzzy) lastFuzzy = out.length>0;
  }
  const sort = $('f-sort').value;
  const unk=b=>String(b.title||'').startsWith('(')?1:0;
  const byTitle=(x,y)=>(unk(x.b)-unk(y.b)) || natCmp(normKey(x.b.title), normKey(y.b.title));
  const authorKey=b=>{ const a=String(b.author||'').split(/[,&;]| and /)[0].trim(); const w=a.split(/\s+/); return norm(w[w.length-1]+' '+a); };
  const cmp = {
    title: byTitle,
    author: (x,y)=>natCmp(authorKey(x.b),authorKey(y.b)) || natCmp(x.b.series,y.b.series) || (parseFloat(x.b.seriesNo)||0)-(parseFloat(y.b.seriesNo)||0) || byTitle(x,y),
    location: (x,y)=>natCmp(x.b.room,y.b.room)||natCmp(x.b.bookcase,y.b.bookcase)||natCmp(x.b.shelf,y.b.shelf)||posCmp(x.b,y.b)||byTitle(x,y),
    added: (x,y)=>(y.b.addedAt||0)-(x.b.addedAt||0),
    rating: (x,y)=>(+y.b.rating||0)-(+x.b.rating||0)||byTitle(x,y),
  }[sort] || byTitle;
  out.sort((x,y)=> q.length && sort==='title' ? (unk(x.b)-unk(y.b))||(y.score-x.score)||cmp(x,y) : cmp(x,y));
  filtered.q = q;
  return out.map(o=>o.b);
}
