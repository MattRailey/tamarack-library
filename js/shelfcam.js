/* Railey Library — shelfcam.js
   The shelf camera: stays open, one tap of the shutter = one photo, no "Use Photo" step. Each photo is sent to
   photos/inbox/ in the background while the next one is taken (failed ones wait on the phone, photos.js).
   Names: "<stamp> <Room> <Bookcase> [shelf-n] <kind> NNN.jpg", NNN counting up through one bookcase (001, 002…),
   so they sort in the order taken. A new bookcase name starts a new stamp and count.
   openShelfCam({ room, bookcase, shelf, kind, build, onUpdate(cases), onFinish(cases) })
     build: show "Finished with N1 →" (next bookcase, name counted up) and "Finished adding to library";
     otherwise a single "Done". cases = [{ room, bookcase, n }] sent in this session.
   No camera (or permission refused): falls back to the photo picker (opts.fallback()).
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
  $('cam-room').value=opts.room||''; $('cam-case').value=opts.bookcase||'';
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
  camStop(); $('cam-bg').classList.remove('open'); unlockPage();
  const c=cam; cam=null;
  if(!silent && c && c.opts.onFinish) c.opts.onFinish(c.cases, !!finished);
}
function camCount(){
  if(!cam) return;
  const loc=camLoc(), here=(cam.cases.find(c=>c.room===loc.room && c.bookcase===loc.bookcase)||{}).n||0;
  $('cam-count').textContent=(here?here+' of '+(loc.bookcase||'this bookcase'):'No photos yet')+(cam.sending?' · sending '+cam.sending+'…':'')+(cam.failed?' · '+cam.failed+' waiting for signal':'');
}
function camButtons(){ if(!cam) return; const bc=$('cam-case').value.trim(); $('cam-next').textContent='Finished with '+(bc||'this bookcase')+' →'; }

/* One frame from the video at full size, shrunk to the usual shelf-photo size (photos.js PHOTO_SIZE). */
function camGrab(){
  const v=$('cam-video'); if(!v.videoWidth) return Promise.resolve(null);
  const [max, q]=PHOTO_SIZE[cam.opts.kind||'shelf']||PHOTO_SIZE.shelf;
  const k=Math.min(1, max/Math.max(v.videoWidth, v.videoHeight));
  const c=document.createElement('canvas'); c.width=Math.round(v.videoWidth*k); c.height=Math.round(v.videoHeight*k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return new Promise(res=>c.toBlob(res, 'image/jpeg', q));
}
async function camShoot(){
  if(!cam) return;
  const loc=camLoc();
  if(!loc.room || !loc.bookcase){ $('cam-msg').textContent='Type the room and bookcase at the top first.'; $(!loc.room?'cam-room':'cam-case').focus(); return; }
  $('cam-msg').textContent='';
  const blob=await camGrab(); if(!blob){ $('cam-msg').textContent='The camera isn’t ready yet. Try again in a second.'; return; }
  $('cam-flash').classList.remove('go'); void $('cam-flash').offsetWidth; $('cam-flash').classList.add('go');
  if(cam.redo && cam.last) return camRedo(blob);
  // a new bookcase (or room) starts a new name and count
  const key=loc.room+'|'+loc.bookcase;
  if(!cam.session || cam.session.key!==key) cam.session={ key, base:camBase(loc), n:0 };
  const n=++cam.session.n, path=dbxFolder()+'/photos/inbox/'+cam.session.base+' '+String(n).padStart(3,'0')+'.jpg';
  let c=cam.cases.find(x=>x.room===loc.room && x.bookcase===loc.bookcase); if(!c){ c={ room:loc.room, bookcase:loc.bookcase, n:0 }; cam.cases.push(c); }
  c.n++;
  const url=URL.createObjectURL(blob);
  $('cam-thumbs').insertAdjacentHTML('afterbegin','<div class="cam-th sending"><img src="'+url+'" alt=""></div>');
  const th=$('cam-thumbs').firstElementChild; while($('cam-thumbs').children.length>6) $('cam-thumbs').lastElementChild.remove();
  cam.sending++; camCount(); cam.opts.onUpdate && cam.opts.onUpdate(cam.cases);
  const rec={ path, th, rev:null, state:'sending' }; cam.last=rec; camRedoBtn();
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
$('cam-case').addEventListener('input', ()=>{ camButtons(); camCount(); });
$('cam-room').addEventListener('input', camCount);
$('cam-next').onclick=()=>{
  cam.redo=false; cam.last=null; camRedoBtn();
  const bc=$('cam-case').value.trim(), m=bc.match(/^(.*?)(\d+)$/);
  $('cam-case').value=m ? m[1]+(+m[2]+1) : '';
  camButtons(); camCount();
  $('cam-msg').textContent=m ? 'Now: '+$('cam-case').value+'. Change the name at the top if that’s not it.' : 'Type the next bookcase’s name at the top.';
  if(!m) $('cam-case').focus();
  cam.opts.onUpdate && cam.opts.onUpdate(cam.cases, $('cam-case').value);
};
$('cam-finish').onclick=()=>closeShelfCam(false, true);
$('cam-close').onclick=()=>closeShelfCam(false);
// volume buttons can't be read by a web page; the space bar / Enter work on a keyboard
document.addEventListener('keydown', e=>{ if(cam && $('cam-bg').classList.contains('open') && (e.key===' '||e.key==='Enter') && !e.target.closest('input')){ e.preventDefault(); camShoot(); } });
document.addEventListener('visibilitychange', ()=>{
  // the phone stops the camera when the screen locks; start it again on return
  if(!document.hidden && cam && $('cam-bg').classList.contains('open')){ const t=cam.stream && cam.stream.getVideoTracks()[0]; if(!t || t.readyState==='ended'){ camStop(); navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' }, width:{ ideal:4096 }, height:{ ideal:4096 } }, audio:false }).then(s=>{ if(!cam){ s.getTracks().forEach(t=>t.stop()); return; } cam.stream=s; $('cam-video').srcObject=s; $('cam-video').play().catch(()=>{}); }).catch(()=>{}); } }
});
