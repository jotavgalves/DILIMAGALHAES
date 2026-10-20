(()=>{
  const PAGE_SIZE=50;
  const selected=new Set();
  let page=1;
  let rowsCache=[];
  let applying=false;
  let lastSignature='';
  let refreshScheduled=false;

  const clean=v=>String(v??'').trim();
  const norm=s=>clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const today=()=>new Date().toISOString().slice(0,10);
  const daysSince=v=>{
    if(!v)return null;
    const d=new Date(`${String(v).slice(0,10)}T12:00:00`);
    if(Number.isNaN(d.getTime()))return null;
    return Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
  };
  const classify=r=>clean(r.status)||'A diligenciar';
  const risk=r=>{
    let score=0;
    const age=daysSince(r.atualizadoEm||r.dataSolicitacao);
    const p=norm(r.prioridade);
    if(p==='urgente')score+=4; else if(p==='alta')score+=2;
    if(r.proximaData&&String(r.proximaData).slice(0,10)<=today())score+=3;
    if(age!==null){if(age>=30)score+=3;else if(age>=15)score+=2;else if(age>=7)score+=1;}
    if(!clean(r.proximaAcao)&&classify(r)!=='Finalizado')score+=2;
    if(!clean(r.responsavel))score+=1;
    if(classify(r)==='A diligenciar')score+=1;
    return Math.min(10,score);
  };

  async function api(action,payload={}){
    const r=await fetch('/api/sheets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...payload})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);
    return d;
  }
  async function workspaceList(){
    const r=await fetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'list'})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);
    rowsCache=Array.isArray(d.rows)?d.rows:[];
    return rowsCache;
  }

  function toast(msg,error=false){
    let t=document.querySelector('#opsToast');
    if(!t){t=document.createElement('div');t.id='opsToast';t.style.cssText='position:fixed;right:22px;bottom:22px;z-index:9999;padding:12px 14px;border-radius:10px;background:#103d35;color:#fff;font:600 12px system-ui;box-shadow:0 10px 30px #0003;max-width:360px';document.body.appendChild(t);}
    t.style.background=error?'#8f312b':'#103d35';t.textContent=msg;t.hidden=false;clearTimeout(t._timer);t._timer=setTimeout(()=>t.hidden=true,3200);
  }

  function addOpsHeader(){
    const content=document.querySelector('.content');
    if(!content||document.querySelector('#opsStrip'))return;
    const strip=document.createElement('div');strip.id='opsStrip';
    strip.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px';
    strip.innerHTML='<button class="btn secondary" data-ops="saved">Visões salvas</button><button class="btn secondary" data-ops="saveview">Salvar visão</button><button class="btn secondary" data-ops="smartdatajud">Radar inteligente</button><span id="opsSelection" style="font-size:11px;color:#6f7f79;margin-left:auto"></span>';
    content.prepend(strip);
  }

  function savedViews(){try{return JSON.parse(localStorage.getItem('dili.savedViews')||'[]')}catch{return[]}}
  function saveViews(v){localStorage.setItem('dili.savedViews',JSON.stringify(v.slice(0,12)));}
  function saveCurrentView(){
    const name=prompt('Nome desta visão:');if(!clean(name))return;
    const view={name:clean(name),q:document.querySelector('#globalSearch')?.value||'',status:document.querySelector('#statusFilter')?.value||'Todos',priority:document.querySelector('#priorityFilter')?.value||'Todas',owner:document.querySelector('#ownerFilter')?.value||'Todos',client:document.querySelector('#clientFilter')?.value||'Todos',sort:document.querySelector('#sortFilter')?.value||'risk'};
    const list=savedViews().filter(x=>x.name!==view.name);list.unshift(view);saveViews(list);toast('Visão salva.');
  }
  function showSavedViews(){
    const list=savedViews();
    if(!list.length){toast('Nenhuma visão salva ainda.');return;}
    const names=list.map((x,i)=>`${i+1}. ${x.name}`).join('\n');
    const n=Number(prompt(`Escolha uma visão:\n${names}`));
    const v=list[n-1];if(!v)return;
    const set=(sel,val)=>{const el=document.querySelector(sel);if(!el)return;el.value=val;el.dispatchEvent(new Event(el.tagName==='INPUT'?'input':'change',{bubbles:true}));};
    set('#globalSearch',v.q);set('#statusFilter',v.status);set('#priorityFilter',v.priority);set('#ownerFilter',v.owner);set('#clientFilter',v.client);set('#sortFilter',v.sort);
  }

  function ensureBulkToolbar(){
    const wrap=document.querySelector('.table-wrap');
    const table=wrap?.querySelector('.cases-table');
    if(!wrap||!table||wrap.previousElementSibling?.classList?.contains('ops-bulk'))return;
    const bar=document.createElement('div');bar.className='ops-bulk';
    bar.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid #edf2ef;background:#fbfcfc';
    bar.innerHTML='<button class="btn secondary" data-ops="selectall">Selecionar página</button><button class="btn secondary" data-ops="clearselect">Limpar seleção</button><select data-ops-field style="height:36px;border:1px solid #dfe7e3;border-radius:9px;padding:0 9px"><option value="">Ação em massa...</option><option value="status">Alterar status</option><option value="prioridade">Alterar prioridade</option><option value="responsavel">Alterar responsável</option><option value="proximaData">Definir próxima verificação</option></select><button class="btn primary" data-ops="applybulk">Aplicar</button><span class="ops-count" style="font-size:11px;color:#6f7f79;margin-left:auto"></span>';
    wrap.parentNode.insertBefore(bar,wrap);
  }

  function enhanceTable(){
    const table=document.querySelector('.cases-table');if(!table)return;
    const tbody=table.tBodies?.[0];if(!tbody)return;
    const all=[...tbody.querySelectorAll('tr[data-row]')];
    const sig=all.map(r=>r.dataset.row).join(',');
    if(sig!==lastSignature){page=1;selected.clear();lastSignature=sig;}
    const total=all.length,pages=Math.max(1,Math.ceil(total/PAGE_SIZE));page=Math.min(page,pages);
    all.forEach((tr,i)=>{
      let td=tr.querySelector('td.ops-check');
      if(!td){td=document.createElement('td');td.className='ops-check';td.innerHTML=`<input type="checkbox" data-ops-check="${tr.dataset.row}" aria-label="Selecionar processo">`;tr.insertBefore(td,tr.firstChild);}
      const input=td.querySelector('input'),checked=selected.has(String(tr.dataset.row));
      if(input.checked!==checked)input.checked=checked;
      const shouldHide=!(i>=(page-1)*PAGE_SIZE&&i<page*PAGE_SIZE);
      if(tr.hidden!==shouldHide)tr.hidden=shouldHide;
      const rec=rowsCache.find(r=>String(r.id)===String(tr.dataset.row));
      if(rec){const pill=tr.querySelector('.risk-pill');if(pill){const v=String(risk(rec));if(pill.textContent!==v)pill.textContent=v;const title=daysSince(rec.atualizadoEm||rec.dataSolicitacao)===null?'Sem data de atualização: idade não pontua no risco':'Risco recalculado sem penalizar ausência de data';if(pill.title!==title)pill.title=title;}}
    });
    const head=table.tHead?.rows?.[0];if(head&&!head.querySelector('th.ops-check-head')){const th=document.createElement('th');th.className='ops-check-head';th.textContent='';head.insertBefore(th,head.firstChild);}
    let pager=table.parentNode.querySelector('.ops-pager');if(!pager){pager=document.createElement('div');pager.className='ops-pager';pager.style.cssText='display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #edf2ef';table.parentNode.appendChild(pager);}
    const pagerHtml=`<button class="btn secondary" data-ops="prev" ${page<=1?'disabled':''}>Anterior</button><span style="font-size:11px;color:#6f7f79">Página ${page} de ${pages} · ${total} registros</span><button class="btn secondary" data-ops="next" ${page>=pages?'disabled':''}>Próxima</button>`;
    if(pager.innerHTML!==pagerHtml)pager.innerHTML=pagerHtml;
    ensureBulkToolbar();updateSelectionCount();
  }

  function updateSelectionCount(){
    const text=selected.size?`${selected.size} selecionado(s)`:'';
    document.querySelectorAll('.ops-count,#opsSelection').forEach(el=>{if(el.textContent!==text)el.textContent=text;});
  }

  async function applyBulk(){
    if(applying||!selected.size)return toast('Selecione ao menos um processo.',true);
    const field=document.querySelector('[data-ops-field]')?.value;if(!field)return toast('Escolha a ação em massa.',true);
    let value='';
    if(field==='status')value=prompt('Novo status:')||'';
    else if(field==='prioridade')value=prompt('Nova prioridade (Normal, Alta ou Urgente):')||'';
    else if(field==='responsavel')value=prompt('Novo responsável:')||'';
    else if(field==='proximaData')value=prompt('Nova data (AAAA-MM-DD):')||'';
    if(!clean(value))return;
    applying=true;toast(`Atualizando ${selected.size} processo(s)...`);
    try{
      if(!rowsCache.length)await workspaceList();
      let ok=0,fail=0;
      for(const id of [...selected]){
        const r=rowsCache.find(x=>String(x.id)===String(id));if(!r){fail++;continue;}
        try{await api('update',{record:{id:r.id,versao:r.versao,[field]:value}});ok++;r[field]=value;r.versao=Number(r.versao||1)+1;}catch{fail++;}
      }
      selected.clear();toast(`${ok} atualizado(s)${fail?` · ${fail} falha(s)`:''}`,!!fail);
      document.querySelector('[data-action="reload"]')?.click();
    }finally{applying=false;}
  }

  async function smartDataJud(){
    try{
      if(!rowsCache.length)await workspaceList();
      const candidates=rowsCache.filter(r=>clean(r.processo)&&classify(r)!=='Finalizado').map(r=>({r,score:risk(r),age:daysSince(r.atualizadoEm||r.dataSolicitacao)})).filter(x=>x.score>=5||x.age===null||x.age>=7||x.r.proximaData<=today()).sort((a,b)=>b.score-a.score).slice(0,20);
      if(!candidates.length)return toast('Nenhum processo prioritário para consultar agora.');
      toast(`Consultando ${candidates.length} processo(s) prioritário(s)...`);
      const req=candidates.map(x=>({processo:x.r.processo,knownLatest:x.r.datajud?.result?.latestMovement?.dataHora||x.r.datajud?.latestMovement?.dataHora||''}));
      const r=await fetch('/api/datajud',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({processos:req})});const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);
      const updates=(d.results||[]).filter(x=>x.ok).map(x=>{const rec=rowsCache.find(z=>z.processo===x.processo);return rec?{id:rec.id,datajud:{...x,previousLatest:rec.datajud?.result?.latestMovement?.dataHora||'',syncedAt:new Date().toISOString()}}:null}).filter(Boolean);
      if(updates.length)await api('datajud.batchSave',{updates});
      toast(`Radar concluído: ${d.changed||0} novidade(s) em ${d.count||candidates.length} consulta(s).`);
      document.querySelector('[data-action="reload"]')?.click();
    }catch(e){toast(e.message||'Falha no Radar DataJud.',true);}
  }

  function refresh(){
    addOpsHeader();
    if(document.querySelector('.cases-table'))enhanceTable();
  }
  function scheduleRefresh(){
    if(refreshScheduled)return;
    refreshScheduled=true;
    requestAnimationFrame(()=>{refreshScheduled=false;refresh();});
  }

  document.addEventListener('change',e=>{const c=e.target?.closest?.('[data-ops-check]');if(!c)return;const id=String(c.dataset.opsCheck);c.checked?selected.add(id):selected.delete(id);updateSelectionCount();});
  document.addEventListener('click',e=>{const el=e.target?.closest?.('[data-ops]');if(!el)return;const a=el.dataset.ops;if(a==='prev'){page=Math.max(1,page-1);enhanceTable();}else if(a==='next'){page++;enhanceTable();}else if(a==='selectall'){document.querySelectorAll('.cases-table tbody tr[data-row]:not([hidden])').forEach(tr=>selected.add(String(tr.dataset.row)));enhanceTable();}else if(a==='clearselect'){selected.clear();enhanceTable();}else if(a==='applybulk')applyBulk();else if(a==='saveview')saveCurrentView();else if(a==='saved')showSavedViews();else if(a==='smartdatajud')smartDataJud();});

  const mo=new MutationObserver(mutations=>{
    if(!mutations.some(m=>m.target?.closest?.('#app')||m.target?.id==='app'))return;
    scheduleRefresh();
  });
  const app=document.querySelector('#app');if(app)mo.observe(app,{subtree:true,childList:true});
  window.addEventListener('load',async()=>{try{await workspaceList();}catch{}scheduleRefresh();},{once:true});
})();
