const ENDPOINTS={
  '1g':'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2',
  '2g':'https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2'
};
const WSDLS={
  '1g':`${ENDPOINTS['1g']}?wsdl`,
  '2g':`${ENDPOINTS['2g']}?wsdl`
};
const SERVICE_NS='http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/';
const TYPES_NS='http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2';
const SOAP_NS='http://schemas.xmlsoap.org/soap/envelope/';

const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=v=>v===null||v===undefined?'':String(v).trim();
const escXml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const decode=s=>String(s??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function cnj(value=''){
  const digits=String(value).replace(/\D/g,'');
  if(digits.length!==20)return null;
  return{digits,formatted:`${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16)}`};
}
function tag(xml,name){
  const re=new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${name}>`,'i');
  const m=String(xml||'').match(re);return m?decode(m[1]):'';
}
function attr(block,name){
  const m=String(block||'').match(new RegExp(`\\b${name}="([^"]*)"`,'i'));return m?decode(m[1]):'';
}
function allBlocks(xml,name,limit=30){
  const re=new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z0-9_.-]+:)?${name}>`,'gi');
  return [...String(xml||'').matchAll(re)].slice(0,limit).map(m=>m[0]);
}
function parseMovement(block){
  const national=tag(block,'movimentoNacional');
  const local=tag(block,'movimentoLocal');
  const code=tag(block,'codigoNacional')||tag(block,'codigoMovimento')||tag(block,'codigo');
  const desc=tag(block,'descricao')||tag(block,'nome')||decode(national)||decode(local)||'Movimentação processual';
  return{dataHora:tag(block,'dataHora')||tag(block,'data'),codigo:code,descricao:desc};
}
function parseSoap(xml,degree,httpStatus){
  const fault=tag(xml,'faultstring')||tag(xml,'Fault');
  const successRaw=tag(xml,'sucesso');
  const success=/^true$/i.test(successRaw)||(!successRaw&&!fault&&httpStatus>=200&&httpStatus<300);
  const message=tag(xml,'mensagem')||fault||'';
  const basicBlock=allBlocks(xml,'dadosBasicos',1)[0]||'';
  const numero=attr(basicBlock,'numero')||tag(basicBlock,'numero')||tag(xml,'numeroProcesso');
  const classe=attr(basicBlock,'classeProcessual')||tag(basicBlock,'classeProcessual')||tag(xml,'classeProcessual');
  const nivelSigilo=attr(basicBlock,'nivelSigilo')||tag(basicBlock,'nivelSigilo')||tag(xml,'nivelSigilo');
  const orgao=tag(xml,'orgaoJulgador')||tag(xml,'nomeOrgao')||tag(xml,'nomeOrgaoJulgador');
  const movimentos=allBlocks(xml,'movimento',40).map(parseMovement).filter(m=>m.dataHora||m.codigo||m.descricao!=='Movimentação processual');
  movimentos.sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||'')));
  const polos=allBlocks(xml,'polo',10).map(p=>({polo:attr(p,'polo')||tag(p,'polo')||attr(p,'tipo')||'',partes:allBlocks(p,'parte',20).map(x=>tag(x,'nome')||tag(x,'pessoa')||decode(x)).filter(Boolean).slice(0,20)}));
  return{degree,success,message,numero,classe,nivelSigilo,orgaoJulgador:orgao,movimentos:movimentos.slice(0,30),latestMovement:movimentos[0]||null,polos,rawAvailable:Boolean(xml)};
}
function envelope(numero,env,{movimentos=true,incluirCabecalho=true,incluirDocumentos=false}={}){
  const id=clean(env.PJE_MNI_ID||env.PJE_MNI_USUARIO||'');
  const senha=clean(env.PJE_MNI_PASSWORD||env.PJE_MNI_SENHA||'');
  const credentials=`${id?`<tip:idConsultante>${escXml(id)}</tip:idConsultante>`:''}${senha?`<tip:senhaConsultante>${escXml(senha)}</tip:senhaConsultante>`:''}`;
  return`<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:ser="${SERVICE_NS}" xmlns:tip="${TYPES_NS}"><soapenv:Header/><soapenv:Body><ser:consultarProcesso>${credentials}<tip:numeroProcesso>${escXml(numero)}</tip:numeroProcesso><tip:movimentos>${movimentos?'true':'false'}</tip:movimentos><tip:incluirCabecalho>${incluirCabecalho?'true':'false'}</tip:incluirCabecalho><tip:incluirDocumentos>${incluirDocumentos?'true':'false'}</tip:incluirDocumentos></ser:consultarProcesso></soapenv:Body></soapenv:Envelope>`;
}
async function consult(degree,processo,env,opts={}){
  const endpoint=ENDPOINTS[degree];
  const body=envelope(processo.digits,env,opts);
  const started=Date.now();
  try{
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'text/xml; charset=UTF-8','accept':'text/xml, application/soap+xml','soapaction':`"${SERVICE_NS}consultarProcesso"`},body});
    const xml=await r.text();
    const parsed=parseSoap(xml,degree,r.status);
    return{ok:r.ok&&parsed.success,httpStatus:r.status,endpoint,wsdl:WSDLS[degree],latencyMs:Date.now()-started,...parsed};
  }catch(e){return{ok:false,degree,endpoint,wsdl:WSDLS[degree],latencyMs:Date.now()-started,error:e?.message||'Falha de rede ao consultar o MNI.'};}
}
async function liveWsdl(degree){
  const started=Date.now();
  try{const r=await fetch(WSDLS[degree],{method:'GET',headers:{accept:'text/xml, application/wsdl+xml'}});return{degree,ok:r.ok,status:r.status,latencyMs:Date.now()-started};}
  catch(e){return{degree,ok:false,error:e?.message||'Falha ao alcançar WSDL.',latencyMs:Date.now()-started};}
}

export async function onRequestGet({request,env}){
  const u=new URL(request.url),live=u.searchParams.get('live')==='1';
  const credentialsConfigured=Boolean(clean(env.PJE_MNI_ID||env.PJE_MNI_USUARIO)&&clean(env.PJE_MNI_PASSWORD||env.PJE_MNI_SENHA));
  const data={ok:true,provider:'TJPE',protocol:'MNI 2.2.2 / SOAP',credentialsConfigured,endpoints:{firstDegree:WSDLS['1g'],secondDegree:WSDLS['2g']},operations:['consultarProcesso']};
  if(live)data.live=await Promise.all([liveWsdl('1g'),liveWsdl('2g')]);
  return reply(data);
}

export async function onRequestPost({request,env}){
  let input;try{input=await request.json()}catch{return reply({error:'JSON inválido.'},400)}
  const action=clean(input.action)||'query';
  if(action==='status')return onRequestGet({request:new Request(`${new URL(request.url).origin}/api/pje-mni${input.live?'?live=1':''}`),env});
  const p=cnj(input.processo);if(!p)return reply({error:'Informe um número CNJ válido com 20 dígitos.'},400);
  const target=['1g','2g'].includes(input.degree)?input.degree:'both';
  const opts={movimentos:input.movimentos!==false,incluirCabecalho:input.incluirCabecalho!==false,incluirDocumentos:Boolean(input.incluirDocumentos)};
  const degrees=target==='both'?['1g','2g']:[target];
  const results=await Promise.all(degrees.map(d=>consult(d,p,env,opts)));
  const found=results.filter(x=>x.ok).length;
  return reply({ok:found>0,provider:'TJPE',protocol:'MNI 2.2.2',processo:p.formatted,credentialsConfigured:Boolean(clean(env.PJE_MNI_ID||env.PJE_MNI_USUARIO)&&clean(env.PJE_MNI_PASSWORD||env.PJE_MNI_SENHA)),found,results,checkedAt:new Date().toISOString()},found?200:502);
}
