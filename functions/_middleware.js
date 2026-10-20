const COOKIE_NAME = 'dili_session';

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function html(message = '', status = 200) {
  const safe = String(message || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return new Response(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso restrito | Diligências Magalhães</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#e5e7eb}.box{width:min(92vw,420px);background:#111827;border:1px solid #243047;border-radius:20px;padding:32px;box-shadow:0 24px 70px #0008}.mark{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:#1d4ed8;font-size:24px;margin-bottom:20px}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 22px;color:#94a3b8;line-height:1.5}.err{color:#fca5a5;background:#7f1d1d33;border:1px solid #7f1d1d;padding:10px 12px;border-radius:10px;margin-bottom:14px}label{display:block;font-size:13px;color:#cbd5e1;margin-bottom:8px}input{width:100%;border:1px solid #334155;background:#0f172a;color:white;border-radius:12px;padding:13px 14px;font-size:16px;outline:none}input:focus{border-color:#3b82f6}button{width:100%;margin-top:14px;border:0;border-radius:12px;padding:13px 16px;background:#2563eb;color:white;font-size:15px;font-weight:700;cursor:pointer}small{display:block;text-align:center;margin-top:18px;color:#64748b}</style></head>
<body><main class="box"><div class="mark">⚖</div><h1>Diligências Magalhães</h1><p>Área interna. Informe a senha para continuar.</p>${safe ? `<div class="err">${safe}</div>` : ''}<form method="post" action="/__login"><label for="password">Senha de acesso</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">Entrar</button></form><small>Acesso restrito</small></main></body></html>`, {status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

function getCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname === '/api/datajud-cron') {
    const response = await next();
    response.headers.set('cache-control', 'no-store');
    return response;
  }

  if (!env.SITE_PASSWORD) {
    return new Response('SITE_PASSWORD não configurado no Cloudflare.', {status:503, headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
  }

  const expected = await sha256(`dili-auth:${env.SITE_PASSWORD}`);

  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData();
    const password = String(form.get('password') || '');
    if (password !== env.SITE_PASSWORD) return html('Senha incorreta.', 401);
    return new Response(null, {status:303, headers:{
      'location':'/',
      'set-cookie':`${COOKIE_NAME}=${expected}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
      'cache-control':'no-store'
    }});
  }

  if (url.pathname === '/__logout') {
    return new Response(null, {status:303, headers:{
      'location':'/',
      'set-cookie':`${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      'cache-control':'no-store'
    }});
  }

  if (getCookie(request, COOKIE_NAME) !== expected) return html();

  const response = await next();
  response.headers.set('cache-control', url.pathname.startsWith('/api/') ? 'no-store' : (response.headers.get('cache-control') || 'no-cache'));
  return response;
}
