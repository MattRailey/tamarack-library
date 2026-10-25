/* Railey Library — mealplan.js
   Meal plan: seven days at a time, starting today (‹ › move a week; "Today" comes back), Breakfast / Lunch / Dinner / Snacks & dessert for each day.
   Pick recipes into a meal (or type a note: "Leftovers", "Pizza night"), each for a number of people (the household's
   number by default: "Cooking for 5"). Tap a planned recipe to open it with the amounts scaled for those people.
   "Ingredients for this week" adds everything up, scaled, same ingredients combined ("1 cup flour" + "2 cups flour"
   → "3 cups flour"); tick the ones you don't have (Matt: a checkmark next to what we need), then add those to the
   shopping list or share them.
   The plan lives in recipes.json (plan: [...], settings: { people }), so the whole household shares it.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

const MEALS=[['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snacks & dessert']];
const MEAL_NAME=Object.fromEntries(MEALS);
let mpWeek=null;          // the first day shown (YYYY-MM-DD); today by default
let mpPick=null;          // { date, meal } being filled from the picker, or { recipeId } from "Plan it"

function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fromYmd(s){ const p=String(s).split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
function addDays(s, n){ const d=fromYmd(s); d.setDate(d.getDate()+n); return ymd(d); }
function weekStart(){ return todayLocal(); }
function planList(){ return (rstore.plan||[]).filter(p=>p && !p.deleted && !p.trip); }   // the week; trip meals live in their trip
function tripList(){ return (rstore.trips||[]).filter(t=>t && !t.deleted).sort((a,b)=>String(a.start).localeCompare(String(b.start))); }
function tripById(id){ return tripList().find(t=>t.id===id); }
function tripEntries(id){ return (rstore.plan||[]).filter(p=>p && !p.deleted && p.trip===id); }
function householdPeople(){ const n=+((rstore.settings||{}).people); return n>0 ? n : 4; }
// "12 rolls" → 12, "4-6" → 4, "2 dozen" → 24, "makes 8" → 8, "" → 0 (unknown: amounts stay as written)
function servingsNum(s){
  const t=String(s||'').toLowerCase(); const m=t.match(/(\d+(?:[.,]\d+)?)/); if(!m) return 0;
  const n=parseFloat(m[1].replace(',','.')); return /dozen/.test(t) ? n*12 : n;
}
function planScale(p, r){ const n=servingsNum(r && r.servings); return n ? (p.people||householdPeople())/n : 1; }
function rpcommit(){ rstore.updatedAt=Date.now(); rSaveLocal(); renderPlan(); renderTrips(); renderRecipes(); rSchedule(); }

/* ---------------- Recipes | Meal plan ---------------- */
let rView='recipes'; try{ { const v=lsGet('tamarack_library_rview'+LIB_NS); rView=(v==='plan'||v==='trips') ? v : 'recipes'; } }catch(e){}
function showRView(v){
  rView=v; lsSet('tamarack_library_rview'+LIB_NS, v);
  document.querySelectorAll('#r-view button').forEach(b=>b.classList.toggle('active', b.dataset.rv===v));
  $('r-recipes-view').classList.toggle('hide', v!=='recipes'); $('r-plan-view').classList.toggle('hide', v!=='plan'); $('r-trips-view').classList.toggle('hide', v!=='trips');
  if(v==='plan') renderPlan(); if(v==='trips') renderTrips();
}
document.querySelectorAll('#r-view button').forEach(b=>b.onclick=()=>showRView(b.dataset.rv));

/* ---------------- the week ---------------- */
function dayHtml(d, entries, today, fmt, dated, label){
  let html='<div class="mp-day'+(d===today&&dated?' today':'')+(d<today&&dated?' past':'')+'"><h4>'+esc(label || fmt(d,{ weekday:'long' }))+' <small>'+esc(label ? fmt(d,{ weekday:'short', month:'short', day:'numeric' }) : fmt(d,{ month:'short', day:'numeric' }))+'</small>'+(d===today&&dated?' <span class="chip read">Today</span>':'')+'</h4>';
  for(const [meal, name] of MEALS){
    const items=entries.filter(p=>p.date===d && p.meal===meal).sort((a,b)=>(a.at||0)-(b.at||0));
    html+='<div class="mp-meal"><span class="mp-mname">'+name+'</span><div class="mp-items">'
      +items.map(p=>{ const r=p.recipeId && recipeById(p.recipeId);
        const label=r ? r.title : p.recipeId ? '(recipe deleted)' : p.text||'';
        return '<span class="mp-item'+(r?'':' note')+'"><button class="mp-open" data-pid="'+esc(p.id)+'">'+esc(label)+'</button>'
          +(r ? '<button class="mp-ppl" data-pid="'+esc(p.id)+'" title="How many people">👤 '+(p.people||householdPeople())+'</button>' : '')
          +'<button class="mp-x" data-pid="'+esc(p.id)+'" aria-label="Take off the plan">×</button></span>'; }).join('')
      +'<button class="mp-add" data-date="'+d+'" data-meal="'+meal+'" aria-label="Add to '+name+', '+esc(fmt(d,{ weekday:'long' }))+'">＋</button></div></div>';
  }
  return html+'</div>';
}
function renderPlan(){
  if(!$('r-plan-view') || rView!=='plan') return;
  if(!mpWeek) mpWeek=weekStart();
  const end=addDays(mpWeek, 6), today=todayLocal();
  const fmt=(s,o)=>fromYmd(s).toLocaleDateString(undefined, o);
  $('mp-range').textContent=fmt(mpWeek,{ month:'short', day:'numeric' })+' – '+fmt(end,{ month:'short', day:'numeric', year:'numeric' });
  $('mp-thisweek').classList.toggle('hide', mpWeek===weekStart());
  $('mp-people').textContent=householdPeople();
  const inWeek=planList().filter(p=>p.date>=mpWeek && p.date<=end);
  const n=inWeek.filter(p=>p.recipeId && recipeById(p.recipeId)).length;
  $('mp-ing').textContent='🛒 Ingredients for this week'+(n?' ('+n+' recipe'+(n===1?'':'s')+')':'');
  $('mp-ing').disabled=!n;
  let html='';
  for(let i=0;i<7;i++) html+=dayHtml(addDays(mpWeek, i), inWeek, today, fmt, true);
  $('mp-days').innerHTML=html;
}
$('mp-prev').onclick=()=>{ mpWeek=addDays(mpWeek||weekStart(), -7); renderPlan(); };
$('mp-next').onclick=()=>{ mpWeek=addDays(mpWeek||weekStart(), 7); renderPlan(); };
$('mp-thisweek').onclick=()=>{ mpWeek=weekStart(); renderPlan(); };
function setPeople(n){ n=Math.max(1, Math.min(40, Math.round(n))); rstore.settings=Object.assign({}, rstore.settings, { people:n, updatedAt:Date.now() }); rpcommit(); }
$('mp-ppl-minus').onclick=()=>setPeople(householdPeople()-1);
$('mp-ppl-plus').onclick=()=>setPeople(householdPeople()+1);
function planClick(e){
  const inTrip=e.currentTarget===$('tr-days');
  const add=e.target.closest('.mp-add'); if(add){ openPicker(inTrip ? { date:add.dataset.date, meal:add.dataset.meal, trip:trCur } : { date:add.dataset.date, meal:add.dataset.meal }); return; }
  const x=e.target.closest('.mp-x'); if(x){ const p=(rstore.plan||[]).find(q=>q.id===x.dataset.pid); if(p){ Object.keys(p).forEach(k=>{ if(!['id'].includes(k)) delete p[k]; }); p.deleted=true; p.updatedAt=Date.now(); rpcommit(); } return; }
  const ppl=e.target.closest('.mp-ppl'); if(ppl){
    const p=(rstore.plan||[]).find(q=>q.id===ppl.dataset.pid); if(!p) return;
    const v=prompt('How many people is this for?', p.people||householdPeople()); if(v===null) return;
    const n=parseInt(v,10); if(!(n>0)){ toast('Type a number'); return; }
    p.people=Math.min(60,n); p.updatedAt=Date.now(); rpcommit(); return; }
  const op=e.target.closest('.mp-open'); if(op){
    const p=(rstore.plan||[]).find(q=>q.id===op.dataset.pid); const r=p && p.recipeId && recipeById(p.recipeId);
    if(r) openRecipe(r.id, { scale:planScale(p, r), people:servingsNum(r.servings) ? (p.people||householdPeople()) : 0 });
    else if(p && !p.recipeId){ const v=prompt('Change the note', p.text||''); if(v===null) return; if(!v.trim()) return; p.text=v.trim().slice(0,80); p.updatedAt=Date.now(); rpcommit(); }
  }
}
$('mp-days').onclick=planClick; $('tr-days').onclick=planClick;
function addPlan(date, meal, o){
  rstore.plan=(rstore.plan||[]).concat(Object.assign({ id:'p'+Date.now().toString(36)+Math.random().toString(36).slice(2,6), date, meal, at:Date.now(), updatedAt:Date.now() }, o));
  rpcommit();
}

/* ---------------- picking a recipe for a meal ---------------- */
function openPicker(slot){
  mpPick=slot; $('mpk-q').value='';
  $('mpk-h').textContent=MEAL_NAME[slot.meal]+', '+fromYmd(slot.date).toLocaleDateString(undefined,{ weekday:'long', month:'short', day:'numeric' });
  $('mpk-people').value=(slot.trip && tripById(slot.trip) && tripById(slot.trip).people) || householdPeople();
  renderPicker(); $('mpk-bg').classList.add('open'); lockPage(); setTimeout(()=>$('mpk-q').focus(), 50);
}
function renderPicker(){
  const qw=words($('mpk-q').value).split(' ').filter(Boolean).filter(t=>!STOP.has(t));
  let L=liveRecipes().filter(r=>!r.pending || r.title);
  if(qw.length) L=L.filter(r=>{ const ix=recipeIndex(r); return qw.every(t=>tokScore(ix.all, t, false)); });
  const rank=r=>(r.favorite?0:r.want?1:2);
  L.sort((a,b)=>rank(a)-rank(b) || natCmp(lastMade(b), lastMade(a)) || natCmp(normKey(a.title), normKey(b.title)));
  const typed=$('mpk-q').value.trim();
  $('mpk-list').innerHTML=(typed ? '<button class="mpk-note" data-note="1">✎ Add “'+esc(typed)+'” as a note (no recipe)</button>' : '')
    +(L.length ? L.slice(0,60).map(r=>'<button class="mpk-item" data-rid="'+esc(r.id)+'"><b>'+esc(r.title)+'</b><span>'+esc([r.favorite?'♥':'', r.want?'Want to make':'', r.servings?'serves '+r.servings:'', rTime(r)].filter(Boolean).join(' · '))+'</span></button>').join('')
      : '<p class="note">'+(liveRecipes().length ? 'No recipe matches. Add it as a note above, or add the recipe first.' : 'No recipes yet. Type a note above (e.g. “Tacos”), or add recipes in the Recipes view.')+'</p>');
}
$('mpk-q').addEventListener('input', renderPicker);
$('mpk-close').onclick=closePicker;
function closePicker(){ $('mpk-bg').classList.remove('open'); unlockPage(); mpPick=null; }
$('mpk-list').onclick=e=>{
  if(!mpPick) return;
  const people=Math.max(1, parseInt($('mpk-people').value,10)||householdPeople());
  const it=e.target.closest('[data-rid]');
  if(it){ addPlan(mpPick.date, mpPick.meal, Object.assign({ recipeId:it.dataset.rid, people }, mpPick.trip ? { trip:mpPick.trip } : {})); toast('Planned'); closePicker(); return; }
  if(e.target.closest('[data-note]')){ addPlan(mpPick.date, mpPick.meal, Object.assign({ text:$('mpk-q').value.trim().slice(0,80) }, mpPick.trip ? { trip:mpPick.trip } : {})); closePicker(); }
};

/* ---------------- "Plan it" from a recipe ---------------- */
$('rc-plan').onclick=()=>{
  const r=recipeById(rCur); if(!r) return;
  $('mpq-h').textContent='Plan “'+r.title+'”';
  $('mpq-date').value=todayLocal(); $('mpq-meal').value='dinner'; $('mpq-people').value=householdPeople();
  $('mpq-bg').classList.add('open');
};
$('mpq-cancel').onclick=()=>$('mpq-bg').classList.remove('open');
$('mpq-save').onclick=()=>{
  const r=recipeById(rCur); if(!r) return;
  const date=$('mpq-date').value; if(!/^\d{4}-\d\d-\d\d$/.test(date)){ toast('Pick a day'); return; }
  addPlan(date, $('mpq-meal').value, { recipeId:r.id, people:Math.max(1, parseInt($('mpq-people').value,10)||householdPeople()) });
  $('mpq-bg').classList.remove('open');
  toast('Planned for '+MEAL_NAME[$('mpq-meal').value].toLowerCase()+', '+fromYmd(date).toLocaleDateString(undefined,{ weekday:'long', month:'short', day:'numeric' }));
};

/* ---------------- the week's ingredients, scaled and added up ---------------- */
const UNIT_KEY={ cups:'cup', c:'cup', tablespoons:'tbsp', tablespoon:'tbsp', tbsps:'tbsp', tbs:'tbsp', teaspoons:'tsp', teaspoon:'tsp', tsps:'tsp',
  pounds:'lb', pound:'lb', lbs:'lb', ounces:'oz', ounce:'oz', cloves:'clove', cans:'can', packages:'package', pkg:'package', sticks:'stick', slices:'slice', quarts:'quart', pints:'pint', grams:'g', gram:'g', kg:'kg' };
function ingKey(rest){
  return norm(rest).replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(Boolean)
    .map((w,i)=>UNIT_KEY[w] || (w.length>3 && /[^s]s$/.test(w) ? w.slice(0,-1) : w)).join(' ');
}
// [{ line, from }] → [{ text, from:[recipe titles] }], same ingredient (and unit) added up
function combineIngredients(items){
  const out=[], by=new Map();
  for(const it of items){
    const line=String(it.line||'').trim(); if(!line || /^##\s/.test(line)) continue;
    const m=line.match(QTY_RE);
    let qty=NaN, rest=line;
    if(m && !m[4]){ qty=parseQty(m[2]); rest=line.slice(m[0].length).trim(); }
    const key=(isFinite(qty)?'q|':'t|')+ingKey(rest || line);
    let e=by.get(key);
    if(e && isFinite(qty) && isFinite(e.qty)){ e.qty+=qty; if(qty>1 && !(e.big)) e.big=rest; if(!e.from.includes(it.from)) e.from.push(it.from); e.n++; continue; }
    if(e && !isFinite(qty) && !isFinite(e.qty)){ if(!e.from.includes(it.from)) e.from.push(it.from); e.n++; continue; }
    e={ qty, rest, line, from:[it.from], n:1, big:isFinite(qty) && qty>1 ? rest : '' }; by.set(key+(by.has(key)?'|'+out.length:''), e); out.push(e);
  }
  // "3 cups flour", not "3 cup flour": over one, take the wording of a line that was already over one
  return out.map(e=>{ const q=isFinite(e.qty) ? shopQty(e.qty, e.rest) : NaN, rest=q>1 && e.big ? e.big : e.rest;
    return { text: isFinite(q) ? fmtQty(q)+(rest?' '+rest:'') : e.line, from:e.from }; });
}
// For buying: things you count round up to whole ones (2½ eggs → 3); measured amounts up to a kitchen measure (0.83 cup → 1 cup)
const MEASURED=new Set(['cup','tbsp','tsp','lb','oz','g','kg','ml','l','quart','pint','gallon','stick','pinch','dash']);
function shopQty(q, rest){
  const u=ingKey(rest).split(' ')[0];
  if(!MEASURED.has(u)) return Math.ceil(q-1e-9);
  const whole=Math.floor(q+1e-9), f=q-whole; if(f<1e-6) return whole;
  const up=[1/4,1/3,1/2,2/3,3/4,1].find(x=>x>=f-1e-6);
  return whole+up;
}
function entryItems(entries){
  const items=[];
  for(const p of entries.filter(p=>p.recipeId)){
    const r=recipeById(p.recipeId); if(!r) continue;
    const k=planScale(p, r);
    for(const s of (r.ingredients||[])) items.push({ line:scaleLine(String(s), k), from:r.title });
  }
  return combineIngredients(items);
}
let mpIng=[], mpIngLabel='';
function weekEntries(){ const end=addDays(mpWeek||weekStart(), 6); return planList().filter(p=>p.date>=(mpWeek||weekStart()) && p.date<=end); }
$('mp-ing').onclick=()=>openIng(weekEntries(), 'Week of '+fromYmd(mpWeek).toLocaleDateString(undefined,{ month:'short', day:'numeric' }), 'Ingredients for the week');
function openIng(entries, label, title){
  mpIngSolo=false; mpIngLabel=label; $('mi-h').textContent=title;
  mpIng=entryItems(entries).map(x=>Object.assign({ need:false }, x));
  const unk=entries.filter(p=>p.recipeId).map(p=>recipeById(p.recipeId)).filter(r=>r && !servingsNum(r.servings));
  $('mi-note').textContent='Amounts are for the people planned at each meal. Tick what you need to buy.'
    +(unk.length ? ' Not scaled (the recipe doesn’t say how many it serves): '+[...new Set(unk.map(r=>r.title))].join(', ')+'.' : '');
  renderWeekIng(); $('mi-bg').classList.add('open'); lockPage();
}
// a single recipe's 🛒: tick what you need and send it to your cart (share/copy); nothing is saved for later
function openRecipeIng(r, k){
  mpIngLabel=r.title; $('mi-h').textContent='Groceries for '+(r.title||'this recipe');
  mpIng=combineIngredients((r.ingredients||[]).map(s=>({ line:scaleLine(String(s), k||1), from:r.title }))).map(x=>Object.assign({ need:false }, x));
  $('mi-note').textContent='Tick what you need to buy, then send it to your cart.';
  mpIngSolo=true; renderWeekIng(); $('mi-bg').classList.add('open'); lockPage();
}
let mpIngSolo=false;
function renderWeekIng(){
  $('mi-list').innerHTML=mpIng.length ? mpIng.map((x,i)=>'<label class="gr-item mi-item'+(x.need?' need':'')+'"><input type="checkbox" data-mi="'+i+'"'+(x.need?' checked':'')+'> <span>'+esc(x.text)+'<small class="mi-from">'+esc(x.from.join(', '))+'</small></span></label>').join('')
    : '<p class="note">Nothing planned with a recipe yet.</p>';
  const n=mpIng.filter(x=>x.need).length; $('mi-add').textContent=n ? 'Add '+n+' to the shopping list' : 'Tick what you need'; $('mi-add').disabled=!n; $('mi-add').classList.toggle('hide', mpIngSolo); $('mi-share').textContent=mpIngSolo ? (n ? 'Send '+n+' to cart' : 'Tick what you need') : 'Share or copy'; $('mi-share').classList.toggle('secondary', !mpIngSolo);
  $('mi-all').textContent=mpIng.length && mpIng.every(x=>x.need) ? 'Untick all' : 'Tick all';
}
$('mi-list').onchange=e=>{ const c=e.target.closest('[data-mi]'); if(!c) return; mpIng[+c.dataset.mi].need=c.checked; renderWeekIng(); };
$('mi-all').onclick=()=>{ const all=mpIng.every(x=>x.need); mpIng.forEach(x=>x.need=!all); renderWeekIng(); };
$('mi-close').onclick=()=>{ $('mi-bg').classList.remove('open'); unlockPage(); };
$('mi-add').onclick=()=>{
  const L=grocery(); const add=mpIng.filter(x=>x.need);
  for(const x of add) L.push({ t:x.text, r:mpIngLabel, done:false });
  saveGrocery(L); toast(add.length+' item'+(add.length===1?'':'s')+' added to the shopping list');
  $('mi-bg').classList.remove('open'); unlockPage();
};
$('mi-share').onclick=async()=>{
  const text=mpIng.filter(x=>x.need).map(x=>x.text).join('\n'); if(!text){ toast('Tick what you need first'); return; }
  if(navigator.share){ try{ await navigator.share({ title:mpIngLabel||'Groceries', text }); return; }catch(e){ if(e && e.name==='AbortError') return; } }
  try{ await navigator.clipboard.writeText(text); toast('List copied'); }catch(e){ toast('Couldn’t copy on this device'); }
};

/* ---------------- what's planned today, above the recipe list ---------------- */
function renderTodayPlan(){
  const el=$('r-today'); if(!el) return;
  const t=todayLocal(), items=planList().filter(p=>p.date===t).sort((a,b)=>MEALS.findIndex(m=>m[0]===a.meal)-MEALS.findIndex(m=>m[0]===b.meal));
  el.classList.toggle('hide', !items.length);
  el.innerHTML=items.length ? '<b>Today:</b> '+items.map(p=>{ const r=p.recipeId && recipeById(p.recipeId);
    return esc(MEAL_NAME[p.meal])+' — '+(r ? '<a href="#" data-pid="'+esc(p.id)+'">'+esc(r.title)+'</a>' : esc(p.text||'')); }).join(' · ') : '';
}
$('r-today').onclick=e=>{ const a=e.target.closest('[data-pid]'); if(!a) return; e.preventDefault();
  const p=(rstore.plan||[]).find(q=>q.id===a.dataset.pid), r=p && recipeById(p.recipeId);
  if(r) openRecipe(r.id, { scale:planScale(p, r), people:servingsNum(r.servings) ? (p.people||householdPeople()) : 0 }); };

/* ---------------- trips: a few days away, planned meal by meal ---------------- */
let trCur=null, trEditing=null;
const tFmt=(d,o)=>fromYmd(d).toLocaleDateString(undefined, o);
function tripEnd(t){ return addDays(t.start, Math.max(1, t.days||1)-1); }
function tripRange(t){ return tFmt(t.start,{ month:'short', day:'numeric' })+' – '+tFmt(tripEnd(t),{ month:'short', day:'numeric', year:'numeric' }); }
function tripInRange(t){ const e=tripEnd(t); return tripEntries(t.id).filter(p=>p.date>=t.start && p.date<=e); }
function renderTrips(){
  if(!$('r-trips-view') || rView!=='trips') return;
  const t=trCur && tripById(trCur);
  if(trCur && !t) trCur=null;
  $('tr-list-pane').classList.toggle('hide', !!t); $('tr-detail-pane').classList.toggle('hide', !t);
  if(!t){
    const L=tripList(), today=todayLocal();
    $('tr-list').innerHTML=L.length ? L.map(x=>{ const n=tripInRange(x).filter(p=>p.recipeId&&recipeById(p.recipeId)).length;
      return '<button class="tr-card'+(tripEnd(x)<today?' past':'')+'" data-tid="'+esc(x.id)+'"><b>'+esc(x.name||'Trip')+'</b><span>'+esc(tripRange(x))+' · '+x.days+' day'+(x.days===1?'':'s')+' · '+x.people+' people · '+n+' recipe'+(n===1?'':'s')+'</span></button>'; }).join('')
      : '<p class="note">No trips yet.</p>';
    return;
  }
  $('tr-title').textContent=t.name||'Trip';
  $('tr-sub').textContent=tripRange(t)+' · '+t.days+' day'+(t.days===1?'':'s')+' · '+t.people+' people';
  $('tr-notes').textContent=t.notes||''; $('tr-notes').classList.toggle('hide', !t.notes);
  const inR=tripInRange(t), n=inR.filter(p=>p.recipeId&&recipeById(p.recipeId)).length;
  $('tr-ing').textContent='🛒 Ingredients for this trip'+(n?' ('+n+' recipe'+(n===1?'':'s')+')':''); $('tr-ing').disabled=!n;
  $('tr-meals').disabled=!inR.length;
  let html=''; for(let i=0;i<t.days;i++) html+=dayHtml(addDays(t.start,i), inR, '', tFmt, false, 'Day '+(i+1));
  $('tr-days').innerHTML=html;
}
$('tr-list').onclick=e=>{ const c=e.target.closest('[data-tid]'); if(c){ trCur=c.dataset.tid; renderTrips(); window.scrollTo(0,0); } };
$('tr-back').onclick=()=>{ trCur=null; renderTrips(); };
function openTripForm(t){
  trEditing=t||null;
  $('trm-h').textContent=t ? 'Change trip' : 'Plan a trip';
  $('trm-name').value=t ? t.name : ''; $('trm-start').value=t ? t.start : todayLocal(); $('trm-days').value=t ? t.days : 3;
  $('trm-people').value=t ? t.people : householdPeople(); $('trm-notes').value=t ? (t.notes||'') : '';
  $('trm-del').classList.toggle('hide', !t); $('trm-bg').classList.add('open');
}
$('tr-new').onclick=()=>openTripForm(null);
$('tr-edit').onclick=()=>openTripForm(tripById(trCur));
$('trm-cancel').onclick=()=>$('trm-bg').classList.remove('open');
$('trm-save').onclick=()=>{
  const start=$('trm-start').value; if(!/^\d{4}-\d\d-\d\d$/.test(start)){ toast('Pick the first day'); return; }
  const days=Math.max(1, Math.min(21, parseInt($('trm-days').value,10)||0)); if(!days){ toast('How many days?'); return; }
  const o={ name:$('trm-name').value.trim().slice(0,60)||'Trip', start, days, people:Math.max(1, Math.min(60, parseInt($('trm-people').value,10)||householdPeople())), notes:$('trm-notes').value.trim().slice(0,600), updatedAt:Date.now() };
  if(trEditing){ Object.assign(trEditing, o); }
  else { const t=Object.assign({ id:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,5) }, o); rstore.trips=(rstore.trips||[]).concat(t); trCur=t.id; }
  $('trm-bg').classList.remove('open'); rpcommit();
};
$('trm-del').onclick=()=>{
  const t=trEditing; if(!t || !confirm('Delete “'+t.name+'” and its meals?')) return;
  tripEntries(t.id).forEach(p=>{ Object.keys(p).forEach(k=>{ if(k!=='id') delete p[k]; }); p.deleted=true; p.updatedAt=Date.now(); });
  Object.keys(t).forEach(k=>{ if(k!=='id') delete t[k]; }); t.deleted=true; t.updatedAt=Date.now();
  trCur=null; $('trm-bg').classList.remove('open'); rpcommit();
};
$('tr-ing').onclick=()=>{ const t=tripById(trCur); if(t) openIng(tripInRange(t), t.name||'Trip', 'Ingredients for '+(t.name||'the trip')); };
// the menu: every meal, day by day, as text to read, share or copy
function tripMenuText(t){
  const inR=tripInRange(t), lines=[(t.name||'Trip')+' — '+tripRange(t)+' — '+t.people+' people'];
  for(let i=0;i<t.days;i++){
    const d=addDays(t.start,i), day=[];
    for(const [meal,name] of MEALS){
      const items=inR.filter(p=>p.date===d && p.meal===meal).sort((a,b)=>(a.at||0)-(b.at||0)).map(p=>{ const r=p.recipeId && recipeById(p.recipeId); return r ? r.title : p.text||''; }).filter(Boolean);
      if(items.length) day.push('  '+name+': '+items.join(', '));
    }
    lines.push('', 'Day '+(i+1)+' ('+tFmt(d,{ weekday:'short', month:'short', day:'numeric' })+')'); lines.push(...(day.length?day:['  (nothing planned)']));
  }
  return lines.join('\n');
}
$('tr-meals').onclick=()=>{ const t=tripById(trCur); if(!t) return; $('trmenu-text').textContent=tripMenuText(t); $('trmenu-bg').classList.add('open'); lockPage(); };
$('trmenu-close').onclick=()=>{ $('trmenu-bg').classList.remove('open'); unlockPage(); };
$('trmenu-share').onclick=async()=>{
  const text=$('trmenu-text').textContent;
  if(navigator.share){ try{ await navigator.share({ title:'Trip menu', text }); return; }catch(e){ if(e && e.name==='AbortError') return; } }
  try{ await navigator.clipboard.writeText(text); toast('Menu copied'); }catch(e){ toast('Couldn’t copy on this device'); }
};

showRView(rView);
