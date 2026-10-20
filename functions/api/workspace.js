import { configured, loadWorkbook, getMainRows } from '../lib/drive-xlsx.js';

const WIDTH = 21;
const STALE_SECONDS = 900;
const COL = {
  historico: 15, tarefas: 16, comentarios: 17, meta: 18, versao: 19, ultimoEditor: 20,
};
const clean = v => v === null || v === undefined ? '' : String(v).trim();
const pad = v => String(v).padStart(2, '0');
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
function iso(v) {
  const s = clean(v);
  if (!s) return '';
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
}
function json(v, fallback) {
  try { const x = JSON.parse(clean(v) || ''); return x ?? fallback; } catch { return fallback; }
}
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
    history, tasks, comments, meta,
    versao: Number(row[COL.versao] || 1), ultimoEditor: clean(row[COL.ultimoEditor]),
    historyCount: Array.isArray(history) ? history.length : 0,
    taskCount: Array.isArray(tasks) ? tasks.filter(t => !/conclu/i.test(clean(t.status))).length : 0,
    commentCount: Array.isArray(comments) ? comments.length : 0,
    favorito: Boolean(meta?.favorito), tags: Array.isArray(meta?.tags) ? meta.tags : [],
    decisionOwner: clean(meta?.decisionOwner), datajud: meta?.datajud || null,
  };
}
function summary(r) {
  const { history, tasks, comments, meta, ...rest } = r;
  return rest;
}
async function ensure(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS workspace_records (
      row_id INTEGER PRIMARY KEY,
      processo TEXT,
      cliente TEXT,
      responsavel TEXT,
      status TEXT,
      prioridade TEXT,
      proxima_data TEXT,
      atualizado_em TEXT,
      payload_json TEXT NOT NULL,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE INDEX IF NOT EXISTS idx_workspace_processo ON workspace_records(processo)',
    'CREATE INDEX IF NOT EXISTS idx_workspace_cliente ON workspace_records(cliente)',
    'CREATE INDEX IF NOT EXISTS idx_workspace_responsavel ON workspace_records(responsavel)',
    'CREATE INDEX IF NOT EXISTS idx_workspace_status ON workspace_records(status)',
    `CREATE TABLE IF NOT EXISTS workspace_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
}
async function setState(db, key, value) {
  await db.prepare(`INSERT INTO workspace_state(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).bind(key, value).run();
}
async function getState(db, key) {
  const r = await db.prepare('SELECT value, updated_at FROM workspace_state WHERE key=?').bind(key).first();
  return r || null;
}
async function syncFromXlsx(env, db) {
  if (!configured(env)) throw new Error('Integração Google Drive não configurada.');
  const started = Date.now();
  const book = await loadWorkbook(env);
  const rows = getMainRows(book, WIDTH);
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const r = record(rows[i] || [], i + 1);
    if (r.processo || r.cliente || r.solicitacao || r.obs) records.push(r);
  }
  await ensure(db);
  await db.prepare('DELETE FROM workspace_records').run();
  for (let i = 0; i < records.length; i += 40) {
    const chunk = records.slice(i, i + 40).map(r => db.prepare(`INSERT INTO workspace_records
      (row_id,processo,cliente,responsavel,status,prioridade,proxima_data,atualizado_em,payload_json,indexed_at)
      VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(
        r.id, r.processo, r.cliente, r.responsavel, r.status, r.prioridade, r.proximaData, r.atualizadoEm, JSON.stringify(r)
      ));
    if (chunk.length) await db.batch(chunk);
  }
  const now = new Date().toISOString();
  await setState(db, 'last_sync', now);
  await setState(db, 'record_count', String(records.length));
  return { count: records.length, syncedAt: now, durationMs: Date.now() - started };
}
async function listFromDb(db) {
  const q = await db.prepare('SELECT payload_json FROM workspace_records ORDER BY row_id ASC').all();
  return (q.results || []).map(x => {
    try { return summary(JSON.parse(x.payload_json)); } catch { return null; }
  }).filter(Boolean);
}
async function detailFromDb(db, input) {
  let row = null;
  const id = Number(input?.id || input?.row);
  if (Number.isInteger(id) && id >= 2) row = await db.prepare('SELECT payload_json FROM workspace_records WHERE row_id=?').bind(id).first();
  if (!row && clean(input?.processo)) row = await db.prepare('SELECT payload_json FROM workspace_records WHERE processo=? LIMIT 1').bind(clean(input.processo)).first();
  if (!row) return null;
  try { return JSON.parse(row.payload_json); } catch { return null; }
}
function isStale(state, seconds = STALE_SECONDS) {
  const t = Date.parse(state?.value || '');
  return !Number.isFinite(t) || Date.now() - t > seconds * 1000;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return reply({ error: 'D1 ainda não vinculado.', code: 'D1_NOT_BOUND' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  const action = clean(input.action || 'list');
  try {
    await ensure(env.DB);
    if (action === 'status') {
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_records').first();
      const last = await getState(env.DB, 'last_sync');
      return reply({ ok: true, engine: 'd1', count: Number(count?.n || 0), lastSync: last?.value || null, staleAfterSeconds: STALE_SECONDS });
    }
    if (action === 'sync') {
      const result = await syncFromXlsx(env, env.DB);
      return reply({ ok: true, engine: 'd1', ...result });
    }
    if (action === 'list') {
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_records').first();
      if (!Number(count?.n || 0)) await syncFromXlsx(env, env.DB);
      const rows = await listFromDb(env.DB);
      const last = await getState(env.DB, 'last_sync');
      if (isStale(last) && context.waitUntil) context.waitUntil(syncFromXlsx(env, env.DB).catch(console.error));
      return reply({ rows, source: 'cloudflare-d1', cached: true, lastSync: last?.value || null });
    }
    if (action === 'detail') {
      let row = await detailFromDb(env.DB, input);
      if (!row) {
        await syncFromXlsx(env, env.DB);
        row = await detailFromDb(env.DB, input);
      }
      return row ? reply({ row, source: 'cloudflare-d1' }) : reply({ error: 'Processo não encontrado.' }, 404);
    }
    return reply({ error: `Ação inválida: ${action}` }, 400);
  } catch (e) {
    console.error('DILIMAGALHAES WORKSPACE', e);
    return reply({ error: e?.message || 'Falha no workspace D1.' }, 502);
  }
}
