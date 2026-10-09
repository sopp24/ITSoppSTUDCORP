let DATA = null;

const state = {
  scale: 1, tx: 0, ty: 0,
  dragging: false, startX: 0, startY: 0, originTx: 0, originTy: 0,
  expanded: new Set(),
  selectedExample: null,
  pos: {},        // positions personnalisées des bulles déplacées (id -> {x,y})
  moved: false    // vrai si la bulle vient d'être glissée (évite le clic parasite)
};

const svg = document.getElementById("canvas");
const scene = document.getElementById("scene");
const linksLayer = document.getElementById("links");
const nodesLayer = document.getElementById("nodes");
const panel = document.getElementById("examplePanel");
const panelTitle = document.getElementById("exampleTitle");
const panelText = document.getElementById("exampleText");
const panelKicker = document.getElementById("exampleKicker");
const panelList = document.getElementById("exampleList");
const zoomReadout = document.getElementById("zoomReadout");

const NS = "http://www.w3.org/2000/svg";
const nodes = new Map(); // id -> {g, x, y}
let edges = [];          // [idParent, idEnfant, secondaire]
let tree = null;         // conteneur de l'affichage téléphone (créé à la demande)

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
  return el;
}

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

// Fond foncé -> texte blanc ; fond clair -> texte sombre
function isDark(hex){
  const c = [1,3,5].map(i=>{
    const v = parseInt(hex.substr(i,2),16)/255;
    return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4);
  });
  return .2126*c[0] + .7152*c[1] + .0722*c[2] < .3;
}

function applyTransform(){
  scene.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  zoomReadout.textContent = `${Math.round(state.scale*100)}%`;
}

function hideExample(){
  state.selectedExample = null;
  panel.classList.remove("open");
  markSelected();
}

function showExample(category, point){
  state.selectedExample = point;
  panelKicker.textContent = `${DATA.levels.center.label} › ${category.label}`;
  panelTitle.textContent = point.label;
  panelText.textContent = point.explication;
  panelList.replaceChildren();
  (point.exemples || []).forEach(ex=>{
    const li = document.createElement("li");
    if(typeof ex === "string"){
      li.textContent = ex;
    } else {
      const b = document.createElement("strong");
      b.textContent = ex.titre;
      li.appendChild(b);
      const ul = document.createElement("ul");
      (ex.lignes || []).forEach(l=>{
        const x = document.createElement("li");
        x.textContent = l;
        ul.appendChild(x);
      });
      li.appendChild(ul);
    }
    panelList.appendChild(li);
  });
  panel.classList.add("open");
  markSelected();
}

function makeNode({id,x,y,w,h,fill,stroke,label,meta,onClick,radius=14,center=false,drag=true,dark=false,link=null}){
  const p = state.pos[id];
  if(p){ x = p.x; y = p.y; }
  const g = svgEl("g",{class: center ? "node center" : "node", transform:`translate(${x} ${y})`});
  g.appendChild(svgEl("rect",{
    x:-w/2,y:-h/2,width:w,height:h,rx:radius,
    fill,stroke:stroke || fill,"stroke-width":center ? 3 : 2
  }));
  const t = svgEl("text",{
    x:0,y:meta ? -3 : 5,"text-anchor":"middle","class":"node-label",
    style:`fill:${dark ? "#fff" : "#1f3439"}`,"font-size": center ? 22 : 13
  });
  t.textContent = label;
  g.appendChild(t);
  if(meta){
    const m = svgEl("text",{x:0,y:15,"text-anchor":"middle",class:"node-meta",
      style:`fill:${dark ? "rgba(255,255,255,.85)" : "#6b7f84"}`});
    m.textContent = meta;
    g.appendChild(m);
  }
  if(link){
    // Bouton « Voir la maquette » posé à cheval sur le bord bas de la carte
    const by = h/2;
    const a = svgEl("a",{href:link,class:"node-link",role:"link","aria-label":`Voir la maquette de ${label}`});
    a.appendChild(svgEl("rect",{class:"pill",x:-82,y:by-14,width:164,height:28,rx:14}));
    a.appendChild(svgEl("rect",{class:"pill-ico",x:-68,y:by-7,width:9,height:14,rx:2.5}));
    const t = svgEl("text",{class:"pill-txt",x:-52,y:by+4}); t.textContent = "Voir la maquette";
    const ar = svgEl("text",{class:"pill-txt",x:63,y:by+4,"text-anchor":"middle"}); ar.textContent = "↗";
    a.append(t,ar);
    a.addEventListener("click", e=>e.stopPropagation());
    a.addEventListener("pointerdown", e=>e.stopPropagation());
    g.appendChild(a);
  }
  g.addEventListener("click", e=>{
    e.stopPropagation();
    if(state.moved){ state.moved = false; return; }
    onClick?.();
  });
  if(drag) g.addEventListener("pointerdown", e=>startNodeDrag(e,id));
  nodesLayer.appendChild(g);
  nodes.set(id,{g,x,y});
}

function addLink(x1,y1,x2,y2,secondary=false){
  const p = svgEl("path",{class:`link ${secondary ? "secondary":""}`});
  const dx = (x2-x1)*0.45;
  p.setAttribute("d",`M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`);
  linksLayer.appendChild(p);
}

function drawLinks(){
  linksLayer.replaceChildren();
  linksLayer.appendChild(svgEl("circle",{cx:900,cy:550,r:420,fill:"none",stroke:"#e5eeee","stroke-width":1,"stroke-dasharray":"4 10"}));
  edges.forEach(([a,b,s])=>{
    const A = nodes.get(a), B = nodes.get(b);
    if(A && B) addLink(A.x,A.y,B.x,B.y,s);
  });
}

function moveNode(id,dx,dy){
  const n = nodes.get(id);
  if(!n) return;
  n.x += dx; n.y += dy;
  n.g.setAttribute("transform",`translate(${n.x} ${n.y})`);
  state.pos[id] = {x:n.x,y:n.y};
}

// Glisser une bulle : elle entraîne ses sous-parties avec elle
function startNodeDrag(e,id){
  e.stopPropagation();
  state.moved = false;
  const sx = e.clientX, sy = e.clientY;
  let lx = sx, ly = sy;
  const move = ev=>{
    if(!state.moved && Math.hypot(ev.clientX-sx, ev.clientY-sy) < 4) return;
    state.moved = true;
    const r = svg.getBoundingClientRect();
    const u = Math.max(1800/r.width, 1100/r.height) / state.scale;
    const dx = (ev.clientX-lx)*u, dy = (ev.clientY-ly)*u;
    lx = ev.clientX; ly = ev.clientY;
    moveNode(id,dx,dy);
    nodes.forEach((n,k)=>{ if(k.startsWith(id+"/")) moveNode(k,dx,dy); });
    Object.keys(state.pos).forEach(k=>{
      if(k.startsWith(id+"/") && !nodes.has(k)){ state.pos[k].x += dx; state.pos[k].y += dy; }
    });
    drawLinks();
  };
  const up = ()=>{
    window.removeEventListener("pointermove",move);
    window.removeEventListener("pointerup",up);
    window.removeEventListener("pointercancel",up);
  };
  window.addEventListener("pointermove",move);
  window.addEventListener("pointerup",up);
  window.addEventListener("pointercancel",up);
}

function polar(radius, angle){
  return {x: Math.cos(angle)*radius, y: Math.sin(angle)*radius};
}

function render(){
  if(isPhone()){ renderTree(); return; }
  nodes.clear();
  edges = [];
  nodesLayer.replaceChildren();

  const W = 1800, H = 1100;
  const cx = W/2, cy = H/2;
  const catRadius = 325;
  const pointRadius = 210;

  // Niveau 0 : sujet central (non déplaçable)
  makeNode({
    id:"center",x:cx,y:cy,w:180,h:92,fill:"#2f6674",stroke:"#254f59",
    label:DATA.levels.center.label,meta:"concept central",center:true,radius:24,
    drag:false,dark:true,link:MAPS[current]?.mock,
    onClick:()=>{
      if(state.expanded.size === DATA.categories.length){
        state.expanded.clear();
      } else {
        DATA.categories.forEach(c=>state.expanded.add(c.id));
      }
      hideExample();
      render();
    }
  });

  DATA.categories.forEach((cat,i)=>{
    const angle = -Math.PI/2 + i*(Math.PI*2/DATA.categories.length);
    const cp = polar(catRadius, angle);
    const expanded = state.expanded.has(cat.id);

    // Niveau 1 : grandes parties
    makeNode({
      id:cat.id,x:cx+cp.x,y:cy+cp.y,w:175,h:52,fill:cat.color,stroke:cat.color,label:cat.label,
      meta: expanded ? "masquer" : "dérouler",radius:15,dark:isDark(cat.color),
      onClick:()=>{
        hideExample();
        expanded ? state.expanded.delete(cat.id) : state.expanded.add(cat.id);
        render();
      }
    });
    edges.push(["center",cat.id,false]);
    if(!expanded) return;

    // Niveau 2 : sous-parties (explication + exemples concrets dans le panneau)
    const me = nodes.get(cat.id);
    const points = cat.points || [];
    const spread = Math.min(2.2, 0.5 + points.length*0.3);
    points.forEach((point,j)=>{
      const key = `${cat.id}/${j}`;
      const offset = points.length === 1 ? 0 : (-spread/2 + spread*(j/(points.length-1)));
      const pp = polar(pointRadius, angle + offset);
      makeNode({
        id:key,x:me.x+pp.x,y:me.y+pp.y,w:170,h:46,fill:"#fff",stroke:cat.color,label:point.label,
        meta:"explication & exemples",radius:12,
        onClick:()=>showExample(cat,point)
      });
      edges.push([cat.id,key,true]);
    });
  });

  drawLinks();
  applyTransform();
}

/* =====================================================================
   Affichage téléphone
   Sur petit écran, la carte radiale est illisible : on la remplace par une
   arborescence verticale. Mêmes données, mêmes états (bulles ouvertes), même
   panneau d'explication (présenté en volet du bas). Sur ordinateur, rien ne change.
   ===================================================================== */
const mqPhone = window.matchMedia("(max-width:760px), (max-height:520px) and (pointer:coarse)");
const isPhone = () => mqPhone.matches;
const smooth = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

function syncMode(){ document.body.classList.toggle("m-mode", isPhone()); }

function mk(tag, cls, text){
  const el = document.createElement(tag);
  if(cls) el.className = cls;
  if(text != null) el.textContent = text;
  return el;
}

function ensureTree(){
  if(tree) return tree;
  tree = mk("div","m-tree");
  tree.setAttribute("aria-label","Carte mentale");
  document.querySelector(".stage").insertBefore(tree, panel);
  // toucher le fond ferme le volet
  tree.addEventListener("click", e=>{ if(!e.target.closest("button, a")) hideExample(); });
  return tree;
}

// Surligne la sous-partie ouverte et réserve la place du volet en bas de liste
function markSelected(){
  if(!tree) return;
  tree.querySelectorAll(".m-point").forEach(b=>b.classList.toggle("sel", b._point === state.selectedExample));
  tree.style.setProperty("--sheet", panel.classList.contains("open") ? panel.offsetHeight + "px" : "0px");
}

// Remonte la ligne choisie au-dessus du volet s'il la masque
function revealRow(row){
  requestAnimationFrame(()=>{
    const tr = tree.getBoundingClientRect(), rr = row.getBoundingClientRect();
    const limit = tr.bottom - panel.offsetHeight - 12;
    if(rr.bottom > limit || rr.top < tr.top + 8){
      const dy = rr.top - tr.top - 14;
      try{ tree.scrollBy({top:dy, behavior:smooth()}); }catch(_){ tree.scrollTop += dy; }
    }
  });
}

function buildCat(cat){
  const open = state.expanded.has(cat.id);
  const sec = mk("section","m-cat" + (open ? " open" : ""));
  sec.style.setProperty("--c", cat.color);

  const head = mk("button","m-cat-head " + (isDark(cat.color) ? "dark" : "light"));
  head.type = "button";
  head.setAttribute("aria-expanded", String(open));
  const txt = mk("span","m-cat-txt");
  txt.append(mk("span","m-cat-label",cat.label), mk("span","m-cat-meta", open ? "masquer" : "dérouler"));
  const chev = mk("span","m-chev");
  chev.setAttribute("aria-hidden","true");
  head.append(txt, chev);
  head.addEventListener("click", ()=>toggleCat(cat, sec));
  sec.appendChild(head);

  if(open){
    const ul = mk("ul","m-points");
    (cat.points || []).forEach(point=>{
      const li = mk("li");
      const b = mk("button","m-point");
      b.type = "button";
      b._point = point;
      if(state.selectedExample === point) b.classList.add("sel");
      const t = mk("span","m-point-txt");
      t.append(mk("span","m-point-label",point.label), mk("span","m-point-meta","explication & exemples"));
      const go = mk("span","m-go");
      go.setAttribute("aria-hidden","true");
      b.append(t, go);
      b.addEventListener("click", ()=>{
        showExample(cat, point);
        panel.scrollTop = 0;
        revealRow(b);
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
  }
  return sec;
}

// Déplier / replier une grande partie sans reconstruire toute la liste
function toggleCat(cat, sec){
  hideExample();
  state.expanded.has(cat.id) ? state.expanded.delete(cat.id) : state.expanded.add(cat.id);
  const fresh = buildCat(cat);
  sec.replaceWith(fresh);
  fresh.querySelector(".m-cat-head").focus({preventScroll:true});
  if(state.expanded.has(cat.id)) fresh.scrollIntoView({block:"nearest", behavior:smooth()});
}

function renderTree(){
  const t = ensureTree();
  const keep = t.dataset.map === current ? t.scrollTop : 0;
  t.dataset.map = current;
  t.replaceChildren();

  const wrap = mk("div","m-wrap");

  // Replier / Tout ouvrir : mêmes actions que les boutons de la barre du haut
  const bar = mk("div","m-bar");
  [["Replier","closeAll"],["Tout ouvrir","openAll"]].forEach(([txt,id])=>{
    const b = mk("button","m-bar-btn",txt);
    b.type = "button";
    b.addEventListener("click", ()=>document.getElementById(id).click());
    bar.appendChild(b);
  });
  wrap.appendChild(bar);

  // Niveau 0 : sujet central (toucher = tout déplier / tout replier, comme sur la carte)
  const center = mk("div","m-center");
  const main = mk("button","m-center-main");
  main.type = "button";
  main.setAttribute("aria-label", `${DATA.levels.center.label} : tout déplier ou replier`);
  main.append(mk("span","m-center-label",DATA.levels.center.label), mk("span","m-center-meta","concept central"));
  main.addEventListener("click", ()=>{
    if(state.expanded.size === DATA.categories.length){
      state.expanded.clear();
    } else {
      DATA.categories.forEach(c=>state.expanded.add(c.id));
    }
    hideExample();
    render();
  });
  center.appendChild(main);
  const href = MAPS[current]?.mock;
  if(href){
    const a = mk("a","m-link");
    a.href = href;
    a.setAttribute("aria-label",`Voir la maquette de ${DATA.levels.center.label}`);
    const ico = mk("span","m-ico");
    ico.setAttribute("aria-hidden","true");
    a.append(ico, mk("span","m-link-txt","Voir la maquette"), mk("span","m-arrow","↗"));
    center.appendChild(a);
  }
  wrap.appendChild(center);

  // Niveaux 1 et 2 : grandes parties, puis sous-parties
  const list = mk("div","m-cats");
  DATA.categories.forEach(cat=>list.appendChild(buildCat(cat)));
  wrap.appendChild(list);

  t.appendChild(wrap);
  t.scrollTop = keep;
  markSelected();
}

syncMode();
const onModeChange = ()=>{ syncMode(); hideExample(); if(DATA) render(); };
if(mqPhone.addEventListener) mqPhone.addEventListener("change", onModeChange);
else mqPhone.addListener(onModeChange);

function fitToView(){
  state.scale = 1;
  state.tx = 0;
  state.ty = 0;
  applyTransform();
}

svg.addEventListener("wheel", e=>{
  e.preventDefault();
  const rect = svg.getBoundingClientRect();
  const mx = (e.clientX-rect.left) * (1800/rect.width);
  const my = (e.clientY-rect.top) * (1100/rect.height);
  const old = state.scale;
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const next = clamp(old*factor,0.45,2.6);
  const k = next/old;
  state.tx = mx - (mx-state.tx)*k;
  state.ty = my - (my-state.ty)*k;
  state.scale = next;
  applyTransform();
},{passive:false});

svg.addEventListener("pointerdown", e=>{
  if(e.target.closest(".node")) return;
  state.dragging = true;
  svg.classList.add("dragging");
  state.startX = e.clientX;
  state.startY = e.clientY;
  state.originTx = state.tx;
  state.originTy = state.ty;
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener("pointermove", e=>{
  if(!state.dragging) return;
  const rect = svg.getBoundingClientRect();
  const factorX = 1800/rect.width;
  const factorY = 1100/rect.height;
  state.tx = state.originTx + (e.clientX-state.startX)*factorX;
  state.ty = state.originTy + (e.clientY-state.startY)*factorY;
  applyTransform();
});

svg.addEventListener("pointerup", e=>{
  state.dragging = false;
  svg.classList.remove("dragging");
  try{svg.releasePointerCapture(e.pointerId)}catch(_){}
});

svg.addEventListener("click", e=>{
  if(!e.target.closest(".node")) hideExample();
});

document.getElementById("zoomIn").addEventListener("click",()=>{
  state.scale=clamp(state.scale*1.15,0.45,2.6); applyTransform();
});
document.getElementById("zoomOut").addEventListener("click",()=>{
  state.scale=clamp(state.scale/1.15,0.45,2.6); applyTransform();
});
document.getElementById("reset").addEventListener("click",()=>{
  hideExample();
  state.expanded.clear();
  state.pos = {};
  fitToView();
  render();
});
document.getElementById("openAll").addEventListener("click",()=>{
  DATA.categories.forEach(c=>state.expanded.add(c.id));
  hideExample();
  render();
});
document.getElementById("closeAll").addEventListener("click",()=>{
  state.expanded.clear();
  hideExample();
  render();
});

const MAPS = {
  ecostud:{file:"data.json",mock:"maquette-ecostud.html",logo:"E",title:"EcoSTUD — carte mentale",
    subtitle:"Budget & assistant de décision pour la mobilité internationale étudiante",doc:"EcoSTUD — Carte mentale interactive"},
  medistud:{file:"medistud.json",mock:"maquette-medistud.html",logo:"M",title:"MediSTUD — carte mentale",
    subtitle:"Carnet de santé & assistant médical pour la mobilité internationale étudiante",doc:"MediSTUD — Carte mentale interactive"}
};
const cache = {};   // clé -> données chargées
const views = {};   // clé -> état de la vue (zoom, bulles ouvertes, positions)
let current = null;

async function loadMap(key){
  const cfg = MAPS[key];
  try{
    if(!cache[key]){
      const r = await fetch(cfg.file);
      if(!r.ok) throw new Error(r.status);
      cache[key] = await r.json();
    }
  }catch(err){
    panelKicker.textContent="Erreur";
    panelTitle.textContent=`Impossible de charger ${cfg.file}`;
    panelText.textContent=`Vérifie que ${cfg.file} est bien dans le même dossier que index.html sur GitHub Pages.`;
    panelList.replaceChildren();
    panel.classList.add("open");
    console.error(err);
    return;
  }
  if(current) views[current] = {scale:state.scale,tx:state.tx,ty:state.ty,expanded:state.expanded,pos:state.pos};
  hideExample();
  current = key;
  DATA = cache[key];
  Object.assign(state, views[key] || {scale:1,tx:0,ty:0,expanded:new Set(),pos:{}});
  document.getElementById("mapLogo").textContent = cfg.logo;
  document.getElementById("mapTitle").textContent = cfg.title;
  document.getElementById("mapSubtitle").textContent = cfg.subtitle;
  document.title = cfg.doc;
  document.querySelectorAll(".tab").forEach(t=>{
    const on = t.dataset.map === key;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  });
  render();
}

document.querySelectorAll(".tab").forEach(t=>{
  t.addEventListener("click",()=>{ if(t.dataset.map !== current) loadMap(t.dataset.map); });
});

loadMap("ecostud");
