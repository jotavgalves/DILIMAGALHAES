(()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const label=(ok,yes='Configurado',no='Não configurado')=>`<span style="font-size:9px;font-weight:800;padding:5px 8px;border-radius:999px;background:${ok?'#e8f5ef':'#faece9'};color:${ok?'#27634f':'#9f4239'}">${ok?yes:no}</span>`;
  let loading=false,last=null;
  async function load(){
    if(loading)return;loading=true;
    const box=document.querySelector('#pjeMniAccessPanel');if(box)box.innerHTML='<div style="padding:12px;color:#71817b;font-size:11px">Verificando configuração de acesso...</div>';
    try{const r=await fetch('/api/pje-mni-config');const d=await r.json();last=d;render();}
    catch(e){if(box)box.innerHTML=`<div style="padding:12px;color:#9f4239;font-size:11px">Falha ao verificar configuração: ${esc(e.message||'erro')}</div>`;}
    finally{loading=false;}
  }
  function render(){
    const box=document.querySelector('#pjeMniAccessPanel');if(!box||!last)return;
    const s=last.summary||{},g1=(last.standard||[]).find(x=>x.degree==='1g'),g2=(last.standard||[]).find(x=>x.degree==='2g');
    const connOk=Boolean(s.endpointReachable&&!s.tlsFailure);
    box.innerHTML=`<section style="border:1px solid #dfe7e3;border-radius:13px;background:#fff;padding:13px;margin:10px 0 12px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b style="font-size:12px">Configuração de acesso PJe/MNI</b><div style="font-size:10px;color:#71817b;margin-top:3px">Endpoint, credencial e certificado são verificados separadamente</div></div><button class="btn secondary" data-pje-access-refresh>Verificar novamente</button></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px"><div style="border:1px solid #edf2ef;border-radius:10px;padding:10px"><div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b style="font-size:10px">Conexão TJPE</b>${label(connOk,'OK',s.tlsFailure?'Falha TLS':'Indisponível')}</div><div style="font-size:9px;color:#71817b;margin-top:6px">1º grau: HTTP ${esc(g1?.status??'—')} · 2º grau: HTTP ${esc(g2?.status??'—')}</div></div><div style="border:1px solid #edf2ef;border-radius:10px;padding:10px"><div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b style="font-size:10px">Credencial MNI</b>${label(s.credentialsConfigured)}</div><div style="font-size:9px;color:#71817b;margin-top:6px">ID consultante + senha, quando exigidos pelo Tribunal.</div></div><div style="border:1px solid #edf2ef;border-radius:10px;padding:10px"><div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b style="font-size:10px">Certificado cliente</b>${label(s.certificateBindingConfigured)}</div><div style="font-size:9px;color:#71817b;margin-top:6px">Binding Cloudflare: <b>PJE_MNI_CERT</b></div></div></div><div style="margin-top:10px;padding:10px;border-radius:9px;background:#f7faf8;font-size:10px;line-height:1.5;color:#60716a"><b>Conclusão:</b> ${esc(s.conclusion||'Sem conclusão.')}${!s.certificateBindingConfigured?'<br><b>Certificado:</b> nenhum certificado cliente está ligado ao backend neste momento.':''}<br>Nenhum certificado ou senha é solicitado ou armazenado no navegador.</div></section>`;
  }
  function inject(){
    const status=document.querySelector('#pjeMniStatus');if(!status||document.querySelector('#pjeMniAccessPanel'))return;
    const panel=document.createElement('div');panel.id='pjeMniAccessPanel';status.insertAdjacentElement('afterend',panel);load();
  }
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-pje-access-refresh]'))load();});
  const mo=new MutationObserver(()=>inject());mo.observe(document.documentElement,{subtree:true,childList:true});
  window.addEventListener('load',inject,{once:true});
})();
