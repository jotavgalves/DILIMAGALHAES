const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

async function state(db,key){
  try{return await db.prepare('SELECT value,updated_at FROM workspace_state WHERE key=?').bind(key).first()}
  catch{return null}
}

export async function onRequestGet({env}){
  if(!env.DB)return reply({ok:false,engine:'none',code:'D1_NOT_BOUND'},503);
  const started=Date.now();
  try{
    const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM workspace_records').first();
    const [lastSync,lastMutation]=await Promise.all([state(env.DB,'last_sync'),state(env.DB,'last_mutation')]);
    return reply({
      ok:true,
      engine:'d1',
      records:Number(count?.n||0),
      lastSync:lastSync?.value||null,
      lastMutation:lastMutation?.value||null,
      latencyMs:Date.now()-started
    });
  }catch(e){
    return reply({ok:false,engine:'d1',code:'D1_HEALTH_ERROR',error:e?.message||'Falha ao consultar o D1.'},502);
  }
}
