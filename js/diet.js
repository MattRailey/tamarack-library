/* Railey Library — diet.js
   Dairy-free, corn-free and gluten-free, for recipes.
   Each recipe is checked from its ingredient lines (dietScan): an ingredient that contains dairy / gluten / corn is
   listed with a swap ("Show options" in the recipe window). Corn hides in a lot of things (baking powder, powdered
   sugar, plain "oil", white vinegar…): those are "check the label" rather than a sure hit. A recipe marked confirmed
   in its edit form (r.diet: ['dairy','corn','gluten']) counts as free, whatever the check says.
   The filter (Recipes → Dairy-free / Corn-free / Gluten-free) shows recipes that are free, or can be with swaps
   ("2 swaps"); "Only ones already free" leaves the swaps out.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

const DIETS=[['dairy','Dairy-free','dairy'],['corn','Corn-free','corn'],['gluten','Gluten-free','gluten']];
const DIET_NAME={ dairy:'Dairy-free', corn:'Corn-free', gluten:'Gluten-free' };
// [pattern, swap, flags] — patterns run on the ingredient line, lowercased, after the "safe" phrases are taken out.
// flags: 'maybe' = may contain it (check the label); 'none' = no easy swap.
const DIET_RULES={
  dairy:{
    safe:/\b(coconut|almond|oat|soy|rice|cashew|hemp|flax|plant|dairy[- ]free|non[- ]?dairy|vegan)\s+(milk|cream|creamer|butter|cheese|yogurt|yoghurt|sour cream|beverage|alternative|ice cream)\b|\b(peanut|almond|cashew|sunflower|nut|seed|apple|pumpkin|cocoa|shea)\s+butter\b|\bmilk alternative\b|\bcream of tartar\b|\bbutternut\b|\bbutter lettuce\b|\bcoconut cream\b|\bmilk chocolate-free\b/g,
    rules:[
      [/\bbuttermilk\b/, 'dairy-free milk + 1 tbsp lemon juice or vinegar per cup (let stand 5 minutes)'],
      [/\b(sweetened )?condensed milk\b/, 'sweetened condensed coconut milk'],
      [/\bevaporated milk\b/, 'canned coconut milk, or a dairy-free milk simmered down'],
      [/\bice cream\b/, 'dairy-free ice cream'],
      [/\beggnog\b/, 'dairy-free (almond or coconut) eggnog'],
      [/\b(half[- ]and[- ]half|heavy cream|whipping cream|light cream|sour cream|cream cheese|cream)\b/, 'full-fat coconut milk or coconut cream (sour cream / cream cheese: a dairy-free one)'],
      [/\b(yogurt|yoghurt|kefir)\b/, 'plain dairy-free yogurt (coconut, almond or oat)'],
      [/\b(ghee|butter)\b/, 'dairy-free butter (vegan butter sticks), or coconut or olive oil'],
      [/\b(parmesan|romano|pecorino)\b/, 'dairy-free parmesan, or nutritional yeast (about the same amount)'],
      [/\b(cheese|cheddar|mozzarella|gruy[eè]re|swiss|ricotta|feta|provolone|monterey|colby|brie|cottage cheese|mascarpone)\b/, 'a dairy-free cheese of the same kind, or leave it out'],
      [/\b(whey|casein|milk powder|dry milk)\b/, 'leave out, or a dairy-free milk powder'],
      [/\bmilk\b/, 'oat, almond, soy or coconut milk (unsweetened)'],
      [/\b(chocolate chips|milk chocolate)\b/, 'dairy-free chocolate chips', 'maybe'],
    ] },
  gluten:{
    safe:/\b(gluten[- ]free|gf|almond|coconut|rice|tapioca|potato|corn|cassava|chickpea|buckwheat|sorghum|oat|arrowroot)\s+(flour|bread|pasta|noodles|crumbs|breadcrumbs|crackers|tortillas?|starch|meal)\b|\btamari\b|\bcoconut aminos\b|\bcornstarch\b|\bcorn starch\b|\brice noodles\b|\bbuckwheat\b|\bgluten[- ]free\b[^,]*/g,
    rules:[
      [/\b(soy sauce|teriyaki|hoisin)\b/, 'tamari or coconut aminos (gluten-free)'],
      [/\b(bread ?crumbs|panko|cracker crumbs|graham crackers?|crackers|croutons)\b/, 'gluten-free bread crumbs / crackers, or crushed GF cereal'],
      [/\b(self[- ]rising flour)\b/, '1:1 gluten-free baking flour + 1½ tsp baking powder and ¼ tsp salt per cup'],
      [/\b(all[- ]purpose|bread|cake|pastry|whole[- ]wheat|wheat|white)?\s*flour\b/, '1:1 gluten-free baking flour (one with xanthan gum)'],
      [/\b(spaghetti|pasta|noodles|macaroni|lasagna|penne|fettuccine|linguine|orzo|egg noodles)\b/, 'gluten-free pasta (rice, corn or chickpea)'],
      [/\b(flour tortillas?|tortillas?|pita|naan|wraps?)\b/, 'gluten-free tortillas or wraps (corn tortillas if corn is fine)'],
      [/\b(bread|buns?|rolls|bagels?|english muffins?|biscuits?|pie crust|puff pastry|phyllo)\b/, 'gluten-free bread / buns / crust'],
      [/\b(couscous|bulgur|farro|spelt|semolina|barley|rye|seitan)\b/, 'quinoa, rice or millet'],
      [/\b(oats|oatmeal|rolled oats)\b/, 'certified gluten-free oats', 'maybe'],
      [/\b(beer|malt|malt vinegar|malted)\b/, 'gluten-free beer; cider vinegar for malt vinegar'],
      [/\b(cream of (mushroom|chicken|celery) soup|condensed soup)\b/, 'a gluten-free condensed soup, or a quick sauce thickened with cornstarch'],
      [/\b(cake mix|brownie mix|pancake mix|bisquick|cookies?|cookie crumbs)\b/, 'the gluten-free version'],
      [/\b(worcestershire)\b/, 'a gluten-free Worcestershire (check the label)', 'maybe'],
    ] },
  corn:{
    safe:/\bpeppercorns?\b|\bcorned beef\b|\bcornish\b|\b(olive|avocado|coconut|canola|sesame|peanut|sunflower|grapeseed|safflower|walnut|truffle)\s+oil\b|\b(apple cider|cider|balsamic|rice|red wine|white wine|sherry|wine|malt)\s+vinegar\b|\bcorn[- ]free\b[^,]*/g,
    rules:[
      [/\b(cornstarch|corn starch|cornflour|corn flour)\b/, 'arrowroot, tapioca or potato starch (same amount)'],
      [/\b(corn syrup)\b/, 'honey, maple syrup, golden syrup or brown rice syrup'],
      [/\b(cornmeal|polenta|grits|masa|hominy|corn tortillas?|tortilla chips|corn chips|cornflakes|corn flakes)\b/, 'no easy swap (a different recipe, or flour tortillas for corn tortillas)', 'none'],
      [/\b(corn oil)\b/, 'olive, avocado or canola oil'],
      [/\b(popcorn|corn)\b/, 'leave out, or another vegetable (peas, diced carrots)'],
      [/\bbaking powder\b/, 'corn-free baking powder, or for each 1 tsp: ¼ tsp baking soda + ½ tsp cream of tartar', 'maybe'],
      [/\b(powdered|confectioners'?|icing) sugar\b/, 'corn-free (tapioca-starch) powdered sugar, or blend 1 cup sugar + 1 tbsp arrowroot', 'maybe'],
      [/\b(vegetable oil|cooking spray|oil)\b/, 'olive, avocado or canola oil', 'maybe'],
      [/\b(distilled|white) vinegar\b|\bvinegar\b/, 'apple cider vinegar', 'maybe'],
      [/\b(dextrose|maltodextrin|xanthan gum|caramel color|iodized salt)\b/, 'check the label; non-iodized salt for iodized', 'maybe'],
      [/\b(vanilla extract|vanilla flavoring)\b/, 'a corn-free vanilla (check the label), or vanilla bean', 'maybe'],
      [/\b(baking mix|cake mix|bisquick)\b/, 'check the label', 'maybe'],
    ] },
};
const DIET_CACHE=new WeakMap();
// → { dairy:{ hits:[{ line, swap, maybe, none }], confirmed }, corn:…, gluten:… }
function dietScan(r){
  let c=DIET_CACHE.get(r); if(c) return c;
  c={};
  for(const [d] of DIETS){
    const R=DIET_RULES[d], hits=[];
    for(const raw of (r.ingredients||[])){
      const line=String(raw||''); if(/^##\s/.test(line)) continue;
      const t=norm(line).replace(R.safe,' ');
      for(const [re, swap, flag] of R.rules){ if(re.test(t)){ hits.push({ line, swap, maybe:flag==='maybe', none:flag==='none' }); break; } }
    }
    c[d]={ hits, confirmed:(r.diet||[]).includes(d) };
  }
  DIET_CACHE.set(r, c); return c;
}
// 'free' | 'check' (only "check the label" items) | 'swap' (has swaps for everything) | 'no' (something with no easy swap)
function dietStatus(r, d){
  const s=dietScan(r)[d]; if(s.confirmed || !s.hits.length) return 'free';
  if(s.hits.some(h=>h.none)) return 'no';
  if(s.hits.every(h=>h.maybe)) return 'check';
  return 'swap';
}
function dietOk(r){
  for(const d of (rui.diet||[])){ const st=dietStatus(r, d); if(st==='no') return false; if(rui.dietStrict && st!=='free' && st!=='check') return false; }
  return true;
}
function dietBadges(r){
  if(!(rui.diet||[]).length) return '';
  return rui.diet.map(d=>{ const st=dietStatus(r, d), s=dietScan(r)[d], n=s.hits.filter(h=>!h.maybe).length;
    return st==='free' ? '<span class="chip diet-ok">✓ '+DIET_NAME[d]+'</span>'
      : st==='check' ? '<span class="chip diet-check">'+DIET_NAME[d]+'? check labels</span>'
      : '<span class="chip diet-swap">'+DIET_NAME[d]+' with '+n+' swap'+(n===1?'':'s')+'</span>'; }).join('');
}

/* ---------------- the filter row ---------------- */
function renderDietRow(){
  document.querySelectorAll('#r-diet [data-diet]').forEach(b=>{ const on=(rui.diet||[]).includes(b.dataset.diet); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('r-diet-strict-row').classList.toggle('hide', !(rui.diet||[]).length);
  $('r-diet-strict').checked=!!rui.dietStrict;
}
document.querySelectorAll('#r-diet [data-diet]').forEach(b=>b.onclick=()=>{
  const d=b.dataset.diet, L=(rui.diet||[]).slice(), i=L.indexOf(d); if(i>=0) L.splice(i,1); else L.push(d);
  rui.diet=L; saveRui(); renderRecipes();
});
$('r-diet-strict').onchange=()=>{ rui.dietStrict=$('r-diet-strict').checked; saveRui(); renderRecipes(); };

/* ---------------- in the recipe window: the summary, and "Show options" ---------------- */
let dietOpen=false;
function renderRecipeDiet(r){
  const el=$('rc-diet'); if(!el) return;
  const S=dietScan(r), parts=[], any=DIETS.some(([d])=>!S[d].confirmed && S[d].hits.length);
  for(const [d, name] of DIETS){
    const st=dietStatus(r, d), sure=S[d].hits.filter(h=>!h.maybe).length, maybe=S[d].hits.filter(h=>h.maybe).length;
    parts.push(st==='free' ? '<span class="chip diet-ok">✓ '+name+(S[d].confirmed && S[d].hits.length?' (marked)':'')+'</span>'
      : st==='check' ? '<span class="chip diet-check">'+name+'? '+maybe+' to check</span>'
      : st==='no' ? '<span class="chip diet-no">Not '+name.toLowerCase()+'</span>'
      : '<span class="chip diet-swap">'+name+' with '+sure+' swap'+(sure===1?'':'s')+(maybe?' (+'+maybe+' to check)':'')+'</span>');
  }
  let opts='';
  if(any){
    opts='<div class="diet-opts'+(dietOpen?'':' hide')+'" id="rc-diet-opts">'+DIETS.map(([d, name])=>{
      const s=S[d]; if(s.confirmed || !s.hits.length) return '';
      return '<h5>'+name+'</h5><ul>'+s.hits.map(h=>'<li><b>'+esc(h.line)+'</b>'+(h.maybe?' <span class="note">may contain '+(d==='corn'?'corn':d==='dairy'?'dairy':'gluten')+', check the label</span>':'')+'<br>→ '+esc(h.swap)+'</li>').join('')+'</ul>';
    }).join('')
    +(((rui.diet||[]).includes('corn') || S.corn.hits.length) && S.gluten.hits.length && !S.gluten.confirmed ? '<p class="note">Corn-free too? Pick a gluten-free flour blend without cornstarch or corn flour.</p>' : '')
    +'<p class="note">Checked from the ingredient list, so it can miss things (always read labels). If a recipe is fine as it is, mark it in <b>Edit</b>.</p></div>';
  }
  el.innerHTML='<div class="diet-sum">'+parts.join('')+(any?'<button class="linkish" id="rc-diet-toggle">'+(dietOpen?'Hide options':'Show options')+'</button>':'')+'</div>'+opts;
  if(any) $('rc-diet-toggle').onclick=()=>{ dietOpen=!dietOpen; renderRecipeDiet(r); };
}
