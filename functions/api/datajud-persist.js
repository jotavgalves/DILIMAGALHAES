import { persistDataJudResults } from '../lib/datajud-persist.js';

const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

export async function onRequestPost({request,env}){
  let body;try{body=await request.json()}catch{return reply({error:'JSON inválido.'},400)}
  try{
    const updates=Array.isArray(body?.updates)?body.updates:[];
    const result=await persistDataJudResults(env,updates,body?.actor||'DataJud manual');
    return reply(result);
  }catch(e){
    console.error('DILIMAGALHAES DATAJUD PERSIST',e);
    return reply({error:e?.message||'Falha ao persistir dados do DataJud.'},502);
  }
}
