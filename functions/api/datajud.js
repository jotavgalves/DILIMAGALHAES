const CURRENT_PUBLIC_KEY = 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

const STATE_ALIASES = {
  '01':'tjac','02':'tjal','03':'tjap','04':'tjam','05':'tjba','06':'tjce','07':'tjdft','08':'tjes','09':'tjgo','10':'tjma','11':'tjmt','12':'tjms','13':'tjmg','14':'tjpa','15':'tjpb','16':'tjpr','17':'tjpe','18':'tjpi','19':'tjrj','20':'tjrn','21':'tjrs','22':'tjro','23':'tjrr','24':'tjsc','25':'tjse','26':'tjsp','27':'tjto'
};

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function cnjParts(value='') {
  const formatted = String(value).trim().match(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})$/);
  if (!formatted) return null;
  return { digits: formatted.slice(1).join(''), justice: formatted[4], tribunal: formatted[5] };
}

function endpointFor(parts) {
  if (!parts) return null;
  if (parts.justice === '8') {
    const alias = STATE_ALIASES[parts.tribunal];
    return alias ? `https://api-publica.datajud.cnj.jus.br/api_publica_${alias}/_search` : null;
  }
  if (parts.justice === '4') {
    const reg = String(Number(parts.tribunal));
    return `https://api-publica.datajud.cnj.jus.br/api_publica_trt${reg}/_search`;
  }
  if (parts.justice === '5') {
    const reg = String(Number(parts.tribunal));
    return `https://api-publica.datajud.cnj.jus.br/api_publica_trf${reg}/_search`;
  }
  return null;
}

function normalizeHit(hit) {
  const s = hit?._source || {};
  const movimentos = Array.isArray(s.movimentos) ? [...s.movimentos].sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||''))).slice(0,12) : [];
  return {
    numeroProcesso: s.numeroProcesso || '',
    tribunal: s.tribunal || '',
    grau: s.grau || '',
    classe: s.classe || null,
    orgaoJulgador: s.orgaoJulgador || null,
    assuntos: Array.isArray(s.assuntos) ? s.assuntos : [],
    sistema: s.sistema || null,
    formato: s.formato || null,
    nivelSigilo: s.nivelSigilo,
    dataAjuizamento: s.dataAjuizamento || '',
    movimentos
  };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return reply({ error: 'JSON inválido.' }, 400); }
  const processo = String(body?.processo || '').trim();
  const parts = cnjParts(processo);
  if (!parts) return reply({ error: 'Número CNJ inválido para consulta no DataJud.' }, 400);
  const endpoint = endpointFor(parts);
  if (!endpoint) return reply({ error: 'Tribunal ainda não mapeado para consulta automática.' }, 422);

  const key = String(env.DATAJUD_API_KEY || CURRENT_PUBLIC_KEY).trim();
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `APIKey ${key}`
      },
      body: JSON.stringify({
        size: 3,
        query: { match: { numeroProcesso: parts.digits } },
        sort: [{ '@timestamp': { order: 'desc', unmapped_type: 'date' } }]
      })
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const detail = data?.error?.reason || data?.message || text.slice(0,400);
      return reply({ error: `DataJud respondeu ${r.status}: ${detail}` }, 502);
    }
    const hits = data?.hits?.hits || [];
    if (!hits.length) return reply({ ok: true, found: false, endpoint, processo }, 200);
    return reply({ ok: true, found: true, endpoint, processo, result: normalizeHit(hits[0]) });
  } catch (e) {
    return reply({ error: e?.message || 'Falha ao consultar o DataJud.' }, 502);
  }
}
