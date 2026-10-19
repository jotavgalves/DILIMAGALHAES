const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXPECTED_FILE_NAME = 'COPIA DE ESTUDOS.xlsx';
let tokenCache = null;
let fileIdCache = null;

const clean = v => v === null || v === undefined ? '' : String(v).trim();
const te = new TextEncoder();
const td = new TextDecoder();

function b64url(input) {
  const bytes = typeof input === 'string' ? te.encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function pemToBytes(pem) {
  const body = String(pem || '').replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const binary = atob(body), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 90) return tokenCache.token;
  const email = clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL), pem = String(env.GOOGLE_PRIVATE_KEY || '');
  if (!email || !pem) throw new Error('Credenciais da conta de serviço não configuradas.');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: email, scope: DRIVE_SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(unsigned));
  const assertion = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(`Falha ao autenticar no Google: ${data.error_description || data.error || r.status}`);
  tokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 3600) };
  return tokenCache.token;
}
async function rawGoogleFetch(env, url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('authorization', `Bearer ${await accessToken(env)}`);
  return fetch(url, { ...options, headers });
}
async function googleFetch(env, url, options = {}) {
  const r = await rawGoogleFetch(env, url, options);
  if (!r.ok) throw new Error(`Google respondeu ${r.status}: ${(await r.text()).slice(0, 900)}`);
  return r;
}
async function resolveOriginalId(env) {
  const configuredId = clean(env.GOOGLE_DRIVE_FILE_ID), cacheKey = `${clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)}|${configuredId}`;
  if (fileIdCache?.key === cacheKey) return fileIdCache.id;
  if (configuredId) {
    const check = await rawGoogleFetch(env, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(configuredId)}?fields=id,name,mimeType&supportsAllDrives=true`);
    if (check.ok) { const meta = await check.json(); fileIdCache = { key: cacheKey, id: meta.id }; return meta.id; }
    if (check.status !== 404) throw new Error(`Google Drive respondeu ${check.status} ao validar o arquivo: ${(await check.text()).slice(0,700)}`);
  }
  const q = `trashed = false and name contains 'COPIA DE ESTUDOS'`;
  const search = await googleFetch(env, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  const files = (await search.json()).files || [];
  const candidate = files.find(f => f.name === EXPECTED_FILE_NAME && f.mimeType === XLSX_MIME) || files.find(f => f.mimeType === XLSX_MIME) || files[0];
  if (!candidate?.id) throw new Error(`O arquivo não está acessível para a conta de serviço ${clean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL)}.`);
  fileIdCache = { key: cacheKey, id: candidate.id };
  return candidate.id;
}

function u16(v,o){ return v.getUint16(o,true); }
function u32(v,o){ return v.getUint32(o,true); }
function put16(v,o,n){ v.setUint16(o,n,true); }
function put32(v,o,n){ v.setUint32(o,n>>>0,true); }
function concat(parts){ const len=parts.reduce((n,p)=>n+p.length,0), out=new Uint8Array(len); let o=0; for(const p of parts){out.set(p,o);o+=p.length;} return out; }

function findEocd(bytes){
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(u32(v,i)===0x06054b50) return i;
  throw new Error('XLSX inválido: diretório ZIP não encontrado.');
}
function parseZip(bytes){
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), eocd=findEocd(bytes);
  const count=u16(v,eocd+10), cdOffset=u32(v,eocd+16), entries=[]; let p=cdOffset;
  for(let i=0;i<count;i++){
    if(u32(v,p)!==0x02014b50) throw new Error('XLSX inválido: entrada ZIP corrompida.');
    const flags=u16(v,p+8), method=u16(v,p+10), time=u16(v,p+12), date=u16(v,p+14), crc=u32(v,p+16), csize=u32(v,p+20), usize=u32(v,p+24);
    const nlen=u16(v,p+28), xlen=u16(v,p+30), clen=u16(v,p+32), ext=u32(v,p+38), loff=u32(v,p+42);
    const name=td.decode(bytes.slice(p+46,p+46+nlen));
    if(u32(v,loff)!==0x04034b50) throw new Error('XLSX inválido: cabeçalho ZIP local ausente.');
    const ln=u16(v,loff+26), lx=u16(v,loff+28), dataStart=loff+30+ln+lx;
    entries.push({name,flags,method,time,date,crc,csize,usize,ext,data:bytes.slice(dataStart,dataStart+csize)});
    p += 46+nlen+xlen+clen;
  }
  return entries;
}
async function inflate(entry){
  if(entry.method===0) return entry.data;
  if(entry.method!==8) throw new Error(`Compressão ZIP não suportada (${entry.method}) em ${entry.name}.`);
  try {
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    throw new Error(`O runtime não conseguiu descompactar ${entry.name}: ${e.message}`);
  }
}
function crc32(bytes){
  let c=0xffffffff;
  for(const b of bytes){ c^=b; for(let k=0;k<8;k++) c=(c>>>1) ^ ((c&1)?0xedb88320:0); }
  return (c^0xffffffff)>>>0;
}
function zipBytes(entries, replacements=new Map()){
  const locals=[], centrals=[]; let offset=0;
  for(const e of entries){
    const name=te.encode(e.name), replacement=replacements.get(e.name);
    const raw = replacement ? (typeof replacement==='string'?te.encode(replacement):replacement) : null;
    const method = raw ? 0 : e.method, data = raw || e.data, crc = raw ? crc32(data) : e.crc, csize=data.length, usize=raw?data.length:e.usize;
    const flags=(e.flags||0)&~0x08;
    const lh=new Uint8Array(30+name.length), lv=new DataView(lh.buffer);
    put32(lv,0,0x04034b50); put16(lv,4,20); put16(lv,6,flags); put16(lv,8,method); put16(lv,10,e.time||0); put16(lv,12,e.date||0); put32(lv,14,crc); put32(lv,18,csize); put32(lv,22,usize); put16(lv,26,name.length); put16(lv,28,0); lh.set(name,30);
    locals.push(lh,data);
    const ch=new Uint8Array(46+name.length), cv=new DataView(ch.buffer);
    put32(cv,0,0x02014b50); put16(cv,4,20); put16(cv,6,20); put16(cv,8,flags); put16(cv,10,method); put16(cv,12,e.time||0); put16(cv,14,e.date||0); put32(cv,16,crc); put32(cv,20,csize); put32(cv,24,usize); put16(cv,28,name.length); put16(cv,30,0); put16(cv,32,0); put16(cv,34,0); put16(cv,36,0); put32(cv,38,e.ext||0); put32(cv,42,offset); ch.set(name,46);
    centrals.push(ch); offset += lh.length + data.length;
  }
  const central=concat(centrals), eocd=new Uint8Array(22), ev=new DataView(eocd.buffer);
  put32(ev,0,0x06054b50); put16(ev,4,0); put16(ev,6,0); put16(ev,8,entries.length); put16(ev,10,entries.length); put32(ev,12,central.length); put32(ev,16,offset); put16(ev,20,0);
  return concat([...locals,central,eocd]);
}

function xmlDecode(s=''){ return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
function xmlEscape(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
function colLetters(n){ let s=''; while(n){ n--; s=String.fromCharCode(65+n%26)+s; n=Math.floor(n/26);} return s; }
function colNumber(ref){ const m=String(ref).match(/^([A-Z]+)/i); if(!m)return 0; let n=0; for(const ch of m[1].toUpperCase()) n=n*26+ch.charCodeAt(0)-64; return n; }
function normalizeTarget(t){ let x=xmlDecode(t||'').replace(/^\//,''); if(!x.startsWith('xl/')) x='xl/'+x.replace(/^\.\//,''); return x.replace(/\\/g,'/'); }

async function textEntry(entries,name){ const e=entries.find(x=>x.name===name); return e?td.decode(await inflate(e)):''; }
function parseShared(xml){
  if(!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x=>xmlDecode(x[1])).join(''));
}
function parseDateStyles(stylesXml){
  const custom=new Map();
  for(const m of stylesXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?\s*>/g)) custom.set(Number(m[1]),xmlDecode(m[2]));
  const xfs=(stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)||[])[1]||'';
  return [...xfs.matchAll(/<xf\b([^>]*)\/?\s*>/g)].map(m=>{
    const id=Number((m[1].match(/numFmtId="(\d+)"/)||[])[1]||0), fmt=custom.get(id)||'';
    return (id>=14&&id<=22)||(id>=27&&id<=36)||(id>=45&&id<=47)||(id>=50&&id<=58)||/[dmyhs]/i.test(fmt.replace(/\[[^\]]+\]/g,''));
  });
}
function excelDate(v){ const n=Number(v); if(!Number.isFinite(n)) return String(v); const d=new Date(Date.UTC(1899,11,30)+Math.round(n*86400000)); return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`; }
function cellValue(cellXml, shared, dateStyles){
  const attrs=(cellXml.match(/^<c\b([^>]*)>/)||[])[1]||'', t=(attrs.match(/\bt="([^"]+)"/)||[])[1]||'', style=Number((attrs.match(/\bs="(\d+)"/)||[])[1]||-1);
  if(t==='inlineStr') return [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>xmlDecode(m[1])).join('');
  const v=(cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)||[])[1]; if(v===undefined) return '';
  if(t==='s') return shared[Number(v)] ?? '';
  if(t==='b') return v==='1'?'TRUE':'FALSE';
  if(dateStyles[style]) return excelDate(v);
  return xmlDecode(v);
}
function readRows(sheetXml, shared, dateStyles, maxCol=15){
  const rows=[];
  for(const rm of sheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
    const rn=Number(rm[1]), arr=[];
    for(const cm of rm[2].matchAll(/<c\b[^>]*r="([A-Z]+\d+)"[^>]*>[\s\S]*?<\/c>/g)){
      const ci=colNumber(cm[1]); if(ci>=1&&ci<=maxCol) arr[ci-1]=cellValue(cm[0],shared,dateStyles);
    }
    rows[rn-1]=arr;
  }
  return rows;
}
function cellXml(ref,value,style){ const s=style!==''&&style!==undefined&&style!==null?` s="${style}"`:''; return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value??'')}</t></is></c>`; }
function styleFor(rowXml, col){ const m=rowXml.match(new RegExp(`<c\\b([^>]*)r="${col}\\d+"[^>]*>`)); return m?((m[1].match(/\bs="(\d+)"/)||[])[1]||''):''; }
function setRowXml(sheetXml,rowNumber,values){
  const rowRe=new RegExp(`<row\\b([^>]*)r="${rowNumber}"([^>]*)>([\\s\\S]*?)<\\/row>`), found=sheetXml.match(rowRe);
  let rowXml;
  if(found){ rowXml=found[0]; for(let i=0;i<values.length;i++){
      const col=colLetters(i+1), ref=`${col}${rowNumber}`, cRe=new RegExp(`<c\\b[^>]*r="${ref}"[^>]*>[\\s\\S]*?<\\/c>`), style=styleFor(rowXml,col), next=cellXml(ref,values[i],style);
      rowXml=cRe.test(rowXml)?rowXml.replace(cRe,next):rowXml.replace('</row>',next+'</row>');
    }
    sheetXml=sheetXml.replace(rowRe,rowXml);
  } else {
    let prev=''; for(const m of sheetXml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) if(Number(m[1])<rowNumber) prev=m[0];
    const attrs=prev?(prev.match(/^<row\b([^>]*)>/)||[])[1]||'':'';
    const kept=attrs.replace(/\s*r="\d+"/,'').replace(/\s*spans="[^"]*"/,'');
    const cells=values.map((v,i)=>cellXml(`${colLetters(i+1)}${rowNumber}`,v,prev?styleFor(prev,colLetters(i+1)):'')).join('');
    rowXml=`<row r="${rowNumber}"${kept}>${cells}</row>`;
    sheetXml=sheetXml.replace('</sheetData>',rowXml+'</sheetData>');
  }
  sheetXml=sheetXml.replace(/<dimension\b([^>]*)ref="([A-Z]+\d+):([A-Z]+)(\d+)"([^>]*)\/>/, (all,a,start,endCol,endRow,b)=>Number(endRow)<rowNumber?`<dimension${a}ref="${start}:${endCol}${rowNumber}"${b}/>`:all);
  return sheetXml;
}

async function openWorkbook(env){
  const fileId=await resolveOriginalId(env), r=await googleFetch(env,`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`), bytes=new Uint8Array(await r.arrayBuffer()), entries=parseZip(bytes);
  const workbookXml=await textEntry(entries,'xl/workbook.xml'), relsXml=await textEntry(entries,'xl/_rels/workbook.xml.rels');
  const sheet=[...workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/?\s*>/g)].find(m=>xmlDecode(m[1])==='Planilha Geral');
  if(!sheet) throw new Error('A aba "Planilha Geral" não foi encontrada no XLSX.');
  const rid=sheet[2], rel=[...relsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(m=>((m[1].match(/\bId="([^"]+)"/)||[])[1]===rid));
  const target=rel?((rel[1].match(/\bTarget="([^"]+)"/)||[])[1]||''):''; if(!target) throw new Error('Não foi possível localizar o XML da aba Planilha Geral.');
  const sheetPath=normalizeTarget(target), sheetXml=await textEntry(entries,sheetPath), shared=parseShared(await textEntry(entries,'xl/sharedStrings.xml')), dateStyles=parseDateStyles(await textEntry(entries,'xl/styles.xml'));
  return {fileId,entries,sheetPath,sheetXml,shared,dateStyles,dirty:false};
}
export function configured(env){ return ['GOOGLE_SERVICE_ACCOUNT_EMAIL','GOOGLE_PRIVATE_KEY','GOOGLE_DRIVE_FILE_ID'].every(k=>clean(env[k])); }
export async function loadWorkbook(env){ return openWorkbook(env); }
export function getMainRows(book,maxCol=15){ return readRows(book.sheetXml,book.shared,book.dateStyles,maxCol); }
export function setMainRow(book,rowNumber,values){ book.sheetXml=setRowXml(book.sheetXml,rowNumber,values); book.dirty=true; }
export function nextMainRow(book){ let max=1; for(const m of book.sheetXml.matchAll(/<row\b[^>]*r="(\d+)"/g)) max=Math.max(max,Number(m[1])); return max+1; }
export async function saveWorkbook(env,book){
  if(!book.dirty) return;
  const out=zipBytes(book.entries,new Map([[book.sheetPath,book.sheetXml]]));
  await googleFetch(env,`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(book.fileId)}?uploadType=media&supportsAllDrives=true`,{method:'PATCH',headers:{'content-type':XLSX_MIME},body:out});
}
