import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { URL } from 'node:url';

const PORT=Number(process.env.PORT||3000);
const TOKEN=String(process.env.RELAY_TOKEN||'').trim();
const CERT=String(process.env.PJE_CERT_PEM||'').replace(/\\n/g,'\n');
const KEY=String(process.env.PJE_KEY_PEM||'').replace(/\\n/g,'\n');
const EXTRA_CA=String(process.env.TJPE_CA_PEM||'').replace(/\\n/g,'\n');
const ENDPOINTS={
  '1g':'https://pjemni.app.tjpe.jus.br/1g/servico-intercomunicacao-2.2.2',
  '2g':'https://pjemni.app.tjpe.jus.br/2g/servico-intercomunicacao-2.2.2'
};
const WSDLS={ '1g':`${ENDPOINTS['1g']}?wsdl`, '2g':`${ENDPOINTS['2g']}?wsdl` };

const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const authorized=req=>TOKEN&&req.headers.authorization===`Bearer ${TOKEN}`;
const ca=EXTRA_CA?[...tls.rootCertificates,EXTRA_CA]:tls.rootCertificates;
const agent=new https.Agent({keepAlive:true,cert:CERT||undefined,key:KEY||undefined,ca,rejectUnauthorized:true,minVersion:'TLSv1.2'});

function requestOrigin(url,{method='GET',headers={},body=''}={}){
  return new Promise((resolve,reject)=>{
    const u=new URL(url);const started=Date.now();
    const req=https.request({protocol:u.protocol,hostname:u.hostname,port:u.port||443,path:`${u.pathname}${u.search}`,method,headers,agent,servername:u.hostname,timeout:20000},r=>{
      const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode||0,headers:r.headers,body:Buffer.concat(chunks).toString('utf8'),latencyMs:Date.now()-started,authorized:r.socket?.authorized??null,authorizationError:r.socket?.authorizationError||''}));
    });
    req.on('timeout',()=>req.destroy(new Error('Timeout ao acessar o TJPE.')));
    req.on('error',reject);
    if(body)req.write(body);req.end();
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&req.url==='/health'){
      const checks=await Promise.all(['1g','2g'].map(async degree=>{
        try{const r=await requestOrigin(WSDLS[degree],{headers:{accept:'text/xml, application/wsdl+xml'}});return{degree,ok:r.status>=200&&r.status<400,status:r.status,latencyMs:r.latencyMs,tlsAuthorized:r.authorized,tlsAuthorizationError:r.authorizationError};}
        catch(e){return{degree,ok:false,error:e.message};}
      }));
      return json(res,200,{ok:true,service:'dilimagalhaes-pje-relay',clientCertificateConfigured:Boolean(CERT&&KEY),extraCaConfigured:Boolean(EXTRA_CA),checks});
    }
    if(req.method!=='POST'||req.url!=='/relay')return json(res,404,{error:'Rota não encontrada.'});
    if(!authorized(req))return json(res,401,{error:'Não autorizado.'});
    const chunks=[];for await(const c of req)chunks.push(c);let input={};try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(res,400,{error:'JSON inválido.'});}
    const degree=input.degree==='2g'?'2g':'1g';const mode=input.mode==='wsdl'?'wsdl':'soap';const url=mode==='wsdl'?WSDLS[degree]:ENDPOINTS[degree];
    const headers=mode==='wsdl'?{accept:'text/xml, application/wsdl+xml'}:{'content-type':'text/xml; charset=UTF-8','accept':'text/xml, application/soap+xml','soapaction':String(input.soapaction||'')};
    const out=await requestOrigin(url,{method:mode==='wsdl'?'GET':'POST',headers,body:mode==='soap'?String(input.body||''):''});
    return json(res,200,{ok:out.status>=200&&out.status<400,status:out.status,body:out.body,headers:{'content-type':out.headers['content-type']||''},latencyMs:out.latencyMs,tlsAuthorized:out.authorized,tlsAuthorizationError:out.authorizationError,degree,mode});
  }catch(e){return json(res,502,{ok:false,error:e?.message||'Falha no relay.'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`PJe relay ouvindo na porta ${PORT}`));
