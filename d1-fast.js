(()=>{
  const nativeFetch=window.fetch.bind(window);
  const parse=init=>{try{return JSON.parse(init?.body||'{}')}catch{return{}}};
  window.fetch=async(input,init={})=>{
    const url=typeof input==='string'?input:(input?.url||'');
    const method=String(init.method||'GET').toUpperCase();
    if(url.includes('/api/sheets')&&method==='POST'){
      const body=parse(init);
      if(body.action==='list'||body.action==='detail'){
        try{
          const wr=await nativeFetch('/api/workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
          if(wr.ok)return wr;
        }catch{}
        return nativeFetch(input,init);
      }
      return nativeFetch(input,init);
    }
    return nativeFetch(input,init);
  };
})();
