(()=>{
  const SEARCH_DEBOUNCE_MS=180;
  const PREFETCH_DELAY_MS=120;
  const STATUS_INTERVAL_MS=60000;
  let replaySearch=false;
  let searchTimer=null;
  let hoverTimer=null;
  let hoveredId='';
  const prefetched=new Set();

  const style=document.createElement('style');
  style.textContent=`
    .priority-row,.inbox-item,.agenda-item,.person-card,.client-card,.court-card,.audit-item,.kanban-card{content-visibility:auto;contain-intrinsic-size:72px}
    .cases-table tbody tr{contain:layout style paint}
    .drawer{contain:layout style paint}
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
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({action:'detail',id})
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
    clearTimeout(hoverTimer);
    hoveredId='';
  },{passive:true});

  async function refreshStatus(){
    try{
      const r=await fetch('/api/workspace',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({action:'status'})
      });
      if(!r.ok)return;
      const d=await r.json();
      const badge=document.querySelector('.sync');
      if(!badge)return;
      const dot=badge.querySelector('i');
      badge.childNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE)n.remove()});
      badge.append(document.createTextNode(`D1 ativo · ${Number(d.count||0)} registros`));
      if(dot)dot.title=d.lastSync?`Última reconciliação: ${new Date(d.lastSync).toLocaleString('pt-BR')}`:'D1 ativo';
    }catch{}
  }

  const observer=new MutationObserver(()=>{
    if(document.querySelector('.sync'))refreshStatus();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true});
  setInterval(refreshStatus,STATUS_INTERVAL_MS);
  window.addEventListener('load',refreshStatus,{once:true});
})();
