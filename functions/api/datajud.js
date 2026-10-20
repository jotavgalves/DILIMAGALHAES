import { configured, loadWorkbook, getMainRows } from '../lib/drive-xlsx.js';
import { persistDataJudResults } from '../lib/datajud-persist.js';

const CURRENT_PUBLIC_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const WIDTH=21;
const STATE_ALIASES = {
  '01':'tjac','02':'tjal','03':'tjap','04':'tjam','05':'tjba','06':'tjce','07':'tjdft','08':'tjes','09':'tjgo','10':'tjma','11':'tjmt','12':'tjms','13':'tjmg','14':'tjpa','15':'tjpb','16':'tjpr','17':'tjpe','18':'tjpi','19':'tjrj','20':'tjrn','21':'tjrs','22':'tjro','23':'tjrr','24':'tjsc','25':'tjse','26':'tjsp','27':'tjto'
};
const reply = (data, status = 200) => new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const clean=v=>v===null||v===undefined?'':String(v).trim();
const json=(v,fallback)=>{try{const x=JSON.parse(clean(v)||'');return x??fallback}catch{return fallback}};

function cnjParts(value='') {
  const formatted = String(value).trim().match(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/);
  if (!formatted) return null;
  return { digits: formatted.slice(1).join(''), justice: formatted[4], tribunal: formatted[5] };
}
function endpointFor(parts) {
  if (!parts) return null;
  if (parts.justice === '8') { const alias=STATE_ALIASES[parts.tribunal]; return alias?`https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search`:null; }
  if (parts.justice === '4') return `https://api-publica.datajud.cnj.jus.br/api_publica_trt${Number(parts.tribunal)}/_search`;
  if (parts.justice === '5') return `https://api-publica.datajud.cnj.jus.br/api_publica_trf${Number(parts.tribunal)}/_search`;
  return null;
}
function moveName(m={}) { return String(m.nome || m.movimento?.nome || m.descricao || m.codigo || 'Movimentação processual').trim(); }
function movementCategory(m={}) {
  const t = `${moveName(m)} ${JSON.stringify(m.complementosTabelados || [])}`.toLowerCase();
  if (/senten/.test(t)) return 'sentenca'; if (/acórd|acord/.test(t)) return 'acordao'; if (/decis|julgament|mérito|merito/.test(t)) return 'decisao';
  if (/despacho/.test(t)) return 'despacho'; if (/intima/.test(t)) return 'intimacao'; if (/citaç|citacao|citação/.test(t)) return 'citacao';
  if (/conclus/.test(t)) return 'conclusao'; if (/expedi|mandado|ofício|oficio|alvar/.test(t)) return 'expedicao'; if (/juntad|petiç|petic|manifest/.test(t)) return 'juntada';
  if (/arquiv|baixa|trânsito|transito em julgado/.test(t)) return 'encerramento'; return 'movimentacao';
}
function normalizeMovement(m={},grau='') {
  const normalized={codigo:m.codigo??m.movimento?.codigo??'',nome:moveName(m),dataHora:m.dataHora||m.data||'',complementosTabelados:Array.isArray(m.complementosTabelados)?m.complementosTabelados:[],orgaoJulgador:m.orgaoJulgador||null,grau:clean(grau)};
  normalized.categoria=movementCategory(normalized); normalized.chave=`${normalized.dataHora||''}|${normalized.codigo||''}|${normalized.nome||''}|${normalized.grau||''}`; return normalized;
}
function degreeRank(v){const t=clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(!t)return 0;if(/(^|\D)2(\D|$)|g2|segundo|segunda|2o|2a/.test(t))return 2;if(/(^|\D)1(\D|$)|g1|primeiro|primeira|1o|1a/.test(t))return 1;return 0;}
function degreeLabel(v){const r=degreeRank(v);return r===2?'2º grau':r===1?'1º grau':clean(v)||'Não informado';}
function operationalInsight(result) {
  const latest=result?.latestMovement;
  if (!latest) return { level:'neutral', category:'none', label:'Sem movimento recente identificado', suggestedStatus:'Monitoramento', suggestedAction:'Manter acompanhamento manual.' };
  const category=latest.categoria||movementCategory(latest);
  const map={sentenca:{level:'high',label:'Sentença detectada',suggestedStatus:'Aguardando orientação',suggestedAction:'Ler o teor da sentença e definir a providência jurídica.'},acordao:{level:'high',label:'Acórdão detectado',suggestedStatus:'Aguardando orientação',suggestedAction:'Analisar o acórdão e verificar eventual providência ou prazo recursal.'},decisao:{level:'high',label:'Decisão/julgamento detectado',suggestedStatus:'Aguardando orientação',suggestedAction:'Ler o teor da decisão e definir a providência jurídica.'},intimacao:{level:'high',label:'Intimação detectada',suggestedStatus:'A diligenciar',suggestedAction:'Conferir o teor e verificar imediatamente eventual prazo.'},citacao:{level:'high',label:'Citação detectada',suggestedStatus:'A diligenciar',suggestedAction:'Conferir a citação e verificar imediatamente a providência necessária.'},conclusao:{level:'medium',label:'Autos conclusos',suggestedStatus:'Concluso',suggestedAction:'Acompanhar gabinete e aguardar pronunciamento.'},despacho:{level:'high',label:'Novo despacho',suggestedStatus:'A diligenciar',suggestedAction:'Ler o despacho e registrar a providência necessária.'},expedicao:{level:'medium',label:'Expedição/cumprimento',suggestedStatus:'Aguardando cumprimento',suggestedAction:'Verificar expedição e posterior cumprimento.'},juntada:{level:'medium',label:'Petição/documento juntado',suggestedStatus:'Monitoramento',suggestedAction:'Conferir a juntada e avaliar se exige manifestação.'},encerramento:{level:'low',label:'Possível encerramento',suggestedStatus:'Finalizado',suggestedAction:'Confirmar baixa/arquivamento antes de finalizar internamente.'},movimentacao:{level:'neutral',label:'Movimentação nova',suggestedStatus:'Monitoramento',suggestedAction:'Analisar a última movimentação e registrar a próxima ação.'}};
  return {category,...(map[category]||map.movimentacao)};
}
function normalizeHit(hit) {
  const s=hit?._source||{},grau=clean(s.grau||s.instancia||s.nivel||'');
  const movimentos=Array.isArray(s.movimentos)?[...s.movimentos].map(m=>normalizeMovement(m,grau)).sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||''))).slice(0,30):[];
  return {numeroProcesso:s.numeroProcesso||'',tribunal:s.tribunal||'',grau,grauNormalizado:degreeLabel(grau),grauRank:degreeRank(grau),classe:s.classe||null,orgaoJulgador:s.orgaoJulgador||null,assuntos:Array.isArray(s.assuntos)?s.assuntos:[],sistema:s.sistema||null,formato:s.formato||null,nivelSigilo:s.nivelSigilo,dataAjuizamento:s.dataAjuizamento||'',movimentos,latestMovement:movimentos[0]||null};
}
function mergeHits(hits=[]) {
  const parts=hits.map(normalizeHit),degrees=[...new Set(parts.map(x=>x.grauNormalizado).filter(Boolean))];
  const allMovements=[];const seen=new Set();
  for(const p of parts)for(const m of p.movimentos||[]){if(!seen.has(m.chave)){seen.add(m.chave);allMovements.push(m)}}
  allMovements.sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||'')));
  const highest=parts.slice().sort((a,b)=>b.grauRank-a.grauRank)[0]||parts[0]||{};
  const latestSecond=allMovements.find(m=>degreeRank(m.grau)>=2)||null;
  const result={numeroProcesso:highest.numeroProcesso||parts[0]?.numeroProcesso||'',tribunal:highest.tribunal||parts[0]?.tribunal||'',grau:highest.grau||'',grauNormalizado:degreeLabel(highest.grau),grauRank:highest.grauRank||0,graus:degrees,secondDegreeDetected:parts.some(x=>x.grauRank>=2),classe:highest.classe||parts[0]?.classe||null,orgaoJulgador:highest.orgaoJulgador||parts[0]?.orgaoJulgador||null,assuntos:highest.assuntos||[],sistema:highest.sistema||null,formato:highest.formato||null,nivelSigilo:highest.nivelSigilo,dataAjuizamento:highest.dataAjuizamento||'',movimentos:allMovements.slice(0,30),latestMovement:allMovements[0]||null,latestSecondDegreeMovement:latestSecond,hits:parts.map(p=>({grau:p.grau,grauNormalizado:p.grauNormalizado,orgaoJulgador:p.orgaoJulgador,classe:p.classe,latestMovement:p.latestMovement}))};
  result.insight=operationalInsight(result); return result;
}
function cacheKey(processo) { return new Request(`https://datajud-cache.local/processo/${encodeURIComponent(processo)}`); }
async function cacheRead(processo) { try { if(!globalThis.caches?.default)return null; const r=await caches.default.match(cacheKey(processo)); return r?await r.json():null; } catch { return null; } }
async function cacheWrite(processo,data) { try { if(!globalThis.caches?.default)return; await caches.default.put(cacheKey(processo),new Response(JSON.stringify(data),{headers:{'content-type':'application/json','cache-control':'public, max-age=900'}})); } catch {} }
async function queryOne(processo,env,force=false) {
  const p=String(processo||'').trim(),parts=cnjParts(p); if(!parts)return{ok:false,processo:p,error:'Número CNJ inválido.'};
  const endpoint=endpointFor(parts); if(!endpoint)return{ok:false,processo:p,error:'Tribunal ainda não mapeado para consulta automática.'};
  if(!force){const cached=await cacheRead(p);if(cached)return{...cached,cached:true}}
  const key=String(env.DATAJUD_API_KEY||CURRENT_PUBLIC_KEY).trim();
  try{
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':`APIKey ${key}`},body:JSON.stringify({size:10,query:{match:{numeroProcesso:parts.digits}},sort:[{'@timestamp':{order:'desc',unmapped_type:'date'}}]})});
    const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=null}
    if(!r.ok){const detail=data?.error?.reason||data?.message||text.slice(0,400);return{ok:false,processo:p,error:`DataJud respondeu ${r.status}: ${detail}`}}
    const hits=data?.hits?.hits||[];
    const out=hits.length?{ok:true,found:true,endpoint,processo:p,result:mergeHits(hits),fetchedAt:new Date().toISOString()}:{ok:true,found:false,endpoint,processo:p,fetchedAt:new Date().toISOString()};
    await cacheWrite(p,out);return out;
  }catch(e){return{ok:false,processo:p,error:e?.message||'Falha ao consultar o DataJud.'}}
}
function knownDate(item){return typeof item==='string'?'':String(item?.knownLatest||item?.ultimaMovimentacao||'').trim();}
function knownKey(item){return typeof item==='string'?'':String(item?.knownKey||item?.ultimaChave||'').trim();}
function knownDegree(item){return typeof item==='string'?'':String(item?.knownDegree||item?.grauConhecido||'').trim();}
function knownSecond(item){if(typeof item==='string')return false;return Boolean(item?.knownSecondDegree);}
function processValue(item){return typeof item==='string'?item:item?.processo;}
function detectChange(out,item){
  const latest=out?.result?.latestMovement||null,previousDate=knownDate(item),previousKey=knownKey(item),latestDate=String(latest?.dataHora||''),latestKey=String(latest?.chave||'');
  const hasNewMovement=Boolean(latest&&(previousKey?latestKey!==previousKey:latestDate&&(!previousDate||latestDate>previousDate)));
  const oldDegree=knownDegree(item),oldRank=degreeRank(oldDegree),newRank=Number(out?.result?.grauRank||0),hasPriorDegree=Boolean(oldDegree);
  const secondNow=Boolean(out?.result?.secondDegreeDetected),wasSecond=knownSecond(item)||oldRank>=2;
  const movedToSecondDegree=Boolean(secondNow&&!wasSecond&&hasPriorDegree&&newRank>=2),firstSeenSecondDegree=Boolean(secondNow&&!wasSecond&&!hasPriorDegree);
  return{hasNewMovement,changeType:movedToSecondDegree?'subiu_segundo_grau':hasNewMovement?(previousKey||previousDate?'nova_movimentacao':'primeira_leitura'):'sem_alteracao',previousLatest:previousDate,previousKey,latestKey,latestCategory:latest?.categoria||null,latestLabel:out?.result?.insight?.label||null,suggestedStatus:out?.result?.insight?.suggestedStatus||null,suggestedAction:out?.result?.insight?.suggestedAction||null,previousDegree:oldDegree,currentDegree:out?.result?.grauNormalizado||out?.result?.grau||'',secondDegreeDetected:secondNow,movedToSecondDegree,firstSeenSecondDegree};
}
async function batch(items,env,{force=false}={}) {
  const unique=[];const seen=new Set();for(const item of items.slice(0,40)){const p=String(processValue(item)||'').trim();if(p&&!seen.has(p)){seen.add(p);unique.push(item)}}
  const results=new Array(unique.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=unique.length)break;const item=unique[i],out=await queryOne(processValue(item),env,force);results[i]={...out,...detectChange(out,item)}}}
  await Promise.all(Array.from({length:Math.min(6,unique.length||1)},()=>worker()));
  const found=results.filter(x=>x?.found).length,changed=results.filter(x=>x?.hasNewMovement).length,failed=results.filter(x=>x&&!x.ok).length,urgent=results.filter(x=>x?.hasNewMovement&&x?.result?.insight?.level==='high').length,secondDegree=results.filter(x=>x?.result?.secondDegreeDetected).length,secondDegreeChanges=results.filter(x=>x?.movedToSecondDegree).length,firstSeenSecondDegree=results.filter(x=>x?.firstSeenSecondDegree).length;
  const categories={};for(const x of results)if(x?.hasNewMovement){const k=x.latestCategory||'movimentacao';categories[k]=(categories[k]||0)+1}
  return{ok:true,batch:true,count:results.length,found,changed,urgent,failed,secondDegree,secondDegreeChanges,firstSeenSecondDegree,categories,results,checkedAt:new Date().toISOString()};
}
function localDate(){const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Recife',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`;}
async function ensureState(db){if(!db)return;await db.prepare(`CREATE TABLE IF NOT EXISTS workspace_state (key TEXT PRIMARY KEY,value TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`).run();}
async function getState(db,key){if(!db)return null;await ensureState(db);return await db.prepare('SELECT value,updated_at FROM workspace_state WHERE key=?').bind(key).first();}
async function setState(db,key,value){if(!db)return;await ensureState(db);await db.prepare(`INSERT INTO workspace_state(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(key,value).run();}
function activeRecord(r){return clean(r?.processo)&&!/finaliz|arquiv|baixad|encerrad/i.test(`${clean(r?.status)} ${clean(r?.obs)}`);}
async function activeRows(env){
  if(env.DB){try{const q=await env.DB.prepare('SELECT payload_json FROM workspace_records ORDER BY row_id').all();const rows=(q.results||[]).map(x=>{try{return JSON.parse(x.payload_json)}catch{return null}}).filter(Boolean);if(rows.length)return rows.filter(activeRecord);}catch{}}
  if(!configured(env))return[];const book=await loadWorkbook(env),rows=getMainRows(book,WIDTH),out=[];for(let i=1;i<rows.length;i++){const row=rows[i]||[],meta=json(row[18],{}),r={id:i+1,processo:clean(row[1]),cliente:clean(row[2]),status:clean(row[9]),obs:clean(row[10]),datajud:meta?.datajud||null};if(activeRecord(r))out.push(r)}return out;
}
function buildDailyData(rec,x){
  const prev=rec?.datajud||{},now=new Date().toISOString(),pending=Boolean(x.hasNewMovement||x.movedToSecondDegree||x.firstSeenSecondDegree);
  const hist=[{checkedAt:now,latestKey:x.latestKey||'',latestDate:x.result?.latestMovement?.dataHora||'',degree:x.currentDegree||'',secondDegree:Boolean(x.secondDegreeDetected),hasNewMovement:Boolean(x.hasNewMovement),movedToSecondDegree:Boolean(x.movedToSecondDegree),category:x.latestCategory||''},...(Array.isArray(prev.queryHistory)?prev.queryHistory:[])].slice(0,20);
  return{...x,syncedAt:now,reviewed:pending?false:(prev.reviewed??true),reviewedAt:pending?null:(prev.reviewedAt||null),queryHistory:hist};
}
async function dailyScan(env,{force=false}={}){
  const date=localDate(),last=await getState(env.DB,'datajud_daily_date');
  if(!force&&last?.value===date){const summary=await getState(env.DB,'datajud_daily_summary');return{ok:true,skipped:true,date,summary:summary?.value?json(summary.value,{}):{}};}
  const rows=await activeRows(env);await setState(env.DB,'datajud_daily_running',new Date().toISOString());
  const all=[];for(let i=0;i<rows.length;i+=40){const chunk=rows.slice(i,i+40).map(r=>({processo:r.processo,knownLatest:r.datajud?.result?.latestMovement?.dataHora||r.datajud?.previousLatest||'',knownKey:r.datajud?.result?.latestMovement?.chave||r.datajud?.latestKey||'',knownDegree:r.datajud?.result?.grauNormalizado||r.datajud?.currentDegree||r.datajud?.result?.grau||'',knownSecondDegree:Boolean(r.datajud?.result?.secondDegreeDetected||r.datajud?.secondDegreeDetected)}));const d=await batch(chunk,env,{force:true});all.push(...(d.results||[]));}
  const updates=all.filter(x=>x.ok).map(x=>{const rec=rows.find(r=>r.processo===x.processo);return rec?{id:rec.id,processo:rec.processo,datajud:buildDailyData(rec,x)}:null}).filter(Boolean);
  const persisted=updates.length?await persistDataJudResults(env,updates,'DataJud diário'):{ok:true,changed:0,xlsxSaved:false,d1Mirrored:false};
  const summary={date,active:rows.length,checked:all.length,found:all.filter(x=>x.found).length,changed:all.filter(x=>x.hasNewMovement).length,urgent:all.filter(x=>x.hasNewMovement&&x.result?.insight?.level==='high').length,failed:all.filter(x=>!x.ok).length,secondDegree:all.filter(x=>x.result?.secondDegreeDetected).length,secondDegreeChanges:all.filter(x=>x.movedToSecondDegree).length,firstSeenSecondDegree:all.filter(x=>x.firstSeenSecondDegree).length,xlsxSaved:persisted.xlsxSaved,d1Mirrored:persisted.d1Mirrored,finishedAt:new Date().toISOString()};
  await setState(env.DB,'datajud_daily_date',date);await setState(env.DB,'datajud_daily_summary',JSON.stringify(summary));await setState(env.DB,'datajud_daily_running','');return{ok:true,daily:true,...summary};
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;try{body=await request.json()}catch{return reply({error:'JSON inválido.'},400)}
  if(body?.action==='dailyStatus'){const date=await getState(env.DB,'datajud_daily_date'),summary=await getState(env.DB,'datajud_daily_summary'),running=await getState(env.DB,'datajud_daily_running');return reply({ok:true,date:date?.value||null,running:running?.value||null,summary:summary?.value?json(summary.value,{}):null});}
  if(body?.action==='daily'){try{return reply(await dailyScan(env,{force:Boolean(body.force)}));}catch(e){console.error('DILIMAGALHAES DATAJUD DAILY',e);return reply({error:e?.message||'Falha no DataJud diário.'},502)}}
  if(Array.isArray(body?.processos))return reply(await batch(body.processos,env,{force:Boolean(body.force)}));
  const processo=String(body?.processo||'').trim();if(!processo)return reply({error:'Informe processo ou processos.'},400);
  const out=await queryOne(processo,env,Boolean(body.force));return reply(out,out.ok?200:502);
}
