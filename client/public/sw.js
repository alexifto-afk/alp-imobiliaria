/* Service worker apenas para notificações. Não armazena páginas ou dados financeiros. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch{}
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
 const today=parts.year+'-'+parts.month+'-'+parts.day;
 event.waitUntil(self.registration.showNotification('A.L.P Imobiliária',{
  body:data.day===today?'Você tem parcela com vencimento hoje. Abra o app para consultar e pagar.':'Abra o app para consultar suas parcelas e pagamentos.',
  icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',tag:'due-'+(data.day||today),
  data:{url:'/?view=installments'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const target=new URL('/?view=installments',self.location.origin).href;
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
  if(existing){await existing.navigate(target);return existing.focus()}
  return self.clients.openWindow(target);
 })());
});
