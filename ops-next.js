(()=>{
  const PAGE_SIZE=50;
  const DATAJUD_COOLDOWN_MS=6*60*60*1000;
  const selected=new Set();
  let page=1;
  let rowsCache=[];
  let applying=false;
  let lastSignature='';
  let refreshScheduled=false;

  const clean=v=>String(v??'').trim();
  const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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

  function datajudNews(){
    return rowsCache.filter(r=>r?.datajud?.hasNewMovement).sort((a,b)=>String(b.datajud?.result?.latestMovement?.dataHora||'').localeCompare(String(a.datajud?.result?.latestMovement?.dataHora||'')));
  }
  function addOpsHeader(){
    const content=document.querySelector('.content');
    if(!content)return;
    let strip=document.querySelector('#opsStrip');
    if(!strip){
      strip=document.createElement('div');strip.id='opsStrip';
      strip.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px';
      content.prepend(strip);
    }
    const news=datajudNews().length;
    const html=`<button class="btn secondary" data-ops="saved">Visões salvas</button><button class="btn secondary" data-ops="saveview">Salvar visão</button><button class="btn secondary" data-ops="smartdatajud">Radar inteligente</button><button class="btn ${news?'primary':'secondary'}" data-ops="datajudnews">Novidades DataJud${news?` (${news})`:''}</button><span id="opsSelection" style="font-size:11px;color:#6f7f79;margin-left:auto"></span>`;
    if(strip.innerHTML!==html)strip.innerHTML=html;
    updateSelectionCount();
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

  function lastDatajudSync(r){
    const raw=r?.datajud?.syncedAt||r?.datajud?.checkedAt||r?.datajud?.fetchedAt||'';
    const t=Date.parse(raw);return Number.isFinite(t)?t:0;
  }
  function shouldCheckDatajud(r){
    if(!clean(r.processo)||classify(r)==='Finalizado')return false;
    const st=norm(classify(r));
    const sensitive=/aguardando decis|conclus|aguardando gabinete|aguardando cart|aguardando manifest|aguardando exped|aguardando cumprimento|monitoramento|a diligenciar/.test(st);
    const overdue=Boolean(r.proximaData&&String(r.proximaData).slice(0,10)<=today());
    const score=risk(r),age=daysSince(r.atualizadoEm||r.dataSolicitacao);
    const cooled=Date.now()-lastDatajudSync(r)>=DATAJUD_COOLDOWN_MS;
    return overdue||score>=7||(cooled&&(sensitive||age===null||age>=7));
  }

  async function smartDataJud(){
    try{
      if(!rowsCache.length)await workspaceList();
      const candidates=rowsCache.filter(shouldCheckDatajud).map(r=>({r,score:risk(r),overdue:Boolean(r.proximaData&&r.proximaData<=today())})).sort((a,b)=>(b.overdue-a.overdue)||(b.score-a.score)||(lastDatajudSync(a.r)-lastDatajudSync(b.r))).slice(0,20);
      if(!candidates.length)return toast('Radar em dia. Nenhum processo precisa de nova consulta agora.');
      toast(`Consultando ${candidates.length} processo(s) prioritário(s)...`);
      const req=candidates.map(x=>({
        processo:x.r.processo,
        knownLatest:x.r.datajud?.result?.latestMovement?.dataHora||x.r.datajud?.latestMovement?.dataHora||'',
        knownKey:x.r.datajud?.result?.latestMovement?.chave||x.r.datajud?.latestKey||''
      }));
      const r=await fetch('/api/datajud',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({processos:req})});
      const d=await r.json();if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);
      const updates=(d.results||[]).filter(x=>x.ok).map(x=>{const rec=rowsCache.find(z=>z.processo===x.processo);return rec?{id:rec.id,datajud:{...x,syncedAt:new Date().toISOString()}}:null}).filter(Boolean);
      if(updates.length)await api('datajud.batchSave',{updates});
      await workspaceList();
      toast(`Radar concluído: ${d.changed||0} novidade(s)${d.urgent?` · ${d.urgent} urgente(s)`:''} em ${d.count||candidates.length} consulta(s).`);
      addOpsHeader();
      if(d.changed)showDataJudNews();
      document.querySelector('[data-action="reload"]')?.click();
    }catch(e){toast(e.message||'Falha no Radar DataJud.',true);}
  }

  function closeOpsModal(){document.querySelector('#opsNewsModal')?.remove();}
  function showDataJudNews(){
    const news=datajudNews();
    closeOpsModal();
    const modal=document.createElement('div');modal.id='opsNewsModal';
    modal.style.cssText='position:fixed;inset:0;z-index:9998;background:rgba(8,25,21,.42);display:grid;place-items:center;padding:24px';
    const cards=news.map(r=>{
      const dj=r.datajud||{},latest=dj.result?.latestMovement||{},ins=dj.result?.insight||{};
      return `<article style="border:1px solid #e1e8e5;border-radius:12px;padding:13px;background:#fff"><div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start"><div><b style="font-size:12px">${esc(ins.label||dj.latestLabel||'Movimentação nova')}</b><div style="font-size:10px;color:#6f7f79;margin-top:3px">${esc(r.cliente||'Sem cliente')} · ${esc(r.processo)}</div></div><span style="font-size:9px;font-weight:800;padding:5px 8px;border-radius:999px;background:${ins.level==='high'?'#faece9':'#fff3df'};color:${ins.level==='high'?'#a84940':'#976313'}">${esc(latest.categoria||dj.latestCategory||'movimentação')}</span></div><p style="font-size:11px;line-height:1.45;margin:10px 0 5px">${esc(latest.nome||'Movimentação processual')}</p><small style="color:#81908b">${latest.dataHora?new Date(latest.dataHora).toLocaleString('pt-BR'):'Data não informada'}</small><div style="margin-top:9px;padding:9px;background:#f7faf8;border-radius:9px;font-size:10px"><b>Sugestão:</b> ${esc(ins.suggestedAction||dj.suggestedAction||'Analisar a movimentação.')}</div><div style="display:flex;gap:7px;margin-top:10px"><button class="btn primary" data-row="${r.id}">Abrir processo</button>${(ins.suggestedStatus||dj.suggestedStatus)?`<button class="btn secondary" data-ops="applydatajud" data-id="${r.id}">Aplicar sugestão</button>`:''}</div></article>`;
    }).join('');
    modal.innerHTML=`<section style="width:min(860px,100%);max-height:85vh;overflow:auto;background:#f8faf9;border-radius:16px;box-shadow:0 24px 70px #0004"><header style="position:sticky;top:0;background:#fff;padding:16px 18px;border-bottom:1px solid #e1e8e5;display:flex;justify-content:space-between;align-items:center;z-index:1"><div><b style="font-size:15px">Novidades DataJud</b><div style="font-size:10px;color:#71817b;margin-top:3px">${news.length} processo(s) com movimentação nova identificada</div></div><button class="btn secondary" data-ops="closedjnews">Fechar</button></header><div style="padding:14px;display:grid;gap:10px">${cards||'<div style="padding:30px;text-align:center;color:#71817b">Nenhuma novidade do DataJud salva no momento.</div>'}</div></section>`;
    document.body.appendChild(modal);
  }

  async function applyDatajudSuggestion(id){
    const r=rowsCache.find(x=>String(x.id)===String(id));if(!r)return;
    const ins=r.datajud?.result?.insight||{};
    const status=ins.suggestedStatus||r.datajud?.suggestedStatus;
    const action=ins.suggestedAction||r.datajud?.suggestedAction;
    if(!status&&!action)return toast('Sem sugestão automática disponível.',true);
    try{
      await api('update',{record:{id:r.id,versao:r.versao,...(status?{status}:{}),...(action?{proximaAcao:action}:{})}});
      toast('Sugestão do DataJud aplicada.');
      closeOpsModal();await workspaceList();addOpsHeader();document.querySelector('[data-action="reload"]')?.click();
    }catch(e){toast(e.message||'Falha ao aplicar sugestão.',true);}
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
  document.addEventListener('click',e=>{
    const el=e.target?.closest?.('[data-ops]');if(!el)return;
    const a=el.dataset.ops;
    if(a==='prev'){page=Math.max(1,page-1);enhanceTable();}
    else if(a==='next'){page++;enhanceTable();}
    else if(a==='selectall'){document.querySelectorAll('.cases-table tbody tr[data-row]:not([hidden])').forEach(tr=>selected.add(String(tr.dataset.row)));enhanceTable();}
    else if(a==='clearselect'){selected.clear();enhanceTable();}
    else if(a==='applybulk')applyBulk();
    else if(a==='saveview')saveCurrentView();
    else if(a==='saved')showSavedViews();
    else if(a==='smartdatajud')smartDataJud();
    else if(a==='datajudnews')showDataJudNews();
    else if(a==='closedjnews')closeOpsModal();
    else if(a==='applydatajud')applyDatajudSuggestion(el.dataset.id);
  });

  const mo=new MutationObserver(mutations=>{
    if(!mutations.some(m=>m.target?.closest?.('#app')||m.target?.id==='app'))return;
    scheduleRefresh();
  });
  const app=document.querySelector('#app');if(app)mo.observe(app,{subtree:true,childList:true});
  window.addEventListener('load',async()=>{try{await workspaceList();}catch{}scheduleRefresh();},{once:true});
})();
