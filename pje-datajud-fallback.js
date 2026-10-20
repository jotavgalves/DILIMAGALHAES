(()=>{
  const clean=v=>String(v??'').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let running=false,lastProcess='',lastData=null,timer=null;

  const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR');};
  function isTlsFailure(){const modal=document.querySelector('#pjeMniModal');if(!modal)return false;const t=modal.innerText||'';return /HTTP\s*526|Falha TLS\/SSL|TLS_ORIGIN/i.test(t);}
  function inputProcess(){return clean(document.querySelector('#pjeMniProcess')?.value);}
  function box(){
    let el=document.querySelector('#pjeDatajudFallback');
    if(el)return el;
    const host=document.querySelector('#pjeMniResult');
    if(!host)return null;
    el=document.createElement('section');el.id='pjeDatajudFallback';
    el.style.cssText='margin-top:12px;border:1px solid #d7e4df;border-radius:13px;background:#f7fbf9;padding:14px';
    host.appendChild(el);return el;
  }
  function renderLoading(){const el=box();if(el)el.innerHTML='<b style="font-size:12px">Fallback DataJud</b><div style="font-size:10px;color:#6c7c75;margin-top:5px">O MNI/TJPE falhou no TLS. Consultando automaticamente a API pública do DataJud...</div>';}
  function renderError(msg){const el=box();if(el)el.innerHTML=`<b style="font-size:12px">Fallback DataJud indisponível</b><div style="font-size:10px;color:#8d443c;margin-top:5px">${esc(msg||'Falha ao consultar o DataJud.')}</div>`;}
  function renderData(d){
    const el=box();if(!el)return;
    const r=d?.result||{},m=r.latestMovement||{};
    const degree=r.grauNormalizado||r.grau||'Não informado';
    const found=d?.found!==false&&d?.ok;
    if(!found){el.innerHTML='<b style="font-size:12px">Fallback DataJud</b><div style="font-size:10px;color:#6c7c75;margin-top:5px">Processo não localizado no DataJud.</div>';return;}
    el.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b style="font-size:12px">Fallback automático · DataJud/CNJ</b><div style="font-size:10px;color:#6c7c75;margin-top:3px">MNI indisponível por TLS; dados públicos usados como contingência.</div></div><span style="font-size:9px;font-weight:800;padding:5px 8px;border-radius:999px;background:#e6f4ee;color:#28634f">ATIVO</span></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:11px;font-size:11px"><div><b>Grau:</b> ${esc(degree)}</div><div><b>Órgão:</b> ${esc(r.orgaoJulgador?.nome||r.orgaoJulgador||'—')}</div><div><b>Classe:</b> ${esc(r.classe?.nome||r.classe||'—')}</div><div><b>Última movimentação:</b> ${esc(m.nome||m.descricao||'—')}</div></div><div style="font-size:10px;color:#6c7c75;margin-top:8px">Data da movimentação: ${esc(fmt(m.dataHora))} · Consulta: ${esc(fmt(d.fetchedAt))}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn secondary" data-pje-fallback-save>Salvar DataJud no processo/planilha</button><button class="btn secondary" data-pje-fallback-retry>Reconsultar DataJud</button></div>`;
  }
  async function query(force=false){
    const processo=inputProcess();if(!processo||!/\.8\.17\./.test(processo)||running)return;
    if(!force&&processo===lastProcess&&lastData)return renderData(lastData);
    running=true;lastProcess=processo;renderLoading();
    try{const r=await fetch('/api/datajud',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({processo,force})});const d=await r.json().catch(()=>({}));if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);lastData=d;renderData(d);}catch(e){renderError(e.message);}finally{running=false;}
  }
  async function save(){if(!lastData?.ok||!lastData?.found)return;try{const processo=lastData.processo||lastProcess;const payload={...lastData,hasNewMovement:Boolean(lastData.hasNewMovement),movedToSecondDegree:Boolean(lastData.movedToSecondDegree),firstSeenSecondDegree:Boolean(lastData.firstSeenSecondDegree)};const r=await fetch('/api/datajud-persist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({actor:'Fallback DataJud · PJe MNI',updates:[{processo,datajud:payload}]})});const d=await r.json().catch(()=>({}));if(!r.ok||d.error)throw new Error(d.error||`HTTP ${r.status}`);const b=document.querySelector('[data-pje-fallback-save]');if(b){b.textContent='Salvo no processo/planilha';b.disabled=true;}}catch(e){renderError(`Consulta obtida, mas não foi possível salvar: ${e.message}`);}}
  function maybe(){clearTimeout(timer);timer=setTimeout(()=>{if(isTlsFailure())query(false);},350);}
  document.addEventListener('click',e=>{if(e.target.closest('[data-pje-query],[data-pje-selected]'))setTimeout(maybe,450);if(e.target.closest('[data-pje-fallback-retry]'))query(true);if(e.target.closest('[data-pje-fallback-save]'))save();});
  const mo=new MutationObserver(()=>maybe());mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
})();
