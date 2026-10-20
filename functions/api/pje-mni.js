const ENDPOINTS={
  '1g':'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2',
  '2g':'https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2'
};
const WSDLS={'1g':`${ENDPOINTS['1g']}?wsdl`,'2g':`${ENDPOINTS['2g']}?wsdl`};
const SERVICE_NS='http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/';
const TYPES_NS='http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2';
const SOAP_NS='http://schemas.xmlsoap.org/soap/envelope/';
const MAX_BATCH=20;
const CONCURRENCY=4;

const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=v=>v===null||v===undefined?'':String(v).trim();
const escXml=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const decode=s=>String(s??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function cnj(value=''){const digits=String(value).replace(/\D/g,'');if(digits.length!==20)return null;return{digits,formatted:`${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16)}`};}
function tag(xml,name){const re=new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${name}>`,'i');const m=String(xml||'').match(re);return m?decode(m[1]):'';}
function attr(block,name){const m=String(block||'').match(new RegExp(`\\b${name}="([^"]*)"`,'i'));return m?decode(m[1]):'';}
function allBlocks(xml,name,limit=60){const re=new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z0-9_.-]+:)?${name}>`,'gi');return[...String(xml||'').matchAll(re)].slice(0,limit).map(m=>m[0]);}
function movementKey(m={}){return`${clean(m.dataHora)}|${clean(m.codigo)}|${clean(m.descricao)}`;}
function parseMovement(block){
  const national=tag(block,'movimentoNacional'),local=tag(block,'movimentoLocal');
  const code=tag(block,'codigoNacional')||tag(block,'codigoMovimento')||tag(block,'codigo')||attr(block,'codigoNacional')||attr(block,'codigoMovimento');
  const desc=tag(block,'descricao')||tag(block,'nome')||attr(block,'descricao')||decode(national)||decode(local)||'Movimentação processual';
  const out={dataHora:tag(block,'dataHora')||tag(block,'data')||attr(block,'dataHora'),codigo:code,descricao:desc};out.chave=movementKey(out);return out;
}
function parseParty(block){
  const name=tag(block,'nome')||tag(block,'nomePessoa')||tag(block,'pessoa')||attr(block,'nome');
  const doc=tag(block,'numeroDocumentoPrincipal')||tag(block,'documento')||'';
  return{name:decode(name),documento:clean(doc)};
}
function parseSoap(xml,degree,httpStatus){
  const fault=tag(xml,'faultstring')||tag(xml,'Reason')||tag(xml,'Fault');
  const successRaw=tag(xml,'sucesso');
  const success=/^true$/i.test(successRaw)||(!successRaw&&!fault&&httpStatus>=200&&httpStatus<300);
  const message=tag(xml,'mensagem')||fault||'';
  const basicBlock=allBlocks(xml,'dadosBasicos',1)[0]||'';
  const numero=attr(basicBlock,'numero')||tag(basicBlock,'numero')||tag(xml,'numeroProcesso');
  const classe=attr(basicBlock,'classeProcessual')||tag(basicBlock,'classeProcessual')||tag(xml,'classeProcessual');
  const nivelSigilo=attr(basicBlock,'nivelSigilo')||tag(basicBlock,'nivelSigilo')||tag(xml,'nivelSigilo');
  const orgaoBlock=allBlocks(xml,'orgaoJulgador',1)[0]||'';
  const orgao=attr(orgaoBlock,'nomeOrgao')||tag(orgaoBlock,'nomeOrgao')||tag(orgaoBlock,'nome')||tag(xml,'nomeOrgaoJulgador')||tag(xml,'orgaoJulgador');
  const movimentos=allBlocks(xml,'movimento',80).map(parseMovement).filter(m=>m.dataHora||m.codigo||m.descricao!=='Movimentação processual');
  movimentos.sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||'')));
  const polos=allBlocks(xml,'polo',10).map(p=>({
    polo:attr(p,'polo')||tag(p,'polo')||attr(p,'tipo')||'',
    partes:allBlocks(p,'parte',30).map(parseParty).filter(x=>x.name).slice(0,30)
  }));
  const docs=allBlocks(xml,'documento',40).length;
  return{degree,success,message,numero,classe,nivelSigilo,orgaoJulgador:orgao,movimentos:movimentos.slice(0,50),latestMovement:movimentos[0]||null,polos,documentCount:docs,rawAvailable:Boolean(xml)};
}
function envelope(numero,env,{movimentos=true,incluirCabecalho=true,incluirDocumentos=false}={}){
  const id=clean(env.PJE_MNI_ID||env.PJE_MNI_USUARIO||''),senha=clean(env.PJE_MNI_PASSWORD||env.PJE_MNI_SENHA||'');
  const credentials=`${id?`<tip:idConsultante>${escXml(id)}</tip:idConsultante>`:''}${senha?`<tip:senhaConsultante>${escXml(senha)}</tip:senhaConsultante>`:''}`;
  return`<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:ser="${SERVICE_NS}" xmlns:tip="${TYPES_NS}"><soapenv:Header/><soapenv:Body><ser:consultarProcesso>${credentials}<tip:numeroProcesso>${escXml(numero)}</tip:numeroProcesso><tip:movimentos>${movimentos?'true':'false'}</tip:movimentos><tip:incluirCabecalho>${incluirCabecalho?'true':'false'}</tip:incluirCabecalho><tip:incluirDocumentos>${incluirDocumentos?'true':'false'}</tip:incluirDocumentos></ser:consultarProcesso></soapenv:Body></soapenv:Envelope>`;
}
async function consult(degree,processo,env,opts={}){
  const endpoint=ENDPOINTS[degree],body=envelope(processo.digits,env,opts),started=Date.now();
  try{
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'text/xml; charset=UTF-8','accept':'text/xml, application/soap+xml','soapaction':`"${SERVICE_NS}consultarProcesso"`},body});
    const xml=await r.text(),parsed=parseSoap(xml,degree,r.status);
    return{ok:r.ok&&parsed.success,httpStatus:r.status,endpoint,wsdl:WSDLS[degree],latencyMs:Date.now()-started,...parsed};
  }catch(e){return{ok:false,degree,endpoint,wsdl:WSDLS[degree],latencyMs:Date.now()-started,error:e?.message||'Falha de rede ao consultar o MNI.'};}
}
function summarize(processo,results,known={}){
  const first=results.find(x=>x.degree==='1g'&&x.ok)||null,second=results.find(x=>x.degree==='2g'&&x.ok)||null;
  const successful=results.filter(x=>x.ok),allMoves=successful.flatMap(x=>(x.movimentos||[]).map(m=>({...m,degree:x.degree}))).sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||'')));
  const latest=allMoves[0]||null,best=second||first||successful[0]||null;
  const previousKey=clean(known?.latestKey),latestKey=latest?`${latest.degree}|${latest.chave||movementKey(latest)}`:'';
  const hasNewMovement=Boolean(latestKey&&(previousKey?latestKey!==previousKey:true));
  const wasSecond=Boolean(known?.secondDegreeDetected),secondDegreeDetected=Boolean(second),movedToSecondDegree=Boolean(secondDegreeDetected&&!wasSecond&&known?.checkedBefore);
  return{
    processo:processo.formatted,found1g:Boolean(first),found2g:Boolean(second),secondDegreeDetected,movedToSecondDegree,
    currentDegree:second?'2g':first?'1g':'',currentDegreeLabel:second?'2º grau':first?'1º grau':'Não localizado',
    currentOrgan:best?.orgaoJulgador||'',classe:best?.classe||'',nivelSigilo:best?.nivelSigilo||'',latestMovement:latest,latestKey,previousKey,hasNewMovement,
    parties:successful.flatMap(x=>x.polos||[]),checkedAt:new Date().toISOString()
  };
}
async function queryProcess(p,degree,env,opts,known={}){
  const degrees=degree==='both'?['1g','2g']:[degree];
  const results=await Promise.all(degrees.map(d=>consult(d,p,env,opts)));
  const summary=summarize(p,results,known);
  return{ok:results.some(x=>x.ok),provider:'TJPE',protocol:'MNI 2.2.2',processo:p.formatted,results,summary,checkedAt:new Date().toISOString()};
}
async function batch(items,degree,env,opts){
  const unique=[];const seen=new Set();
  for(const item of (Array.isArray(items)?items:[]).slice(0,MAX_BATCH)){const p=cnj(typeof item==='string'?item:item?.processo);if(p&&!seen.has(p.digits)){seen.add(p.digits);unique.push({p,known:typeof item==='string'?{}:(item.known||{})});}}
  const out=new Array(unique.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=unique.length)break;const item=unique[i];out[i]=await queryProcess(item.p,degree,env,opts,item.known);}}
  await Promise.all(Array.from({length:Math.min(CONCURRENCY,unique.length||1)},()=>worker()));
  return{ok:true,batch:true,count:out.length,found:out.filter(x=>x.ok).length,secondDegree:out.filter(x=>x.summary?.secondDegreeDetected).length,movedToSecondDegree:out.filter(x=>x.summary?.movedToSecondDegree).length,changed:out.filter(x=>x.summary?.hasNewMovement).length,results:out,checkedAt:new Date().toISOString()};
}
async function liveWsdl(degree){const started=Date.now();try{const r=await fetch(WSDLS[degree],{method:'GET',headers:{accept:'text/xml, application/wsdl+xml'}});return{degree,ok:r.ok,status:r.status,latencyMs:Date.now()-started};}catch(e){return{degree,ok:false,error:e?.message||'Falha ao alcançar WSDL.',latencyMs:Date.now()-started};}}
function credentialsConfigured(env){return Boolean(clean(env.PJE_MNI_ID||env.PJE_MNI_USUARIO)&&clean(env.PJE_MNI_PASSWORD||env.PJE_MNI_SENHA));}

export async function onRequestGet({request,env}){
  const u=new URL(request.url),live=u.searchParams.get('live')==='1';
  const data={ok:true,provider:'TJPE',protocol:'MNI 2.2.2 / SOAP',credentialsConfigured:credentialsConfigured(env),endpoints:{firstDegree:WSDLS['1g'],secondDegree:WSDLS['2g']},operations:['consultarProcesso','batch'],batchLimit:MAX_BATCH};
  if(live)data.live=await Promise.all([liveWsdl('1g'),liveWsdl('2g')]);
  return reply(data);
}
export async function onRequestPost({request,env}){
  let input;try{input=await request.json()}catch{return reply({error:'JSON inválido.'},400)}
  const action=clean(input.action)||'query';
  if(action==='status')return onRequestGet({request:new Request(`${new URL(request.url).origin}/api/pje-mni${input.live?'?live=1':''}`),env});
  const target=['1g','2g'].includes(input.degree)?input.degree:'both';
  const opts={movimentos:input.movimentos!==false,incluirCabecalho:input.incluirCabecalho!==false,incluirDocumentos:Boolean(input.incluirDocumentos)};
  if(action==='batch'){
    const out=await batch(input.processos,target,env,opts);
    return reply({...out,credentialsConfigured:credentialsConfigured(env)});
  }
  const p=cnj(input.processo);if(!p)return reply({error:'Informe um número CNJ válido com 20 dígitos.'},400);
  const out=await queryProcess(p,target,env,opts,input.known||{});
  return reply({...out,credentialsConfigured:credentialsConfigured(env)},out.ok?200:502);
}
