const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const EXPECTED_FILE_NAME = 'COPIA DE ESTUDOS.xlsx';
let tokenCache = null;
let fileIdCache = null;

const clean = v => v === null || v === undefined ? '' : String(v).trim();

function b64url(input) {
  let bytes = input;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToBytes(pem) {
  const body = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 90) return tokenCache.token;

  const email = clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const pem = String(env.GOOGLE_PRIVATE_KEY || '');
  if (!email || !pem) throw new Error('Credenciais da conta de serviço não configuradas.');

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: DRIVE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Falha ao autenticar no Google: ${data.error_description || data.error || response.status}`);
  }
  tokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return tokenCache.token;
}

async function rawGoogleFetch(env, url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${await accessToken(env)}`);
  return fetch(url, { ...options, headers });
}

async function googleFetch(env, url, options = {}) {
  const response = await rawGoogleFetch(env, url, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google respondeu ${response.status}: ${detail.slice(0, 900)}`);
  }
  return response;
}

async function resolveOriginalId(env) {
  const configuredId = clean(env.GOOGLE_DRIVE_FILE_ID);
  const cacheKey = `${clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)}|${configuredId}`;
  if (fileIdCache?.key === cacheKey) return fileIdCache.id;

  if (configuredId) {
    const check = await rawGoogleFetch(
      env,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(configuredId)}?fields=id,name,mimeType&supportsAllDrives=true`,
    );
    if (check.ok) {
      const meta = await check.json();
      fileIdCache = { key: cacheKey, id: meta.id };
      return meta.id;
    }
    if (check.status !== 404) {
      const detail = await check.text();
      throw new Error(`Google Drive respondeu ${check.status} ao validar o arquivo: ${detail.slice(0, 700)}`);
    }
  }

  const q = `trashed = false and name contains 'COPIA DE ESTUDOS'`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const search = await rawGoogleFetch(env, searchUrl);
  if (!search.ok) {
    const detail = await search.text();
    throw new Error(`Não foi possível localizar o XLSX no Drive (${search.status}): ${detail.slice(0, 700)}`);
  }
  const data = await search.json();
  const files = Array.isArray(data.files) ? data.files : [];
  const exact = files.find(f => f.name === EXPECTED_FILE_NAME && f.mimeType === XLSX_MIME);
  const candidate = exact || files.find(f => f.mimeType === XLSX_MIME) || files[0];
  if (candidate?.id) {
    fileIdCache = { key: cacheKey, id: candidate.id };
    return candidate.id;
  }

  const email = clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  throw new Error(`O arquivo não está acessível para a conta de serviço ${email}. Abra COPIA DE ESTUDOS.xlsx no Google Drive, clique em Compartilhar e adicione EXATAMENTE este e-mail como Editor: ${email}`);
}

function concatBytes(parts) {
  const normalized = parts.map(p => typeof p === 'string' ? new TextEncoder().encode(p) : new Uint8Array(p));
  const total = normalized.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of normalized) { out.set(p, offset); offset += p.byteLength; }
  return out;
}

async function canUseOriginalWithSheetsApi(env, originalId) {
  const response = await rawGoogleFetch(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(originalId)}?fields=spreadsheetId`,
  );
  if (response.ok) return true;
  const detail = await response.text();
  console.warn('Sheets API não aceitou XLSX diretamente:', response.status, detail.slice(0, 400));
  return false;
}

async function createTempSpreadsheet(env, originalId) {
  const original = await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(originalId)}?alt=media&supportsAllDrives=true`,
  );
  const bytes = new Uint8Array(await original.arrayBuffer());
  const boundary = `dili_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadata = JSON.stringify({
    name: `DILIMAGALHAES_TMP_${Date.now()}`,
    mimeType: GSHEET_MIME,
  });
  const body = concatBytes([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  const created = await rawGoogleFetch(
    env,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,mimeType',
    {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!created.ok) {
    const detail = await created.text();
    if (created.status === 403 && detail.includes('storageQuotaExceeded')) {
      throw new Error('A conta de serviço conseguiu acessar o XLSX, mas o Google não permite criar a cópia temporária por falta de cota de armazenamento da própria conta de serviço. O sistema já tentou usar o XLSX diretamente pela Sheets API e esse arquivo não foi aceito como planilha nativa.');
    }
    throw new Error(`Google respondeu ${created.status}: ${detail.slice(0, 900)}`);
  }
  const data = await created.json();
  if (!data.id) throw new Error('O Google não retornou o ID da cópia temporária da planilha.');
  return data.id;
}

async function exportBackToOriginal(env, tempId, originalId) {
  const exported = await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(tempId)}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`,
  );
  const bytes = await exported.arrayBuffer();
  await googleFetch(
    env,
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(originalId)}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { 'content-type': XLSX_MIME },
      body: bytes,
    },
  );
}

async function deleteTemp(env, tempId) {
  try {
    await googleFetch(env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(tempId)}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('Falha ao excluir planilha temporária', e);
  }
}

export function configured(env) {
  return ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_DRIVE_FILE_ID']
    .every(k => clean(env[k]));
}

export async function withTempSpreadsheet(env, write, fn) {
  const originalId = await resolveOriginalId(env);

  // Primeiro tenta usar o arquivo Office diretamente. Em contas que suportam
  // Office Editing via Sheets API isso elimina conversões e não consome cota.
  if (await canUseOriginalWithSheetsApi(env, originalId)) {
    return fn(originalId);
  }

  // Fallback para conversão temporária quando a Sheets API não aceita o XLSX.
  const tempId = await createTempSpreadsheet(env, originalId);
  try {
    const result = await fn(tempId);
    if (write) await exportBackToOriginal(env, tempId, originalId);
    return result;
  } finally {
    await deleteTemp(env, tempId);
  }
}

export async function sheetsGet(env, spreadsheetId, pathAndQuery = '') {
  const response = await googleFetch(env, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${pathAndQuery}`);
  return response.json();
}

export async function sheetsJson(env, spreadsheetId, pathAndQuery, method, body) {
  const response = await googleFetch(
    env,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}${pathAndQuery}`,
    {
      method,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    },
  );
  if (response.status === 204) return {};
  return response.json();
}
