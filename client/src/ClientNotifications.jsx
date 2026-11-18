import React,{useEffect,useRef,useState} from 'react';
import {pushSupport,registerPushWorker,applicationKey,disableCurrentPush,dueTodayCount} from './push-client.js';

export default function ClientNotifications({request,token,contracts=[],onOpenInstallments}){
 const support=pushSupport(),registration=useRef(null);
 const [config,setConfig]=useState(null),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[message,setMessage]=useState('');
 const due=dueTodayCount(contracts);
 useEffect(()=>{
  let alive=true;
  (async()=>{
   try{
    const settings=await request('/notifications/config','GET',undefined,token);
    if(!alive)return;setConfig(settings);
    if(!settings.enabled||!support.supported)return;
    const worker=await registerPushWorker();if(!alive)return;registration.current=worker;
    const subscription=await worker.pushManager.getSubscription();
    if(subscription){const status=await request('/notifications/status','POST',{endpoint:subscription.endpoint},token);if(alive)setActive(status.active)}
    if(alive)setReady(true);
   }catch{if(alive)setMessage('Não foi possível consultar os lembretes. Tente novamente ao abrir esta tela.')}
  })();
  return()=>{alive=false};
 },[token]);
 async function enable(){
  if(busy||!ready||!config?.enabled)return;
  setBusy(true);setMessage('');
  try{
   // A permissão é solicitada somente após o toque no botão.
   const permission=await Notification.requestPermission();
   if(permission!=='granted'){setMessage('Permissão não concedida. Você pode liberar os avisos nas configurações do navegador ou do app.');return}
   let subscription=await registration.current.pushManager.getSubscription();
   if(subscription?.options?.applicationServerKey){
    const previous=new Uint8Array(subscription.options.applicationServerKey),next=applicationKey(config.publicKey);
    if(previous.length!==next.length||previous.some((value,index)=>value!==next[index])){await subscription.unsubscribe();subscription=null}
   }
   if(!subscription)subscription=await registration.current.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(config.publicKey)});
   await request('/notifications/subscriptions','POST',{subscription:subscription.toJSON()},token);
   setActive(true);setMessage('Lembretes ativados neste aparelho.');
  }catch{setMessage('Não foi possível ativar os avisos. Confira a permissão e tente novamente.')}
  finally{setBusy(false)}
 }
 async function disable(){
  setBusy(true);setMessage('');
  try{await disableCurrentPush(request,token);setActive(false);setMessage('Lembretes desativados neste aparelho.')}
  catch(error){setMessage(error.message)}finally{setBusy(false)}
 }
 const denied=support.supported&&Notification.permission==='denied';
 return <section className="notification-settings" aria-label="Lembretes de vencimento">
  <h2>Lembretes de vencimento</h2>
  {due>0&&<div className="notification-due" role="status"><strong>{due===1?'Você tem uma parcela vencendo hoje.':'Você tem '+due+' parcelas vencendo hoje.'}</strong>{onOpenInstallments&&<button type="button" onClick={onOpenInstallments}>Ver parcelas</button>}</div>}
  <p>Receba um aviso no celular às 12h, no horário de Brasília, no dia do vencimento de parcelas em aberto.</p>
  {!support.supported?<p>{support.reason}</p>:config&&!config.enabled?<p>Os avisos no celular ainda estão sendo configurados pela administração.</p>:<>
   {active?<><p>Ativado neste aparelho.</p><button type="button" className="secondary" disabled={busy} onClick={disable}>Desativar lembretes neste aparelho</button></>:<button type="button" disabled={busy||!ready||denied} onClick={enable}>{busy?'Ativando...':'Ativar lembretes neste aparelho'}</button>}
   {denied&&<p>Os avisos estão bloqueados. Libere a permissão nas configurações do navegador ou do app na Tela de Início.</p>}
  </>}
  {message&&<p role="status">{message}</p>}
  <small>A entrega depende da conexão e das configurações de notificações do celular.</small>
 </section>;
}
