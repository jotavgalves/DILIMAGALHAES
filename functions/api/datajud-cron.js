import { onRequestPost as runDataJud } from './datajud.js';

const AUDIENCE='dilimagalhaes-daily';
const REPOSITORY='jotavgalves/DILIMAGALHAES';
const WORKFLOW_REF='jotavgalves/DILIMAGALHAES/.github/workflows/datajud-daily.yml@refs/heads/main';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const td=new TextDecoder();

function b64urlBytes(s=''){
  const base=String(s).replace(/-/g,'+').replace(/_/g,'/');
  const padded=base+'='.repeat((4-base.length%4)%4);
  const bin=atob(padded),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
function parsePart(s){return JSON.parse(td.decode(b64urlBytes(s)));}
function audOk(aud){return Array.isArray(aud)?aud.includes(AUDIENCE):aud===AUDIENCE;}
async function verifyGithubToken(request){
  const raw=request.headers.get('authorization')||'';
  const token=raw.match(/^Bearer\s+(.+)$/i)?.[1]||'';
  if(!token)throw new Error('OIDC ausente.');
  const parts=token.split('.');if(parts.length!==3)throw new Error('OIDC inválido.');
  const [h,p,s]=parts,header=parsePart(h),claims=parsePart(p);
  if(header.alg!=='RS256'||!header.kid)throw new Error('Algoritmo OIDC inválido.');
  const now=Math.floor(Date.now()/1000);
  if(claims.iss!=='https://token.actions.githubusercontent.com')throw new Error('Emissor OIDC inválido.');
  if(!audOk(claims.aud))throw new Error('Audience OIDC inválida.');
  if(Number(claims.exp||0)<now-30||Number(claims.nbf||0)>now+30)throw new Error('OIDC expirado ou ainda não válido.');
  if(claims.repository!==REPOSITORY)throw new Error('Repositório OIDC não autorizado.');
  if(claims.ref!=='refs/heads/main')throw new Error('Branch OIDC não autorizada.');
  if(claims.job_workflow_ref&&claims.job_workflow_ref!==WORKFLOW_REF)throw new Error('Workflow OIDC não autorizado.');
  if(!['schedule','workflow_dispatch'].includes(String(claims.event_name||'')))throw new Error('Evento OIDC não autorizado.');
  const jwks=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks').then(r=>{if(!r.ok)throw new Error(`JWKS ${r.status}`);return r.json();});
  const jwk=(jwks.keys||[]).find(k=>k.kid===header.kid);if(!jwk)throw new Error('Chave OIDC não encontrada.');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64urlBytes(s),new TextEncoder().encode(`${h}.${p}`));
  if(!ok)throw new Error('Assinatura OIDC inválida.');
  return claims;
}

export async function onRequestPost({request,env}){
  try{
    const claims=await verifyGithubToken(request);
    const internal=new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'daily',force:false,source:'github-actions'})});
    const response=await runDataJud({request:internal,env});
    const text=await response.text();
    let data;try{data=JSON.parse(text)}catch{data={raw:text}};
    return reply({ok:response.ok,source:'github-actions-oidc',actor:claims.actor||null,runId:claims.run_id||null,data},response.status);
  }catch(e){
    console.error('DILIMAGALHAES DATAJUD CRON AUTH',e);
    return reply({ok:false,error:e?.message||'Cron não autorizado.'},401);
  }
}
