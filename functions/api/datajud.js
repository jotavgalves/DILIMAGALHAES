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
  if (parts.justice === '4') return `https://api-publica.datajud.cnj.jus.br/api_publica_trt${Number(parts.tribunal)}/_search`;
  if (parts.justice === '5') return `https://api-publica.datajud.cnj.jus.br/api_publica_trf${Number(parts.tribunal)}/_search`;
  return null;
}
function moveName(m={}) {
  return String(m.nome || m.movimento?.nome || m.descricao || m.codigo || 'Movimentação processual').trim();
}
function normalizeMovement(m={}) {
  return {
    codigo: m.codigo ?? m.movimento?.codigo ?? '',
    nome: moveName(m),
    dataHora: m.dataHora || m.data || '',
    complementosTabelados: Array.isArray(m.complementosTabelados) ? m.complementosTabelados : [],
    orgaoJulgador: m.orgaoJulgador || null
  };
}
function operationalInsight(result) {
  const latest = result?.latestMovement;
  if (!latest) return { level:'neutral', label:'Sem movimento recente identificado', suggestedStatus:'Monitoramento', suggestedAction:'Manter acompanhamento manual.' };
  const t = `${latest.nome} ${JSON.stringify(latest.complementosTabelados || [])}`.toLowerCase();
  if (/senten|acórd|acord|decis|julgament|mérito|merito/.test(t)) return { level:'high', label:'Decisão/julgamento detectado', suggestedStatus:'Aguardando orientação', suggestedAction:'Ler o teor da decisão e definir a providência jurídica.' };
  if (/intima|citaç|citacao|citação/.test(t)) return { level:'high', label:'Intimação/citação detectada', suggestedStatus:'A diligenciar', suggestedAction:'Conferir o teor e verificar imediatamente eventual prazo.' };
  if (/conclus/.test(t)) return { level:'medium', label:'Autos conclusos', suggestedStatus:'Concluso', suggestedAction:'Acompanhar gabinete e aguardar pronunciamento.' };
  if (/despacho/.test(t)) return { level:'high', label:'Novo despacho', suggestedStatus:'A diligenciar', suggestedAction:'Ler o despacho e registrar a providência necessária.' };
  if (/expedi|mandado|ofício|oficio|alvar/.test(t)) return { level:'medium', label:'Expedição/cumprimento', suggestedStatus:'Aguardando cumprimento', suggestedAction:'Verificar expedição e posterior cumprimento.' };
  if (/juntad|petiç|petic|manifest/.test(t)) return { level:'medium', label:'Petição/documento juntado', suggestedStatus:'Monitoramento', suggestedAction:'Conferir a juntada e avaliar se exige manifestação.' };
  if (/arquiv|baixa|trânsito|transito em julgado/.test(t)) return { level:'low', label:'Possível encerramento', suggestedStatus:'Finalizado', suggestedAction:'Confirmar baixa/arquivamento antes de finalizar internamente.' };
  return { level:'neutral', label:'Movimentação nova', suggestedStatus:'Monitoramento', suggestedAction:'Analisar a última movimentação e registrar a próxima ação.' };
}
function normalizeHit(hit) {
  const s = hit?._source || {};
  const movimentos = Array.isArray(s.movimentos)
    ? [...s.movimentos].map(normalizeMovement).sort((a,b)=>String(b.dataHora||'').localeCompare(String(a.dataHora||''))).slice(0,20)
    : [];
  const result = {
    numeroProcesso: s.numeroProcesso || '', tribunal: s.tribunal || '', grau: s.grau || '',
    classe: s.classe || null, orgaoJulgador: s.orgaoJulgador || null,
    assuntos: Array.isArray(s.assuntos) ? s.assuntos : [], sistema: s.sistema || null,
    formato: s.formato || null, nivelSigilo: s.nivelSigilo,
    dataAjuizamento: s.dataAjuizamento || '', movimentos,
    latestMovement: movimentos[0] || null
  };
  result.insight = operationalInsight(result);
  return result;
}
function cacheKey(processo) {
  return new Request(`https://datajud-cache.local/processo/${encodeURIComponent(processo)}`);
}
async function cacheRead(processo) {
  try {
    if (!globalThis.caches?.default) return null;
    const r = await caches.default.match(cacheKey(processo));
    return r ? await r.json() : null;
  } catch { return null; }
}
async function cacheWrite(processo, data) {
  try {
    if (!globalThis.caches?.default) return;
    const r = new Response(JSON.stringify(data), { headers:{'content-type':'application/json','cache-control':'public, max-age=900'} });
    await caches.default.put(cacheKey(processo), r);
  } catch {}
}
async function queryOne(processo, env) {
  const p = String(processo || '').trim();
  const parts = cnjParts(p);
  if (!parts) return { ok:false, processo:p, error:'Número CNJ inválido.' };
  const endpoint = endpointFor(parts);
  if (!endpoint) return { ok:false, processo:p, error:'Tribunal ainda não mapeado para consulta automática.' };
  const cached = await cacheRead(p);
  if (cached) return { ...cached, cached:true };
  const key = String(env.DATAJUD_API_KEY || CURRENT_PUBLIC_KEY).trim();
  try {
    const r = await fetch(endpoint, {
      method:'POST',
      headers:{'content-type':'application/json','authorization':`APIKey ${key}`},
      body:JSON.stringify({ size:3, query:{ match:{ numeroProcesso:parts.digits } }, sort:[{'@timestamp':{order:'desc',unmapped_type:'date'}}] })
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const detail = data?.error?.reason || data?.message || text.slice(0,400);
      return { ok:false, processo:p, error:`DataJud respondeu ${r.status}: ${detail}` };
    }
    const hits = data?.hits?.hits || [];
    const out = hits.length
      ? { ok:true, found:true, endpoint, processo:p, result:normalizeHit(hits[0]), fetchedAt:new Date().toISOString() }
      : { ok:true, found:false, endpoint, processo:p, fetchedAt:new Date().toISOString() };
    await cacheWrite(p, out);
    return out;
  } catch (e) {
    return { ok:false, processo:p, error:e?.message || 'Falha ao consultar o DataJud.' };
  }
}
function knownDate(item) {
  if (typeof item === 'string') return '';
  return String(item?.knownLatest || item?.ultimaMovimentacao || '').trim();
}
function processValue(item) { return typeof item === 'string' ? item : item?.processo; }
async function batch(items, env) {
  const unique=[]; const seen=new Set();
  for (const item of items.slice(0,40)) {
    const p=String(processValue(item)||'').trim();
    if (p && !seen.has(p)) { seen.add(p); unique.push(item); }
  }
  const results=new Array(unique.length); let cursor=0;
  async function worker(){
    while (true) {
      const i=cursor++; if (i>=unique.length) break;
      const item=unique[i], out=await queryOne(processValue(item), env), known=knownDate(item);
      const latest=out?.result?.latestMovement?.dataHora || '';
      results[i]={...out, knownLatest:known, hasNewMovement:Boolean(latest && (!known || latest>known))};
    }
  }
  await Promise.all(Array.from({length:Math.min(6,unique.length||1)},()=>worker()));
  const found=results.filter(x=>x?.found).length;
  const changed=results.filter(x=>x?.hasNewMovement).length;
  const failed=results.filter(x=>x && !x.ok).length;
  return { ok:true, batch:true, count:results.length, found, changed, failed, results, checkedAt:new Date().toISOString() };
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return reply({ error:'JSON inválido.' },400); }
  if (Array.isArray(body?.processos)) return reply(await batch(body.processos, env));
  const processo=String(body?.processo||'').trim();
  if (!processo) return reply({ error:'Informe processo ou processos.' },400);
  const out=await queryOne(processo, env);
  return reply(out, out.ok ? 200 : 502);
}
