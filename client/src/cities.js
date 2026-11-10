const cache=new Map();
const source=()=>import('./data/municipalities.mjs');
export async function loadCities(uf,{signal,loadData=source}={}){
 if(!/^[A-Z]{2}$/.test(uf))return [];
 if(signal?.aborted)throw new DOMException('Cancelado','AbortError');
 if(cache.has(uf))return cache.get(uf);
 try{
  const data=(await loadData()).default;
  if(signal?.aborted)throw new DOMException('Cancelado','AbortError');
  const rows=data[uf];
  if(!Array.isArray(rows)||!rows.length)throw Error('UF sem municípios');
  const cities=rows.map(([id,name])=>({id:String(id),name}));
  cities.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  cache.set(uf,cities);return cities;
 }catch(error){
  if(signal?.aborted)throw error;
  throw Error('Não foi possível carregar as cidades. Tente novamente.');
 }
}
