(()=>{
  const nativeFetch=window.fetch.bind(window);
  const CACHE_PREFIX='dili.fast.v3:';
  const FRESH_MS=12000;
  const STALE_MS=90000;
  const memory=new Map();
  const inflight=new Map();
  const parse=init=>{try{return JSON.parse(init?.body||'{}')}catch{return{}}};
  const keyFor=body=>body.action==='list'?'list':`detail:${body.id||body.row||body.processo||''}`;
  const storageKey=key=>CACHE_PREFIX+key;
  const makeResponse=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','x-dili-cache':'1'}});
  function readCache(key){
    const now=Date.now();
    const mem=memory.get(key);
    if(mem&&now-mem.t<STALE_MS)return mem;
    try{
      const raw=sessionStorage.getItem(storageKey(key));
      if(!raw)return null;
      const item=JSON.parse(raw);
      if(!item||!item.t||now-item.t>=STALE_MS){sessionStorage.removeItem(storageKey(key));return null;}
      memory.set(key,item); return item;
    }catch{return null;}
  }
  function writeCache(key,data){
    const item={t:Date.now(),data}; memory.set(key,item);
    try{sessionStorage.setItem(storageKey(key),JSON.stringify(item));}catch{}
  }
  function clearCache(){
    memory.clear();
    try{for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k&&k.startsWith(CACHE_PREFIX))sessionStorage.removeItem(k);}}catch{}
  }
  async function workspaceSnapshot(body,key){
    if(inflight.has(key))return inflight.get(key);
    const p=(async()=>{
      const r=await nativeFetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const text=await r.text();
      let data=null; try{data=JSON.parse(text)}catch{}
      if(r.ok&&data)writeCache(key,data);
      return {ok:r.ok,status:r.status,text,data};
    })().finally(()=>inflight.delete(key));
    inflight.set(key,p); return p;
  }
  async function fastWorkspace(body){
    const key=keyFor(body),cached=readCache(key),age=cached?Date.now()-cached.t:Infinity;
    if(cached&&age<FRESH_MS)return makeResponse(cached.data);
    if(cached&&age<STALE_MS){workspaceSnapshot(body,key).catch(()=>{});return makeResponse(cached.data);}
    try{
      const snap=await workspaceSnapshot(body,key);
      return new Response(snap.text,{status:snap.status,headers:{'content-type':'application/json; charset=utf-8'}});
    }catch(e){
      if(cached)return makeResponse(cached.data);
      throw e;
    }
  }
  window.addEventListener('pageshow',e=>{if(e.persisted)clearCache()});
  document.addEventListener('click',e=>{const a=e.target?.closest?.('a[href="/__logout"]');if(a)clearCache();},{capture:true});
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:(input?.url||'');
    const method=String(init.method||'GET').toUpperCase();
    if(url.includes('/api/sheets')&&method==='POST'){
      const body=parse(init);
      if(body.action==='list'||body.action==='detail'){
        try{
          const wr=await fastWorkspace(body);
          if(wr.ok)return wr;
        }catch{}
        return nativeFetch(input,init);
      }
      const r=await nativeFetch(input,init);
      if(r.ok)clearCache();
      return r;
    }
    return nativeFetch(input,init);
  };
})();
