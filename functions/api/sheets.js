import { configured, loadWorkbook, getMainRows, setMainRow, nextMainRow, saveWorkbook } from '../lib/drive-xlsx.js';

const COL = {
  responsavel: 0, processo: 1, cliente: 2, adverso: 3, comarca: 4, vara: 5,
  secao: 6, solicitacao: 7, dataSolicitacao: 8, status: 9, obs: 10,
  atualizadoEm: 11, prioridade: 12, proximaAcao: 13, proximaData: 14,
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
function br(v) {
  const s = iso(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(v);
}
function nowBR() {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date());
}
function record(row, rowNumber) {
  return {
    id: rowNumber,
    responsavel: clean(row[0]), processo: clean(row[1]), cliente: clean(row[2]), adverso: clean(row[3]),
    comarca: clean(row[4]), vara: clean(row[5]), secao: clean(row[6]), solicitacao: clean(row[7]),
    dataSolicitacao: iso(row[8]), status: clean(row[9]), obs: clean(row[10]), atualizadoEm: iso(row[11]),
    prioridade: clean(row[12]) || 'Normal', proximaAcao: clean(row[13]), proximaData: iso(row[14]),
  };
}
function listRows(book) {
  const rows = getMainRows(book, 15), out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = record(rows[i] || [], i + 1);
    if (r.processo || r.cliente || r.solicitacao || r.obs) out.push(r);
  }
  return { rows, out };
}
function makeRow(data = {}, existing = []) {
  const row = Array.from({ length: 15 }, (_, i) => clean(existing[i]));
  for (const [key, index] of Object.entries(COL)) {
    if (key === 'atualizadoEm') continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) row[index] = ['dataSolicitacao','proximaData'].includes(key) ? br(data[key]) : clean(data[key]);
  }
  row[COL.atualizadoEm] = nowBR();
  if (!clean(row[COL.prioridade])) row[COL.prioridade] = 'Normal';
  return row;
}
function ensureHeaders(book, rows) {
  const header = Array.from({ length: 15 }, (_, i) => clean((rows[0] || [])[i]));
  let changed = false;
  if (!header[12]) { header[12] = 'Prioridade'; changed = true; }
  if (!header[13]) { header[13] = 'Próxima ação'; changed = true; }
  if (!header[14]) { header[14] = 'Próxima verificação'; changed = true; }
  if (changed) setMainRow(book, 1, header);
}

export async function onRequestGet({ env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  try {
    const book = await loadWorkbook(env), { out } = listRows(book);
    return reply({ ok: true, source: 'google-drive-xlsx-direct', sheet: 'Planilha Geral', rows: out.length });
  } catch (e) {
    console.error('DILIMAGALHAES GET', e);
    return reply({ error: e.message || 'Falha ao acessar a planilha.' }, 502);
  }
}

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  const action = clean(input.action);
  try {
    const book = await loadWorkbook(env), { rows, out } = listRows(book);
    if (action === 'list') return reply({ rows: out, source: 'google-drive-xlsx-direct' });
    if (action === 'history.list' || action === 'task.list') return reply({ rows: [] });
    ensureHeaders(book, rows);

    if (action === 'create') {
      const data = input.record || {};
      if (!clean(data.processo)) throw new Error('Número do processo é obrigatório.');
      const rowNumber = nextMainRow(book);
      setMainRow(book, rowNumber, makeRow(data));
      await saveWorkbook(env, book);
      return reply({ ok: true, row: rowNumber, source: 'google-drive-xlsx-direct' });
    }
    if (action === 'update') {
      const data = input.record || {}, rowNumber = Number(data.id);
      if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Linha inválida para atualização.');
      const existing = rows[rowNumber - 1] || [];
      setMainRow(book, rowNumber, makeRow(data, existing));
      await saveWorkbook(env, book);
      return reply({ ok: true, row: rowNumber, source: 'google-drive-xlsx-direct' });
    }
    if (action === 'history.add' || action === 'task.create') {
      return reply({ ok: true, warning: 'Histórico e tarefas serão ativados em uma etapa posterior.' });
    }
    throw new Error(`Ação inválida: ${action || '(vazia)'}`);
  } catch (e) {
    console.error('DILIMAGALHAES API', e);
    return reply({ error: e.message || 'Falha ao acessar o XLSX.' }, 502);
  }
}
