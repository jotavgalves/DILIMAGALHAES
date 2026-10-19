import { configured, withTempSpreadsheet, sheetsGet, sheetsJson } from '../lib/drive-xlsx.js';

const MAIN = 'Planilha Geral';
const HIST = 'Sistema_Historico';
const TASKS = 'Sistema_Tarefas';
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
const q = s => `'${String(s).replace(/'/g, "''")}'`;

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
async function getValues(env, id, range) {
  const data = await sheetsGet(env, id, `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
  return Array.isArray(data.values) ? data.values : [];
}
async function putValues(env, id, range, values) {
  return sheetsJson(env, id, `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, 'PUT', {
    range, majorDimension: 'ROWS', values,
  });
}
async function appendValues(env, id, range, values) {
  return sheetsJson(env, id, `/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, 'POST', {
    range, majorDimension: 'ROWS', values,
  });
}
async function metadata(env, id) {
  return sheetsGet(env, id, '?fields=sheets.properties');
}
async function ensureAux(env, id) {
  let meta = await metadata(env, id);
  const titles = new Set((meta.sheets || []).map(s => s.properties?.title));
  const requests = [];
  if (!titles.has(HIST)) requests.push({ addSheet: { properties: { title: HIST, hidden: true } } });
  if (!titles.has(TASKS)) requests.push({ addSheet: { properties: { title: TASKS, hidden: true } } });
  if (requests.length) {
    await sheetsJson(env, id, ':batchUpdate', 'POST', { requests });
    if (!titles.has(HIST)) await putValues(env, id, `${q(HIST)}!A1:F1`, [['ID','Processo','Data','Tipo','Texto','Usuário']]);
    if (!titles.has(TASKS)) await putValues(env, id, `${q(TASKS)}!A1:G1`, [['ID','Processo','Tarefa','Responsável','Prazo','Status','Criado em']]);
  }
}
async function ensureMainHeaders(env, id, rows) {
  const header = rows[0] || [];
  let changed = false;
  const next = [...header];
  while (next.length < 15) next.push('');
  if (!clean(next[12])) { next[12] = 'Prioridade'; changed = true; }
  if (!clean(next[13])) { next[13] = 'Próxima ação'; changed = true; }
  if (!clean(next[14])) { next[14] = 'Próxima verificação'; changed = true; }
  if (changed) await putValues(env, id, `${q(MAIN)}!A1:O1`, [next.slice(0,15)]);
}
async function listRows(env, id) {
  const rows = await getValues(env, id, `${q(MAIN)}!A:O`);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = record(rows[i] || [], i + 1);
    if (r.processo || r.cliente || r.solicitacao || r.obs) out.push(r);
  }
  return { rows, out };
}
async function copyPreviousRowFormatting(env, id, rowNumber) {
  if (rowNumber <= 2) return;
  const meta = await metadata(env, id);
  const sh = (meta.sheets || []).find(s => s.properties?.title === MAIN);
  const sheetId = sh?.properties?.sheetId;
  if (sheetId === undefined) return;
  await sheetsJson(env, id, ':batchUpdate', 'POST', {
    requests: [{ copyPaste: {
      source: { sheetId, startRowIndex: rowNumber - 2, endRowIndex: rowNumber - 1, startColumnIndex: 0, endColumnIndex: 15 },
      destination: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 15 },
      pasteType: 'PASTE_FORMAT',
    }}],
  });
}
function makeRow(data = {}, existing = []) {
  const row = Array.from({ length: 15 }, (_, i) => clean(existing[i]));
  for (const [key, index] of Object.entries(COL)) {
    if (key === 'atualizadoEm') continue;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      row[index] = ['dataSolicitacao','proximaData'].includes(key) ? br(data[key]) : clean(data[key]);
    }
  }
  row[COL.atualizadoEm] = nowBR();
  if (!clean(row[COL.prioridade])) row[COL.prioridade] = 'Normal';
  return row;
}
async function addHistory(env, id, processo, entry = {}) {
  await ensureAux(env, id);
  const uuid = crypto.randomUUID();
  await appendValues(env, id, `${q(HIST)}!A:F`, [[
    uuid, clean(processo), new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' }),
    clean(entry.tipo) || 'Atualização', clean(entry.texto), clean(entry.usuario) || 'Sistema',
  ]]);
  return uuid;
}
async function historyList(env, id, processo) {
  const rows = await getValues(env, id, `${q(HIST)}!A:F`).catch(() => []);
  const target = clean(processo), out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (target && clean(r[1]) !== target) continue;
    out.push({ id: clean(r[0]), processo: clean(r[1]), data: clean(r[2]), tipo: clean(r[3]), texto: clean(r[4]), usuario: clean(r[5]) });
  }
  return out.reverse();
}
async function taskList(env, id, processo) {
  const rows = await getValues(env, id, `${q(TASKS)}!A:G`).catch(() => []);
  const target = clean(processo), out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (target && clean(r[1]) !== target) continue;
    out.push({ id: clean(r[0]), processo: clean(r[1]), tarefa: clean(r[2]), responsavel: clean(r[3]), prazo: iso(r[4]), status: clean(r[5]) || 'Aberta', criadoEm: clean(r[6]) });
  }
  return out.reverse();
}
async function taskCreate(env, id, task = {}) {
  if (!clean(task.processo)) throw new Error('Processo não informado para a tarefa.');
  if (!clean(task.tarefa)) throw new Error('Descrição da tarefa é obrigatória.');
  await ensureAux(env, id);
  const uuid = crypto.randomUUID();
  await appendValues(env, id, `${q(TASKS)}!A:G`, [[
    uuid, clean(task.processo), clean(task.tarefa), clean(task.responsavel), br(task.prazo), clean(task.status) || 'Aberta',
    new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' }),
  ]]);
  await addHistory(env, id, task.processo, { tipo: 'Tarefa', texto: `Tarefa criada: ${clean(task.tarefa)}` });
  return uuid;
}

export async function onRequestGet({ env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  try {
    const result = await withTempSpreadsheet(env, false, async id => {
      const { out } = await listRows(env, id);
      return { ok: true, source: 'google-drive-xlsx', sheet: MAIN, rows: out.length };
    });
    return reply(result);
  } catch (e) { return reply({ error: e.message || 'Falha ao acessar a planilha.' }, 502); }
}

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  const action = clean(input.action);
  const write = ['create','update','history.add','task.create'].includes(action);
  try {
    const result = await withTempSpreadsheet(env, write, async id => {
      const { rows, out } = await listRows(env, id);
      if (action === 'list') return { rows: out, source: 'google-drive-xlsx' };
      if (action === 'history.list') return { rows: await historyList(env, id, input.processo) };
      if (action === 'task.list') return { rows: await taskList(env, id, input.processo) };
      await ensureMainHeaders(env, id, rows);

      if (action === 'create') {
        const data = input.record || {};
        if (!clean(data.processo)) throw new Error('Número do processo é obrigatório.');
        const rowNumber = Math.max(2, rows.length + 1);
        await copyPreviousRowFormatting(env, id, rowNumber);
        await putValues(env, id, `${q(MAIN)}!A${rowNumber}:O${rowNumber}`, [makeRow(data)]);
        await addHistory(env, id, data.processo, { tipo: 'Cadastro', texto: 'Processo incluído pelo sistema.' });
        return { ok: true, row: rowNumber, source: 'google-drive-xlsx' };
      }
      if (action === 'update') {
        const data = input.record || {}, rowNumber = Number(data.id);
        if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('Linha inválida para atualização.');
        const existing = rows[rowNumber - 1] || [];
        const merged = makeRow(data, existing);
        await putValues(env, id, `${q(MAIN)}!A${rowNumber}:O${rowNumber}`, [merged]);
        await addHistory(env, id, clean(data.processo) || clean(existing[1]), { tipo: 'Atualização', texto: 'Cadastro/status atualizado pelo sistema.' });
        return { ok: true, row: rowNumber, source: 'google-drive-xlsx' };
      }
      if (action === 'history.add') {
        return { ok: true, row: await addHistory(env, id, input.processo, input.entry || {}), source: 'google-drive-xlsx' };
      }
      if (action === 'task.create') {
        return { ok: true, row: await taskCreate(env, id, input.task || {}), source: 'google-drive-xlsx' };
      }
      throw new Error(`Ação inválida: ${action || '(vazia)'}`);
    });
    return reply(result);
  } catch (e) {
    console.error('DILIMAGALHAES API', e);
    return reply({ error: e.message || 'Falha ao acessar o XLSX.' }, 502);
  }
}
