/* Railey Library — units.js
   Cooking unit converter: a small window opened from the Recipes tab.
   Type a number, pick its unit, pick the unit you want. Volume, weight and oven temperature.
   Cups <-> grams (volume <-> weight) needs to know the ingredient, so there is an optional "Ingredient" picker.
   Nothing is saved. Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

const UC_VOL={ tsp:['teaspoon (tsp)',4.92892], tbsp:['tablespoon (Tbsp)',14.7868], floz:['fluid ounce (fl oz)',29.5735], cup:['cup',236.588],
  pint:['pint',473.176], quart:['quart',946.353], gal:['gallon',3785.41], ml:['milliliter (mL)',1], l:['liter (L)',1000] };
const UC_WT={ oz:['ounce (oz)',28.3495], lb:['pound (lb)',453.592], g:['gram (g)',1], kg:['kilogram (kg)',1000] };
const UC_TEMP={ f:['°F (Fahrenheit)'], c:['°C (Celsius)'] };
/* grams in one US cup */
const UC_ING=[ ['','— none —',0], ['All-purpose flour','All-purpose flour',125], ['Bread flour','Bread flour',127], ['Whole wheat flour','Whole wheat flour',120],
  ['Granulated sugar','Sugar (granulated)',200], ['Brown sugar','Brown sugar (packed)',213], ['Powdered sugar','Powdered sugar',120],
  ['Butter','Butter',227], ['Water, milk','Water / milk',237], ['Honey','Honey / molasses',340], ['Oil','Vegetable oil',218],
  ['Rice','Rice (uncooked)',185], ['Rolled oats','Rolled oats',90], ['Cocoa','Cocoa powder',85], ['Chocolate chips','Chocolate chips',170], ['Cornmeal','Cornmeal',156] ];

function ucKind(u){ return UC_VOL[u]?'vol':UC_WT[u]?'wt':'temp'; }
function ucParse(s){
  s=String(s||'').trim().replace(/[½¼¾⅓⅔⅛]/g,c=>' '+({'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8'})[c]).replace(/\s+/g,' ').trim();
  if(!s) return NaN;
  let m;
  if((m=s.match(/^(-?\d+)\s+(\d+)\/(\d+)$/))) return (+m[3]) ? Math.sign(+m[1]||1)*(Math.abs(+m[1])+(+m[2])/(+m[3])) : NaN;
  if((m=s.match(/^(\d+)\/(\d+)$/))) return (+m[2]) ? (+m[1])/(+m[2]) : NaN;
  if(/^-?\d*[.,]?\d+$/.test(s)) return parseFloat(s.replace(',','.'));
  return NaN;
}
function ucNice(n){
  if(!isFinite(n)) return '';
  const a=Math.abs(n);
  const d=a>=100?0:a>=10?1:a>=1?2:3;
  return String(+n.toFixed(d));
}
function ucFrac(n,u){
  if(['ml','l','g','kg','c','f'].includes(u)||!(n>0)||n>=100) return '';
  const w=Math.floor(n+1e-9); const f=n-w;
  const opts=[[0,''],[1/8,'1/8'],[1/4,'1/4'],[1/3,'1/3'],[3/8,'3/8'],[1/2,'1/2'],[5/8,'5/8'],[2/3,'2/3'],[3/4,'3/4'],[7/8,'7/8'],[1,'']];
  let best=opts[0],bd=9; for(const o of opts){ const dd=Math.abs(f-o[0]); if(dd<bd){ bd=dd; best=o; } }
  if(bd>0.02) return '';
  const whole=w+(best[0]===1?1:0), fr=best[0]===1?'':best[1];
  const txt=(whole?whole:'')+(whole&&fr?' ':'')+fr;
  return txt && Math.abs(whole+(best[0]===1?0:best[0])-n)>1e-6 ? txt : '';
}
function ucConvert(v,from,to,gPerCup){
  const kf=ucKind(from), kt=ucKind(to);
  if(kf==='temp'||kt==='temp'){
    if(kf!==kt) return {err:'Temperature can only be converted to a temperature.'};
    if(from===to) return {val:v};
    return {val: from==='f' ? (v-32)*5/9 : v*9/5+32};
  }
  if(kf===kt){
    const t=kf==='vol'?UC_VOL:UC_WT;
    return {val:v*t[from][1]/t[to][1]};
  }
  if(!gPerCup) return {err:'To go between cups and grams, pick the ingredient below.'};
  const gPerMl=gPerCup/UC_VOL.cup[1];
  if(kf==='vol'){ const g=v*UC_VOL[from][1]*gPerMl; return {val:g/UC_WT[to][1]}; }
  const ml=v*UC_WT[from][1]/gPerMl; return {val:ml/UC_VOL[to][1]};
}

function ucDraw(){
  const v=ucParse($('uc-n').value), from=$('uc-from').value, to=$('uc-to').value;
  const ing=UC_ING[+$('uc-ing').selectedIndex]||UC_ING[0];
  const out=$('uc-out'), note=$('uc-note');
  note.textContent='';
  if(isNaN(v)){ out.textContent='—'; note.textContent=$('uc-n').value.trim()?'Type a number like 2, 1.5 or 1 1/2.':''; return; }
  const r=ucConvert(v,from,to,ing[2]);
  if(r.err){ out.textContent='—'; note.textContent=r.err; return; }
  const txt=ucNice(r.val), fr=ucFrac(r.val,to);
  const label=(UC_VOL[to]||UC_WT[to]||UC_TEMP[to])[0].replace(/ \(.*\)/,'').replace(/^°F.*/,'°F').replace(/^°C.*/,'°C');
  out.textContent=txt+' '+(to==='f'||to==='c'?'':label)+(fr&&fr!==txt?'  (about '+fr+')':'');
  if(to==='f'||to==='c') out.textContent=txt+label;
  if(ucKind(from)!==ucKind(to)&&ucKind(from)!=='temp') note.textContent='Using '+ing[1].toLowerCase()+' at about '+ing[2]+' g per cup. Brands and packing vary a little.';
}
function ucFill(sel,keep){
  const o=[]; o.push('<optgroup label="Volume">'+Object.entries(UC_VOL).map(([k,a])=>'<option value="'+k+'">'+a[0]+'</option>').join('')+'</optgroup>');
  o.push('<optgroup label="Weight">'+Object.entries(UC_WT).map(([k,a])=>'<option value="'+k+'">'+a[0]+'</option>').join('')+'</optgroup>');
  o.push('<optgroup label="Oven temperature">'+Object.entries(UC_TEMP).map(([k,a])=>'<option value="'+k+'">'+a[0]+'</option>').join('')+'</optgroup>');
  sel.innerHTML=o.join(''); sel.value=keep;
}
function openUnits(){
  $('uc-bg').classList.add('open'); lockPage();
  setTimeout(()=>{ try{ $('uc-n').focus(); $('uc-n').select(); }catch(e){} },30);
  ucDraw();
}
function closeUnits(){ $('uc-bg').classList.remove('open'); unlockPage(); }
(function(){
  const bg=document.createElement('div'); bg.className='modal-bg'; bg.id='uc-bg';
  bg.innerHTML='<div class="modal uc-modal" role="dialog" aria-modal="true" aria-labelledby="uc-title">'+
    '<button class="modal-close" id="uc-close" aria-label="Close">&times;</button>'+
    '<h3 id="uc-title">Cooking conversions</h3>'+
    '<div class="uc-grid">'+
      '<label>Amount<input type="text" id="uc-n" inputmode="decimal" autocomplete="off" value="1" aria-label="Amount"></label>'+
      '<label>From<select id="uc-from"></select></label>'+
      '<button type="button" class="secondary uc-swap" id="uc-swap" aria-label="Swap the two units" title="Swap">⇅</button>'+
      '<label>To<select id="uc-to"></select></label>'+
    '</div>'+
    '<div class="uc-result"><div class="uc-out" id="uc-out" aria-live="polite">—</div><div class="note" id="uc-note"></div></div>'+
    '<label class="uc-ing">Ingredient <span class="note">(only needed to go between cups and grams)</span><select id="uc-ing">'+UC_ING.map(a=>'<option>'+a[1]+'</option>').join('')+'</select></label>'+
    '</div>';
  document.body.appendChild(bg);
  ucFill($('uc-from'),'cup'); ucFill($('uc-to'),'g');
  $('uc-n').addEventListener('input',ucDraw);
  ['uc-from','uc-to','uc-ing'].forEach(id=>$(id).addEventListener('change',ucDraw));
  $('uc-swap').onclick=()=>{ const a=$('uc-from').value; $('uc-from').value=$('uc-to').value; $('uc-to').value=a; ucDraw(); };
  $('uc-close').onclick=closeUnits;
  bg.addEventListener('click',e=>{ if(e.target===bg) closeUnits(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&bg.classList.contains('open')) closeUnits(); });
  const b=$('r-conv'); if(b) b.onclick=openUnits;
})();
