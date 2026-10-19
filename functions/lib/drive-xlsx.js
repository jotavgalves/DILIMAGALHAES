import ExcelJS from 'exceljs';
import { SignJWT, importPKCS8 } from 'jose';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let tokenCache = null;

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 90) return tokenCache.token;

  const email = clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const pem = String(env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !pem) throw new Error('Credenciais da conta de serviço não configuradas.');

  const key = await importPKCS8(pem, 'RS256');
  const assertion = await new SignJWT({ scope: DRIVE_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

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

async function googleFetch(env, url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${await accessToken(env)}`);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive respondeu ${response.status}: ${detail.slice(0, 600)}`);
  }
  return response;
}

export function configured(env) {
  return ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_DRIVE_FILE_ID']
    .every(k => clean(env[k]));
}

export async function loadWorkbook(env) {
  const id = clean(env.GOOGLE_DRIVE_FILE_ID);
  const response = await googleFetch(
    env,
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  return workbook;
}

export async function saveWorkbook(env, workbook) {
  const id = clean(env.GOOGLE_DRIVE_FILE_ID);
  const bytes = await workbook.xlsx.writeBuffer();
  await googleFetch(
    env,
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { 'content-type': XLSX_MIME },
      body: bytes,
    },
  );
}
