/* Railey Library — lookup.js
   Cover & detail lookups from Open Library and Google Books.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Cover & detail lookups — Open Library first, Google Books as
   a fallback (both free, no key, called from the browser).
   Results are normalized to { title, authors[], year, isbn[],
   publisher, pages, subjects[], cover }.
   ============================================================ */
const LOOKUP_V = 3;   // bump to re-check books a weaker earlier lookup gave up on
async function olSearch(title, author, isbn){
  const p = new URLSearchParams({ limit:'6', fields:'key,title,author_name,first_publish_year,isbn,publisher,cover_i,number_of_pages_median,subject' });
  const cleanIsbn = String(isbn||'').replace(/[^0-9Xx]/g,'');
  if(cleanIsbn.length>=10) p.set('isbn', cleanIsbn);
  else { if(title) p.set('title', title); if(author) p.set('author', author); }
  const r = await fetch('https://openlibrary.org/search.json?'+p.toString());
  if(!r.ok) throw new Error('Open Library HTTP '+r.status);
  return ((await r.json()).docs || []).map(d=>({ src:'Open Library', title:d.title, authors:d.author_name||[], year:d.first_publish_year?String(d.first_publish_year):'',
    isbn:d.isbn||[], publisher:(d.publisher||[])[0]||'', pages:d.number_of_pages_median?String(d.number_of_pages_median):'', subjects:d.subject||[],
    cover:d.cover_i?'https://covers.openlibrary.org/b/id/'+d.cover_i+'-M.jpg':'' }));
}
async function gbSearch(title, author, isbn){
  const cleanIsbn = String(isbn||'').replace(/[^0-9Xx]/g,'');
  const strip = s=>String(s||'').replace(/[:"()]/g,' ').trim();
  const q = cleanIsbn.length>=10 ? 'isbn:'+cleanIsbn : 'intitle:'+strip(title) + (author ? ' inauthor:'+strip(String(author).split(/[,&;]| and | with /)[0]).split(' ').pop() : '');
  const r = await fetch('https://www.googleapis.com/books/v1/volumes?'+new URLSearchParams({ q, maxResults:'6', printType:'books' }));
  if(!r.ok) throw new Error('Google Books HTTP '+r.status);
  return ((await r.json()).items || []).map(it=>{ const v=it.volumeInfo||{}; const img=(v.imageLinks||{}).thumbnail||(v.imageLinks||{}).smallThumbnail||'';
    return { src:'Google Books', title:v.title+(v.subtitle?': '+v.subtitle:''), authors:v.authors||[], year:(v.publishedDate||'').slice(0,4),
      isbn:(v.industryIdentifiers||[]).filter(x=>/ISBN/.test(x.type)).map(x=>x.identifier), publisher:v.publisher||'', pages:v.pageCount?String(v.pageCount):'',
      subjects:v.categories||[], about:(String(v.description||'').replace(/<[^>]+>/g,'').match(/^.{0,400}?[.!?](?=\s|$)/)||[''])[0], cover:img?img.replace(/^http:/,'https:').replace('&edge=curl',''):'' }; });
}
async function bookSearch(title, author, isbn){
  const out=[];
  try{ out.push(...await olSearch(title, author, isbn)); }catch(e){}
  try{ out.push(...await gbSearch(title, author, isbn)); }catch(e){}
  return out;
}
function cleanSubjects(list){
  const out=[], seen=new Set();
  for(let x of (list||[])){
    for(let part of String(x).split(/\s*--\s*|\s*,\s*/)){
      part=part.toLowerCase().replace(/\s*\(.*?\)\s*/g,' ').replace(/\s+/g,' ').trim();
      if(!part || part.length>30 || /[^\x00-\x7f]/.test(part) || /^\d/.test(part)) continue;
      if(/^(fiction|juvenile|juvenile fiction|juvenile literature|general|accessible book|protected daisy|in library|large type books|open library staff picks|literature|english|nyt:|reading level)/.test(part)) continue;
      part=part.replace(/ and adventurers$/,'').replace(/, fiction$/,'');
      if(seen.has(part)) continue; seen.add(part); out.push(part);
      if(out.length>=6) return out.join(', ');
    }
  }
  return out.join(', ');
}
function pickIsbn(doc){ const l=doc.isbn||[]; return l.find(x=>x.length===13 && x.startsWith('978')) || l.find(x=>x.length===13) || l[0] || ''; }
function docFill(doc){
  return { isbn:pickIsbn(doc), year:doc.year||'', publisher:doc.publisher||'', pages:doc.pages||'', subjects:cleanSubjects(doc.subjects), coverUrl:doc.cover||'' };
}
$('btn-cover-photo').onclick=()=>$('cover-file').click();
$('cover-file').onchange=e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f) return;
  const img=new Image(), url=URL.createObjectURL(f);
  img.onload=()=>{ const W=240,H=360, c=document.createElement('canvas'); c.width=W; c.height=H; const g=c.getContext('2d');
    const s=Math.max(W/img.width,H/img.height), w=img.width*s, h=img.height*s; g.drawImage(img,(W-w)/2,(H-h)/2,w,h);
    URL.revokeObjectURL(url);
    const dataUrl=c.toDataURL('image/jpeg',0.72);
    $('m-cover').innerHTML='<img src="'+dataUrl+'" alt="">';
    c.toBlob(async blob=>{
      pendingCover=dataUrl;                                   // fallback if Dropbox isn't reachable
      const path=await saveCoverFile(blob, editId||'new');
      if(path) pendingCover='dbx:'+path;
      toast('Cover photo added — tap Save to keep it');
    }, 'image/jpeg', 0.72); };
  img.src=url;
};
$('btn-lookup').onclick = async ()=>{
  const box=$('lookup-res'); box.innerHTML='<div class="note">Searching Open Library and Google Books…</div>';
  let docs = await bookSearch(cleanTitle($('e-title').value.trim()), searchAuthor($('e-author').value.trim()), $('e-isbn').value.trim());
  if(!docs.length) docs = await bookSearch(cleanTitle($('e-title').value.trim()), '', '');
  if(!docs.length){ box.innerHTML='<div class="note">No matches (or no connection). Try shortening the title or removing the author.</div>'; return; }
  box.innerHTML = docs.slice(0,10).map((d,i)=>'<div class="lk">'+(d.cover?'<img src="'+esc(d.cover)+'" alt="">':'<img alt="">')+
    '<div class="x"><b>'+esc(d.title)+'</b><br>'+esc(d.authors.join(', '))+(d.year?' · '+esc(d.year):'')+'<br><span style="color:var(--steel);font-size:.7rem;">'+d.src+'</span></div><button type="button" data-i="'+i+'">Use</button></div>').join('');
  box.onclick = e=>{
    const i=e.target.dataset.i; if(i===undefined) return;
    const d=docs[+i], f=docFill(d);
    // fill only empty fields — never overwrite what's been typed (the cover is the exception: you picked it)
    ['isbn','year','publisher','pages','subjects'].forEach(k=>{ if(!$('e-'+k).value.trim() && f[k]) $('e-'+k).value=f[k]; });
    if(!$('e-title').value.trim()) $('e-title').value=d.title||'';
    if(!$('e-author').value.trim()) $('e-author').value=d.authors.join(', ');
    if(f.coverUrl){ pendingCover=f.coverUrl; $('m-cover').innerHTML='<img src="'+esc(f.coverUrl)+'" alt="">'; }
    box.innerHTML='<div class="note">Filled in the blanks — tap Save to keep it.</div>';
  };
};

// Titles as they sit on our shelves carry extras the catalogs don't: "(Hardy Boys #17)", ", Vol. 3", "(second copy)"…
function cleanTitle(t){
  return String(t||'').replace(/\s*\((?:[^()]*#\s*\d+[^()]*|second copy|third copy|volume[^)]*|vol\.[^)]*|collected works[^)]*|eyewitness|dk [^)]*|a child's first library[^)]*|take-along guide|the gatefold collection|kingfisher knowledge|\d{4} yearbook[^)]*|golden guide)\)\s*/ig,' ')
    .replace(/,?\s+(?:vol\.?|volume|book)\s+[\divxlc]+\b.*$/i,'').replace(/\s+/g,' ').trim();
}
function searchAuthor(a){ return String(a||'').split(/\s+(?:and|with)\s+|[,;&(]/)[0].replace(/\b(ed|eds|trans|illus)\.?$/i,'').trim(); }
function sigWords(t){ return normKey(t).split(' ').filter(w=>w.length>2 && !STOP.has(w)); }
function titleMatch(a,b){
  const x=normKey(cleanTitle(a)), y=normKey(cleanTitle(b)); if(!x||!y) return false;
  if(x===y) return true;
  const xs=normKey(x.split(':')[0]), ys=normKey(y.split(':')[0]);
  if(xs===ys) return true;
  if((x.length>7 && y.startsWith(x)) || (y.length>7 && x.startsWith(y))) return true;
  const wa=sigWords(xs), wb=sigWords(ys);
  if(wa.length>=2 && wb.length>=2){ const n=Math.min(3,wa.length,wb.length); if(wa.slice(0,n).join(' ')===wb.slice(0,n).join(' ') && Math.abs(wa.length-wb.length)<=2) return true; }
  return false;
}
function authorMatch(a, list){
  const want=normKey(searchAuthor(a)).split(' ').filter(w=>w.length>=3);
  if(!want.length) return true;
  const last=want[want.length-1];
  return (list||[]).some(n=>normKey(n).split(' ').some(w=>w===last || (w.length>=5 && last.length>=5 && edit1(w,last)) || want.includes(w) && w.length>=4));
}
let lookupRunning=false, lookupStop=false;
function needsLookup(b){ return b.title && !String(b.title).startsWith('(') && !b.coverUrl && (b.lookupV||0) < LOOKUP_V; }
async function autoLookup(manual){
  if(lookupRunning) return;
  const todo = live().filter(needsLookup);
  if(!todo.length){ if(manual) $('lookup-progress').textContent='Nothing to look up — every book has a cover or was already checked.'; return; }
  lookupRunning=true; lookupStop=false;
  $('btn-lookup-all').disabled=true; $('btn-lookup-stop').classList.remove('hide');
  let found=0, n=0, pendingSave=0;
  for(const b of todo){
    if(lookupStop) break;
    n++;
    const msg='Finding covers '+n+' of '+todo.length+'…';
    $('lookup-progress').textContent = msg+' ('+found+' found)'; $('lookup-hdr').textContent = msg;
    let ok=false, d=null;
    const t=cleanTitle(b.title), a=searchAuthor(b.author);
    const good=list=>list.find(x=>x.cover && titleMatch(b.title, x.title) && authorMatch(b.author, x.authors));
    const tries=[()=>olSearch(t,a,b.isbn), ()=>gbSearch(t,a,b.isbn)];
    if(a) tries.push(()=>olSearch(t,'',''), ()=>gbSearch(t,'',''));            // author spelled differently in the catalog
    if(t.includes(':')) tries.push(()=>olSearch(t.split(':')[0],a,''));        // drop long subtitles
    for(const go of tries){ try{ d=good(await go()); ok=true; }catch(e){} if(d) break; await new Promise(r=>setTimeout(r,150)); }
    if(!ok){ await new Promise(r=>setTimeout(r, 1500)); continue; }   // offline or blocked: leave it for next time
    const cur = byId(b.id); if(!cur || cur.deleted) continue;
    const ch = { lookupV:LOOKUP_V };
    if(d){ const f=docFill(d); ['isbn','year','publisher','pages','coverUrl','subjects'].forEach(k=>{ if(!cur[k] && f[k]) ch[k]=f[k]; }); if(ch.coverUrl) found++; }
    Object.assign(cur, ch, {updatedAt:Date.now()});
    if(++pendingSave>=10){ pendingSave=0; commit(); }
    await new Promise(r=>setTimeout(r, 350));
  }
  commit();
  lookupRunning=false;
  $('btn-lookup-all').disabled=false; $('btn-lookup-stop').classList.add('hide'); $('lookup-hdr').textContent='';
  $('lookup-progress').textContent = (lookupStop?'Stopped. ':'Done. ') + 'Found covers for '+found+' of '+n+' books checked.';
}
$('btn-lookup-all').onclick = ()=>autoLookup(true);
$('btn-lookup-stop').onclick = ()=>{ lookupStop=true; };
