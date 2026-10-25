/* Railey Library — shelfcam.js
   The shelf camera: stays open, one tap of the shutter = one photo, no "Use Photo" step. Each photo is sent to
   photos/inbox/ in the background while the next one is taken (failed ones wait on the phone, photos.js).
   Names: "<stamp> <Room> <Bookcase> [shelf-n] <kind> NNN.jpg", NNN counting up through one bookcase (001, 002…),
   so they sort in the order taken. A new bookcase name starts a new stamp and count.
   openShelfCam({ room, bookcase, shelf, kind, build, onUpdate(cases), onFinish(cases) })
     build: show "Finished with N1 →" (next bookcase, name counted up) and "Finished adding to library";
     otherwise a single "Done". cases = [{ room, bookcase, n }] sent in this session.
   No camera (or permission refused): falls back to the photo picker (opts.fallback()).
   The bookcase being photographed shows as a heading ("Photographing: Living room · N1"); "Change" and "Finished with
   N1 →" open a small pop-up (camAsk) that asks for the room and bookcase, the next one counted up (N1 → N2).
   opts.optional (Send photos): the room and bookcase can stay empty. The camera opens straight to shooting, the heading
   says "no location yet", and the photos are named "no-room no-bookcase" for Claude to place later. Setting a place
   (Change) is still there when it is known. Setup and Recheck shelves keep asking: they need to know which bookcase.
   opts.recipe (Recipes → Photograph recipes): the heading shows "Recipe 1" (and who it's from / the cookbook);
   "Next recipe →" moves straight on to Recipe 2, so each recipe's pages share one name and count. No pop-up.
   "← Previous recipe" goes back one (a page that was missed): the photo joins that recipe's name and numbering
   (002 → 003…). "Next recipe →" from there goes to a new recipe after the last one with photos.
   Redo last: the next shot replaces the last photo under the same name (Dropbox revision, or its place in the
   waiting queue). If that can't overwrite, it goes up as "NNN redo.jpg": a redo replaces the photo with that number.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

let cam=null;   // { opts, stream, session:{ base, n }, cases, sending, sent, failed, chain }
function camSlug(s){ return String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,40); }
function camStamp(){ const d=new Date(), p=x=>String(x).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds()); }
function camLoc(){ return { room:$('cam-room').value.trim(), bookcase:$('cam-case').value.trim(), shelf:cam.opts.shelf||'', kind:cam.opts.kind||'shelf' }; }
function camBase(loc){ return [camStamp(), camSlug(loc.room)||'no-room', camSlug(loc.bookcase)||'no-bookcase', loc.shelf?'shelf-'+camSlug(loc.shelf):'', loc.kind].filter(Boolean).join(' '); }

async function openShelfCam(opts){
  if(!cloudOn()){ toast('Connect Dropbox first (Epilogue → Data & Sync) so photos can reach the folder'); return; }
  cam={ opts, stream:null, session:null, cases:[], sending:0, sent:0, failed:0, chain:Promise.resolve(), last:null, redo:false };
  $('cam-room').value=opts.room||''; $('cam-case').value=opts.bookcase||''; camWhere();
  $('cam-thumbs').innerHTML=''; $('cam-msg').textContent='';
  $('cam-next').classList.toggle('hide', !opts.build); $('cam-finish').textContent=opts.finishLabel||(opts.build?'Finished adding to library':'Done');
  camButtons(); camCount(); camRedoBtn();
  $('cam-bg').classList.add('open'); lockPage();
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return camNoCamera();
  try{
    // ask for the biggest frame the camera gives (iPhone: 4K); spine print needs the pixels
    cam.stream=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:4096 }, height:{ ideal:4096 } }, audio:false });
  }catch(e){ return camNoCamera(e); }
  if(!cam || !$('cam-bg').classList.contains('open')){ cam && cam.stream && cam.stream.getTracks().forEach(t=>t.stop()); return; }
  const v=$('cam-video'); v.srcObject=cam.stream; v.setAttribute('playsinline',''); try{ await v.play(); }catch(e){}
  camFocus(cam.stream);
  if(cam.opts.recipe) $('cam-msg').textContent='Hold the phone about a foot away and keep it still; each tap keeps the sharpest moment.';
  // no place yet: ask for it before the first photo
  if(cam && !opts.optional && (!$('cam-room').value || !$('cam-case').value)) camChange('Which bookcase are you photographing?', $('cam-case').value);
}
function camWhere(){
  if(cam && cam.opts.recipe){ $('cam-where-txt').textContent=$('cam-case').value+($('cam-room').value?' · '+$('cam-room').value:''); $('cam-change').classList.add('hide'); return; }
  $('cam-change').classList.remove('hide'); $('cam-where-txt').textContent=[$('cam-room').value, $('cam-case').value].filter(Boolean).join(' · ') || (cam && cam.opts.optional ? 'no location yet' : 'no bookcase yet'); }

/* The pop-up: room + bookcase, Start / Cancel → { room, bookcase } or null. Works over the camera or the setup wizard. */
function camAsk(title, room, bookcase){
  return new Promise(res=>{
    const opt=!!(cam && cam.opts.optional);
    $('ca-title').textContent=title; $('ca-room').value=room||''; $('ca-case').value=bookcase||''; $('ca-err').classList.add('hide');
    $('ca-none').classList.toggle('hide', !opt);
    $('cam-ask').classList.remove('hide');
    const f=(!room ? $('ca-room') : $('ca-case')); setTimeout(()=>{ f.focus(); if(f.value) f.select(); }, 50);
    const done=v=>{ $('cam-ask').classList.add('hide'); $('ca-start').onclick=$('ca-cancel').onclick=$('ca-none').onclick=null; $('ca-case').onkeydown=null; res(v); };
    $('ca-cancel').onclick=()=>done(null);
    $('ca-none').onclick=()=>done({ room:'', bookcase:'' });   // "I don't know where these go yet"
    $('ca-start').onclick=()=>{
      const r=$('ca-room').value.trim(), b=$('ca-case').value.trim();
      if(!opt && (!r || !b)){ $('ca-err').textContent='Type the room and the bookcase name.'; $('ca-err').classList.remove('hide'); return; }
      done({ room:r, bookcase:b });
    };
    $('ca-case').onkeydown=e=>{ if(e.key==='Enter') $('ca-start').onclick(); };
  });
}
// N1 → N2, D9 → D10; a name without a number gives '' (typed fresh)
function nextCaseName(bc){ const m=String(bc||'').match(/^(.*?)(\d+)$/); return m ? m[1]+(+m[2]+1) : ''; }
// set the place: a new bookcase starts its own photo names and count; redo applies to this bookcase only
function camSetPlace(p){
  $('cam-room').value=p.room; $('cam-case').value=p.bookcase; camWhere();
  cam.redo=false; cam.last=null; camRedoBtn(); camButtons(); camCount();
  cam.opts.onUpdate && cam.opts.onUpdate(cam.cases, p.bookcase);
}
async function camChange(title, suggest){
  if(!cam) return;
  const p=await camAsk(title, $('cam-room').value, suggest);
  if(p && cam){ camSetPlace(p); $('cam-msg').textContent=p.bookcase ? 'Now photographing '+p.bookcase+'.' : 'No location: Claude will place these later.'; }
}
// keep refocusing on its own (Chrome/Android honour this; Safari picks its own focus and ignores it)
function camFocus(stream){
  try{ const t=stream && stream.getVideoTracks()[0], caps=t && t.getCapabilities ? t.getCapabilities() : {};
    if(caps.focusMode && caps.focusMode.includes('continuous')) t.applyConstraints({ advanced:[{ focusMode:'continuous' }] }).catch(()=>{}); }catch(e){}
}
function camNoCamera(e){
  const why=e && e.name==='NotAllowedError' ? 'Camera permission was turned down.' : 'This browser can’t open the camera here.';
  const o=cam.opts; closeShelfCam(true);
  toast(why+' Choose the photos instead.');
  if(o.fallback) o.fallback();
}
function camStop(){ if(cam && cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream=null; } const v=$('cam-video'); if(v) v.srcObject=null; }
// finished: "Finished adding to library" / "Done"; otherwise just closed (×)
function closeShelfCam(silent, finished){
  // remember where the camera got to (after "Finished with N3 →" that's N4), for Send photos next time
  if(cam && cam.opts.kind!=='recheck' && !cam.opts.recipe){ ui.phLoc=Object.assign({}, ui.phLoc, { room:$('cam-room').value.trim(), bookcase:$('cam-case').value.trim() }); lsSet(UI_KEY, JSON.stringify(ui)); }
  camStop(); $('cam-bg').classList.remove('open'); unlockPage();
  const c=cam; cam=null;
  if(!silent && c && c.opts.onFinish) c.opts.onFinish(c.cases, !!finished);
}
function camCount(){
  if(!cam) return;
  const loc=camLoc(), here=(cam.cases.find(c=>c.room===loc.room && c.bookcase===loc.bookcase)||{}).n||0;
  if(cam.opts.recipe){ $('cam-count').textContent=(here?here+' page'+(here===1?'':'s')+' of '+loc.bookcase:'No photos yet')+(cam.sending?' · sending '+cam.sending+'…':'')+(cam.failed?' · '+cam.failed+' waiting for signal':''); return; }
  $('cam-count').textContent=(here?here+' of '+(loc.bookcase||(cam.opts.optional?'these (no location yet)':'this bookcase')):'No photos yet')+(cam.sending?' · sending '+cam.sending+'…':'')+(cam.failed?' · '+cam.failed+' waiting for signal':'');
}
function camButtons(){ if(!cam) return; const bc=$('cam-case').value.trim();
  $('cam-prevrec').classList.toggle('hide', !cam.opts.recipe || recipeNum(bc)<=1); $('cam-next').textContent=cam.opts.recipe ? 'Next recipe →' : 'Finished with '+(bc||'this bookcase')+' →';
  $('cam-next').classList.toggle('hide', !cam.opts.build || (!!cam.opts.optional && !bc)); }   // no bookcase named: nothing to finish with

/* One frame from the video at full size, shrunk to the usual shelf-photo size (photos.js PHOTO_SIZE). */
/* The sharpest of a few frames. Up close the phone refocuses, and an iPhone switches lenses by itself (the blur that
   "snaps back"), so one frame grabbed at the tap can catch it mid-blur. Each tap watches for ~¼ s (taps in a row queue up), scores each frame
   (frameSharpness: how strong the edges are in the middle of the picture) and keeps the best. → { blob, score } */
const SHARP_FRAMES=4, SHARP_GAP=80;
function frameSharpness(src, w, h){
  // the middle 60% of the frame, shrunk to 240 px wide, in grey; then the average squared Laplacian (edge strength)
  const W=240, H=Math.max(3, Math.round(W*h/w)), c=frameSharpness.c||(frameSharpness.c=document.createElement('canvas'));
  c.width=W; c.height=H; const x=c.getContext('2d', { willReadFrequently:true });
  x.drawImage(src, w*0.2, h*0.2, w*0.6, h*0.6, 0, 0, W, H);
  const d=x.getImageData(0, 0, W, H).data, g=new Float32Array(W*H);
  for(let i=0;i<W*H;i++) g[i]=0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
  let s=0, n=0;
  for(let y=1;y<H-1;y++) for(let xx=1;xx<W-1;xx++){ const i=y*W+xx, l=4*g[i]-g[i-1]-g[i+1]-g[i-W]-g[i+W]; s+=l*l; n++; }
  return n ? s/n : 0;
}
async function camGrab(){
  const v=$('cam-video'); if(!v.videoWidth) return null;
  const [max, q]=PHOTO_SIZE[cam.opts.kind||'shelf']||PHOTO_SIZE.shelf;
  const k=Math.min(1, max/Math.max(v.videoWidth, v.videoHeight));
  const W=Math.round(v.videoWidth*k), H=Math.round(v.videoHeight*k);
  let best=null, bestScore=-1, spare=null;
  for(let i=0;i<SHARP_FRAMES;i++){
    if(i) await new Promise(r=>setTimeout(r, SHARP_GAP));
    if(!v.videoWidth) break;
    const c=spare||document.createElement('canvas'); c.width=W; c.height=H;
    c.getContext('2d').drawImage(v, 0, 0, W, H);
    let sc=0; try{ sc=frameSharpness(c, W, H); }catch(e){ sc=0; }
    if(sc>bestScore){ spare=best; best=c; bestScore=sc; } else spare=c;
  }
  if(!best) return null;
  const blob=await new Promise(res=>best.toBlob(res, 'image/jpeg', q));
  return blob ? { blob, score:bestScore } : null;
}
// A shot much softer than this camera's usual is called out (after a few shots, so there's a usual to compare with).
function camBlurry(score){
  const L=(cam.scores=cam.scores||[]);
  const sorted=L.slice().sort((a,b)=>a-b), med=sorted.length ? sorted[Math.floor(sorted.length/2)] : 0;
  const blurry=L.length>=2 && med>0 && score<med*0.4;
  if(!blurry) { L.push(score); if(L.length>12) L.shift(); }
  return blurry;
}
// taps queue up: each one is taken in turn, none is lost while the one before it is still choosing its frame
function camShoot(){
  if(!cam) return;
  $('cam-flash').classList.remove('go'); void $('cam-flash').offsetWidth; $('cam-flash').classList.add('go');
  const me=cam; me.shots=(me.shots||Promise.resolve()).then(()=>cam===me && camShootNow()).catch(()=>{});
  return me.shots;
}
async function camShootNow(pre){
  if(!cam) return;
  const loc=camLoc();
  if(!cam.opts.optional && (!loc.room || !loc.bookcase)){ camChange('Which bookcase are you photographing?', loc.bookcase); return; }
  $('cam-msg').textContent=''; $('cam-shutter').classList.add('busy');
  let got=null; try{ got=pre||await camGrab(); }finally{ $('cam-shutter').classList.remove('busy'); }
  if(!cam) return;
  if(!got){ $('cam-msg').textContent='The camera isn’t ready yet. Try again in a second.'; return; }
  const blob=got.blob, blurry=got.score==null ? false : camBlurry(got.score);
  if(cam.redo && cam.last) return camRedo(blob);
  // a new bookcase (or room) starts a new name and count
  const key=loc.room+'|'+loc.bookcase;
  // each place keeps its own name and count, so going back to Recipe 1 (or N1) carries on 003, 004…
  cam.sessions=cam.sessions||{};
  if(!cam.sessions[key]) cam.sessions[key]={ key, base:camBase(loc), n:0 };
  cam.session=cam.sessions[key];
  const n=++cam.session.n, path=dbxFolder()+'/photos/inbox/'+cam.session.base+' '+String(n).padStart(3,'0')+'.jpg';
  let c=cam.cases.find(x=>x.room===loc.room && x.bookcase===loc.bookcase); if(!c){ c={ room:loc.room, bookcase:loc.bookcase, n:0 }; cam.cases.push(c); }
  c.n++; logSent(loc, 1);
  const url=URL.createObjectURL(blob);
  $('cam-thumbs').insertAdjacentHTML('afterbegin','<div class="cam-th sending"><img src="'+url+'" alt=""></div>');
  const th=$('cam-thumbs').firstElementChild; while($('cam-thumbs').children.length>6) $('cam-thumbs').lastElementChild.remove();
  cam.sending++; camCount(); cam.opts.onUpdate && cam.opts.onUpdate(cam.cases);
  const rec={ path, th, rev:null, state:'sending' }; cam.last=rec; camRedoBtn();
  if(blurry){ th.classList.add('blurry'); $('cam-msg').textContent='That one looks blurry. Tap ↺ Redo last to take it again.'; }
  // one at a time, in order, while the next photo is being taken
  const me=cam;
  me.chain=me.chain.then(async()=>{
    let r=null; try{ r=await cloudPut(path, blob, { autorename:true }); }catch(e){}
    const ok=!!(r && r.ok);
    if(ok){ rec.path=r.path||path; rec.rev=r.rev; rec.state='sent'; } else { await queuePhoto(path, blob); rec.state='waiting'; }
    me.sending--; if(ok) me.sent++; else me.failed++;
    th.classList.remove('sending'); th.classList.add(ok?'sent':'waiting');
    if(cam===me) camCount();
    renderRetry();
  });
}
// The retake replaces the last photo: same name, so the order stays right and nothing is there twice.
function camRedo(blob){
  const rec=cam.last, me=cam; cam.redo=false; camRedoBtn();
  const img=rec.th.querySelector('img'); if(img) img.src=URL.createObjectURL(blob);
  rec.th.className='cam-th sending'; me.sending++; camCount();
  $('cam-msg').textContent='Replaced the last photo.';
  me.chain=me.chain.then(async()=>{
    let ok=false;
    if(rec.state==='waiting'){ await queuePhoto(rec.path, blob); }
    else {
      let r=null; try{ r=await cloudPut(rec.path, blob, { rev:rec.rev }); }catch(e){}
      if(r && r.ok){ rec.rev=r.rev; ok=true; }
      else { const p2=rec.path.replace(/\.jpg$/, ' redo.jpg'); rec.path=p2; rec.rev=null;
        try{ r=await cloudPut(p2, blob, { autorename:true }); }catch(e){ r=null; }
        if(r && r.ok){ rec.path=r.path||p2; rec.rev=r.rev; ok=true; } else { await queuePhoto(p2, blob); rec.state='waiting'; } }
    }
    me.sending--;
    rec.th.classList.remove('sending'); rec.th.classList.add(ok?'sent':'waiting');
    if(cam===me) camCount();
    renderRetry();
  });
}
function camRedoBtn(){
  const b=$('cam-redo'); if(!b || !cam) return;
  b.disabled=!cam.last; b.classList.toggle('on', !!cam.redo);
  b.textContent=cam.redo ? 'Cancel redo' : '↺ Redo last';
}
$('cam-redo').onclick=()=>{
  if(!cam || !cam.last) return;
  cam.redo=!cam.redo; camRedoBtn();
  $('cam-msg').textContent=cam.redo ? 'Take it again: the next photo replaces the last one.' : '';
};
$('cam-shutter').onclick=camShoot;
// The phone's own Camera app, for a page the web camera keeps losing focus on: it can switch to the close-up lens and
// tap-to-focus. Each photo it gives back goes through the same naming, thumbnails and sending as a tap on the shutter.
$('cam-native').onclick=()=>{ if(cam) $('cam-native-file').click(); };
$('cam-native-file').onchange=e=>{
  const files=[...e.target.files]; e.target.value=''; const me=cam; if(!me || !files.length) return;
  const [max, q]=PHOTO_SIZE[me.opts.kind||'shelf']||PHOTO_SIZE.shelf;
  files.forEach(f=>{ me.shots=(me.shots||Promise.resolve()).then(async()=>{
    if(cam!==me) return; let blob=null; try{ blob=await shrinkPhoto(f, max, q); }catch(err){}
    if(!blob){ $('cam-msg').textContent='That photo couldn’t be read. Try again.'; return; }
    return camShootNow({ blob, score:null }); }).catch(()=>{}); });
};
function recipeNum(s){ const m=String(s||'').match(/(\d+)$/); return m ? +m[1] : 1; }
$('cam-next').onclick=()=>{
  if(cam && cam.opts.recipe){
    // after going back for a missed page, Next goes on past the last recipe that has photos
    const cur=recipeNum($('cam-case').value), last=Math.max(0, ...cam.cases.filter(c=>c.n>0).map(c=>recipeNum(c.bookcase)));
    camSetPlace({ room:$('cam-room').value, bookcase:'Recipe '+(Math.max(cur, last)+1) });
    $('cam-msg').textContent='Now '+$('cam-case').value+'. Photograph each page of it.'; return; }
  camChange('Name of the next bookcase', nextCaseName($('cam-case').value.trim()));
};
$('cam-prevrec').onclick=()=>{
  if(!cam || !cam.opts.recipe) return;
  const n=recipeNum($('cam-case').value); if(n<=1) return;
  camSetPlace({ room:$('cam-room').value, bookcase:'Recipe '+(n-1) });
  const had=(cam.cases.find(c=>c.bookcase==='Recipe '+(n-1))||{}).n||0;
  $('cam-msg').textContent='Back to Recipe '+(n-1)+(had?' ('+had+' page'+(had===1?'':'s')+' so far)':'')+'. Photograph the page you missed; it joins that recipe.';
};
$('cam-change').onclick=()=>camChange('Change room or bookcase', $('cam-case').value);
$('cam-finish').onclick=()=>closeShelfCam(false, true);
$('cam-close').onclick=()=>closeShelfCam(false);
// volume buttons can't be read by a web page; the space bar / Enter work on a keyboard
document.addEventListener('keydown', e=>{ if(cam && $('cam-bg').classList.contains('open') && (e.key===' '||e.key==='Enter') && !e.target.closest('input')){ e.preventDefault(); camShoot(); } });
document.addEventListener('visibilitychange', ()=>{
  // the phone stops the camera when the screen locks; start it again on return
  if(!document.hidden && cam && $('cam-bg').classList.contains('open')){ const t=cam.stream && cam.stream.getVideoTracks()[0]; if(!t || t.readyState==='ended'){ camStop(); navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:4096 }, height:{ ideal:4096 } }, audio:false }).then(s=>{ if(!cam){ s.getTracks().forEach(t=>t.stop()); return; } cam.stream=s; $('cam-video').srcObject=s; $('cam-video').play().catch(()=>{}); }).catch(()=>{}); } }
});
