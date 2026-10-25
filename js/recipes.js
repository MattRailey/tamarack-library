/* Railey Library — recipes.js
   The Recipes tab. Each library keeps its own recipes, private like its books, in <library folder>/recipes.json
   (readable JSON, synced with the same never-overwrite rules as the catalog), with original card / page photos
   in <library folder>/recipes/. Search works like the Library's (every word must start a word; Anything / Name /
   Ingredient). A recipe window shows ingredients and steps, scales servings, starts timers (cooking.js), links to
   the cookbook in the library, and logs "Made it". Recipes come in by: photos for Claude (shelf camera in recipe
   mode, or chosen photos), a link (the friends service reads the recipe from the page; if it can't, the link
   waits for Claude), or typing.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

const RCP_FILE='recipes.json';
const RCP_KEY='tamarack_library_recipes_v1'+LIB_NS;        // device copy (IndexedDB, localStorage fallback)
const RCP_SIG_KEY='tamarack_library_recipes_sig'+LIB_NS;   // what was last synced
const RUI_KEY='tamarack_library_recipes_ui'+LIB_NS;        // search scope, filters, sort
const GROC_KEY='tamarack_library_grocery'+LIB_NS;          // grocery list, kept on this phone
const RCP_SOURCES={ card:'Recipe card or sheet', cookbook:'Cookbook', web:'Website', magazine:'Magazine or clipping', family:'Family recipe', other:'Other' };
const RCP_ORDER=['id','title','from','source','bookId','bookTitle','page','url','author','servings','prep','cook','total','category','cuisine','tags',
  'about','ingredients','steps','notes','diet','favorite','want','rating','made','photos','image','pending','reread','needsReview','addedAt','updatedAt'];

function emptyRecipes(){ return { format:'tamarack-recipes', version:1, updatedAt:0, recipes:[] }; }
function validRecipes(s){ return !!s && typeof s==='object' && Array.isArray(s.recipes); }
let rstore=emptyRecipes();
let rui={ scope:'all', show:'', cat:'', sort:'title', book:'' };
try{ Object.assign(rui, JSON.parse(lsGet(RUI_KEY)||'{}')); }catch(e){}
function saveRui(){ lsSet(RUI_KEY, JSON.stringify(rui)); }

function rid(){ return 'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function liveRecipes(){ return rstore.recipes.filter(r=>!r.deleted); }
function recipeById(id){ return rstore.recipes.find(r=>r.id===id && !r.deleted); }   // a recipe deleted on another phone is gone here too
function safeUrl(u){ u=String(u||'').trim(); return /^https?:\/\/[^\s]+$/i.test(u) ? u : ''; }
function rcpFull(rel){ return dbxFolder()+'/'+String(rel||'').replace(/^\/+/,''); }   // stored paths are relative to the library folder

/* ---------------- on the device ---------------- */
let _rSaveT=null;
function rSaveLocal(){ clearTimeout(_rSaveT); _rSaveT=setTimeout(async()=>{ const j=JSON.stringify(rstore); try{ await idbPut(RCP_KEY, j); }catch(e){ lsSet(RCP_KEY, j); } }, 300); }
async function rLoadLocal(){
  let s=null;
  try{ const raw=await idbGet(RCP_KEY); if(raw) s=JSON.parse(raw); }catch(e){}
  if(!validRecipes(s)){ try{ s=JSON.parse(lsGet(RCP_KEY)||'null'); }catch(e){ s=null; } }
  if(validRecipes(s)){ rstore=mergeRecipes(rstore, s); renderRecipes(); }
}
// Whole recipes: the newer one wins (a deleted recipe is a tombstone, so the delete reaches the other phones).
// The meal plan (plan: entries by id, the same rule, deletes as tombstones) and the household settings
// (settings: { people, updatedAt }, the newer wins) live in the same file, so the whole household shares them.
function mergeById(x, y){ const m=new Map(); for(const e of (x||[])) if(e && e.id) m.set(e.id, e); for(const e of (y||[])){ if(!e || !e.id) continue; const c=m.get(e.id); if(!c || (e.updatedAt||0)>(c.updatedAt||0)) m.set(e.id, e); } return [...m.values()]; }
function mergeRecipes(a, b){
  const sa=a.settings||{}, sb=b.settings||{};
  const out={ format:'tamarack-recipes', version:1, updatedAt:Math.max(a.updatedAt||0, b.updatedAt||0), recipes:mergeById(a.recipes, b.recipes) };
  const plan=mergeById(a.plan, b.plan); if(plan.length) out.plan=plan;
  const trips=mergeById(a.trips, b.trips); if(trips.length) out.trips=trips;
  const st=(sb.updatedAt||0)>(sa.updatedAt||0) ? sb : (a.settings||b.settings); if(st) out.settings=st;
  return out;
}
function rsig(s){
  const ids=arr=>(arr||[]).map(r=>r.id+':'+(r.updatedAt||0)+(r.deleted?'x':'')).sort().join('|');
  return ids(s.recipes)+'#'+ids(s.plan)+'#'+ids(s.trips)+'#'+((s.settings||{}).updatedAt||0);
}
function rcommit(){ rstore.updatedAt=Date.now(); rSaveLocal(); renderRecipes(); rSchedule(); }
function readableRecipes(s){
  const tidy=r=>{ if(r.deleted) return r; const o={}; for(const k of RCP_ORDER) if(k in r && r[k]!=='' && r[k]!=null) o[k]=r[k]; for(const k in r) if(!(k in o) && r[k]!=='' && r[k]!=null) o[k]=r[k]; return o; };
  const o={ format:'tamarack-recipes', version:1, updatedAt:s.updatedAt, recipes:s.recipes.map(tidy) };
  if((s.plan||[]).length) o.plan=s.plan.slice().sort((x,y)=>String(x.date||'').localeCompare(String(y.date||'')));
  if((s.trips||[]).length) o.trips=s.trips;
  if(s.settings) o.settings=s.settings;
  return JSON.stringify(o, null, 2);
}

/* ---------------- sync: download, merge, upload with the revision (never a blind overwrite) ---------------- */
let _rSyncing=false, _rAgain=false, _rPushT=null, rLastSync=0;
function rSchedule(){ if(!cloudOn()) return; clearTimeout(_rPushT); _rPushT=setTimeout(syncRecipes, 1500); }
async function syncRecipes(){
  if(!cloudOn()) return;
  if(_rSyncing){ _rAgain=true; return; }
  _rSyncing=true;
  try{
    const path=dbxFolder()+'/'+RCP_FILE;
    for(let i=0;i<4;i++){
      const g=await cloudGet(path);
      if(g.signedOut) return;
      let remote=null;
      if(!g.missing){ remote=JSON.parse(await g.res.text()); if(!validRecipes(remote)) throw new Error('recipes.json isn’t a recipe file — not touching it'); }
      const merged=remote ? mergeRecipes(rstore, remote) : rstore;
      if(rsig(merged)!==rsig(rstore)){ rstore=merged; rSaveLocal(); renderRecipes(); }
      if(remote && rsig(merged)===rsig(remote)){ rLastSync=Date.now(); break; }
      if(!remote && !rstore.recipes.length){ rLastSync=Date.now(); break; }   // nothing on either side: no empty file
      const up=await cloudPut(path, readableRecipes(merged), { rev:g.rev||null });
      if(up.ok){ rLastSync=Date.now(); break; }
      if(!up.conflict) throw new Error('upload failed');
    }
    lsSet(RCP_SIG_KEY, rsig(rstore));
    rStatus('');
  }catch(e){ rStatus(navigator.onLine===false ? 'Offline — recipes are saved on this phone and sync when you’re back online.' : 'Recipes didn’t sync ('+e.message+'). They’re safe on this phone.'); }
  finally{ _rSyncing=false; if(_rAgain){ _rAgain=false; syncRecipes(); } }
}
function rStatus(t){ const e=$('r-status'); if(e){ e.textContent=t; e.classList.toggle('hide', !t); } }

/* ---------------- search ---------------- */
const RIDX=new WeakMap();
function lines(a){ return (Array.isArray(a)?a:[]).filter(x=>!/^##\s/.test(String(x))).join(' '); }
function recipeIndex(r){
  let ix=RIDX.get(r); if(ix) return ix;
  const F=(w,t)=>({ w, words:words(t).split(' ').filter(Boolean) });
  const bk=r.bookId && byId(r.bookId);
  ix={ title:[F(10, r.title)], ing:[F(8, lines(r.ingredients))], titleStr:' '+words(r.title)+' ' };
  ix.all=ix.title.concat(ix.ing, [F(5, (r.tags||[]).join(' ')), F(5, r.category), F(4, r.cuisine), F(4, r.from), F(3, r.author),
    F(3, bk ? bk.title : r.bookTitle), F(2, r.about), F(1, lines(r.steps)), F(1, r.notes), F(1, RCP_SOURCES[r.source]||'')]);
  RIDX.set(r, ix); return ix;
}
function lastMade(r){ const m=(r.made||[]).map(x=>x.date||'').sort(); return m[m.length-1]||''; }
function filteredRecipes(){
  let q=words($('r-q').value).split(' ').filter(Boolean);
  if(q.some(t=>!STOP.has(t))) q=q.filter(t=>!STOP.has(t));
  const pool=liveRecipes().filter(r=>(!rui.show || (rui.show==='fav' ? r.favorite : rui.show==='want' ? r.want : rui.show==='check' ? (r.needsReview && !r.pending) : true))
    && (!rui.cat || r.category===rui.cat) && (!rui.book || r.bookId===rui.book) && dietOk(r));
  const out=[];
  for(const fuzzy of [false, true]){
    if(fuzzy && (out.length || !q.length)) break;
    for(const r of pool){
      let score=0;
      if(q.length){
        const ix=recipeIndex(r), fields=rui.scope==='title'?ix.title : rui.scope==='ing'?ix.ing : ix.all;
        let ok=true; for(const t of q){ const s=tokScore(fields, t, fuzzy); if(!s){ ok=false; break; } score+=s; }
        if(!ok) continue;
        if(ix.titleStr.includes(' '+q.join(' ')+' ')) score+=15;
      }
      out.push({ r, score });
    }
  }
  const byT=(x,y)=>natCmp(normKey(x.r.title), normKey(y.r.title));
  const cmp={ title:byT, added:(x,y)=>(y.r.addedAt||0)-(x.r.addedAt||0), made:(x,y)=>natCmp(lastMade(y.r), lastMade(x.r))||byT(x,y) }[rui.sort]||byT;
  out.sort((x,y)=> q.length && rui.sort==='title' ? (y.score-x.score)||cmp(x,y) : cmp(x,y));
  return out.map(o=>o.r);
}

/* ---------------- the list ---------------- */
function rTime(r){ return r.total || [r.prep && 'prep '+r.prep, r.cook && 'cook '+r.cook].filter(Boolean).join(' · '); }
function rSourceLine(r){
  const bk=r.bookId && byId(r.bookId);
  const book=bk ? bk.title : r.bookTitle;
  return [r.from, book ? book+(r.page?', p. '+r.page:'') : (r.source==='web' && r.url ? hostOf(r.url) : RCP_SOURCES[r.source]||'')].filter(Boolean).join(' · ');
}
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return ''; } }
function rThumb(r){
  const ph='<div class="ph" style="background-color:'+CLOTH[hue(r.title||'?')%CLOTH.length]+'">'+esc(initials(r.title||'?'))+'</div>';
  const p=(r.photos||[])[0];
  if(p && !/^\/|\.\./.test(p)){ const full=rcpFull(p); if(coverBlobs.has(full)) return '<img alt="" src="'+esc(coverBlobs.get(full))+'">'; loadCover(full);
    return '<img alt="" data-dbx="'+esc(full)+'" data-ph="'+esc(ph)+'" onerror="if(this.parentNode)this.parentNode.innerHTML=this.dataset.ph">'; }
  if(/^https:\/\//.test(r.image||'')) return '<img loading="lazy" alt="" src="'+esc(r.image)+'" data-ph="'+esc(ph)+'" onerror="if(this.parentNode)this.parentNode.innerHTML=this.dataset.ph">';
  return ph;
}
function renderRecipes(){
  if(!$('recipes')) return;
  if(typeof renderTodayPlan==='function'){ renderTodayPlan(); renderPlan(); }
  $('r-q').placeholder={ all:'Search recipes…', title:'Search recipe names…', ing:'What’s in the fridge? e.g. chicken rice' }[rui.scope]||'Search recipes…';
  document.querySelectorAll('#r-scope button').forEach(b=>b.classList.toggle('active', b.dataset.scope===rui.scope));
  document.querySelectorAll('#r-show button').forEach(b=>b.classList.toggle('active', b.dataset.show===rui.show));
  const nCheck=liveRecipes().filter(r=>r.needsReview && !r.pending).length;
  $('r-show-check').textContent='Check this'+(nCheck?' ('+nCheck+')':'');
  $('r-show-check').classList.toggle('hide', !nCheck && rui.show!=='check');
  const cats=uniq(liveRecipes().map(r=>r.category));
  $('r-cat').innerHTML='<option value="">All kinds</option>'+cats.map(c=>'<option'+(c===rui.cat?' selected':'')+'>'+esc(c)+'</option>').join('');
  $('r-sort').value=rui.sort;
  fillDatalist('dl-rcat', uniq(liveRecipes().map(r=>r.category).concat(['Breakfast','Bread','Main dish','Side dish','Soup','Salad','Dessert','Cookies','Snack','Drink','Canning'])));
  fillDatalist('dl-rfrom', uniq(liveRecipes().map(r=>r.from)));
  // filters on (same look as the Library's)
  const on=[]; const q=$('r-q').value.trim();
  if(q) on.push({ id:'q', label:({all:'Search',title:'Name',ing:'Ingredient'}[rui.scope])+': “'+q+'”' });
  if(rui.show) on.push({ id:'show', label:rui.show==='fav'?'Favorites':rui.show==='check'?'Check this':'Want to make' });
  if(rui.cat) on.push({ id:'cat', label:'Kind: '+rui.cat });
  if(rui.book){ const b=byId(rui.book); on.push({ id:'book', label:'Cookbook: '+(b?b.title:'?') }); }
  for(const d of (rui.diet||[])) on.push({ id:'diet:'+d, label:DIET_NAME[d]+(rui.dietStrict?' only':'') });
  renderDietRow();
  const bar=$('r-filter-bar'); bar.classList.toggle('hide', !on.length);
  bar.innerHTML=on.length ? '<span class="fb-label">Filters on:</span>'+on.map(f=>'<button class="fb-chip" data-roff="'+f.id+'">'+esc(f.label)+' <span aria-hidden="true">×</span></button>').join('')+'<button class="fb-clear" data-rclear>Clear filters</button>' : '';
  $('r-q').classList.toggle('filter-on', !!q); $('r-clear-q').classList.toggle('hide', !q);
  const pasted=asUrl(q) && /^https?:\/\/|\//i.test(q) ? asUrl(q) : '';
  $('r-urladd').classList.toggle('hide', !pasted);
  $('r-urladd').innerHTML=pasted ? '<span>That’s a link.</span><button id="r-urladd-go">＋ Add this recipe</button>' : '';
  if(pasted){ $('r-urladd-go').onclick=()=>addFromLink(pasted); }
  const list=filteredRecipes(), all=liveRecipes().length;
  $('r-summary').textContent = all ? (list.length===all ? all+' recipe'+(all===1?'':'s') : 'Showing '+list.length+' of '+all+' recipes') : '';
  const waiting=liveRecipes().filter(r=>r.pending).length;
  $('r-waiting').classList.toggle('hide', !waiting);
  $('r-waiting').textContent=waiting ? waiting+' waiting for Claude to read (links or photos sent). Say “check the recipes” next time you chat.' : '';
  if(!all){ $('r-results').innerHTML='<div class="card empty rc-empty"><b>No recipes yet.</b><br>Tap <b>+</b> to photograph recipe cards or cookbook pages, paste a link, or type one in.</div>'; renderGrocBadge(); return; }
  if(!list.length){ $('r-results').innerHTML='<div class="card empty">No recipes match. <button class="secondary" data-rclear>Clear filters</button></div>'; renderGrocBadge(); return; }
  $('r-results').innerHTML=list.map(r=>'<button class="rc-item" data-rid="'+esc(r.id)+'"><div class="rc-thumb">'+rThumb(r)+'</div><div class="rc-txt">'
    +'<b>'+esc(r.title||'(untitled)')+'</b>'
    +'<span class="rc-meta">'+esc(rSourceLine(r))+'</span>'
    +'<span class="rc-meta">'+esc([rTime(r), r.servings?'serves '+r.servings:''].filter(Boolean).join(' · '))+'</span>'
    +'<span class="chips">'+(r.favorite?'<span class="chip stars">♥ Favorite</span>':'')+(r.want?'<span class="chip reading">Want to make</span>':'')
      +(r.pending?'<span class="chip review">Waiting for Claude</span>':'')+(r.reread?'<span class="chip review">Waiting for Claude to re-read</span>':r.needsReview&&!r.pending?'<span class="chip review">Check this</span>':'')
      +((r.made||[]).length?'<span class="chip read">Made '+r.made.length+'×</span>':'')+dietBadges(r)+'</span>'
    +'</div></button>').join('');
  renderGrocBadge();
}
let _rqT=null;
$('r-q').addEventListener('input', ()=>{ clearTimeout(_rqT); _rqT=setTimeout(renderRecipes, 150); });
$('r-clear-q').onclick=()=>{ $('r-q').value=''; renderRecipes(); $('r-q').focus(); };
document.querySelectorAll('#r-scope button').forEach(b=>b.onclick=()=>{ rui.scope=b.dataset.scope; saveRui(); renderRecipes(); });
document.querySelectorAll('#r-show button').forEach(b=>b.onclick=()=>{ rui.show=b.dataset.show; saveRui(); renderRecipes(); });
$('r-cat').onchange=()=>{ rui.cat=$('r-cat').value; saveRui(); renderRecipes(); };
$('r-sort').onchange=()=>{ rui.sort=$('r-sort').value; saveRui(); renderRecipes(); };
function clearRecipeFilters(){ $('r-q').value=''; rui.show=''; rui.cat=''; rui.book=''; rui.diet=[]; rui.dietStrict=false; saveRui(); renderRecipes(); }
document.addEventListener('click', e=>{
  if(e.target.closest('[data-rclear]')){ clearRecipeFilters(); return; }
  const off=e.target.closest('[data-roff]'); if(off){ const k=off.dataset.roff; if(k==='q') $('r-q').value=''; else if(k.startsWith('diet:')) rui.diet=(rui.diet||[]).filter(x=>x!==k.slice(5)); else rui[k]=''; saveRui(); renderRecipes(); return; }
});
$('r-results').onclick=e=>{ const it=e.target.closest('[data-rid]'); if(it) openRecipe(it.dataset.rid); };

/* ---------------- quantities: scale "1 1/2 cups" by ×2 → "3 cups" ---------------- */
const VULGAR={ '½':.5, '⅓':1/3, '⅔':2/3, '¼':.25, '¾':.75, '⅛':.125, '⅜':.375, '⅝':.625, '⅞':.875, '⅕':.2, '⅙':1/6 };
const QTY_RE=/^(\s*)((?:\d+\s+\d+\/\d+)|(?:\d+\s*[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙])|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?)|[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙])(?:(\s*(?:-|–|to)\s*)((?:\d+\s+\d+\/\d+)|(?:\d+\s*[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙])|(?:\d+\/\d+)|(?:\d+(?:[.,]\d+)?)|[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙]))?/;
function parseQty(s){
  s=String(s).trim(); let m;
  if((m=s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + (+m[2])/(+m[3]);
  if((m=s.match(/^(\d+)\s*([½⅓⅔¼¾⅛⅜⅝⅞⅕⅙])$/))) return +m[1] + VULGAR[m[2]];
  if((m=s.match(/^(\d+)\/(\d+)$/))) return (+m[2]) ? (+m[1])/(+m[2]) : NaN;
  if(VULGAR[s]!=null) return VULGAR[s];
  return parseFloat(s.replace(',','.'));
}
function fmtQty(n){
  if(!isFinite(n)) return '';
  const whole=Math.floor(n+1e-9), frac=n-whole;
  const opts=[[0,''],[1/8,'⅛'],[1/4,'¼'],[1/3,'⅓'],[3/8,'⅜'],[1/2,'½'],[5/8,'⅝'],[2/3,'⅔'],[3/4,'¾'],[7/8,'⅞'],[1,'']];
  let best=opts[0]; for(const o of opts) if(Math.abs(frac-o[0])<Math.abs(frac-best[0])) best=o;
  if(Math.abs(frac-best[0])>0.04 && n<10) return String(Math.round(n*100)/100);   // not a kitchen fraction: plain decimal
  const w=whole+(best[0]===1?1:0);
  return (w? String(w):'')+(best[1]? (w?' ':'')+best[1] : (w?'':'0'));
}
function scaleLine(line, k){
  if(k===1 || /^##\s/.test(line)) return line;
  const m=String(line).match(QTY_RE); if(!m) return line;
  const a=parseQty(m[2]); if(!isFinite(a)) return line;
  let out=m[1]+fmtQty(a*k);
  if(m[4]){ const b=parseQty(m[4]); if(isFinite(b)) out+=m[3]+fmtQty(b*k); }
  return out+String(line).slice(m[0].length);
}

/* ---------------- the recipe window ---------------- */
let rCur=null, rScale=1;
function sectioned(arr, fn){
  let html='', open=false, n=0;
  for(const raw of (arr||[])){
    const s=String(raw||'').trim(); if(!s) continue;
    if(/^##\s/.test(s)){ if(open) html+='</ul>'; html+='<h4 class="rc-sec">'+esc(s.replace(/^##\s*/,''))+'</h4>'; open=false; continue; }
    if(!open){ html+='<ul>'; open=true; }
    html+=fn(s, ++n);
  }
  return html+(open?'</ul>':'');
}
let rFor=0;   // people, when opened from the meal plan
function openRecipe(id, opts){
  const r=recipeById(id); if(!r) return;
  opts=opts||{};
  if(rCur!==id) dietOpen=false;
  rCur=id; rScale=opts.scale>0 ? opts.scale : 1; rFor=opts.people||0;
  $('rc-modal').classList.remove('editing');
  drawRecipe();
  $('rc-bg').classList.add('open'); lockPage(); $('rc-modal').scrollTop=0;
}
function drawRecipe(){
  const r=recipeById(rCur); if(!r){ if($('rc-bg').classList.contains('open') && rCur){ closeRecipe(); toast('That recipe was deleted on another phone'); } return; }
  const bk=r.bookId && byId(r.bookId);
  $('rc-title').textContent=r.title||'(untitled)';
  $('rc-sub').innerHTML=[r.from?'From '+esc(r.from):'', bk ? '<a href="#" data-openbook="'+esc(bk.id)+'">📖 '+esc(bk.title)+'</a>'+(r.page?', p. '+esc(r.page):'')
      : r.bookTitle ? '📖 '+esc(r.bookTitle)+(r.page?', p. '+esc(r.page):'') : '',
    safeUrl(r.url) ? '<a href="'+esc(safeUrl(r.url))+'" target="_blank" rel="noopener">'+esc(hostOf(r.url)||'Website')+' ↗</a>' : (!bk && !r.bookTitle && r.source ? esc(RCP_SOURCES[r.source]||'') : '')].filter(Boolean).join(' · ');
  $('rc-facts').innerHTML=[r.servings?'<span><small>Serves</small>'+esc(r.servings)+'</span>':'', r.prep?'<span><small>Prep</small>'+esc(r.prep)+'</span>':'',
    r.cook?'<span><small>Cook</small>'+esc(r.cook)+'</span>':'', r.total?'<span><small>Total</small>'+esc(r.total)+'</span>':''].join('');
  renderRecipeDiet(r);
  $('rc-tags').innerHTML=[r.category, r.cuisine].concat(r.tags||[]).filter(Boolean).map(t=>'<span class="chip">'+esc(t)+'</span>').join('');
  $('rc-fav').classList.toggle('on', !!r.favorite); $('rc-fav').textContent=r.favorite?'♥ Favorite':'♡ Favorite';
  $('rc-want').classList.toggle('on', !!r.want); $('rc-want').textContent=r.want?'✓ Want to make':'Want to make';
  $('rc-pending').classList.toggle('hide', !r.pending);
  $('rc-pending').innerHTML=r.pending ? (r.pending==='link' ? 'This link couldn’t be read here. <b>Claude will fill it in</b> next time you say “check the recipes”.' : 'The photos are with Claude, waiting to be read.') : '';
  // Claude wasn't sure of some of it: offer another photo (a closer one of the unclear part) so it can be read again
  const unclear=!!r.needsReview && !r.pending;
  $('rc-unclear').classList.toggle('hide', !unclear);
  $('rc-unclear-txt').textContent=r.reread ? 'Your extra photo is with Claude. It will re-read this recipe next time you say “check the recipes”.' : 'Some of this wasn’t clear (see the notes below). A closer photo of the unclear part lets Claude read it again.';
  $('rc-reread').textContent=r.reread ? '📷 Take another photo' : '📷 Take another photo to re-read';
  document.querySelectorAll('#rc-scale button').forEach(b=>b.classList.toggle('active', +b.dataset.k===rScale));
  $('rc-scaled').classList.toggle('hide', !rFor || rScale===1);
  $('rc-scaled').textContent=rFor ? 'Amounts for '+rFor+' '+(rFor===1?'person':'people')+' (recipe serves '+r.servings+')' : '';
  $('rc-ing').innerHTML=(r.ingredients||[]).length ? sectioned(r.ingredients, s=>'<li>'+esc(scaleLine(s, rScale))+'</li>') : '<p class="note">No ingredients yet.</p>';
  $('rc-steps').innerHTML=(r.steps||[]).length ? sectioned(r.steps, (s,n)=>'<li><span class="rc-n">'+n+'</span><span>'+esc(s)+timerButtons(s, r.title, n)+'</span></li>').replace(/<ul>/g,'<ol class="rc-ol">').replace(/<\/ul>/g,'</ol>') : '<p class="note">No steps yet.</p>';
  $('rc-notes').innerHTML=(r.about?'<p>'+esc(r.about)+'</p>':'')+(r.notes?'<p class="rc-note">'+esc(r.notes).replace(/\n/g,'<br>')+'</p>':'');
  const made=(r.made||[]).slice().sort((a,b)=>natCmp(b.date,a.date));
  $('rc-made').innerHTML=made.length ? '<h4 class="rc-sec">Made it '+made.length+' time'+(made.length===1?'':'s')+'</h4><ul>'+made.slice(0,8).map(m=>'<li><b>'+esc(fmtLocalDate(m.date))+'</b>'+(m.note?' — '+esc(m.note):'')+'</li>').join('')+'</ul>' : '';
  const ph=(r.photos||[]);
  $('rc-photos').innerHTML=ph.length ? '<h4 class="rc-sec">Original</h4><div class="rc-phs">'+ph.map(p=>{ const full=rcpFull(p); const u=coverBlobs.get(full); if(!u) loadCover(full);
    return '<button class="rc-ph" data-full="'+esc(full)+'"><img alt="Original recipe photo" '+(u?'src="'+esc(u)+'"':'data-dbx="'+esc(full)+'"')+'></button>'; }).join('')+'</div>' : '';
}
$('rc-close').onclick=closeRecipe;
function closeRecipe(){ $('rc-bg').classList.remove('open'); unlockPage(); rCur=null; }
$('rc-bg').addEventListener('click', e=>{ if(e.target===$('rc-bg')) closeRecipe(); });
document.querySelectorAll('#rc-scale button').forEach(b=>b.onclick=()=>{ rScale=+b.dataset.k; rFor=0; drawRecipe(); });
function rUpdate(fn){ const r=recipeById(rCur); if(!r){ drawRecipe(); return; } fn(r); r.updatedAt=Date.now(); RIDX.delete(r); DIET_CACHE.delete(r); rcommit(); drawRecipe(); }
$('rc-fav').onclick=()=>rUpdate(r=>{ r.favorite=!r.favorite; });
$('rc-want').onclick=()=>rUpdate(r=>{ r.want=!r.want; });
$('rc-madeit').onclick=()=>{
  const note=prompt('Made it today! Any notes for next time? (optional)', ''); if(note===null) return;
  rUpdate(r=>{ r.made=(r.made||[]).concat({ date:todayLocal(), note:note.trim() }); r.want=false; });
  toast('Marked as made today');
};
$('rc-cook').onclick=()=>{ const r=recipeById(rCur); if(r) openCooking(r, rScale); };
$('rc-groc').onclick=()=>{ const r=recipeById(rCur); if(!r) return; const n=addToGrocery(r, rScale); toast(n ? n+' item'+(n===1?'':'s')+' added to the grocery list' : 'No ingredients to add'); };
$('rc-reread').onclick=async()=>{
  const r=recipeById(rCur); if(!r) return;
  if(!cloudOn()){ toast('Connect the library first (Epilogue → Data & Sync), so the photo can reach Claude.'); return; }
  const id=r.id, title=r.title||'recipe';
  await writeScanNote({ reread:id, title, source:r.source||'' });   // tells Claude which recipe these photos add to
  closeRecipe();
  openShelfCam({ room:'Reread '+title, bookcase:'Recipe 1', kind:'recipe', recipe:true, build:true, optional:true, finishLabel:'Done',
    fallback:()=>{ $('r-file').click(); },
    onFinish:cases=>{ const n=cases.reduce((s,c)=>s+c.n,0); if(!n) return;
      const x=recipeById(id); if(x){ x.reread=true; x.updatedAt=Date.now(); RIDX.delete(x); rcommit(); }
      toast(n+' photo'+(n===1?'':'s')+' sent. Claude re-reads “'+title+'” next time you ask.'); } });
};
$('rc-edit').onclick=()=>{ const r=recipeById(rCur); if(r) openRecipeForm(r); };
$('rc-share').onclick=async()=>{
  const r=recipeById(rCur); if(!r) return;
  const text=recipeText(r, rScale);
  if(navigator.share){ try{ await navigator.share({ title:r.title, text }); return; }catch(e){ if(e && e.name==='AbortError') return; } }
  try{ await navigator.clipboard.writeText(text); toast('Recipe copied'); }catch(e){ toast('Couldn’t copy on this device'); }
};
$('rc-print').onclick=()=>{ document.body.classList.add('print-recipe'); setTimeout(()=>{ window.print(); setTimeout(()=>document.body.classList.remove('print-recipe'), 500); }, 50); };
$('rc-del').onclick=()=>{
  const r=recipeById(rCur); if(!r) return;
  if(!confirm('Delete “'+(r.title||'this recipe')+'”? It’s removed from every phone in this library.')) return;
  const i=rstore.recipes.indexOf(r); rstore.recipes[i]={ id:r.id, deleted:true, updatedAt:Date.now() };
  closeRecipe(); rcommit(); toast('Recipe deleted');
};
$('rc-modal').addEventListener('click', e=>{
  const ob=e.target.closest('[data-openbook]'); if(ob){ e.preventDefault(); const id=ob.dataset.openbook; closeRecipe(); openBook(id); return; }
  const ph=e.target.closest('.rc-ph'); if(ph){ const u=coverBlobs.get(ph.dataset.full); if(u){ $('rcp-img').src=u; $('rcp-bg').classList.add('open'); } else toast('Still loading the photo…'); }
});
$('rcp-bg').onclick=()=>{ $('rcp-bg').classList.remove('open'); $('rcp-img').src=''; };
function recipeText(r, k){
  const sec=(arr, num)=>{ let n=0; return (arr||[]).map(s=>/^##\s/.test(s) ? '\n'+s.replace(/^##\s*/,'').toUpperCase() : (num ? (++n)+'. '+s : '• '+scaleLine(s,k||1))).join('\n'); };
  return [r.title, rSourceLine(r), [r.servings&&'Serves '+r.servings, r.total&&'Total '+r.total].filter(Boolean).join(' · '),
    '', 'INGREDIENTS', sec(r.ingredients), '', 'STEPS', sec(r.steps, true), r.notes ? '\nNOTES\n'+r.notes : '', r.url||''].filter(x=>x!=null).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

/* ---------------- add or edit (typed) ---------------- */
let rEditId=null;
function cookbookOptions(){
  const L=live().filter(b=>b.title && !String(b.title).startsWith('('));
  const cook=L.filter(b=>/cook|recipe|baking|kitchen|food|bread|canning|dessert/i.test([b.genre,b.subjects,b.title].join(' ')));
  const pick=cook.length ? cook : L;
  $('dl-rbook').innerHTML=pick.map(b=>'<option value="'+esc(b.title)+'">'+esc(b.author||'')+'</option>').join('');
}
function bookFromTitle(t){ t=normKey(t); if(!t) return null; const L=live().filter(b=>normKey(b.title)===t); return L.find(b=>/cook|recipe|food|baking/i.test([b.genre,b.subjects].join(' ')))||L[0]||null; }
function openRecipeForm(r){
  rEditId=r ? r.id : null;
  const v=r||{ source:'card' };
  const set=(id,x)=>{ $(id).value=x==null?'':x; };
  set('rf-title', v.title); set('rf-from', v.from); set('rf-source', v.source||'card');
  const bk=v.bookId && byId(v.bookId); set('rf-book', bk ? bk.title : v.bookTitle||''); set('rf-page', v.page); set('rf-url', v.url);
  set('rf-servings', v.servings); set('rf-prep', v.prep); set('rf-cook', v.cook); set('rf-total', v.total);
  set('rf-cat', v.category); set('rf-tags', (v.tags||[]).join(', '));
  for(const d of ['dairy','corn','gluten']) $('rf-diet-'+d).checked=(v.diet||[]).includes(d);
  set('rf-ing', (v.ingredients||[]).join('\n')); set('rf-steps', (v.steps||[]).join('\n')); set('rf-notes', v.notes);
  cookbookOptions(); rfSource();
  $('rf-del').classList.toggle('hide', !r);
  $('rc-form-h').textContent=r ? 'Edit recipe' : 'Type in a recipe';
  if(!$('rc-bg').classList.contains('open')){ $('rc-bg').classList.add('open'); lockPage(); }
  $('rc-modal').classList.add('editing'); $('rc-modal').scrollTop=0;
  setTimeout(()=>$('rf-title').focus(), 50);
}
function rfSource(){ const s=$('rf-source').value; $('rf-bookrow').classList.toggle('hide', s!=='cookbook'); $('rf-urlrow').classList.toggle('hide', s!=='web'); }
$('rf-source').onchange=rfSource;
$('rf-cancel').onclick=()=>{ if(rEditId){ $('rc-modal').classList.remove('editing'); drawRecipe(); } else closeRecipe(); };
$('rf-del').onclick=()=>$('rc-del').onclick();
// Steps and ingredients: one per line. Numbers/bullets at the start of a step are dropped; a line ending in ":" or
// starting with "##" is a section heading ("For the crust:").
function splitLines(t, steps){
  return String(t||'').split(/\n+/).map(s=>s.trim()).filter(Boolean).map(s=>{
    if(/^##\s*/.test(s)) return '## '+s.replace(/^##\s*/,'');
    if(/^[^.!?]{2,40}:$/.test(s)) return '## '+s.replace(/:$/,'');
    return steps ? s.replace(/^(?:step\s*)?\d+[.)]\s*/i,'').replace(/^[•\-*]\s*/,'') : s.replace(/^[•\-*]\s*/,'');
  });
}
$('rf-save').onclick=()=>{
  const title=$('rf-title').value.trim();
  if(!title){ toast('Give the recipe a name'); $('rf-title').focus(); return; }
  const dup=liveRecipes().find(x=>x.id!==rEditId && normKey(x.title)===normKey(title));
  if(dup && !confirm('You already have a recipe called “'+dup.title+'”. Save this one too?')) return;
  const src=$('rf-source').value, bookT=$('rf-book').value.trim(), bk=src==='cookbook' ? bookFromTitle(bookT) : null;
  const fields={ title, from:$('rf-from').value.trim(), source:src,
    bookId: bk ? bk.id : '', bookTitle: src==='cookbook' && !bk ? bookT : '', page: src==='cookbook' ? $('rf-page').value.trim() : '',
    url: src==='web' ? (asUrl($('rf-url').value)||'') : '',
    servings:$('rf-servings').value.trim(), prep:$('rf-prep').value.trim(), cook:$('rf-cook').value.trim(), total:$('rf-total').value.trim(),
    category:$('rf-cat').value.trim(), tags:$('rf-tags').value.split(',').map(s=>s.trim()).filter(Boolean),
    diet:['dairy','corn','gluten'].filter(d=>$('rf-diet-'+d).checked),
    ingredients:splitLines($('rf-ing').value), steps:splitLines($('rf-steps').value, true), notes:$('rf-notes').value.trim() };
  const now=Date.now();
  let r=rEditId && recipeById(rEditId);
  if(r){ Object.assign(r, fields); if(r.pending && fields.ingredients.length){ delete r.pending; } r.updatedAt=now; RIDX.delete(r); DIET_CACHE.delete(r); }
  else { r=Object.assign({ id:rid(), addedAt:now, updatedAt:now }, fields); rstore.recipes.push(r); }
  rcommit(); rCur=r.id; rScale=1; $('rc-modal').classList.remove('editing'); drawRecipe(); $('rc-modal').scrollTop=0; toast('Recipe saved');
};

/* ---------------- adding: photos, a link, or typing ---------------- */
/* Adding has to be quick (Matt: "maybe 5 seconds"): + opens the camera straight away, ready for the card or page;
   Done, and Claude does the rest. The row under the search box has the other ways, each one or two taps:
   🔗 Link (Paste and add), 📚 Cookbook (which book, then the camera), ✍️ Type. A link pasted into the search box
   offers "Add this recipe" too. */
function quickPhoto(){
  if(!cloudOn()){ toast('Connect the library first (Epilogue → Data & Sync), so photos can reach Claude. You can type one in now.'); openRecipeForm(null); return; }
  openShelfCam({ room:'', bookcase:'Recipe 1', kind:'recipe', recipe:true, build:true, optional:true, finishLabel:'Done',
    fallback:()=>{ $('ra-onefile').checked=false; $('ra-scan-src').value='card'; $('ra-from').value=''; $('r-file').click(); },
    onFinish:cases=>{ const n=cases.reduce((s,c)=>s+c.n,0); if(n) toast(n+' photo'+(n===1?'':'s')+' sent. Claude adds the recipe'+(cases.length===1?'':'s')+' next time you ask.'); } });
}
function openRAdd(view){ rAddView(view||'menu'); cookbookOptions(); $('ra-bg').classList.add('open'); lockPage(); }
$('r-add').onclick=quickPhoto;
$('rq-photo').onclick=quickPhoto;
$('rq-link').onclick=()=>openRAdd('link');
$('rq-book').onclick=()=>{ openRAdd('scan'); $('ra-scan-src').value='cookbook'; $('ra-bookrow').classList.remove('hide'); setTimeout(()=>$('ra-book').focus(), 50); };
$('rq-type').onclick=()=>openRecipeForm(null);
$('ra-close').onclick=closeRAdd;
function closeRAdd(){ $('ra-bg').classList.remove('open'); unlockPage(); }
function rAddView(v){ ['menu','scan','link'].forEach(k=>$('ra-'+k).classList.toggle('hide', k!==v)); $('ra-msg').textContent=''; if(v==='link') setTimeout(()=>$('ra-url').focus(), 50); }
document.querySelectorAll('[data-ra]').forEach(b=>b.onclick=()=>{ const v=b.dataset.ra; if(v==='type'){ closeRAdd(); openRecipeForm(null); return; } rAddView(v); });
$('ra-scan-src').onchange=()=>$('ra-bookrow').classList.toggle('hide', $('ra-scan-src').value!=='cookbook');
function scanInfo(){
  const src=$('ra-scan-src').value, from=$('ra-from').value.trim(), bt=$('ra-book').value.trim(), bk=src==='cookbook'?bookFromTitle(bt):null;
  return { source:src, from, bookId:bk?bk.id:'', bookTitle:src==='cookbook'?(bk?bk.title:bt):'', page:src==='cookbook'?$('ra-page').value.trim():'', apart:$('ra-onefile').checked?'one':'each' };
}
// The label in the photo names: who it's from, or the cookbook; "Recipe 1", "Recipe 2"… groups the pages of one recipe.
function scanLabel(info){ return info.bookTitle || info.from || RCP_SOURCES[info.source] || 'recipe'; }
async function writeScanNote(info){
  // a small note beside the photos, so Claude knows where they came from (the cookbook and page, who it's from)
  if(!cloudOn()) return;
  const d=new Date(), p=x=>String(x).padStart(2,'0');
  const path=dbxFolder()+'/photos/inbox/'+d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+' recipe-info NOTE.txt';
  const body=new Blob(['Recipe photos. '+JSON.stringify(info)+'\n']);
  try{ const r=await cloudPut(path, body, { autorename:true }); if(!r.ok) await queuePhoto(path, body); }catch(e){ await queuePhoto(path, body); }
}
$('ra-cam').onclick=async()=>{
  if(!cloudOn()){ toast('Connect the library first (Epilogue → Data & Sync) so photos can reach Claude'); return; }
  const info=scanInfo(); await writeScanNote(info); closeRAdd();
  openShelfCam({ room:scanLabel(info), bookcase:'Recipe 1', kind:'recipe', recipe:true, build:true, optional:true, finishLabel:'Done',
    fallback:()=>{ $('r-file').click(); },
    onFinish:cases=>{ const n=cases.reduce((s,c)=>s+c.n,0); if(n){ toast(n+' photo'+(n===1?'':'s')+' sent. Claude adds the recipes next time you ask.'); } } });
};
$('ra-pick').onclick=()=>{ if(!cloudOn()){ toast('Connect the library first (Epilogue → Data & Sync) so photos can reach Claude'); return; } $('r-file').click(); };
$('r-file').onchange=async e=>{
  const files=[...e.target.files]; e.target.value=''; if(!files.length) return;
  const info=scanInfo(); await writeScanNote(info);
  rAddView('scan'); if(!$('ra-bg').classList.contains('open')){ $('ra-bg').classList.add('open'); lockPage(); }
  let ok=0;
  if(info.apart==='one') ok=await sendToInbox(files, { room:scanLabel(info), bookcase:'Recipe 1', shelf:'', kind:'recipe' }, '', $('ra-msg'), null);
  else for(let i=0;i<files.length;i++) ok+=await sendToInbox([files[i]], { room:scanLabel(info), bookcase:'Recipe '+(i+1), shelf:'', kind:'recipe' }, '', $('ra-msg'), null);
  if(ok) $('ra-msg').textContent='✓ '+ok+' photo'+(ok===1?'':'s')+' sent. Claude adds the recipe'+(info.apart==='one'||files.length===1?'':'s')+' next time you say “check the recipes”.';
};
// A link: the friends service reads the recipe the page carries for search engines. If it can't, the link is
// saved as a recipe waiting for Claude (pending:'link'), so nothing is lost.
function asUrl(t){
  let url=String(t||'').trim(); if(!url || /\s/.test(url)) return '';
  if(!/^https?:\/\//i.test(url)){ if(!/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url)) return ''; url='https://'+url; }
  try{ const u=new URL(url); return /\./.test(u.hostname) ? u.toString() : ''; }catch(e){ return ''; }
}
$('ra-link-go').onclick=()=>addFromLink($('ra-url').value);
$('ra-paste').onclick=async()=>{
  let t=''; try{ t=await navigator.clipboard.readText(); }catch(e){}
  if(!asUrl(t)){ $('ra-msg').textContent='There’s no link to paste. Copy the recipe’s address first (Share → Copy link), or paste it in the box.'; $('ra-url').focus(); return; }
  $('ra-url').value=t.trim(); addFromLink(t);
};
async function addFromLink(raw){
  const url=asUrl(raw);
  if(!url){ $('ra-msg').textContent='That doesn’t look like a web address.'; return; }
  if(!$('ra-bg').classList.contains('open')) openRAdd('link');
  $('ra-url').value=url;
  const btn=$('ra-link-go'); btn.disabled=true; $('ra-paste').disabled=true; $('ra-msg').textContent='Reading the recipe…';
  let got=null;
  try{ got=await fetchRecipe(url); }catch(e){ got=null; }
  btn.disabled=false; $('ra-paste').disabled=false;
  const now=Date.now();
  const dup=liveRecipes().find(x=>x.url && x.url===url);
  if(dup && !confirm('You already saved this link (“'+dup.title+'”). Add it again?')){ closeRAdd(); openRecipe(dup.id); return; }
  let r;
  if(got && got.title && (got.ingredients||[]).length){
    r=Object.assign({ id:rid(), source:'web', url, addedAt:now, updatedAt:now }, got);
    toast('Recipe added');
  } else {
    r={ id:rid(), title:hostOf(url)+' recipe', source:'web', url, pending:'link', addedAt:now, updatedAt:now };
    toast('Saved. Claude will fill this one in next time you ask.');
  }
  rstore.recipes.push(r); $('r-q').value=''; rcommit(); $('ra-url').value=''; closeRAdd(); openRecipe(r.id);
}
async function fetchRecipe(url){
  const srv=friendServer(); if(!srv || navigator.onLine===false) return null;
  const f=friendCfg();
  const r=await fetch(srv.replace(/\/+$/,'')+'/recipe/fetch', { method:'POST', headers:Object.assign({ 'Content-Type':'application/json' }, f?{ Authorization:'Bearer '+f.token }:{}), body:JSON.stringify({ url }) });
  if(!r.ok) return null;
  const j=await r.json().catch(()=>null);
  return j && j.recipe ? j.recipe : null;
}

/* ---------------- grocery list (kept on this phone) ---------------- */
function grocery(){ try{ return JSON.parse(lsGet(GROC_KEY)||'[]'); }catch(e){ return []; } }
function saveGrocery(L){ lsSet(GROC_KEY, JSON.stringify(L)); renderGrocBadge(); }
function addToGrocery(r, k){
  const L=grocery(); let n=0;
  for(const s of (r.ingredients||[])){ if(/^##\s/.test(s) || !String(s).trim()) continue; L.push({ t:scaleLine(s, k||1), r:r.title, done:false }); n++; }
  saveGrocery(L); return n;
}
function renderGrocBadge(){ const n=grocery().filter(x=>!x.done).length; const b=$('r-groc-n'); if(b){ b.textContent=n; b.classList.toggle('hide', !n); } }
function renderGrocery(){
  const L=grocery();
  if(!L.length){ $('gr-list').innerHTML='<p class="note">The list is empty. Open a recipe and tap <b>🛒 Grocery list</b> to add its ingredients.</p>'; return; }
  const by=new Map(); L.forEach((x,i)=>{ if(!by.has(x.r)) by.set(x.r, []); by.get(x.r).push([x,i]); });
  $('gr-list').innerHTML=[...by.entries()].map(([r,items])=>'<h4 class="rc-sec">'+esc(r||'Other')+'</h4>'
    +items.map(([x,i])=>'<label class="gr-item'+(x.done?' done':'')+'"><input type="checkbox" data-gi="'+i+'"'+(x.done?' checked':'')+'> <span>'+esc(x.t)+'</span></label>').join('')).join('');
}
$('r-grocery').onclick=()=>{ renderGrocery(); $('gr-bg').classList.add('open'); lockPage(); };
$('gr-close').onclick=()=>{ $('gr-bg').classList.remove('open'); unlockPage(); };
$('gr-list').onchange=e=>{ const c=e.target.closest('[data-gi]'); if(!c) return; const L=grocery(); const x=L[+c.dataset.gi]; if(x){ x.done=c.checked; saveGrocery(L); renderGrocery(); } };
$('gr-clear-done').onclick=()=>{ saveGrocery(grocery().filter(x=>!x.done)); renderGrocery(); };
$('gr-clear-all').onclick=()=>{ if(confirm('Empty the grocery list?')){ saveGrocery([]); renderGrocery(); } };
$('gr-share').onclick=async()=>{
  const text=grocery().filter(x=>!x.done).map(x=>x.t).join('\n'); if(!text){ toast('Nothing left on the list'); return; }
  if(navigator.share){ try{ await navigator.share({ title:'Grocery list', text }); return; }catch(e){ if(e && e.name==='AbortError') return; } }
  try{ await navigator.clipboard.writeText(text); toast('List copied'); }catch(e){ toast('Couldn’t copy on this device'); }
};

/* ---------------- recipes from a cookbook, shown in that book's window ---------------- */
function bookRecipesNote(b){
  const L=liveRecipes().filter(r=>r.bookId===b.id); if(!L.length) return;
  const v=$('m-view'); if(!v) return;
  v.insertAdjacentHTML('beforeend','<p class="note rc-booknote">🍳 '+L.length+' recipe'+(L.length===1?'':'s')+' from this book · <a href="#" data-bookrecipes="'+esc(b.id)+'">Show them</a></p>');
}
document.addEventListener('click', e=>{
  const a=e.target.closest('[data-bookrecipes]'); if(!a) return; e.preventDefault();
  rui.book=a.dataset.bookrecipes; $('r-q').value=''; saveRui(); closeModal(); showPanel('recipes');
});

window.addEventListener('online', ()=>setTimeout(syncRecipes, 1500));
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && Date.now()-rLastSync>15000) syncRecipes(); });
