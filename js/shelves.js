/* Railey Library — shelves.js
   The Shelves tab: rooms, bookcases and shelves in order.
   Part of the app's shared script scope: see DEVELOPER.md. */
'use strict';

/* ============================================================
   Shelves
   ============================================================ */
function renderShelves(){
  const roomF = $('s-room').value, q = norm($('s-q').value.trim());
  const L = live().filter(b=>!roomF || b.room===roomF);
  const tree = {};
  for(const b of L){
    const r=b.room||'(no room)', c=b.bookcase||'(no bookcase)', s=b.shelf||'(no shelf)';
    ((tree[r]=tree[r]||{})[c]=tree[r][c]||{})[s] = (tree[r][c][s]||[]).concat(b);
  }
  const rooms = Object.keys(tree).sort(natCmp);
  if(!rooms.length){ $('shelf-tree').innerHTML='<div class="card empty">No books yet.</div>'; return; }
  const openRooms = new Set([...document.querySelectorAll('details.room[open]')].map(d=>d.dataset.room));
  $('shelf-tree').innerHTML = rooms.map(r=>{
    const cases = tree[r]; let count=0, hit=false;
    const body = Object.keys(cases).sort(natCmp).map(c=>{
      return '<div class="case"><div class="case-h">'+(/^[\w-]{1,3}$/.test(c)?'Bookcase '+esc(c):esc(c))+'</div>' + Object.keys(cases[c]).sort(natCmp).map(s=>{
        const books = cases[c][s].slice().sort((x,y)=>posCmp(x,y) || natCmp(normKey(x.title),normKey(y.title)));
        count += books.length;
        return '<div class="shelf"><div class="shelf-h"><span>Shelf '+esc(s)+' · '+books.length+' book'+(books.length===1?'':'s')+'</span><span class="acts">'+
          '<button class="secondary" data-act="add" data-r="'+esc(r)+'" data-c="'+esc(c)+'" data-s="'+esc(s)+'">+ Book</button>'+
          '<button class="secondary" data-act="renum" data-ids="'+books.map(b=>b.id).join(',')+'">Renumber</button></span></div><div class="spines">'+
          books.map(b=>{ const h = q && hay(b).includes(q); if(h) hit=true;
            return '<div class="sp" data-id="'+b.id+'" data-list="'+books.map(x=>x.id).join(',')+'"'+(h?' style="background:#fff1c2"':'')+'><span class="n">'+esc(b.position?sideText(b).replace(' from left',' L').replace(' from right',' R').replace('#',''):'–')+'</span><span>'+esc(b.title)+(b.loanedTo?' <span class="chip loan">'+esc(b.loanedTo)+'</span>':'')+(b.needsReview?' <span class="chip review">review</span>':'')+'</span><span class="a">'+esc(b.author||'')+'</span></div>'; }).join('')+
          '</div></div>';
      }).join('') + '</div>';
    }).join('');
    const open = openRooms.has(r) || rooms.length===1 || (q && hit);
    return '<details class="room" data-room="'+esc(r)+'"'+(open?' open':'')+'><summary><span>'+esc(r)+'</span><span class="note" style="margin:0 10px 0 auto;">'+count+' books</span></summary><div class="room-body">'+body+'</div></details>';
  }).join('');
}
$('shelf-tree').addEventListener('click', e=>{
  const btn = e.target.closest('button[data-act]');
  if(btn){
    if(btn.dataset.act==='add') openNew({ room:btn.dataset.r.startsWith('(')?'':btn.dataset.r, bookcase:btn.dataset.c.startsWith('(')?'':btn.dataset.c, shelf:btn.dataset.s.startsWith('(')?'':btn.dataset.s });
    if(btn.dataset.act==='renum'){
      // Books in a sideways stack share one slot (5a, 5b…) — keep them together and keep their letters.
      const ids = btn.dataset.ids.split(','); const now=Date.now(); let changed=0, slot=0, lastKey=null;
      ids.forEach((id,i)=>{ const b=byId(id); if(!b) return;
        const m = String(b.position||'').match(/^(\d+)\s*([a-z]*)$/i);
        const key = m && m[2] ? m[1] : 'solo'+i;
        if(key!==lastKey){ slot++; lastKey=key; }
        const np = String(slot) + (m && m[2] ? m[2].toLowerCase() : '');
        if(String(b.position)!==np){ b.position=np; b.updatedAt=now; changed++; } });
      if(changed){ commit(); toast('Renumbered '+changed+' book'+(changed===1?'':'s')); } else toast('Already numbered in order');
    }
    return;
  }
  const sp = e.target.closest('.sp'); if(sp) openBook(sp.dataset.id, sp.dataset.list.split(','));
});
$('s-room').addEventListener('change', renderShelves);
$('s-q').addEventListener('input', ()=>{ clearTimeout(renderShelves._t); renderShelves._t=setTimeout(renderShelves,150); });
