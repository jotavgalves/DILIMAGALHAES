import { configured, loadWorkbook, getMainRows, setMainRow, saveWorkbook } from './drive-xlsx.js';

const WIDTH=21;
const COL={responsavel:0,processo:1,cliente:2,adverso:3,comarca:4,vara:5,secao:6,solicitacao:7,dataSolicitacao:8,status:9,obs:10,atualizadoEm:11,prioridade:12,proximaAcao:13,proximaData:14,historico:15,tarefas:16,comentarios:17,meta:18,versao:19,ultimoEditor:20};
const clean=v=>v===null||v===undefined?'':String(v).trim();
const pad=v=>String(v).padStart(2,'0');
const json=(v,fallback)=>{try{const x=JSON.parse(clean(v)||'');return x??fallback}catch{return fallback}};
const jsonText=v=>JSON.stringify(v??null);
const uuid=()=>crypto.randomUUID();
const nowBRFull=()=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Recife',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
function iso(v){const s=clean(v);if(!s)return'';let m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)return`${m[3]}-${pad(m[2])}-${pad(m[1])}`;m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:s.slice(0,10)}
function fullRow(existing=[]){return Array.from({length:WIDTH},(_,i)=>clean(existing[i]))}
function addHistory(row,entry={}){const arr=json(row[COL.historico],[]),out=Array.isArray(arr)?arr:[];out.unshift({id:uuid(),data:nowBRFull(),tipo:clean(entry.tipo)||'DataJud',texto:clean(entry.texto),usuario:clean(entry.usuario)||'DataJud'});row[COL.historico]=jsonText(out.slice(0,250));}
function record(row,rowNumber){const history=json(row[COL.historico],[]),tasks=json(row[COL.tarefas],[]),comments=json(row[COL.comentarios],[]),meta=json(row[COL.meta],{});return{id:rowNumber,responsavel:clean(row[0]),processo:clean(row[1]),cliente:clean(row[2]),adverso:clean(row[3]),comarca:clean(row[4]),vara:clean(row[5]),secao:clean(row[6]),solicitacao:clean(row[7]),dataSolicitacao:iso(row[8]),status:clean(row[9]),obs:clean(row[10]),atualizadoEm:iso(row[11]),prioridade:clean(row[12])||'Normal',proximaAcao:clean(row[13]),proximaData:iso(row[14]),history,tasks,comments,meta,versao:Number(row[COL.versao]||1),ultimoEditor:clean(row[COL.ultimoEditor]),historyCount:Array.isArray(history)?history.length:0,taskCount:Array.isArray(tasks)?tasks.filter(t=>!/conclu/i.test(clean(t.status))).length:0,commentCount:Array.isArray(comments)?comments.length:0,favorito:Boolean(meta?.favorito),tags:Array.isArray(meta?.tags)?meta.tags:[],decisionOwner:clean(meta?.decisionOwner),datajud:meta?.datajud||null};}
function findRow(rows,u){const rn=Number(u?.id||u?.row);if(Number.isInteger(rn)&&rn>=2)return{rowNumber:rn,row:rows[rn-1]||[]};const p=clean(u?.processo);if(p){const idx=rows.findIndex((r,i)=>i>0&&clean(r?.[1])===p);if(idx>=1)return{rowNumber:idx+1,row:rows[idx]||[]}}throw new Error('Processo/linha não encontrado.')}
function d1Stmt(db,row,rowNumber){const r=record(row,rowNumber);return db.prepare(`INSERT INTO workspace_records
(row_id,processo,cliente,responsavel,status,prioridade,proxima_data,atualizado_em,payload_json,indexed_at)
VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
ON CONFLICT(row_id) DO UPDATE SET processo=excluded.processo,cliente=excluded.cliente,responsavel=excluded.responsavel,status=excluded.status,prioridade=excluded.prioridade,proxima_data=excluded.proxima_data,atualizado_em=excluded.atualizado_em,payload_json=excluded.payload_json,indexed_at=CURRENT_TIMESTAMP`).bind(rowNumber,r.processo,r.cliente,r.responsavel,r.status,r.prioridade,r.proximaData,r.atualizadoEm,JSON.stringify(r));}
async function mirrorMany(env,entries){if(!env.DB||!entries.length)return false;try{await env.DB.batch(entries.map(x=>d1Stmt(env.DB,x.row,x.rowNumber)));await env.DB.prepare(`INSERT INTO workspace_state(key,value,updated_at) VALUES('last_mutation',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(new Date().toISOString()).run();return true}catch(e){console.error('DILIMAGALHAES DATAJUD MIRROR',e);return false}}
function historyText(datajud){const latest=datajud?.result?.latestMovement||{};if(datajud?.movedToSecondDegree)return`Processo identificado como promovido ao 2º grau. ${latest.nome?`Última movimentação: ${latest.nome}.`:''}`;if(datajud?.firstSeenSecondDegree)return`Processo localizado no DataJud já em 2º grau. ${latest.nome?`Última movimentação: ${latest.nome}.`:''}`;if(datajud?.hasNewMovement)return`Nova movimentação DataJud: ${latest.nome||datajud.latestLabel||'movimentação processual'}.`;return'';}
export async function persistDataJudResults(env,updates,who='DataJud diário'){
  if(!configured(env))throw new Error('Integração Google Drive não configurada.');
  const list=Array.isArray(updates)?updates:[];
  if(!list.length)return{ok:true,changed:0,xlsxSaved:false,d1Mirrored:false};
  const book=await loadWorkbook(env),rows=getMainRows(book,WIDTH),mirrored=[];
  let changed=0;
  for(const u of list){try{const f=findRow(rows,u),row=fullRow(f.row),meta={...json(row[COL.meta],{}),datajud:u.datajud||null};row[COL.meta]=jsonText(meta);const txt=historyText(u.datajud);if(txt)addHistory(row,{tipo:'DataJud',texto:txt,usuario:who});row[COL.versao]=String(Number(row[COL.versao]||1)+1);row[COL.ultimoEditor]=who;setMainRow(book,f.rowNumber,row);mirrored.push({row,rowNumber:f.rowNumber});changed++;}catch(e){console.error('DILIMAGALHAES DATAJUD ROW',e)}}
  if(!changed)return{ok:true,changed:0,xlsxSaved:false,d1Mirrored:false};
  await saveWorkbook(env,book);
  const d1Mirrored=await mirrorMany(env,mirrored);
  return{ok:true,changed,xlsxSaved:true,d1Mirrored};
}
