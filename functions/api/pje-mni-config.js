const ENDPOINTS={
  '1g':'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2?wsdl',
  '2g':'https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2?wsdl'
};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=v=>v===null||v===undefined?'':String(v).trim();
function credentialsConfigured(env){return Boolean(clean(env.PJE_MNI_ID||env.PJE_MNI_USUARIO)&&clean(env.PJE_MNI_PASSWORD||env.PJE_MNI_SENHA));}
function certificateBindingConfigured(env){return Boolean(env.PJE_MNI_CERT&&typeof env.PJE_MNI_CERT.fetch==='function');}
function classify(status,error=''){
  const text=String(error||'').toLowerCase();
  if(status===525||status===526||/ssl|tls|certificate|handshake/.test(text))return{code:'TLS_ORIGIN',label:'Falha TLS/SSL',detail:'A conexão falhou na camada TLS antes de confirmar autenticação MNI.'};
  if(status===401||status===403||/credencial|autentic|authorization|unauthorized|forbidden|senha/.test(text))return{code:'AUTH_REQUIRED',label:'Autenticação necessária',detail:'O endpoint respondeu de forma compatível com exigência de credencial/autorização.'};
  if(status===522||status===523||status===524)return{code:'NETWORK',label:'Falha de conectividade',detail:'O endpoint não respondeu normalmente a partir do servidor.'};
  if(status>=500)return{code:'REMOTE_ERROR',label:'Erro remoto',detail:'O servidor remoto respondeu com erro. Isso, sozinho, não comprova falha de credencial.'};
  if(status>=200&&status<400)return{code:'REACHABLE',label:'Endpoint acessível',detail:'O endpoint respondeu ao teste de conectividade.'};
  return{code:'UNKNOWN',label:'Estado não conclusivo',detail:'A resposta não permite concluir a causa com segurança.'};
}
async function test(url,fetcher){
  const started=Date.now();
  try{
    const r=await fetcher.fetch(url,{method:'GET',headers:{accept:'text/xml, application/wsdl+xml'}});
    const body=await r.text();
    const c=classify(r.status,body.slice(0,500));
    return{ok:r.ok,status:r.status,latencyMs:Date.now()-started,...c};
  }catch(e){const msg=e?.message||'Falha de rede.';const c=classify(0,msg);return{ok:false,status:0,latencyMs:Date.now()-started,error:msg,...c};}
}
export async function onRequestGet({env}){
  const globalFetcher={fetch:(...args)=>fetch(...args)};
  const certConfigured=certificateBindingConfigured(env);
  const standard=await Promise.all(Object.entries(ENDPOINTS).map(async([degree,url])=>({degree,...await test(url,globalFetcher)})));
  let certificate=[];
  if(certConfigured)certificate=await Promise.all(Object.entries(ENDPOINTS).map(async([degree,url])=>({degree,...await test(url,env.PJE_MNI_CERT)})));
  const tlsFailure=standard.some(x=>x.code==='TLS_ORIGIN');
  const summary={
    endpointReachable:standard.some(x=>x.ok),
    tlsFailure,
    credentialsConfigured:credentialsConfigured(env),
    certificateBindingConfigured:certConfigured,
    certificateBindingName:'PJE_MNI_CERT',
    readyForAuthenticatedMni:Boolean(certConfigured||credentialsConfigured(env)),
    conclusion:tlsFailure?'Falha TLS/SSL detectada antes de ser possível concluir sobre autenticação.':certConfigured?'Binding de certificado cliente configurado no backend.':credentialsConfigured(env)?'Credencial MNI configurada, sem binding de certificado cliente.':'Sem credencial MNI e sem certificado cliente configurados.'
  };
  return reply({ok:true,provider:'TJPE',protocol:'MNI 2.2.2',summary,standard,certificate,checkedAt:new Date().toISOString()});
}
