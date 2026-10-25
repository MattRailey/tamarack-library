/* Railey Library — cooking.js
   Kitchen timers and the cooking view.
   Timers: any step that mentions a time ("bake 25 minutes", "simmer 20–25 min", "1 hour 15 minutes") gets a ⏱ button.
   Several can run at once; each is labeled with its recipe and step and lives in a dock at the bottom of the screen,
   on every tab. A timer keeps its end time (not a countdown), so one that finished while the phone was locked or the
   app was in the background shows as done the moment you're back. Done = sound, vibration (where the phone allows),
   and the timer flashes until you tap OK. Timers survive a reload (kept on this phone).
   Cooking view: big text, one step at a time, ingredients as a checklist, servings scaled, and the screen kept on
   (Screen Wake Lock, where the browser has it).
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ---------------- finding times in a step ---------------- */
const TM_WORDS={ a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12,
  fifteen:15, twenty:20, thirty:30, forty:40, 'forty-five':45, fortyfive:45, sixty:60, ninety:90 };
const TM_NUM='((?:\\d+|one|two|three|four|five|six) and a half|half(?:\\s+an?)?|\\d+[\\s-]+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?(?:\\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔]|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty(?:-five)?|sixty|ninety)';
const TM_UNIT='(hours?|hrs?\\.?|minutes?|mins?\\.?|seconds?|secs?\\.?)';
const TM_RE=new RegExp('(?<![\\w/½¼¾⅓⅔])'+TM_NUM+'(?:\\s*(?:-|–|—|to|or)\\s*'+TM_NUM+')?\\s*(?:more\\s+)?'+TM_UNIT+'(?![a-z])', 'gi');
function tmNum(s){
  s=String(s||'').toLowerCase().trim().replace(/\s+/g,' ');
  if(TM_WORDS[s]!=null) return TM_WORDS[s];
  let m0;
  if((m0=s.match(/^(.+) and a half$/))) return tmNum(m0[1])+0.5;
  if(/^half( an?)?$/.test(s)) return 0.5;
  if((m0=s.match(/^(\d+)[\s-]+(\d+)\/(\d+)$/))) return +m0[1]+(+m0[3]?(+m0[2])/(+m0[3]):NaN);
  if((m0=s.match(/^(\d+)\/(\d+)$/))) return +m0[2]?(+m0[1])/(+m0[2]):NaN;
  const m=s.match(/^(\d+(?:[.,]\d+)?)?\s*([½¼¾⅓⅔])?$/); if(!m) return NaN;
  return (m[1]?parseFloat(m[1].replace(',','.')):0) + (m[2]?{ '½':.5,'¼':.25,'¾':.75,'⅓':1/3,'⅔':2/3 }[m[2]]:0);
}
function tmUnitSecs(u){ u=u.toLowerCase(); return u[0]==='h' ? 3600 : u.startsWith('m') ? 60 : 1; }
function tmFmtLen(s){ const h=Math.floor(s/3600), m=Math.round((s%3600)/60); if(s<60) return s+' sec'; return (h?h+' hr'+(m?' ':''):'')+(m?m+' min':''); }
// → [{ secs, hi, label }]; "1 hour 15 minutes" is one timer, "20–25 minutes" starts at 20 (with +5 on the timer)
function findTimes(text){
  const out=[]; let m; TM_RE.lastIndex=0;
  const t=String(text||'');
  while((m=TM_RE.exec(t))){
    const a=tmNum(m[1]), b=m[2]!=null ? tmNum(m[2]) : NaN, u=tmUnitSecs(m[3]);
    if(!isFinite(a) || a<=0) continue;
    if(/^(an?|half( an?)?)$/i.test(m[1]) && u!==3600) continue;   // "a few minutes" / "half a minute" aren't timers; "an hour", "half an hour" are          // "a minute" stays a timer only as "an hour"; "a few minutes" isn't a time
    let secs=Math.round(a*u), hi=isFinite(b) && b>a ? Math.round(b*u) : 0;
    const prev=out[out.length-1];
    // "1 hour 15 minutes" / "1 hr and 30 min": join onto the hour just before
    if(prev && !prev.hi && !hi && prev.end!=null && /^\s*(?:and\s+)?$/i.test(t.slice(prev.end, m.index)) && prev.unit>u){ prev.secs+=secs; prev.end=m.index+m[0].length; prev.unit=u; continue; }
    if(secs>24*3600) continue;
    out.push({ secs, hi, unit:u, end:m.index+m[0].length });
  }
  return out.map(x=>({ secs:x.secs, hi:x.hi, label:x.hi ? tmRange(x.secs, x.hi) : tmFmtLen(x.secs) }));
}
// "20–25 min" when both ends are in one unit; else both in full ("1 hr 30 min–2 hr")
function tmRange(a, b){ const A=tmFmtLen(a), B=tmFmtLen(b), m=A.match(/^(\d+) (min|hr|sec)$/), n=B.match(/^\d+ (min|hr|sec)$/);
  return m && n && m[2]===n[1] ? m[1]+'–'+B : A+'–'+B;
}
function timerButtons(step, title, n){
  const T=findTimes(step); if(!T.length) return '';
  return '<span class="tm-btns">'+T.map(t=>'<button type="button" class="tm-btn" data-tsecs="'+t.secs+'" data-thi="'+(t.hi||0)+'" data-tlabel="'+esc((title||'Timer')+' · step '+n)+'">⏱ '+esc(t.label)+'</button>').join('')+'</span>';
}

/* ---------------- running timers ---------------- */
const TM_KEY='tamarack_library_timers';
let timers=[]; try{ timers=JSON.parse(lsGet(TM_KEY)||'[]').filter(t=>t && t.id); }catch(e){ timers=[]; }
let _tmTick=null, _tmAudio=null, _tmRing=null;
function tmSave(){ lsSet(TM_KEY, JSON.stringify(timers)); }
function tmLeft(t){ return t.paused!=null ? t.paused : Math.max(0, t.end-Date.now()); }
function tmClock(ms){ const s=Math.ceil(ms/1000), h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0'); }
function tmAudioCtx(){
  try{ if(!_tmAudio) _tmAudio=new (window.AudioContext||window.webkitAudioContext)(); if(_tmAudio.state==='suspended') _tmAudio.resume(); }catch(e){ _tmAudio=null; }
  return _tmAudio;
}
function tmBeep(){
  const ctx=tmAudioCtx(); if(!ctx) return;
  try{ for(let i=0;i<3;i++){ const o=ctx.createOscillator(), g=ctx.createGain(), t0=ctx.currentTime+i*0.28;
    o.type='sine'; o.frequency.value=880; g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(0.4,t0+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t0+0.22);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0+0.24); } }catch(e){}
  try{ navigator.vibrate && navigator.vibrate([300,120,300]); }catch(e){}
}
function startTimer(secs, label, hi){
  tmAudioCtx();   // unlock sound now, while there's a tap to allow it
  timers.push({ id:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,5), label:label||'Timer', len:secs*1000, end:Date.now()+secs*1000, extra:hi?Math.max(0,(hi-secs)):0 });
  tmSave(); renderTimers(); toast('Timer started: '+tmFmtLen(secs));
}
function renderTimers(){
  const dock=$('tm-dock'); if(!dock) return;
  dock.classList.toggle('hide', !timers.length);
  document.body.classList.toggle('has-timers', !!timers.length);
  requestAnimationFrame(()=>document.documentElement.style.setProperty('--tm-h', (timers.length?dock.offsetHeight+8:0)+'px'));
  let ringing=false;
  dock.innerHTML=timers.map(t=>{
    const left=tmLeft(t), done=t.paused==null && left<=0; if(done && !t.ack) ringing=true;
    return '<div class="tm'+(done?' done':'')+(t.paused!=null?' paused':'')+'" data-tid="'+t.id+'"><span class="tm-lbl">'+esc(t.label)+'</span>'
      +'<b class="tm-clock">'+(done?'Done!':tmClock(left))+'</b>'
      +(done ? '<button class="tm-ok" data-tact="ok">OK</button>'
        : '<button class="secondary" data-tact="add" title="One more minute">+1</button>'+(t.extra?'<button class="secondary" data-tact="more" title="Add the rest of the range">+'+Math.round(t.extra/60)+'</button>':'')
          +'<button class="secondary" data-tact="pause">'+(t.paused!=null?'▶':'❚❚')+'</button><button class="secondary" data-tact="x" aria-label="Cancel timer">✕</button>')
      +'</div>';
  }).join('');
  if(ringing && !_tmRing){ tmBeep(); _tmRing=setInterval(()=>{ if(timers.some(t=>t.paused==null && tmLeft(t)<=0 && !t.ack)) tmBeep(); else { clearInterval(_tmRing); _tmRing=null; } }, 2500); }
  if(timers.some(t=>t.paused==null && tmLeft(t)>0)){ if(!_tmTick) _tmTick=setInterval(renderTimers, 500); }
  else if(_tmTick){ clearInterval(_tmTick); _tmTick=null; }
}
document.addEventListener('click', e=>{
  const b=e.target.closest('[data-tsecs]');
  if(b){ e.preventDefault(); e.stopPropagation(); startTimer(+b.dataset.tsecs, b.dataset.tlabel, +b.dataset.thi||0); return; }
  const a=e.target.closest('[data-tact]'); if(!a) return;
  const t=timers.find(x=>x.id===a.closest('[data-tid]').dataset.tid); if(!t) return;
  const act=a.dataset.tact;
  if(act==='ok' || act==='x') timers=timers.filter(x=>x!==t);
  if(act==='add'){ if(t.paused!=null) t.paused+=60000; else t.end=Math.max(t.end, Date.now())+60000; }
  if(act==='more'){ if(t.paused!=null) t.paused+=t.extra*1000; else t.end+=t.extra*1000; t.extra=0; }
  if(act==='pause'){ if(t.paused!=null){ t.end=Date.now()+t.paused; t.paused=null; } else t.paused=Math.max(0,t.end-Date.now()); }
  tmSave(); renderTimers();
}, true);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) renderTimers(); });

/* ---------------- the cooking view ---------------- */
let ck=null, _wake=null;
async function ckWake(on){
  try{
    if(on && 'wakeLock' in navigator && document.visibilityState==='visible'){ if(!_wake) _wake=await navigator.wakeLock.request('screen'); _wake.addEventListener && _wake.addEventListener('release', ()=>{ _wake=null; }); }
    if(!on && _wake){ await _wake.release(); _wake=null; }
  }catch(e){ _wake=null; }
  const n=$('ck-awake'); if(n) n.textContent = ('wakeLock' in navigator) ? (on && _wake ? 'The screen stays on while you cook.' : '') : 'This phone may dim the screen; tap it now and then.';
}
document.addEventListener('visibilitychange', ()=>{ if(ck && document.visibilityState==='visible') ckWake(true); });
function openCooking(r, scale){
  const steps=[]; let sec='';
  for(const s of (r.steps||[])){ const x=String(s||'').trim(); if(!x) continue; if(/^##\s/.test(x)){ sec=x.replace(/^##\s*/,''); continue; } steps.push({ text:x, sec }); }
  ck={ id:r.id, title:r.title, scale:scale||1, steps, i:0, tab:steps.length?'steps':'ing', ticked:new Set() };
  $('ck-title').textContent=r.title||'Cooking';
  $('ck-bg').classList.add('open'); lockPage(); drawCooking(); ckWake(true);
}
function closeCooking(){ $('ck-bg').classList.remove('open'); ck=null; ckWake(false); if(!$('rc-bg').classList.contains('open')) unlockPage(); }
function drawCooking(){
  if(!ck) return; const r=recipeById(ck.id); if(!r) return closeCooking();
  document.querySelectorAll('#ck-tabs button').forEach(b=>b.classList.toggle('active', b.dataset.ck===ck.tab));
  document.querySelectorAll('#ck-scale button').forEach(b=>b.classList.toggle('active', +b.dataset.k===ck.scale));
  $('ck-bg').classList.toggle('ck-ing', ck.tab==='ing');
  let n=0;
  $('ck-ing').innerHTML=(r.ingredients||[]).map(s=>{ s=String(s||'').trim(); if(!s) return '';
    if(/^##\s/.test(s)) return '<h4 class="rc-sec">'+esc(s.replace(/^##\s*/,''))+'</h4>';
    const k=n++; return '<label class="ck-li'+(ck.ticked.has(k)?' done':'')+'"><input type="checkbox" data-ck-i="'+k+'"'+(ck.ticked.has(k)?' checked':'')+'><span>'+esc(scaleLine(s, ck.scale))+'</span></label>'; }).join('')
    || '<p class="note">No ingredients listed.</p>';
  const st=ck.steps[ck.i];
  $('ck-step').innerHTML=st ? (st.sec?'<div class="ck-sec">'+esc(st.sec)+'</div>':'')+'<div class="ck-count">Step '+(ck.i+1)+' of '+ck.steps.length+'</div>'
      +'<p class="ck-text">'+esc(st.text)+'</p>'+timerButtons(st.text, ck.title, ck.i+1)
    : '<p class="note">No steps listed.</p>';
  $('ck-prev').disabled=ck.i<=0; $('ck-next').disabled=ck.i>=ck.steps.length-1;
}
$('ck-close').onclick=closeCooking;
document.querySelectorAll('#ck-tabs button').forEach(b=>b.onclick=()=>{ if(ck){ ck.tab=b.dataset.ck; drawCooking(); } });
document.querySelectorAll('#ck-scale button').forEach(b=>b.onclick=()=>{ if(ck){ ck.scale=+b.dataset.k; drawCooking(); } });
$('ck-prev').onclick=()=>{ if(ck && ck.i>0){ ck.i--; drawCooking(); } };
$('ck-next').onclick=()=>{ if(ck && ck.i<ck.steps.length-1){ ck.i++; drawCooking(); } };
$('ck-ing').onchange=e=>{ const c=e.target.closest('[data-ck-i]'); if(!c||!ck) return; const k=+c.dataset.ckI; if(c.checked) ck.ticked.add(k); else ck.ticked.delete(k); drawCooking(); };
document.addEventListener('keydown', e=>{ if(!ck || !$('ck-bg').classList.contains('open') || e.target.closest('input,textarea')) return;
  if(e.key==='ArrowRight'||e.key===' '){ e.preventDefault(); $('ck-next').onclick(); } if(e.key==='ArrowLeft'){ e.preventDefault(); $('ck-prev').onclick(); } if(e.key==='Escape') closeCooking(); });
// swipe left / right between steps
(()=>{ let x0=null; const el=$('ck-step');
  el.addEventListener('touchstart', e=>{ x0=e.touches[0].clientX; }, { passive:true });
  el.addEventListener('touchend', e=>{ if(x0==null) return; const dx=e.changedTouches[0].clientX-x0; x0=null; if(Math.abs(dx)>60) (dx<0?$('ck-next'):$('ck-prev')).onclick(); }, { passive:true });
})();
