export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    return new Response(JSON.stringify({ error: 'Integração não configurada' }), { status: 503, headers: { 'content-type': 'application/json' } })
  }
  let body
  try { body = await request.json() } catch { return new Response('JSON inválido', { status: 400 }) }
  const payload = { ...body, secret: env.APPS_SCRIPT_SECRET }
  try {
    const upstream = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    })
    const text = await upstream.text()
    return new Response(text, { status: upstream.ok ? 200 : 502, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control':'no-store' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Falha ao conectar ao Apps Script', detail: error.message }), { status: 502, headers: { 'content-type': 'application/json' } })
  }
}
