(()=>{
  const nativeFetch=window.fetch.bind(window);
  let dirty=false;
  let syncTimer=null;
  const parse=init=>{try{return JSON.parse(init?.body||'{}')}catch{return{}}};
  const syncLater=()=>{
    clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>{
      nativeFetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'sync'})})
        .then(r=>{if(r.ok)dirty=false}).catch(()=>{});
    },900);
  };
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:(input?.url||'');
    const method=String(init.method||'GET').toUpperCase();
    if(url.includes('/api/sheets')&&method==='POST'){
      const body=parse(init);
      if((body.action==='list'||body.action==='detail')&&!dirty){
        try{
          const wr=await nativeFetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
          if(wr.ok)return wr;
        }catch{}
        return nativeFetch(input,init);
      }
      const r=await nativeFetch(input,init);
      if(r.ok&&body.action!=='list'&&body.action!=='detail'){
        dirty=true;
        syncLater();
      }
      return r;
    }
    return nativeFetch(input,init);
  };
})();
