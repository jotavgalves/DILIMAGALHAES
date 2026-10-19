import { configured, loadWorkbook, saveWorkbook } from '../lib/drive-xlsx.js';

const MAIN = 'Planilha Geral';
const HIST = 'Sistema_Historico';
const TASKS = 'Sistema_Tarefas';
const COL = {
  responsavel: 1, processo: 2, cliente: 3, adverso: 4, comarca: 5, vara: 6,
  secao: 7, solicitacao: 8, dataSolicitacao: 9, status: 10, obs: 11,
  atualizadoEm: 12, prioridade: 13, proximaAcao: 14, proximaData: 15,
};

const clean = v => v === null || v === undefined ? '' : String(v).trim();
const pad = v => String(v).padStart(2, '0');
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function value(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date || typeof v !== 'object') return v;
  if ('result' in v) return v.result ?? '';
  if (Array.isArray(v.richText)) return v.richText.map(x => x.text || '').join('');
  if ('text' in v) return v.text ?? '';
  if ('hyperlink' in v) return v.text || v.hyperlink || '';
  return cell?.text || '';
}

function iso(v) {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  const s = clean(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
}

function dateValue(v) {
  const s = iso(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : clean(v);
}

function sheetMain(workbook) {
  const sheet = workbook.getWorksheet(MAIN);
  if (!sheet) throw new Error(`Aba "${MAIN}" não encontrada no arquivo XLSX.`);
  return sheet;
}

function copyStyle(from, to) {
  try { to.style = JSON.parse(JSON.stringify(from.style || {})); } catch {}
  if (from.numFmt) to.numFmt = from.numFmt;
}

function ensureHeaders(sheet) {
  const names = { 13: 'Prioridade', 14: 'Próxima ação', 15: 'Próxima verificação' };
  for (const [col, title] of Object.entries(names)) {
    const cell = sheet.getCell(1, +col);
    if (!clean(value(cell))) {
      copyStyle(sheet.getCell(1, 12), cell);
      cell.value = title;
    }
  }
}

function ensureAux(workbook) {
  let hist = workbook.getWorksheet(HIST);
  if (!hist) {
    hist = workbook.addWorksheet(HIST, { state: 'veryHidden' });
    hist.addRow(['ID', 'Processo', 'Data', 'Tipo', 'Texto', 'Usuário']);
    hist.state = 'veryHidden';
  }
  let tasks = workbook.getWorksheet(TASKS);
  if (!tasks) {
    tasks = workbook.addWorksheet(TASKS, { state: 'veryHidden' });
    tasks.addRow(['ID', 'Processo', 'Tarefa', 'Responsável', 'Prazo', 'Status', 'Criado em']);
    tasks.state = 'veryHidden';
  }
  return { hist, tasks };
}

function record(row) {
  return {
    id: row.number,
    responsavel: clean(value(row.getCell(1))), processo: clean(value(row.getCell(2))),
    cliente: clean(value(row.getCell(3))), adverso: clean(value(row.getCell(4))),
    comarca: clean(value(row.getCell(5))), vara: clean(value(row.getCell(6))),
    secao: clean(value(row.getCell(7))), solicitacao: clean(value(row.getCell(8))),
    dataSolicitacao: iso(value(row.getCell(9))), status: clean(value(row.getCell(10))),
    obs: clean(value(row.getCell(11))), atualizadoEm: iso(value(row.getCell(12))),
    prioridade: clean(value(row.getCell(13))) || 'Normal',
    proximaAcao: clean(value(row.getCell(14))), proximaData: iso(value(row.getCell(15))),
  };
}

function list(workbook) {
  const sh = sheetMain(workbook), out = [];
  for (let n = 2; n <= sh.rowCount; n++) {
    const r = record(sh.getRow(n));
    if (r.processo || r.cliente || r.solicitacao || r.obs) out.push(r);
  }
  return out;
}

function nextRow(sh) {
  for (let n = sh.rowCount; n >= 2; n--) {
    const row = sh.getRow(n);
    if ([1,2,3,8,10,11].some(c => clean(value(row.getCell(c))))) return n + 1;
  }
  return 2;
}

function setCell(row, key, v) {
  const cell = row.getCell(COL[key]);
  if (['dataSolicitacao', 'atualizadoEm', 'proximaData'].includes(key)) {
    cell.value = v ? dateValue(v) : '';
    if (v) cell.numFmt = 'dd/mm/yyyy';
  } else cell.value = clean(v);
}

function addHist(workbook, processo, entry = {}) {
  const { hist } = ensureAux(workbook);
  const id = crypto.randomUUID();
  const row = hist.addRow([
    id, clean(processo), new Date(), clean(entry.tipo) || 'Atualização',
    clean(entry.texto), clean(entry.usuario) || 'Sistema',
  ]);
  row.getCell(3).numFmt = 'dd/mm/yyyy hh:mm';
  return id;
}

function create(workbook, data) {
  if (!clean(data.processo)) throw new Error('Número do processo é obrigatório.');
  const sh = sheetMain(workbook);
  ensureHeaders(sh); ensureAux(workbook);
  const n = nextRow(sh), row = sh.getRow(n), template = sh.getRow(Math.max(2, n - 1));
  for (let c = 1; c <= 15; c++) copyStyle(template.getCell(c), row.getCell(c));
  if (template.height) row.height = template.height;
  for (const key of Object.keys(COL)) if (key !== 'atualizadoEm') setCell(row, key, data[key]);
  setCell(row, 'atualizadoEm', new Date());
  if (!clean(value(row.getCell(13)))) row.getCell(13).value = 'Normal';
  addHist(workbook, data.processo, { tipo: 'Cadastro', texto: 'Processo incluído pelo sistema.' });
  return n;
}

function update(workbook, data) {
  const n = Number(data.id), sh = sheetMain(workbook);
  if (!Number.isInteger(n) || n < 2 || n > sh.rowCount) throw new Error('Linha inválida para atualização.');
  ensureHeaders(sh); ensureAux(workbook);
  const row = sh.getRow(n);
  for (const key of Object.keys(COL)) {
    if (key !== 'atualizadoEm' && Object.prototype.hasOwnProperty.call(data, key)) setCell(row, key, data[key]);
  }
  setCell(row, 'atualizadoEm', new Date());
  const processo = clean(data.processo) || clean(value(row.getCell(2)));
  addHist(workbook, processo, { tipo: 'Atualização', texto: 'Cadastro/status atualizado pelo sistema.' });
  return n;
}

function historyList(workbook, processo) {
  const sh = workbook.getWorksheet(HIST);
  if (!sh) return [];
  const target = clean(processo), out = [];
  for (let n = 2; n <= sh.rowCount; n++) {
    const row = sh.getRow(n), p = clean(value(row.getCell(2)));
    if (target && p !== target) continue;
    const d = value(row.getCell(3));
    out.push({
      id: clean(value(row.getCell(1))), processo: p,
      data: d instanceof Date ? d.toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : clean(d),
      tipo: clean(value(row.getCell(4))), texto: clean(value(row.getCell(5))), usuario: clean(value(row.getCell(6))),
    });
  }
  return out.reverse();
}

function taskList(workbook, processo) {
  const sh = workbook.getWorksheet(TASKS);
  if (!sh) return [];
  const target = clean(processo), out = [];
  for (let n = 2; n <= sh.rowCount; n++) {
    const row = sh.getRow(n), p = clean(value(row.getCell(2)));
    if (target && p !== target) continue;
    out.push({
      id: clean(value(row.getCell(1))), processo: p, tarefa: clean(value(row.getCell(3))),
      responsavel: clean(value(row.getCell(4))), prazo: iso(value(row.getCell(5))),
      status: clean(value(row.getCell(6))) || 'Aberta', criadoEm: iso(value(row.getCell(7))),
    });
  }
  return out.reverse();
}

function taskCreate(workbook, task) {
  if (!clean(task.processo)) throw new Error('Processo não informado para a tarefa.');
  if (!clean(task.tarefa)) throw new Error('Descrição da tarefa é obrigatória.');
  const { tasks } = ensureAux(workbook), id = crypto.randomUUID();
  const row = tasks.addRow([
    id, clean(task.processo), clean(task.tarefa), clean(task.responsavel),
    task.prazo ? dateValue(task.prazo) : '', clean(task.status) || 'Aberta', new Date(),
  ]);
  row.getCell(5).numFmt = 'dd/mm/yyyy'; row.getCell(7).numFmt = 'dd/mm/yyyy hh:mm';
  addHist(workbook, task.processo, { tipo: 'Tarefa', texto: `Tarefa criada: ${clean(task.tarefa)}` });
  return id;
}

export async function onRequestGet({ env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  try {
    const workbook = await loadWorkbook(env), sh = sheetMain(workbook);
    return reply({ ok: true, source: 'google-drive-xlsx', sheet: MAIN, rows: Math.max(0, sh.rowCount - 1) });
  } catch (e) { return reply({ error: e.message }, 502); }
}

export async function onRequestPost({ request, env }) {
  if (!configured(env)) return reply({ error: 'Integração Google Drive não configurada.' }, 503);
  let input;
  try { input = await request.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  try {
    const workbook = await loadWorkbook(env), action = clean(input.action);
    if (action === 'list') return reply({ rows: list(workbook), source: 'google-drive-xlsx' });
    if (action === 'history.list') return reply({ rows: historyList(workbook, input.processo) });
    if (action === 'task.list') return reply({ rows: taskList(workbook, input.processo) });

    let result;
    if (action === 'create') result = { row: create(workbook, input.record || {}) };
    else if (action === 'update') result = { row: update(workbook, input.record || {}) };
    else if (action === 'history.add') result = { row: addHist(workbook, input.processo, input.entry || {}) };
    else if (action === 'task.create') result = { row: taskCreate(workbook, input.task || {}) };
    else return reply({ error: `Ação inválida: ${action || '(vazia)'}` }, 400);

    await saveWorkbook(env, workbook);
    return reply({ ok: true, ...result, source: 'google-drive-xlsx' });
  } catch (e) {
    console.error('DILIMAGALHAES API', e);
    return reply({ error: e.message || 'Falha ao acessar o XLSX.' }, 502);
  }
}
