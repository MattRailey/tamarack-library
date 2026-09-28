/* Railey Library — sell.js
   Sell & value: marking books to sell and exporting eBay / Etsy files.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Sell & value (Import / Export tab only)
   ============================================================ */
const SALE_LABEL={'':'—','consider':'Thinking about it','ebay':'Sell on eBay','etsy':'Sell on Etsy','listed':'Listed','sold':'Sold','keep':'Keep'};
const COND_ID={'Like New':2750,'Very Good':4000,'Good':5000,'Acceptable':6000};
let slView='dups', slShown=40;
function settings(){ return store.settings || (store.settings={}); }
function dupSetIds(){ const s=new Set(); dupGroups().forEach(g=>g.forEach(b=>s.add(b.id))); return s; }
function etsyOK(b){ const y=parseInt(b.year); return !!y && y <= new Date().getFullYear()-20; }
function isbnOf(b){ return String(b.isbn||'').replace(/[^0-9Xx]/g,''); }
function priceLinks(b){
  const q=encodeURIComponent((b.title||'').replace(/\s*\(.*?\)\s*/g,' ')+' '+(String(b.author||'').split(/[,(]/)[0]));
  const L=[['eBay sold','https://www.ebay.com/sch/i.html?_nkw='+q+'&LH_Sold=1&LH_Complete=1&_sacat=267']];
  const i=isbnOf(b); if(i.length>=10) L.push(['BookScouter','https://bookscouter.com/book/'+i]);
  L.push(['AbeBooks','https://www.abebooks.com/servlet/SearchResults?kn='+q]);
  L.push(['Etsy','https://www.etsy.com/search?q='+q+'+vintage+book']);
  return L.map(([t,u])=>'<a href="'+u+'" target="_blank" rel="noopener">'+t+'</a>').join(' · ');
}
function listingTitle(b){
  const parts=[String(b.title||'').replace(/\s*\((?:second|third) copy\)/i,'')];
  if(b.author) parts.push('by '+String(b.author).split(' (')[0]);
  const bind=b.format||''; if(bind) parts.push(bind);
  if(b.year) parts.push(b.year);
  let t=parts.join(' '); if(t.length>80) t=t.slice(0,79).replace(/\s+\S*$/,'');
  return t;
}
function listingDesc(b){
  const c=b.saleCondition||settings().cond||'Very Good';
  const lines=[String(b.title||'')+(b.author?' by '+b.author:'')+'.'];
  if(b.about) lines.push(b.about);
  const det=[b.format, b.publisher, b.year?'first published '+b.year:'', b.pages?b.pages+' pages':''].filter(Boolean).join(', ');
  if(det) lines.push(det.charAt(0).toUpperCase()+det.slice(1)+'.');
  lines.push('Condition: '+c+(b.saleCondNote?' — '+b.saleCondNote:'')+'.');
  if(settings().footer) lines.push(settings().footer);
  return lines.join('\n\n');
}
function etsyTags(b){
  const t=[]; const add=x=>{ x=String(x).toLowerCase().trim(); if(x && x.length<=20 && !t.includes(x)) t.push(x); };
  add('vintage book'); if(b.genre) add(b.genre.split(' & ')[0]); if(b.author) add(String(b.author).split(/[,(]/)[0]);
  String(b.subjects||'').split(',').forEach(add); return t.slice(0,13);
}
function whenMade(b){ const y=parseInt(b.year); if(!y) return ''; if(y<1700) return 'before_1700'; if(y<1800) return '1700s'; if(y<1900) return '1800s'; if(y<2000) return String(Math.floor(y/10)*10)+'s'; return '2000_'+(new Date().getFullYear()-20); }
function saleRows(){
  const q=words($('sl-q').value).split(' ').filter(Boolean);
  let L=allBooks().filter(b=>!String(b.title||'').startsWith('('));
  if(slView==='dups'){ const ids=dupSetIds(); L=L.filter(b=>ids.has(b.id)); }
  else if(slView==='selling') L=L.filter(b=>['consider','ebay','etsy'].includes(b.saleStatus));
  else if(slView==='listed') L=L.filter(b=>b.saleStatus==='listed');
  else if(slView==='sold') L=L.filter(b=>b.saleStatus==='sold');
  if(q.length) L=L.filter(b=>q.every(t=>tokScore(bookIndex(b).title.concat(bookIndex(b).author), t, false)));
  if(slView==='dups'){ const key=b=>normKey(b.title)+'|'+normKey(b.author); L.sort((a,b)=>natCmp(key(a),key(b))); }
  else L.sort((a,b)=>natCmp(normKey(a.title),normKey(b.title)));
  return L;
}
function renderSell(){
  const L=saleRows(), slice=L.slice(0,slShown);
  const all=allBooks(), cnt=s=>all.filter(b=>b.saleStatus===s).length;
  const soldTotal=all.filter(b=>b.saleStatus==='sold').reduce((t,b)=>t+(+b.saleSoldPrice||0),0);
  $('sl-summary').textContent = (cnt('ebay')+cnt('etsy'))+' ready to list · '+cnt('listed')+' listed · '+cnt('sold')+' sold'+(soldTotal?' ('+money(soldTotal)+')':'');
  $('sl-list').innerHTML = slice.length ? slice.map(b=>{
    const st=b.saleStatus||'', cond=b.saleCondition||'';
    return '<div class="card sl-item" data-id="'+b.id+'">'+
      '<div class="sl-top"><div class="cover" style="width:46px;height:68px;">'+coverHTML(b)+'</div><div style="min-width:0;flex:1;">'+
        '<b class="sl-t">'+esc(b.title)+'</b><div class="note" style="margin:2px 0 0;">'+esc(b.author||'')+(b.year?' · '+esc(b.year):'')+' · '+esc(locText(b))+'</div>'+
        (b.saleEst?'<div class="sl-est">Estimated: <b>'+esc(b.saleEst)+'</b>'+(b.saleEstNote?' — '+esc(b.saleEstNote):'')+'</div>':'')+
        '<div class="note sl-links" style="margin-top:4px;">Check prices: '+priceLinks(b)+'</div></div></div>'+
      '<div class="sl-ctrl">'+
        '<select data-f="saleStatus">'+Object.keys(SALE_LABEL).map(k=>'<option value="'+k+'"'+(k===st?' selected':'')+'>'+SALE_LABEL[k]+'</option>').join('')+'</select>'+
        '<select data-f="saleCondition"><option value="">Condition…</option>'+Object.keys(COND_ID).map(k=>'<option'+(k===cond?' selected':'')+'>'+k+'</option>').join('')+'</select>'+
        '<input data-f="salePrice" inputmode="decimal" placeholder="Price $" value="'+esc(b.salePrice||'')+'">'+
        (st==='sold'?'<input data-f="saleSoldPrice" inputmode="decimal" placeholder="Sold for $" value="'+esc(b.saleSoldPrice||'')+'">':'')+
      '</div>'+
      (st==='etsy' && !etsyOK(b)?'<div class="sl-warn">Etsy only allows vintage items (20+ years old). This book’s first-published year is '+(b.year?esc(b.year):'unknown')+' — only list it there if your copy is that old.</div>':'')+
      '<div class="row" style="margin-top:8px;"><button class="secondary" data-act="copy-ebay">Copy for eBay</button><button class="secondary" data-act="copy-etsy">Copy for Etsy</button><button class="secondary" data-act="open">Open book</button></div>'+
    '</div>'; }).join('') : '<div class="card empty">'+({dups:'No duplicates.',selling:'Nothing marked to sell yet. Use the Duplicates or All books view and set a book to “Sell on eBay” or “Sell on Etsy”.',listed:'Nothing listed yet.',sold:'Nothing sold yet.',all:'No books match.'}[slView])+'</div>';
  $('sl-more-wrap').classList.toggle('hide', L.length<=slShown);
  $('sl-more').textContent='Show more ('+(L.length-slShown)+' left)';
}
function setSale(id, f, v){
  const b=byId(id); if(!b) return;
  b[f]=v; b.updatedAt=Date.now();
  if(f==='saleStatus'){ if(v==='sold' && !b.saleSoldAt) b.saleSoldAt=todayLocal(); if(v==='listed' && !b.saleListedAt) b.saleListedAt=todayLocal();
    if((v==='ebay'||v==='etsy') && !b.saleCondition) b.saleCondition=settings().cond||'Very Good'; }
  commit();
}
async function copyText(t){ try{ await navigator.clipboard.writeText(t); toast('Copied — paste it into the listing'); }catch(e){ prompt('Copy this:', t); } }
$('sl-list').addEventListener('change', e=>{ const el=e.target.closest('[data-f]'); if(!el) return; const id=el.closest('.sl-item').dataset.id;
  let v=el.value.trim(); if(el.dataset.f==='salePrice'||el.dataset.f==='saleSoldPrice') v=v.replace(/[$,\s]/g,'');
  setSale(id, el.dataset.f, v); if(el.dataset.f==='saleStatus') renderSell(); });
$('sl-list').addEventListener('click', e=>{ const btn=e.target.closest('button[data-act]'); if(!btn) return; const b=byId(btn.closest('.sl-item').dataset.id); if(!b) return;
  if(btn.dataset.act==='open') openBook(b.id,[b.id]);
  if(btn.dataset.act==='copy-ebay') copyText(listingTitle(b)+'\n\n'+listingDesc(b)+(b.salePrice?'\n\nPrice: $'+b.salePrice:''));
  if(btn.dataset.act==='copy-etsy') copyText('TITLE: '+listingTitle(b)+'\n\nDESCRIPTION:\n'+listingDesc(b)+'\n\nTAGS: '+etsyTags(b).join(', ')+'\nWHEN MADE: '+(whenMade(b)||'(set in Etsy)')+'\nWHO MADE IT: Another company or person\nWHAT IS IT: A finished product\nCATEGORY: Books, Movies & Music > Books'+(b.salePrice?'\nPRICE: $'+b.salePrice:''));
});
document.querySelectorAll('#sl-view button').forEach(x=>x.onclick=()=>{ slView=x.dataset.v; slShown=40; document.querySelectorAll('#sl-view button').forEach(y=>y.classList.toggle('active',y===x)); renderSell(); });
$('sl-q').addEventListener('input', ()=>{ clearTimeout(renderSell._t); renderSell._t=setTimeout(()=>{ slShown=40; renderSell(); },150); });
$('sl-more').onclick=()=>{ slShown+=60; renderSell(); };
$('sl-settings-btn').onclick=()=>{ const s=settings(); $('st-ship').value=s.ship||''; $('st-return').value=s.ret||''; $('st-pay').value=s.pay||''; $('st-cond').value=s.cond||'Very Good'; $('st-footer').value=s.footer||''; $('sl-settings').classList.toggle('hide'); };
$('st-save').onclick=()=>{ store.settings=Object.assign({},settings(),{ship:$('st-ship').value.trim(),ret:$('st-return').value.trim(),pay:$('st-pay').value.trim(),cond:$('st-cond').value,footer:$('st-footer').value.trim(),updatedAt:Date.now()}); commit(); $('sl-settings').classList.add('hide'); toast('Settings saved'); };
function csvQ(v){ v=v==null?'':String(v); return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; }
function markListed(list){ if(!list.length) return; if(confirm('Mark these '+list.length+' books as Listed?')){ const now=Date.now(); list.forEach(b=>{ b.saleStatus='listed'; b.saleListedAt=todayLocal(); b.updatedAt=now; }); commit(); renderSell(); } }
$('sl-export-ebay').onclick=()=>{
  const L=allBooks().filter(b=>b.saleStatus==='ebay');
  if(!L.length){ toast('Set some books to “Sell on eBay” first'); return; }
  const noPrice=L.filter(b=>!(+b.salePrice)); if(noPrice.length && !confirm(noPrice.length+' book(s) have no price and eBay will reject them. Export anyway?')) return;
  const s=settings();
  const head=['*Action(SiteID=US|Country=US|Currency=USD|Version=1193)','Custom label (SKU)','Category ID','Title','Product:ISBN','Price','Quantity','Item photo URL','Condition ID','Description','Format','Duration','Best Offer Enabled','Shipping profile name','Return profile name','Payment profile name','C:Book Title','C:Author','C:Language','C:Format','C:Publication Year','C:Publisher','C:Genre'];
  const rows=L.map(b=>['Add','RL-'+b.id.slice(-8),'261186',listingTitle(b),isbnOf(b),b.salePrice||'','1',webCover(b),COND_ID[b.saleCondition||s.cond||'Very Good']||4000,
    listingDesc(b).replace(/\n\n/g,'<br><br>'),'FixedPrice','GTC','1',s.ship||'',s.ret||'',s.pay||'',String(b.title||'').replace(/\s*\(.*?\)\s*$/,''),String(b.author||'').split(' (')[0],'English',b.format||'',b.year||'',b.publisher||'',b.genre||'']);
  download('ebay-listings-'+todayLocal()+'.csv', [head].concat(rows).map(r=>r.map(csvQ).join(',')).join('\r\n'), 'text/csv');
  toast('eBay file downloaded — add your own photos in Seller Hub before publishing');
  setTimeout(()=>markListed(L), 600);
};
$('sl-export-etsy').onclick=()=>{
  const L=allBooks().filter(b=>b.saleStatus==='etsy');
  if(!L.length){ toast('Set some books to “Sell on Etsy” first'); return; }
  const head=['Title','Description','Price','Quantity','SKU','Tags','When made','Who made','What is it','Category','Condition','ISBN','Photo 1'];
  const rows=L.map(b=>[listingTitle(b).slice(0,140),listingDesc(b),b.salePrice||'','1','RL-'+b.id.slice(-8),etsyTags(b).join(','),whenMade(b),'someone_else','a_finished_product','Books, Movies & Music > Books > Books',b.saleCondition||settings().cond||'Very Good',isbnOf(b),webCover(b)]);
  download('etsy-listings-'+todayLocal()+'.csv', '﻿'+[head].concat(rows).map(r=>r.map(csvQ).join(',')).join('\r\n'), 'text/csv');
  toast('Etsy file downloaded');
  setTimeout(()=>markListed(L), 600);
};
