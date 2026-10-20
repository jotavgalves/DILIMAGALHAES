(()=>{
  const nativeFetch=window.fetch.bind(window);
  const LIST_KEY='dili.rows.cache.v2';
  const LIST_TTL=20000;
  let busy=false;
  const parseBody=init=>{try{return JSON.parse(init?.body||'{}')}catch{return{}}};
  const getCache=()=>{try{return JSON.parse(localStorage.getItem(LIST_KEY)||'null')}catch{return null}};
  const setCache=data=>{try{localStorage.setItem(LIST_KEY,JSON.stringify({at:Date.now(),data}))}catch{}};
  const clearCache=()=>{try{localStorage.removeItem(LIST_KEY)}catch{}};
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:(input?.url||'');
    if(url.includes('/api/sheets')&&String(init.method||'GET').toUpperCase()==='POST'){
      const body=parseBody(init);
      if(body.action==='list'){
        const c=getCache();
        if(c?.data?.rows&&Date.now()-c.at<LIST_TTL){
          return new Response(JSON.stringify({...c.data,clientCached:true}),{status:200,headers:{'content-type':'application/json'}});
        }
        const r=await nativeFetch(input,init);
        try{const d=await r.clone().json();if(r.ok&&Array.isArray(d.rows))setCache(d)}catch{}
        return r;
      }
      clearCache();
    }
    return nativeFetch(input,init);
  };

  function css(){if(document.getElementById('dili-fast-css'))return;const s=document.createElement('style');s.id='dili-fast-css';s.textContent=`
  .dj-radar-btn{background:#eef6f3!important;color:#174f43!important;border-color:#cfe0da!important}
  .dj-radar-overlay{position:fixed;inset:0;z-index:9999;background:rgba(7,24,20,.48);backdrop-filter:blur(5px);display:grid;place-items:center;padding:24px}
  .dj-radar{width:min(980px,96vw);max-height:90vh;overflow:auto;background:#f7faf9;border:1px solid #dbe6e2;border-radius:18px;box-shadow:0 30px 100px rgba(0,0,0,.25)}
  .dj-radar-head{position:sticky;top:0;z-index:2;background:rgba(255,255,255,.96);backdrop-filter:blur(16px);padding:18px 20px;border-bottom:1px solid #e5ece9;display:flex;justify-content:space-between;gap:16px;align-items:flex-start}
  .dj-radar-head small{display:block;font-size:10px;letter-spacing:.11em;color:#7d8c87;font-weight:800}.dj-radar-head h2{margin:4px 0 3px;font:800 22px Manrope,system-ui}.dj-radar-head p{margin:0;font-size:12px;color:#6f7f79}
  .dj-radar-close{width:36px;height:36px;border:1px solid #dbe5e1;border-radius:10px;background:#fff;cursor:pointer;font-size:20px}
  .dj-radar-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:16px 20px}.dj-radar-summary div{background:#fff;border:1px solid #e1e9e6;border-radius:12px;padding:13px}.dj-radar-summary b{display:block;font:800 24px Manrope}.dj-radar-summary span{font-size:10px;color:#75857f}
  .dj-radar-list{padding:0 20px 20px;display:flex;flex-direction:column;gap:9px}.dj-item{background:#fff;border:1px solid #e1e9e6;border-radius:13px;padding:14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px}.dj-item.new{border-left:4px solid #b84e43}.dj-item h3{font-size:13px;margin:0}.dj-item .cnj{font-size:10px;color:#557169;margin-top:2px}.dj-move{font-size:12px;font-weight:700;margin:9px 0 3px}.dj-date{font-size:10px;color:#7e8d88}.dj-suggest{margin-top:9px;padding:9px 10px;background:#f3f7f5;border-radius:9px;font-size:11px;color:#405a52}.dj-badge{align-self:start;border-radius:999px;padding:6px 9px;font-size:9px;font-weight:800;background:#edf3f1;color:#456159;white-space:nowrap}.dj-badge.new{background:#faeae7;color:#a84238}.dj-radar-actions{padding:0 20px 20px;display:flex;justify-content:flex-end;gap:8px}.dj-radar-actions button{border:1px solid #d8e3df;background:#fff;border-radius:10px;padding:10px 13px;font-weight:750;cursor:pointer}.dj-radar-actions .primary{background:#103f35;color:#fff;border-color:#103f35}
  .dj-toast{position:fixed;right:20px;bottom:20px;z-index:10000;background:#123f35;color:white;padding:11px 14px;border-radius:10px;box-shadow:0 12px 35px rgba(0,0,0,.22);font-size:11px;font-weight:700}
  @media(max-width:700px){.dj-radar-summary{grid-template-columns:1fr 1fr}.dj-item{grid-template-columns:1fr}.dj-radar-overlay{padding:8px}}
  `;document.head.appendChild(s)}
  function toast(t){css();const d=document.createElement('div');d.className='dj-toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
  function cachedRows(){const c=getCache();return c?.data?.rows||[]}
  function knownLatest(r){return r?.datajud?.result?.latestMovement?.dataHora||r?.datajud?.result?.movimentos?.[0]?.dataHora||''}
  function activeRows(rows){return rows.filter(r=>r?.processo&&!/finaliz|arquivad|baixad|encerrad/i.test(`${r.status||''} ${r.obs||''}`)).slice(0,40)}
  function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}
  function esc(s=''){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  async function getRows(){let rows=cachedRows();if(rows.length)return rows;const r=await nativeFetch('/api/sheets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'list'})});const d=await r.json();if(!r.ok||!Array.isArray(d.rows))throw new Error(d.error||'Não foi possível carregar os processos.');setCache(d);return d.rows}
  async function runRadar(persist=true){
    if(busy)return;busy=true;toast('Consultando DataJud em lote…');
    try{
      const rows=activeRows(await getRows());
      const payload=rows.map(r=>({processo:r.processo,knownLatest:knownLatest(r)}));
      const rr=await nativeFetch('/api/datajud',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({processos:payload})});
      const d=await rr.json();if(!rr.ok||!d.ok)throw new Error(d.error||'Falha no DataJud.');
      if(persist){
        const updates=d.results.filter(x=>x?.found).map(x=>{const row=rows.find(r=>r.processo===x.processo);return{id:row?.id,processo:x.processo,datajud:{...x,syncedAt:new Date().toISOString()}}}).filter(x=>x.id);
        if(updates.length){await nativeFetch('/api/sheets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'datajud.batchSave',actor:'Radar DataJud',updates})});clearCache()}
      }
      showRadar(d,rows);
    }catch(e){toast(e.message||'Falha ao consultar DataJud.')}finally{busy=false}
  }
  function showRadar(d,rows){css();document.querySelector('.dj-radar-overlay')?.remove();const map=new Map(rows.map(r=>[r.processo,r]));const sorted=[...(d.results||[])].sort((a,b)=>Number(b.hasNewMovement)-Number(a.hasNewMovement));const html=sorted.map(x=>{const r=map.get(x.processo)||{},m=x.result?.latestMovement,ins=x.result?.insight;return `<article class="dj-item ${x.hasNewMovement?'new':''}"><div><h3>${esc(r.cliente||'Sem cliente')}</h3><div class="cnj">${esc(x.processo)}</div><div class="dj-move">${esc(m?.nome||x.error||'Nenhuma movimentação encontrada')}</div><div class="dj-date">${esc(fmtDate(m?.dataHora))}${x.result?.orgaoJulgador?.nome?` · ${esc(x.result.orgaoJulgador.nome)}`:''}</div>${ins?`<div class="dj-suggest"><b>${esc(ins.label)}</b><br>${esc(ins.suggestedAction)}</div>`:''}</div><span class="dj-badge ${x.hasNewMovement?'new':''}">${x.hasNewMovement?'NOVO MOVIMENTO':x.found?'SEM NOVIDADE':'SEM RETORNO'}</span></article>`}).join('');const el=document.createElement('div');el.className='dj-radar-overlay';el.innerHTML=`<section class="dj-radar"><header class="dj-radar-head"><div><small>CNJ · DATAJUD</small><h2>Radar processual</h2><p>Compara a última movimentação pública do CNJ com a última sincronização salva no sistema.</p></div><button class="dj-radar-close">×</button></header><div class="dj-radar-summary"><div><b>${d.count||0}</b><span>consultados</span></div><div><b>${d.changed||0}</b><span>com movimento novo</span></div><div><b>${d.found||0}</b><span>localizados</span></div><div><b>${d.failed||0}</b><span>falhas</span></div></div><div class="dj-radar-list">${html||'<p>Nenhum resultado.</p>'}</div><footer class="dj-radar-actions"><button data-close-radar>Fechar</button><button class="primary" data-refresh-app>Atualizar painel</button></footer></section>`;document.body.appendChild(el);el.querySelector('.dj-radar-close').onclick=()=>el.remove();el.querySelector('[data-close-radar]').onclick=()=>el.remove();el.querySelector('[data-refresh-app]').onclick=()=>{clearCache();location.reload()};el.addEventListener('click',e=>{if(e.target===el)el.remove()})}
  function inject(){css();const sync=document.querySelector('[data-action="syncdatajud"]');if(sync&&!document.querySelector('[data-fast-datajud]')){const b=document.createElement('button');b.className='btn secondary dj-radar-btn';b.dataset.fastDatajud='1';b.textContent='Radar DataJud';sync.parentElement?.insertBefore(b,sync.nextSibling)}}
  document.addEventListener('click',e=>{const sync=e.target.closest('[data-action="syncdatajud"]');const radar=e.target.closest('[data-fast-datajud]');if(sync){e.preventDefault();e.stopImmediatePropagation();runRadar(true);return}if(radar){e.preventDefault();runRadar(false)}},true);
  new MutationObserver(inject).observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',inject);else inject();
})();
