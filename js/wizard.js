/* Railey Library — wizard.js
   First-run setup: shows by itself on a device with no library yet, or when an invite link is opened.
   Three ways in:
     • Invite code (friends): the library lives in Matt's Dropbox behind the friends service (worker/).
     • Own Dropbox: the library lives in this person's Dropbox, signed in on this device.
     • Just this device: nothing is synced (can be set up later).
   Then straight into photographing the shelves (build-library mode), how the walk-through finds the books Claude
   couldn't read, and how to put the app on the home screen.
   Can be run again from Data & Sync. "Add another phone" (friends) also lives here.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

const WZ_KEY = 'tamarack_library_wizard';               // per device, survives the reloads in the middle: { step, folder, title, mode }
const WZ_DONE_KEY = 'tamarack_library_wizard_done'+LIB_NS;
let wz = { step:'welcome' };

function wzState(){ try{ const s=JSON.parse(lsGet(WZ_KEY)||'null'); return s && s.folder===dbxFolder() ? s : null; }catch(e){ return null; } }
function wzSave(o){ wz=Object.assign({}, wz, o); lsSet(WZ_KEY, JSON.stringify(Object.assign({}, wz, { folder:wz.folder||dbxFolder() }))); }
function wzClear(){ try{ localStorage.removeItem(WZ_KEY); }catch(e){} }

function wizardBoot(){
  if(window.__join) return openWizard('code', { code:window.__join.code });
  const st=wzState(); if(st) return openWizard(st.step, st);
  if(window.__libSetup) return;   // a set-up link already chose the library; the Data & Sync page takes it from there
  if(!cloudOn() && !allBooks().length && !lsGet(WZ_DONE_KEY)) openWizard('welcome');
}
function openWizard(step, extra){
  wz=Object.assign({ step:'welcome' }, extra||{}, { step });
  $('wz-bg').classList.add('open'); lockPage();
  wzDraw();
}
function closeWizard(done){
  if(done){ lsSet(WZ_DONE_KEY, '1'); wzClear(); }
  $('wz-bg').classList.remove('open'); unlockPage();
}
$('wz-close').onclick=()=>closeWizard(true);   // closing it is fine: it won't keep coming back, and Data & Sync can run it again
$('btn-wizard').onclick=()=>openWizard('welcome');

const WZ_ORDER=['welcome','connect','photos','unread','home'];
function wzStepOf(s){ return { welcome:0, code:1, own:1, 'own-connect':1, joined:1, photos:2, unread:3, home:4 }[s] ?? 0; }
function wzDraw(){
  const n=wzStepOf(wz.step);
  $('wz-dots').innerHTML=WZ_ORDER.map((_,i)=>'<i class="'+(i<n?'done':i===n?'on':'')+'"></i>').join('');
  const body=$('wz-body'), f=WZ_STEPS[wz.step]||WZ_STEPS.welcome;
  body.innerHTML=f.html();
  f.wire && f.wire(body);
  const first=body.querySelector('input:not([type=hidden])'); if(first && !first.value) setTimeout(()=>first.focus(), 50);
}
function wzGo(step){ wz.step=step; if(['photos','unread','home','own-connect'].includes(step)) wzSave({ step }); wzDraw(); }
function wzDevice(){
  const u=navigator.userAgent;
  return /iPhone/.test(u)?'iPhone':/iPad/.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1)?'iPad':/Android/.test(u)?'Android phone':'Computer';
}
function wzErr(msg){ const e=$('wz-err'); if(e){ e.textContent=msg; e.classList.toggle('hide', !msg); } }
function libFolderFor(name){ const n=String(name||'').replace(/[\\/\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,60); return n ? '/'+n : ''; }
function nsFor(folder){ return folder==='/Railey Library' ? '' : '@'+folder; }

const WZ_STEPS={
  welcome:{
    html:()=>'<h3>Welcome to your library</h3>'
      +'<p class="wz-lead">Let’s set it up. It takes about two minutes, and you only do it once on this phone.</p>'
      +(friendServer() ? '<button class="wz-opt" data-go="code"><b>I have an invite code</b><span>From Matt, or from someone in your household who already uses the app.</span></button>' : '')
      +'<button class="wz-opt" data-go="own"><b>Use my own Dropbox</b><span>The library lives in a folder in your Dropbox.</span></button>'
      +'<button class="wz-opt quiet" data-go="local"><b>Just try it on this device</b><span>Nothing is synced. You can set up syncing later.</span></button>',
    wire:b=>b.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>{
      if(x.dataset.go==='local'){ closeWizard(true); toast('Saved on this device only — run setup again any time from Data & Sync'); return; }
      wzGo(x.dataset.go); }),
  },
  code:{
    html:()=>'<h3>Enter your invite code</h3>'
      +'<p class="wz-lead">It looks like <b>ABCD-EFGH</b>. If you tapped an invite link, it’s already filled in.</p>'
      +'<label for="wz-code">Invite code</label><input id="wz-code" autocomplete="off" autocapitalize="characters" spellcheck="false" value="'+esc(wz.code||'')+'">'
      +'<p class="wz-err hide" id="wz-err"></p>'
      +'<div class="row wz-nav"><button class="secondary" data-back>Back</button><button id="wz-join">Join the library</button></div>',
    wire:b=>{
      b.querySelector('[data-back]').onclick=()=>wzGo('welcome');
      const go=async()=>{
        const code=$('wz-code').value.trim(); if(!code){ wzErr('Type the code first.'); return; }
        const btn=$('wz-join'); btn.disabled=true; btn.textContent='Joining…'; wzErr('');
        try{
          const r=await fetch(friendServer().replace(/\/+$/,'')+'/join', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ code, device:wzDevice() }) });
          const j=await r.json().catch(()=>({}));
          if(!r.ok || !j.token) throw new Error(j.error || 'That code didn’t work. Check it, or ask for a new one.');
          const folder='/'+j.lib, ns=nsFor(folder);
          lsSet(FOLDER_KEY, folder);
          lsSet('tamarack_library_friend'+ns, JSON.stringify({ server:friendServer(), token:j.token, lib:j.lib, device:j.device }));
          let k=[]; try{ k=JSON.parse(lsGet(KNOWN_KEY)||'[]'); }catch(e){} if(!k.includes(folder)) k.push(folder); lsSet(KNOWN_KEY, JSON.stringify(k));
          lsSet(WZ_KEY, JSON.stringify({ step:'joined', folder, title:j.title, mode:'friend' }));
          location.replace(location.pathname);   // reopen as that library
        }catch(e){
          btn.disabled=false; btn.textContent='Join the library';
          wzErr(navigator.onLine===false ? 'No internet connection right now. Try again when you have a signal.'
            : e instanceof TypeError ? 'Couldn’t reach the library service. Check your connection and try again.' : e.message);
        }
      };
      $('wz-join').onclick=go; $('wz-code').onkeydown=e=>{ if(e.key==='Enter') go(); };
    },
  },
  joined:{
    html:()=>'<h3>Opening '+esc(wz.title||'your library')+'…</h3><p class="wz-lead" id="wz-wait">Getting your books.</p>',
    wire:async()=>{
      await wzWaitForSync();
      const lib=(store.settings||{}).library||{};
      if(!lib.title && wz.title){ store.settings=Object.assign({}, store.settings, { library:{ title:wz.title, tag:'Our books at home' }, updatedAt:Date.now() }); commit(); }
      const n=allBooks().length;
      wz.joinedNote = n ? 'You’re in. '+libCfg().title+' has '+n.toLocaleString()+' book'+(n===1?'':'s')+', and anything you change shows up on the other phones too.'
                        : 'You’re in. Your library is ready — let’s fill it.';
      wzGo('photos');
    },
  },
  own:{
    html:()=>'<h3>Use your own Dropbox</h3>'
      +'<p class="wz-lead">Name your library. It becomes a folder in your Dropbox.</p>'
      +'<label for="wz-name">Library name</label><input id="wz-name" placeholder="e.g. Smith Library" value="'+esc(wz.title||(LIB_NS?libCfg().title:''))+'">'
      +(DEFAULT_DBX_APP_KEY ? '' : '<label for="wz-key" style="margin-top:12px;">Dropbox app key</label><input id="wz-key" autocomplete="off" spellcheck="false" value="'+esc(dbxAppKey())+'"><p class="note">From the library’s app in the Dropbox App Console (see How it works).</p>')
      +'<p class="wz-err hide" id="wz-err"></p>'
      +'<div class="row wz-nav"><button class="secondary" data-back>Back</button><button id="wz-own-next">Next</button></div>',
    wire:b=>{
      b.querySelector('[data-back]').onclick=()=>wzGo('welcome');
      $('wz-own-next').onclick=()=>{
        const title=$('wz-name').value.trim(), folder=libFolderFor(title), key=$('wz-key') ? $('wz-key').value.trim() : '';
        if(!folder){ wzErr('Give the library a name first.'); return; }
        if($('wz-key') && !key){ wzErr('Paste the Dropbox app key first.'); return; }
        const ns=nsFor(folder);
        if(key) lsSet('tamarack_library_dropbox_appkey'+ns, key);
        lsSet(WZ_KEY, JSON.stringify({ step:'own-connect', folder, title, mode:'own' }));
        if(folder!==dbxFolder()){ lsSet(FOLDER_KEY, folder); let k=[]; try{ k=JSON.parse(lsGet(KNOWN_KEY)||'[]'); }catch(e){} if(!k.includes(folder)) k.push(folder); lsSet(KNOWN_KEY, JSON.stringify(k)); location.replace(location.pathname); return; }
        wz.title=title; wzGo('own-connect');
      };
    },
  },
  'own-connect':{
    html:()=> dbxTokens()
      ? '<h3>Dropbox is connected</h3><p class="wz-lead" id="wz-wait">Getting your books.</p>'
      : '<h3>Connect Dropbox</h3>'
        +'<p class="wz-lead">Dropbox will ask you to sign in and allow the app. Then you come straight back here.</p>'
        +'<p class="note">The catalog is saved as <b>Dropbox'+esc(dbxFolder())+'/tamarack-library.json</b>.</p>'
        +'<div class="row wz-nav"><button class="secondary" data-back>Back</button><button id="wz-dbx">Connect Dropbox</button></div>',
    wire:async b=>{
      if(!dbxTokens()){ b.querySelector('[data-back]').onclick=()=>{ wzClear(); wzGo('own'); }; $('wz-dbx').onclick=dbxConnect; return; }
      await wzWaitForSync();
      const lib=(store.settings||{}).library||{};
      if(!lib.title && wz.title){ store.settings=Object.assign({}, store.settings, { library:{ title:wz.title, tag:'Our books at home' }, updatedAt:Date.now() }); commit(); }
      wz.joinedNote='Dropbox is connected. '+(allBooks().length ? 'Your '+allBooks().length.toLocaleString()+' books are here.' : 'Your library is ready — let’s fill it.');
      wzGo('photos');
    },
  },
  /* Build-library mode: photograph one bookcase at a time, right here; the photos go to the inbox for Claude.
     Several batches per bookcase; then "Finished with N1" (next one, name counted up: N1 → N2) or "Finished adding to library". */
  photos:{
    html:()=>{
      const done=wz.cases||[], cur=wz.bookcase||'', curN=(done.find(c=>c.room===wz.room && c.bookcase===cur)||{}).n||0;
      return (wz.joinedNote?'<p class="wz-ok">'+esc(wz.joinedNote)+'</p>':'')
      +'<h3>Photograph your shelves</h3>'
      +'<p class="wz-lead">One bookcase at a time. Claude reads the spines and adds every book, with where it sits.</p>'
      +'<ul class="wz-list wz-tight">'
      +'<li><b>Name each bookcase</b> (<i>N1</i>, <i>N2</i>, <i>Den</i>…) and put it on the bookcase, e.g. a piece of tape or a printed label. Photograph the label first.</li>'
      +'<li><b>Top shelf to bottom</b>, two photos per shelf (left half, right half), phone level and square to the spines.</li>'
      +'<li><b>Good light, no flash.</b> Lying-down stacks and books two deep get their own photo.</li>'
      +'</ul>'
      +(done.length?'<div class="wz-done-list">'+done.map(c=>'<span>✓ '+esc(c.bookcase)+' · '+c.n+' photo'+(c.n===1?'':'s')+'</span>').join('')+'</div>':'')
      +'<div class="grid wz-loc"><div><label for="wz-room">Room</label><input id="wz-room" list="dl-room" placeholder="e.g. Living room" value="'+esc(wz.room||'')+'"></div>'
      +'<div><label for="wz-case">Bookcase or bay</label><input id="wz-case" list="dl-case" placeholder="e.g. N1" value="'+esc(cur)+'"></div></div>'
      +'<button id="wz-shoot" class="wz-shoot">📷 '+(curN?'More photos of ':'Take photos of ')+(cur?esc(cur):'this bookcase')+'</button>'
      +'<input type="file" id="wz-file" accept="image/*" multiple class="hide">'
      +'<p class="note" style="margin-top:6px;">The camera stays open: tap the big button for each photo, and they send while you keep going. <a href="#" id="wz-pick">Choose photos instead</a> (if you took them with the Camera app).</p>'
      +'<p class="wz-err hide" id="wz-err"></p>'
      +'<div id="wz-phstatus" class="note">'+(curN?'✓ '+curN+' photo'+(curN===1?'':'s')+' of '+esc(cur)+' sent.':'')+'</div><div id="wz-sent" class="wz-sent"></div>'
      +'<div class="row wz-nav">'
      +(done.length
        ? '<button class="secondary" id="wz-nextcase"'+(curN?'':' disabled')+'>Finished with '+(curN?esc(cur):'this bookcase')+' →</button><button id="wz-photos-done">Finished adding to library</button>'
        : '<button class="secondary" id="wz-photos-done">Later</button>')
      +'</div>';
    },
    wire:()=>{
      $('wz-photos-done').onclick=()=>wzGo('unread');
      const label=()=>{ const c=$('wz-case').value.trim(), seen=(wz.cases||[]).some(x=>x.bookcase===c && x.room===$('wz-room').value.trim());
        $('wz-shoot').textContent='📷 '+(seen?'More photos of ':'Take photos of ')+(c||'this bookcase'); };
      $('wz-case').addEventListener('input', label); $('wz-room').addEventListener('input', label);
      if($('wz-nextcase')) $('wz-nextcase').onclick=()=>{
        // N1 → N2, D9 → D10; a name without a number is left blank to type
        const m=String(wz.bookcase||'').match(/^(.*?)(\d+)$/);
        wzSave({ bookcase: m ? m[1]+(+m[2]+1) : '' }); wzDraw();
        const c=$('wz-case'); c.focus(); c.select();
      };
      $('wz-shoot').onclick=()=>{
        const room=$('wz-room').value.trim(), bc=$('wz-case').value.trim();
        if(!room || !bc){ wzErr('Type the room and the bookcase name first, so Claude knows where these books live.'); return; }
        wzErr('');
        const before=(wz.cases||[]).map(c=>Object.assign({}, c));
        const merge=camCases=>{ const out=before.map(c=>Object.assign({}, c));
          for(const c of camCases){ const o=out.find(x=>x.room===c.room && x.bookcase===c.bookcase); if(o) o.n+=c.n; else out.push(Object.assign({}, c)); }
          return out; };
        openShelfCam({ room, bookcase:bc, kind:'shelf', build:true, fallback:()=>$('wz-file').click(),
          onUpdate:(cases, next)=>{ wzSave({ cases:merge(cases), room:$('cam-room').value.trim(), bookcase:next!=null?next:$('cam-case').value.trim() }); },
          onFinish:(cases, finished)=>{
            wzSave({ cases:merge(cases), room:$('cam-room').value.trim()||room });
            if(finished) wzGo('unread'); else wzDraw();
          } });
      };
      $('wz-pick').onclick=e=>{ e.preventDefault(); const room=$('wz-room').value.trim(), bc=$('wz-case').value.trim();
        if(!room || !bc){ wzErr('Type the room and the bookcase name first, so Claude knows where these books live.'); return; } wzErr(''); $('wz-file').click(); };
      $('wz-file').onchange=async e=>{
        const files=[...e.target.files]; e.target.value=''; if(!files.length) return;
        const loc={ room:$('wz-room').value.trim(), bookcase:$('wz-case').value.trim(), shelf:'', kind:'shelf' };
        ui.phLoc=loc; lsSet(UI_KEY, JSON.stringify(ui));
        $('wz-shoot').disabled=true;
        const ok=await sendToInbox(files, loc, '', $('wz-phstatus'), $('wz-sent'));
        $('wz-shoot').disabled=false;
        if(ok){
          const cases=(wz.cases||[]).slice(), c=cases.find(x=>x.room===loc.room && x.bookcase===loc.bookcase);
          if(c) c.n+=ok; else cases.push({ room:loc.room, bookcase:loc.bookcase, n:ok });
          wzSave({ room:loc.room, bookcase:loc.bookcase, cases });
          const sent=$('wz-sent').innerHTML; wzDraw(); $('wz-sent').innerHTML=sent;
          const n=cases.find(x=>x.room===loc.room && x.bookcase===loc.bookcase).n;
          $('wz-phstatus').textContent='✓ '+ok+' photo'+(ok===1?'':'s')+' of '+loc.bookcase+' sent ('+n+' for this bookcase). More of it? Tap the button again. Otherwise: Finished with '+loc.bookcase+' (on to the next one), or Finished adding to library.';
        }
      };
    },
  },
  /* How the books Claude couldn't read get identified: the walk-through, shown before they exist. */
  unread:{
    html:()=>{
      const n=unidRows().filter(isUnid).length;
      return '<h3>Books Claude can’t read</h3>'
        +'<p class="wz-lead">Some spines are too worn, too thin or too dark. Claude still adds them, as <b>mystery books</b> in the right spot, so nothing is lost. Later, the walk-through takes you to each one:</p>'
        +'<div class="wz-demo" aria-hidden="true">'
        +'<div class="wz-demo-where">Living room · N1 · Shelf 3 · <b>#5 from left</b></div>'
        +'<div class="wz-demo-row"><span>← <i>Little Women</i></span><span class="wz-demo-q">?</span><span><i>Heidi</i> →</span></div>'
        +'<div class="wz-demo-btns"><span>Scan barcode</span><span>Type the title</span><span>📷 Title page</span></div>'
        +'</div>'
        +'<ol class="wz-list wz-tight">'
        +'<li>It says <b>where the book is</b> and which books are on either side.</li>'
        +'<li>Pull it out. <b>Scan its barcode</b>, <b>type the title</b>, or <b>photograph the title page</b> for Claude.</li>'
        +'<li>It moves on to the next one, shelf by shelf. Skip any you can’t reach.</li>'
        +'</ol>'
        +'<p class="note">Find it any time under <b>Epilogue → Import &amp; Export → Unidentified → Start the walk-through</b>. The mystery books appear there once Claude has read your photos.</p>'
        +'<div class="row wz-nav">'+(n?'<button class="secondary" id="wz-walk">Start it now ('+n+')</button>':'')+'<button id="wz-next">Next</button></div>';
    },
    wire:()=>{
      $('wz-next').onclick=()=>wzGo('home');
      if($('wz-walk')) $('wz-walk').onclick=()=>{ closeWizard(true); showPanel('import'); showIE('unid'); openWalk(); };
    },
  },
  home:{
    html:()=>{
      const d=wzDevice();
      const how = d==='iPhone'||d==='iPad'
        ? 'In Safari, tap the <b>Share</b> button (the square with an arrow), then <b>Add to Home Screen</b>.'
        : d==='Android phone' ? 'In Chrome, tap the <b>⋮</b> menu, then <b>Add to Home screen</b> or <b>Install app</b>.'
        : 'On your phone, open this page and add it to the home screen. On a computer, bookmark it.';
      return '<h3>Put it on your home screen</h3>'
        +'<p class="wz-lead">'+how+' It then opens like an app, and works with no signal too.</p>'
        +(friendCfg() ? '<p class="note">Someone else in your household want it on their phone? In the app go to <b>Epilogue → Data &amp; Sync → Add another phone</b> and send them the link.</p>' : '')
        +'<div class="row wz-nav"><button id="wz-done">Start using the library</button></div>';
    },
    wire:()=>{ $('wz-done').onclick=()=>{ closeWizard(true); showPanel('library'); }; },
  },
};
// Wait for the first sync after joining or connecting (up to ~20 s; works offline too, just with nothing new).
async function wzWaitForSync(){
  for(let i=0;i<40;i++){ if(lastSyncAt || $('sync-dot').classList.contains('err') || navigator.onLine===false) break; await new Promise(r=>setTimeout(r,500)); }
}

/* ---- Add another phone (friend libraries): a one-time link for someone else in the household ---- */
$('btn-addphone').onclick=async()=>{
  const box=$('addphone-box'); box.classList.remove('hide'); box.innerHTML='<p class="note">Making a link…</p>';
  try{
    const r=await friendCall('/invite');
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || 'HTTP '+r.status);
    const link=location.origin+location.pathname+'?join='+encodeURIComponent(j.code.replace(/-/g,''));
    box.innerHTML='<div class="wz-invite"><div class="note" style="margin:0;">Send this to the other phone. It works once, for 14 days.</div>'
      +'<div class="wz-code">'+esc(j.code)+'</div><input readonly id="addphone-link" value="'+esc(link)+'">'
      +'<div class="row" style="margin-top:8px;">'+(navigator.share?'<button id="addphone-share">Share link</button>':'')+'<button class="secondary" id="addphone-copy">Copy link</button></div></div>';
    if($('addphone-share')) $('addphone-share').onclick=()=>navigator.share({ title:libCfg().title, text:'Join our library: open this link on your phone (code '+j.code+').', url:link }).catch(()=>{});
    $('addphone-copy').onclick=async()=>{ try{ await navigator.clipboard.writeText(link); toast('Link copied'); }catch(e){ $('addphone-link').select(); } };
  }catch(e){ box.innerHTML='<p class="note">Couldn’t make a link ('+esc(e.message)+'). Check the connection and try again.</p>'; }
};
