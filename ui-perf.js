(()=>{
  const SEARCH_DEBOUNCE_MS=180;
  const PREFETCH_DELAY_MS=120;
  const STATUS_INTERVAL_MS=60000;
  const STATUS_MIN_GAP_MS=12000;
  let replaySearch=false;
  let searchTimer=null;
  let hoverTimer=null;
  let statusTimer=null;
  let lastStatusAt=0;
  let hoveredId='';
  const prefetched=new Set();

  const style=document.createElement('style');
  style.textContent=`
    .priority-row,.inbox-item,.agenda-item,.person-card,.client-card,.court-card,.audit-item,.kanban-card{content-visibility:auto;contain-intrinsic-size:72px}
    .cases-table tbody tr{contain:layout style paint}
    .drawer{contain:layout style paint}
    .sync.offline i,.sync.error i{background:#b34c43!important;box-shadow:0 0 0 4px #f7e8e6!important}
    .sync.repair i{background:#a66b15!important;box-shadow:0 0 0 4px #fff3df!important}
    @media (prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
  `;
  document.head.appendChild(style);

  document.addEventListener('input',e=>{
    const input=e.target;
    if(!input||input.id!=='globalSearch')return;
    if(replaySearch){replaySearch=false;return;}
    e.stopImmediatePropagation();
    clearTimeout(searchTimer);
    searchTimer=setTimeout(()=>{
      const current=document.querySelector('#globalSearch');
      if(!current)return;
      replaySearch=true;
      current.dispatchEvent(new Event('input',{bubbles:true}));
    },SEARCH_DEBOUNCE_MS);
  },true);

  function warmDetail(id){
    if(!id||prefetched.has(id))return;
    prefetched.add(id);
    fetch('/api/sheets',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'detail',id})
    }).catch(()=>prefetched.delete(id));
  }

  document.addEventListener('pointerover',e=>{
    const row=e.target?.closest?.('[data-row]');
    if(!row)return;
    const id=String(row.dataset.row||'');
    if(!id||id===hoveredId||prefetched.has(id))return;
    hoveredId=id;
    clearTimeout(hoverTimer);
    hoverTimer=setTimeout(()=>warmDetail(id),PREFETCH_DELAY_MS);
  },{passive:true});

  document.addEventListener('pointerout',e=>{
    const row=e.target?.closest?.('[data-row]');
    if(!row)return;
    const related=e.relatedTarget;
    if(related&&row.contains(related))return;
    clearTimeout(hoverTimer);hoveredId='';
  },{passive:true});

  function paintStatus(text,kind='',title=''){
    const badge=document.querySelector('.sync');
    if(!badge)return;
    badge.classList.remove('offline','error','repair');
    if(kind)badge.classList.add(kind);
    const dot=badge.querySelector('i');
    [...badge.childNodes].forEach(n=>{if(n.nodeType===Node.TEXT_NODE)n.remove()});
    badge.append(document.createTextNode(text));
    if(dot)dot.title=title||text;
  }

  async function refreshStatus(force=false){
    if(!navigator.onLine){paintStatus('Sem conexão','offline','O navegador está offline.');return;}
    const now=Date.now();
    if(!force&&now-lastStatusAt<STATUS_MIN_GAP_MS)return;
    lastStatusAt=now;
    try{
      const r=await fetch('/api/health',{headers:{accept:'application/json'}});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.ok){paintStatus('D1 indisponível','error',d.error||'Falha no health check.');return;}
      const details=[`Banco D1: ${Number(d.records||0)} registros`,`Latência: ${Number(d.latencyMs||0)} ms`];
      if(d.lastSync)details.push(`Última reconciliação: ${new Date(d.lastSync).toLocaleString('pt-BR')}`);
      if(d.lastMutation)details.push(`Última alteração: ${new Date(d.lastMutation).toLocaleString('pt-BR')}`);
      paintStatus(`D1 ativo · ${Number(d.records||0)} registros`,'',details.join('\n'));
    }catch(e){paintStatus('D1 indisponível','error',e?.message||'Falha de rede.');}
  }

  function scheduleStatus(){
    clearTimeout(statusTimer);
    statusTimer=setTimeout(()=>refreshStatus(false),300);
  }

  const observer=new MutationObserver(()=>{if(document.querySelector('.sync'))scheduleStatus()});
  observer.observe(document.documentElement,{subtree:true,childList:true});

  window.addEventListener('offline',()=>paintStatus('Sem conexão','offline','O navegador está offline.'));
  window.addEventListener('online',()=>refreshStatus(true));
  window.addEventListener('dili:write',e=>{
    const mirrored=e.detail?.d1Mirrored;
    if(mirrored===false)paintStatus('Reconciliando D1…','repair','A gravação no XLSX ocorreu; o D1 será reconciliado automaticamente.');
    else refreshStatus(true);
  });
  window.addEventListener('dili:mirror-repaired',()=>{paintStatus('D1 reconciliado','','Espelhamento recuperado automaticamente.');setTimeout(()=>refreshStatus(true),900)});
  window.addEventListener('error',()=>paintStatus('Falha na interface','error','Ocorreu um erro de JavaScript. Recarregue se a tela não responder.'));
  window.addEventListener('unhandledrejection',()=>paintStatus('Falha na operação','error','Uma operação assíncrona falhou.'));

  setInterval(()=>refreshStatus(false),STATUS_INTERVAL_MS);
  window.addEventListener('load',()=>refreshStatus(true),{once:true});
})();
