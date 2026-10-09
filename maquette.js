const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
function toast(t){const e=$('.toast');e.textContent=t;e.classList.add('on');clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove('on'),2400)}
function sheet(id){$$('.sheet').forEach(s=>s.classList.remove('on'));if(id)$('#'+id).classList.add('on')}
$$('.nav button').forEach(b=>b.onclick=()=>{$$('.nav button,.screen').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.s).classList.add('on');sheet()});
