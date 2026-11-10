import React,{useEffect,useId,useState} from 'react';
import {loadCities} from './cities.js';

export default function CitySelect({uf,city,cityCode,onChange}){
 const id=useId(),[retry,setRetry]=useState(0);
 const [state,setState]=useState({uf:'',cities:[],status:'idle',error:''});
 useEffect(()=>{
  if(!uf){setState({uf:'',cities:[],status:'idle',error:''});return}
  let active=true;const controller=new AbortController();
  setState({uf,cities:[],status:'loading',error:''});
  loadCities(uf,{signal:controller.signal}).then(cities=>{if(active)setState({uf,cities,status:'ready',error:''})}).catch(error=>{if(active)setState({uf,cities:[],status:'error',error:error.message})});
  return()=>{active=false;controller.abort()};
 },[uf,retry]);
 const current=state.uf===uf?state:{cities:[],status:'loading',error:''};
 const selected=current.cities.find(item=>item.id===String(cityCode)||item.name.toLocaleLowerCase('pt-BR')===String(city||'').toLocaleLowerCase('pt-BR'));
 const legacy=Boolean(city&&!selected);
 const value=selected?.id||(legacy?'saved-city':'');
 return <div className="field">
  <label htmlFor={id}>Cidade</label>
  <select id={id} value={value} disabled={!uf||current.status!=='ready'} onChange={event=>{
   const next=current.cities.find(item=>item.id===event.target.value);
   onChange(next?{city:next.name,cityCode:next.id}:{city:'',cityCode:''});
  }}>
   <option value="">{!uf?'Selecione a UF primeiro':current.status==='loading'?'Carregando cidades...':'Selecione a cidade'}</option>
   {legacy&&<option value="saved-city">{city} (cadastrada)</option>}
   {current.cities.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
  </select>
  {current.error&&<div role="alert"><span>{current.error}</span> <button type="button" className="small secondary" onClick={()=>setRetry(value=>value+1)}>Tentar carregar cidades novamente</button></div>}
 </div>;
}
