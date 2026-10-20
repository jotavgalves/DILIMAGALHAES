import { configured, loadWorkbook, getMainRows, setMainRow, nextMainRow, saveWorkbook } from '../lib/drive-xlsx.js';

const COL = {
  responsavel: 0, processo: 1, cliente: 2, adverso: 3, comarca: 4, vara: 5,
  secao: 6, solicitacao: 7, dataSolicitacao: 8, status: 9, obs: 10,
  atualizadoEm: 11, prioridade: 12, proximaAcao: 13, proximaData: 14,
  historico: 15, tarefas: 16, comentarios: 17, meta: 18, versao: 19, ultimoEditor: 20,
};
const WIDTH = 21;
const clean = v => v === null || v === undefined ? '' : String(v).trim();
const pad = v => String(v).padStart(2, '0');
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function cacheRequest(env) {
  const id = clean(env.GOOGLE_DRIVE_FILE_ID) || 'default';
  return new Request(`https://dilimagalhaes-cache.local/list/${encodeURIComponent(id)}`);
}
async function readListCache(env) {
  try {
    if (!globalThis.caches?.default) return null;
    const r = await caches.default.match(cacheRequest(env));
    return r ? await r.json() : null;
  } catch { return null; }
}
async function writeListCache(env, rows) {
  try {
    if (!globalThis.caches?.default) return;
    const r = new Response(JSON.stringify({ rows, source:'google-drive-xlsx-direct-cache', cachedAt:new Date().toISOString() }), {
      headers:{'content-type':'application/json','cache-control':'public, max-age=45'}
    });
    await caches.default.put(cacheRequest(env), r);
  } catch {}
}
async function clearListCache(env) {
  try { if (globalThis.caches?.default) await caches.default.delete(cacheRequest(env)); } catch {}
}

function iso(v) {
  const s = clean(v);
  if (!s) return '';
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
}
function br(v) {
  const s = iso(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(v);
}
function nowBRDate() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date());
}
function nowBRFull() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date());
}
function json(v, fallback) {
  try { const x = JSON.parse(clean(v) || ''); return x ?? fallback; } catch { return fallback; }
}
function jsonText(v) { return JSON.stringify(v ?? null); }
function uuid() { return crypto.randomUUID(); }
function actor(input) { return clean(input?.actor) || clean(input?.usuario) || 'Sistema'; }

function record(row, rowNumber) {
  const history = json(row[COL.historico], []);
  const tasks = json(row[COL.tarefas], []);
  const comments = json(row[COL.comentarios], []);
  const meta = json(row[COL.meta], {});
  return {
    id: rowNumber,
    responsavel: clean(row[0]), processo: clean(row[1]), cliente: clean(row[2]), adverso: clean(row[3]),
    comarca: clean(row[4]), vara: clean(row[5]), secao: clean(row[6]), solicitacao: clean(row[7]),
    dataSolicitacao: iso(row[8]), status: clean(row[9]), obs: clean(row[10]), atualizadoEm: iso(row[11]),
    prioridade: clean(row[12]) || 'Normal', proximaAcao: clean(row[13]), proximaData: iso(row[14]),
    versao: Number(row[COL.versao] || 1), ultimoEditor: clean(row[COL.ultimoEditor]),
    historyCount: Array.isArray(history) ? history.length : 0,
    taskCount: Array.isArray(tasks) ? tasks.filter(t => !/conclu/i.test(clean(t.status))).length : 0,
    commentCount: Array.isArray(comments) ? comments.length : 0,
    favorito: Boolean(meta?.favorito), tags: Array.isArray(meta?.tags) ? meta.tags : [], decisionOwner: clean(meta?.decisionOwner),
    datajud: meta?.datajud || null,
  };
}
function listRows(book) {
  const rows = getMainRows(book, WIDTH), out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = record(rows[i] || [], i + 1);
    if (r.processo || r.cliente || r.solicitacao || r.obs) out.push(r);
  }
  return { rows, out };
}
function ensureHeaders(book, rows) {
  const header = Array.from({ length: WIDTH }, (_, i) => clean((rows[0] || [])[i]));
  const names = ['Responsável','Nº do processo','Cliente','Adverso','Comarca','Vara','Seção','Solicitação','Data da Solicitação','Status','OBS','Atualizado em','Prioridade','Próxima ação','Próxima verificação','Sistema_Histórico','Sistema_Tarefas','Sistema_Comentários','Sistema_Meta','Sistema_Versão','Sistema_ÚltimoEditor'];
  let changed = false;
  for (let i = 0; i < WIDTH; i++) if (!header[i]) { header[i] = names[i]; changed = true; }
  if (changed) setMainRow(book, 1, header);
}
function fullRow(existing = []) { return Array.from({ length: WIDTH }, (_, i) => clean(existing[i])); }
function addHistory(row, entry = {}) {
  const arr = json(row[COL.historico], []);
  const out = Array.isArray(arr) ? arr : [];
  out.unshift({ id: uuid(), data: nowBRFull(), tipo: clean(entry.tipo) || 'Atualização', texto: clean(entry.texto), usuario: clean(entry.usuario) || 'Sistema' });
  row[COL.historico] = jsonText(out.slice(0, 250));
}
const DIFF_LABELS={0:'Responsável',1:'Processo',2:'Cliente',3:'Adverso',4:'Comarca',5:'Vara',6:'Seção',7:'Solicitação',8:'Data da solicitação',9:'Status',10:'Observação',12:'Prioridade',13:'Próxima ação',14:'Próxima verificação'};
function diffSummary(before, after, data={}) {
  const changes=[];
  for (const [key,index] of Object.entries(COL)) {
    if (index>=15 || index===11 || !Object.prototype.hasOwnProperty.call(data,key)) continue;
    const a=clean(before[index]), b=clean(after[index]);
    if (a===b) continue;
    const label=DIFF_LABELS[index]||key;
    const oldVal=a || '—', newVal=b || '—';
    changes.push(`${label}: “${oldVal}” → “${newVal}”`);
  }
  return changes;
}
function makeRow(data = {}, existing = [], who = 'Sistema', mode = 'update') {
  const before = fullRow(existing);
  const row = fullRow(existing);
  for (const [key, index] of Object.entries(COL)) {
    if (index >= 15 || key === 'atualizadoEm') continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) row[index] = ['dataSolicitacao','proximaData'].includes(key) ? br(data[key]) : clean(data[key]);
  }
  row[COL.atualizadoEm] = nowBRDate();
  if (!clean(row[COL.prioridade])) row[COL.prioridade] = 'Normal';
  row[COL.versao] = String(Math.max(1, Number(row[COL.versao] || 0) + 1));
  row[COL.ultimoEditor] = who;
  if (mode === 'create') {
    addHistory(row, { tipo:'Cadastro', texto:'Processo incluído pelo sistema.', usuario:who });
  } else {
    const changes=diffSummary(before,row,data);
    addHistory(row,{tipo:'Atualização',texto:changes.length?changes.join(' | '):'Dados da diligência atualizados.',usuario:who});
  }
  return row;
}
function findRow(rows, input) {
  const rn = Number(input?.id || input?.row);
  if (Number.isInteger(rn) && rn >= 2) return { rowNumber: rn, row: rows[rn - 1] || [] };
  const p = clean(input?.processo);
  if (p) {
    const idx = rows.findIndex((r, i) => i > 0 && clean(r?.[1]) === p);
    if (idx >= 1) return { rowNumber: idx + 1, row: rows[idx] || [] };
  }
  throw new Error('Processo/linha não encontrado.');
}
function detailed(row, rowNumber) {
  return {
    ...record(row, rowNumber),
    history: json(row[COL.historico], []), tasks: json(row[COL.tarefas], []),
    comments: json(row[COL.comentarios], []), meta: json(row[COL.meta], {}),
  };
}
function d1UpsertStatement(db, row, rowNumber) {
  const r = detailed(row, rowNumber);
  return db.prepare(`INSERT INTO workspace_records
    (row_id,processo,cliente,responsavel,status,prioridade,proxima_data,atualizado_em,payload_json,indexed_at)
    VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(row_id) DO UPDATE SET
      processo=excluded.processo,cliente=excluded.cliente,responsavel=excluded.responsavel,status=excluded.status,
      prioridade=excluded.prioridade,proxima_data=excluded.proxima_data,atualizado_em=excluded.atualizado_em,
      payload_json=excluded.payload_json,indexed_at=CURRENT_TIMESTAMP`).bind(
        rowNumber,r.processo,r.cliente,r.responsavel,r.status,r.prioridade,r.proximaData,r.atualizadoEm,JSON.stringify(r)
      );
}
async function mirrorD1(env, row, rowNumber) {
  if (!env.DB) return false;
  try {
    await d1UpsertStatement(env.DB,row,rowNumber).run();
    await env.DB.prepare(`INSERT INTO workspace_state(key,value,updated_at) VALUES('last_mutation',?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(new Date().toISOString()).run();
    return true;
  } catch (e) {
    console.error('DILIMAGALHAES D1 MIRROR',e);
    return false;
  }
}
async function mirrorManyD1(env, entries) {
  if (!env.DB || !entries.length) return false;
  try {
    await env.DB.batch(entries.map(x=>d1UpsertStatement(env.DB,x.row,x.rowNumber)));
    await env.DB.prepare(`INSERT INTO workspace_state(key,value,updated_at) VALUES('last_mutation',?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(new Date().toISOString()).run();
    return true;
  } catch (e) {
    console.error('DILIMAGALHAES D1 BATCH MIRROR',e);
    return false;
  }
}
async function loadListFresh(env) {
  const book = await loadWorkbook(env), { out } = listRows(book);
  await writeListCache(env, out);
  return out;
}

export async function onRequestGet({ env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  try {
    const cached = await readListCache(env);
    if (cached?.rows) return reply({ ok:true, source:'cache', sheet:'Planilha Geral', rows:cached.rows.length, cached:true });
    const out = await loadListFresh(env);
    return reply({ ok:true, source:'google-drive-xlsx-direct', sheet:'Planilha Geral', rows:out.length });
  } catch (e) {
    console.error('DILIMAGALHAES GET', e);
    return reply({ error: e.message || 'Falha ao acessar a planilha.' }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error:'JSON inválido.' },400); }
  const action = clean(input.action), who = actor(input);
  try {
    if (action === 'list') {
      const cached = await readListCache(env);
      if (cached?.rows) return reply({ rows:cached.rows, source:'cache', cached:true, cachedAt:cached.cachedAt });
      const out = await loadListFresh(env);
      return reply({ rows:out, source:'google-drive-xlsx-direct', cached:false });
    }

    const book = await loadWorkbook(env), { rows } = listRows(book);
    ensureHeaders(book, rows);

    if (action === 'detail') {
      const f = findRow(rows, input);
      return reply({ row:detailed(f.row, f.rowNumber) });
    }
    if (action === 'create') {
      const data = input.record || {};
      if (!clean(data.processo)) throw new Error('Número do processo é obrigatório.');
      const rowNumber = nextMainRow(book), row = makeRow(data, [], who, 'create');
      setMainRow(book, rowNumber, row);
      await saveWorkbook(env, book); await clearListCache(env);
      const d1Mirrored=await mirrorD1(env,row,rowNumber);
      return reply({ ok:true, row:rowNumber, versao:Number(row[COL.versao]), source:'google-drive-xlsx-direct', d1Mirrored });
    }
    if (action === 'update') {
      const data=input.record||{}, f=findRow(rows,data), existing=fullRow(f.row);
      const expected=Number(data.versao||input.expectedVersion||0), current=Number(existing[COL.versao]||1);
      if (expected && expected!==current) return reply({ error:'Este processo foi alterado por outra pessoa. Atualize a tela antes de salvar.', code:'VERSION_CONFLICT', currentVersion:current },409);
      const row=makeRow(data,existing,who,'update');
      setMainRow(book,f.rowNumber,row); await saveWorkbook(env,book); await clearListCache(env);
      const d1Mirrored=await mirrorD1(env,row,f.rowNumber);
      return reply({ ok:true,row:f.rowNumber,versao:Number(row[COL.versao]),source:'google-drive-xlsx-direct',d1Mirrored });
    }
    if (action === 'datajud.batchSave') {
      const updates = Array.isArray(input.updates) ? input.updates.slice(0,50) : [];
      let changed=0; const mirrored=[];
      for (const u of updates) {
        try {
          const f=findRow(rows,u), row=fullRow(f.row), meta={...json(row[COL.meta],{}),datajud:u.datajud||null};
          row[COL.meta]=jsonText(meta); row[COL.versao]=String(Number(row[COL.versao]||1)+1); row[COL.ultimoEditor]=who;
          setMainRow(book,f.rowNumber,row); mirrored.push({row,rowNumber:f.rowNumber}); changed++;
        } catch {}
      }
      let d1Mirrored=false;
      if (changed) { await saveWorkbook(env,book); await clearListCache(env); d1Mirrored=await mirrorManyD1(env,mirrored); }
      return reply({ ok:true, changed, d1Mirrored });
    }

    const f=findRow(rows,input), row=fullRow(f.row);
    if (action==='history.list') return reply({ rows:json(row[COL.historico],[]) });
    if (action==='history.add') {
      addHistory(row,{...(input.entry||{}),usuario:who});
      row[COL.versao]=String(Number(row[COL.versao]||1)+1); row[COL.ultimoEditor]=who; row[COL.atualizadoEm]=nowBRDate();
    } else if (action==='task.list') return reply({ rows:json(row[COL.tarefas],[]) });
    else if (action==='task.create') {
      const arr=json(row[COL.tarefas],[]), task=input.task||{};
      arr.unshift({id:uuid(),tarefa:clean(task.tarefa),responsavel:clean(task.responsavel),prazo:iso(task.prazo),status:clean(task.status)||'Aberta',criadoEm:nowBRFull(),criadoPor:who});
      row[COL.tarefas]=jsonText(arr.slice(0,200)); addHistory(row,{tipo:'Tarefa',texto:`Tarefa criada: ${clean(task.tarefa)}`,usuario:who});
      row[COL.versao]=String(Number(row[COL.versao]||1)+1); row[COL.ultimoEditor]=who;
    } else if (action==='task.update') {
      const arr=json(row[COL.tarefas],[]), id=clean(input.task?.id), idx=arr.findIndex(t=>clean(t.id)===id); if(idx<0) throw new Error('Tarefa não encontrada.');
      arr[idx]={...arr[idx],...input.task,atualizadoEm:nowBRFull(),atualizadoPor:who}; row[COL.tarefas]=jsonText(arr);
      addHistory(row,{tipo:'Tarefa',texto:`Tarefa atualizada: ${clean(arr[idx].tarefa)}`,usuario:who}); row[COL.versao]=String(Number(row[COL.versao]||1)+1); row[COL.ultimoEditor]=who;
    } else if (action==='comment.list') return reply({ rows:json(row[COL.comentarios],[]) });
    else if (action==='comment.add') {
      const arr=json(row[COL.comentarios],[]), texto=clean(input.texto); if(!texto) throw new Error('Comentário vazio.');
      arr.unshift({id:uuid(),texto,usuario:who,data:nowBRFull()}); row[COL.comentarios]=jsonText(arr.slice(0,250));
      addHistory(row,{tipo:'Comentário',texto,usuario:who}); row[COL.versao]=String(Number(row[COL.versao]||1)+1); row[COL.ultimoEditor]=who;
    } else if (action==='meta.patch') {
      const meta={...json(row[COL.meta],{}),...(input.patch||{})}; row[COL.meta]=jsonText(meta);
      addHistory(row,{tipo:'Sistema',texto:'Metadados operacionais atualizados.',usuario:who}); row[COL.versao]=String(Number(row[COL.versao]||1)+1); row[COL.ultimoEditor]=who;
    } else throw new Error(`Ação inválida: ${action || '(vazia)'}`);

    setMainRow(book,f.rowNumber,row); await saveWorkbook(env,book); await clearListCache(env);
    const d1Mirrored=await mirrorD1(env,row,f.rowNumber);
    return reply({ ok:true,row:f.rowNumber,versao:Number(row[COL.versao]),source:'google-drive-xlsx-direct',d1Mirrored });
  } catch (e) {
    console.error('DILIMAGALHAES API', e);
    return reply({ error:e.message || 'Falha ao acessar o XLSX.' },502);
  }
}
