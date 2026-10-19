const SHEET_NAME = 'Planilha Geral';
const HISTORY_SHEET = 'Sistema_Historico';
const TASKS_SHEET = 'Sistema_Tarefas';

const COL = {
  responsavel: 1, processo: 2, cliente: 3, adverso: 4, comarca: 5, vara: 6,
  secao: 7, solicitacao: 8, dataSolicitacao: 9, status: 10, obs: 11, atualizadoEm: 12,
  prioridade: 13, proximaAcao: 14, proximaData: 15
};

function doGet() {
  return json_({ ok: true, app: 'Diligências Magalhães', message: 'Use POST.' });
}

function doPost(e) {
  try {
    const input = JSON.parse(e.postData.contents || '{}');
    checkSecret_(input.secret);
    ensureAuxSheets_();
    switch (input.action) {
      case 'list': return json_({ rows: listRows_() });
      case 'create': return json_({ ok: true, row: createRow_(input.record || {}) });
      case 'update': return json_({ ok: true, row: updateRow_(input.record || {}) });
      case 'history.list': return json_({ rows: listHistory_(input.processo) });
      case 'history.add': return json_({ ok: true, row: addHistory_(input.processo, input.entry || {}) });
      case 'task.list': return json_({ rows: listTasks_(input.processo) });
      case 'task.create': return json_({ ok: true, row: createTask_(input.task || {}) });
      default: throw new Error('Ação inválida: ' + input.action);
    }
  } catch (err) {
    return json_({ error: err.message, stack: String(err.stack || '') });
  }
}

function checkSecret_(secret) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  if (!expected) throw new Error('API_SECRET não configurado nas propriedades do script.');
  if (!secret || secret !== expected) throw new Error('Não autorizado.');
}

function mainSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Aba "' + SHEET_NAME + '" não encontrada.');
  return sheet;
}

function clean_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function iso_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${('0'+m[2]).slice(-2)}-${('0'+m[1]).slice(-2)}`;
  return s.slice(0,10);
}
function brDate_(iso) {
  if (!iso) return '';
  const m = String(iso).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function listRows_() {
  const sh = mainSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const maxCol = Math.max(sh.getLastColumn(), 15);
  const values = sh.getRange(2,1,last-1,maxCol).getValues();
  return values.map((r,i) => ({
    id: i + 2,
    responsavel: clean_(r[0]), processo: clean_(r[1]), cliente: clean_(r[2]), adverso: clean_(r[3]),
    comarca: clean_(r[4]), vara: clean_(r[5]), secao: clean_(r[6]), solicitacao: clean_(r[7]),
    dataSolicitacao: iso_(r[8]), status: clean_(r[9]), obs: clean_(r[10]), atualizadoEm: iso_(r[11]),
    prioridade: clean_(r[12]) || 'Normal', proximaAcao: clean_(r[13]), proximaData: iso_(r[14])
  })).filter(r => r.processo || r.cliente || r.solicitacao || r.obs);
}

function createRow_(record) {
  if (!clean_(record.processo)) throw new Error('Número do processo é obrigatório.');
  const lock = LockService.getDocumentLock(); lock.waitLock(15000);
  try {
    const sh = mainSheet_();
    ensureHeaders_(sh);
    const row = Math.max(sh.getLastRow()+1, 2);
    const values = new Array(15).fill('');
    Object.keys(COL).forEach(k => values[COL[k]-1] = formatForSheet_(k, record[k]));
    values[COL.atualizadoEm-1] = new Date();
    sh.getRange(row,1,1,15).setValues([values]);
    addHistory_(record.processo, { tipo:'Cadastro', texto:'Processo incluído pelo sistema.' });
    return row;
  } finally { lock.releaseLock(); }
}

function updateRow_(record) {
  const row = Number(record.id);
  if (!row || row < 2) throw new Error('Linha inválida para atualização.');
  const lock = LockService.getDocumentLock(); lock.waitLock(15000);
  try {
    const sh = mainSheet_(); ensureHeaders_(sh);
    const old = sh.getRange(row,1,1,15).getValues()[0];
    Object.keys(COL).forEach(k => {
      if (k === 'atualizadoEm') return;
      if (Object.prototype.hasOwnProperty.call(record,k)) old[COL[k]-1] = formatForSheet_(k,record[k]);
    });
    old[COL.atualizadoEm-1] = new Date();
    sh.getRange(row,1,1,15).setValues([old]);
    addHistory_(record.processo || old[1], { tipo:'Atualização', texto:'Cadastro/status atualizado pelo sistema.' });
    return row;
  } finally { lock.releaseLock(); }
}

function formatForSheet_(key, value) {
  if (['dataSolicitacao','atualizadoEm','proximaData'].includes(key) && value) {
    const s = String(value).slice(0,10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), 12, 0, 0);
  }
  return clean_(value);
}

function ensureHeaders_(sh) {
  const extra = ['Prioridade','Próxima ação','Próxima verificação'];
  extra.forEach((v,i) => { const c=13+i; if(!clean_(sh.getRange(1,c).getValue())) sh.getRange(1,c).setValue(v); });
}

function ensureAuxSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName(HISTORY_SHEET);
  if (!h) { h = ss.insertSheet(HISTORY_SHEET); h.appendRow(['ID','Processo','Data','Tipo','Texto','Usuário']); h.setFrozenRows(1); }
  let t = ss.getSheetByName(TASKS_SHEET);
  if (!t) { t = ss.insertSheet(TASKS_SHEET); t.appendRow(['ID','Processo','Tarefa','Responsável','Prazo','Status','Criado em']); t.setFrozenRows(1); }
}

function addHistory_(processo, entry) {
  if (!clean_(processo)) throw new Error('Processo não informado.');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HISTORY_SHEET);
  const id = Utilities.getUuid();
  const user = clean_(entry.usuario) || 'Sistema';
  sh.appendRow([id, clean_(processo), new Date(), clean_(entry.tipo)||'Atualização', clean_(entry.texto), user]);
  return id;
}
function listHistory_(processo) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HISTORY_SHEET);
  if (sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,6).getValues().filter(r=>clean_(r[1])===clean_(processo)).map(r=>({id:r[0],processo:r[1],data:Utilities.formatDate(new Date(r[2]),Session.getScriptTimeZone(),'dd/MM/yyyy HH:mm'),tipo:r[3],texto:r[4],usuario:r[5]}));
}
function createTask_(task) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TASKS_SHEET);
  const id=Utilities.getUuid(); sh.appendRow([id,clean_(task.processo),clean_(task.tarefa),clean_(task.responsavel),formatForSheet_('proximaData',task.prazo),clean_(task.status)||'Aberta',new Date()]); return id;
}
function listTasks_(processo) {
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TASKS_SHEET); if(sh.getLastRow()<2)return[];
  return sh.getRange(2,1,sh.getLastRow()-1,7).getValues().filter(r=>!processo||clean_(r[1])===clean_(processo)).map(r=>({id:r[0],processo:r[1],tarefa:r[2],responsavel:r[3],prazo:iso_(r[4]),status:r[5],criadoEm:iso_(r[6])}));
}
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
