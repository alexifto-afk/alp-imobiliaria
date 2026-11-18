export function pushSupport(){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const installed=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 if(ios&&!installed)return {supported:false,reason:'No iPhone, abra no Safari, toque em Compartilhar e escolha Adicionar à Tela de Início. Depois abra pelo ícone para ativar os avisos.'};
 if(!window.isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))return {supported:false,reason:ios?'Atualize o iPhone para iOS 16.4 ou superior e abra o app pela Tela de Início.':'Use um navegador atualizado compatível com notificações.'};
 return {supported:true,reason:''};
}
export function applicationKey(value){
 const base64=value.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64+'='.repeat((4-base64.length%4)%4));
 return Uint8Array.from(raw,character=>character.charCodeAt(0));
}
export async function registerPushWorker(){
 await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
 return navigator.serviceWorker.ready;
}
export async function disableCurrentPush(request,token){
 if(!('serviceWorker'in navigator))return;
 const registration=await navigator.serviceWorker.getRegistration('/');
 const subscription=await registration?.pushManager.getSubscription();if(!subscription)return;
 const results=await Promise.allSettled([
  subscription.unsubscribe().then(ok=>{if(!ok)throw Error('Não foi possível remover a assinatura local.')}),
  request('/notifications/subscriptions','DELETE',{endpoint:subscription.endpoint},token)
 ]);
 if(results.every(result=>result.status==='rejected'))throw Error('Não foi possível desativar os avisos. Tente novamente.');
}
export function dueTodayCount(contracts,date=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
 const day=parts.year+'-'+parts.month+'-'+parts.day;
 return contracts.flatMap(contract=>contract.installments||[]).filter(item=>['OPEN','REJECTED'].includes(item.status)&&String(item.dueDate).slice(0,10)===day).length;
}
