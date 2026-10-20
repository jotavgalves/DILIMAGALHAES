(()=>{
  const clean=v=>String(v??'').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>{if(!v)return'—';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR');};
  let running=false,lastKey='';
  function processo(){return clean(document.querySelector('#pjeMniProcess')?.value);}
  function tlsModal(){const m=document.querySelector('#pjeDiagnosticModal');if(!m)return null;return /HTTP\s*526|TLS_ORIGIN|falha TLS\/SSL/i.test(m.innerText||'')?m:null;}
  function slot(modal){
    let s=modal.querySelector('#pjeDiagnosticDatajud');if(s)return s;
    const body=modal.querySelector('section > div:last-child');if(!body)return null;
    s=document.createElement('section');s.id='pjeDiagnosticDatajud';
    s.style.cssText='margin-top:12px;border:1px solid #cfe2da;border-radius:11px;background:#f4faf7;padding:12px';
    body.appendChild(s);return s;
  }
  function loading(s,p){s.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b style="font-size:11px">Contingência automática · DataJud/CNJ</b><div style="font-size:10px;color:#65766f;margin-top:3px">O MNI falhou no TLS. Consultando ${esc(p)} na base pública do CNJ...</div></div><span style="font-size:9px;font-weight:800;padding:5px 8px;border-radius:999px;background:#fff3df;color:#8b5d10">CONSULTANDO</span></div>`;}
  function render(s,d){
    if(!d?.ok){s.innerHTML=`<b style="font-size:11px">Contingência DataJud indisponível</b><div style="font-size:10px;color:#8d443c;margin-top:5px">${esc(d?.error||'Falha ao consultar o DataJud.')}</div>`;return;}
    if(!d.found){s.innerHTML='<b style="font-size:11px">Contingência · DataJud/CNJ</b><div style="font-size:10px;color:#65766f;margin-top:5px">Processo não localizado na base pública do DataJud.</div>';return;}
    const r=d.result||{},m=r.latestMovement||{},org=r.orgaoJulgador?.nome||r.orgaoJulgador||'—',classe=r.classe?.nome||r.classe||'—';
    s.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b style="font-size:11px">Contingência automática · DataJud/CNJ</b><div style="font-size:10px;color:#65766f;margin-top:3px">MNI/TJPE indisponível por TLS; exibindo dados públicos do CNJ.</div></div><span style="font-size:9px;font-weight:800;padding:5px 8px;border-radius:999px;background:#e6f4ee;color:#28634f">ATIVO</span></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px;font-size:10px"><div><b>Grau:</b> ${esc(r.grauNormalizado||r.grau||'—')}</div><div><b>Órgão:</b> ${esc(org)}</div><div><b>Classe:</b> ${esc(classe)}</div><div><b>Última movimentação:</b> ${esc(m.nome||m.descricao||'—')}</div></div><div style="font-size:9px;color:#65766f;margin-top:7px">Movimentação: ${esc(fmt(m.dataHora))} · Consulta DataJud: ${esc(fmt(d.fetchedAt))}</div><div style="margin-top:9px;font-size:9px;color:#65766f">Este bloco é contingência pública do DataJud; não é resposta do MNI/PJe.</div>`;
  }
  async function run(){
    const modal=tlsModal(),p=processo();if(!modal||!p||!/\.8\.17\./.test(p)||running)return;
    const key=`${p}|${modal.innerText.includes('526')}`;if(key===lastKey&&modal.querySelector('#pjeDiagnosticDatajud'))return;
    lastKey=key;const s=slot(modal);if(!s)return;running=true;loading(s,p);
    try{const r=await fetch('/api/datajud',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({processo:p,force:false})});const d=await r.json().catch(()=>({}));render(s,r.ok?d:{ok:false,error:d.error||`HTTP ${r.status}`});}catch(e){render(s,{ok:false,error:e?.message||'Falha ao consultar o DataJud.'});}finally{running=false;}
  }
  const mo=new MutationObserver(()=>setTimeout(run,80));mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-pje-diagnostic]'))setTimeout(run,250);});
})();
