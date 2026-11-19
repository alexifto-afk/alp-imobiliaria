import React,{useLayoutEffect,useRef} from 'react';
import {formatPhone} from './form-format.js';

const money=value=>value==null?'Não informado':(value/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=value=>value?new Date(value).toLocaleDateString('pt-BR',{timeZone:'UTC'}):'Não informado';
const dayOf=value=>String(value||'').slice(0,10);
const today=()=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));return parts.year+'-'+parts.month+'-'+parts.day};
function situation(item){
 if(item.status==='PAID')return {label:'Paga',color:'paid'};
 if(item.status==='PENDING_REVIEW')return {label:'Em análise',color:'review'};
 if(dayOf(item.dueDate)<today())return {label:'Vencida',color:'late'};
 return {label:item.status==='REJECTED'?'Comprovante rejeitado':'Em aberto',color:'soon'};
}
export function Calendar({month,installments,onSelect,onSelectDay}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return <p>Selecione um mês para consultar os vencimentos.</p>;
 const first=new Date(month+'-01T00:00:00Z'),last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
 const offset=first.getUTCDay(),days=Array.from({length:offset+last.getUTCDate()},(_,index)=>index-offset+1);
 return <div className="calendar" role="region" aria-label="Calendário com rolagem horizontal" tabIndex={0}><div className="weekdays">{['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day=><b key={day}>{day}</b>)}</div><div className="calgrid">{days.map((day,index)=>{
  if(day<1)return <div key={index}/>;
  const key=month+'-'+String(day).padStart(2,'0'),items=installments.filter(item=>dayOf(item.dueDate)===key);
  return <div key={key} className="calday"><strong>{day}</strong>{items.slice(0,4).map(item=>{
   const status=situation(item),name=item.contract.client.user.name;
   return <button type="button" key={item.id} className={'calitem calendar-debt-button '+status.color} title={name+' — '+money(item.amount)} aria-label={'Ver débito de '+name+', parcela '+item.number+', '+date(item.dueDate)} onClick={()=>onSelect(item.id)}>{name.split(' ')[0]} · {money(item.amount)}</button>;
  })}{items.length>4&&<button type="button" className="calendar-more" onClick={()=>onSelectDay(key)} aria-label={'Ver todas as '+items.length+' parcelas de '+date(key)}>+{items.length-4} parcelas</button>}</div>;
 })}</div></div>;
}
function Field({label,children}){return <div><dt>{label}</dt><dd>{children??'Não informado'}</dd></div>}
export function CalendarDebtDialog({selection,installments,onSelect,onClose,whatsappLink}){
 const dialog=useRef(null),heading=useRef(null);
 useLayoutEffect(()=>{
  const element=dialog.current,previous=document.body.style.overflow,previousFocus=document.activeElement;
  element.showModal();document.body.style.overflow='hidden';
  return()=>{element.close();document.body.style.overflow=previous;if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true})};
 },[]);
 useLayoutEffect(()=>{heading.current?.focus()},[selection.type,selection.id,selection.day]);
 const item=selection.type==='installment'?installments.find(value=>value.id===selection.id):null;
 const items=selection.type==='day'?installments.filter(value=>dayOf(value.dueDate)===selection.day):[];
 const title=selection.type==='day'?'Parcelas de '+date(selection.day):'Detalhes do débito';
 function keepFocus(event){
  if(event.key!=='Tab')return;
  const elements=[...dialog.current.querySelectorAll('button:not(:disabled),a[href]')],first=elements[0],last=elements.at(-1),active=document.activeElement;
  if(event.shiftKey&&(active===first||active===heading.current)){event.preventDefault();last?.focus()}
  else if(!event.shiftKey&&active===last){event.preventDefault();first?.focus()}
 }
 return <dialog ref={dialog} className="calendar-debt-dialog" aria-labelledby="calendar-debt-title" onKeyDown={keepFocus} onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}><div className="calendar-debt-content"><header><h2 id="calendar-debt-title" ref={heading} tabIndex={-1}>{title}</h2><button type="button" className="secondary" aria-label="Fechar detalhes" onClick={onClose}>✕</button></header>
 {selection.type==='day'?<div className="calendar-day-list">{items.map(value=><button type="button" key={value.id} onClick={()=>onSelect(value.id)}><strong>{value.contract.client.user.name}</strong><span>Parcela {value.number}/{value.contract.installmentCount} · {money(value.amount)} · {situation(value).label}</span><small>{value.contract.property.reference}</small></button>)}{!items.length&&<p>Nenhuma parcela encontrada para este dia.</p>}</div>:item?(()=>{
  const contract=item.contract,status=situation(item),paid=contract.installments.filter(value=>value.status==='PAID').reduce((total,value)=>total+value.amount,0),balance=contract.installments.filter(value=>value.status!=='PAID').reduce((total,value)=>total+value.amount,0);
  const link=item.status!=='PAID'?whatsappLink(item):null;
  return <><p className={'calendar-debt-status '+status.color}>{status.label}</p><h3>Cliente e imóvel</h3><dl className="calendar-debt-fields"><Field label="Nome do cliente">{contract.client.user.name}</Field><Field label="Telefone">{formatPhone(contract.client.phone)||'Não informado'}</Field><Field label="Imóvel">{contract.property.reference}</Field><Field label="Endereço">{contract.property.address}</Field><Field label="Identificador do contrato">{contract.id}</Field><Field label="Início do contrato">{date(contract.startDate)}</Field></dl>
  <h3>Parcela selecionada</h3><dl className="calendar-debt-fields"><Field label="Parcela">{item.number} de {contract.installmentCount}</Field><Field label="Vencimento">{date(item.dueDate)}</Field><Field label="Valor da parcela">{money(item.amount)}</Field><Field label="Situação">{status.label}</Field></dl>
  <h3>Valores do contrato</h3><dl className="calendar-debt-fields"><Field label="Valor do contrato (imóvel)">{money(contract.propertyPrice)}</Field><Field label="Entrada contratada">{money(contract.downPayment)}</Field><Field label="Valor financiado">{money(contract.financedAmount)}</Field><Field label="Total das parcelas">{money(paid+balance)}</Field><Field label="Recebido em parcelas">{money(paid)}</Field><Field label="Saldo em parcelas">{money(balance)}</Field></dl><p className="hint">O saldo inclui todas as parcelas não quitadas deste contrato, inclusive as que ainda vão vencer ou estão em análise. A entrada é o valor previsto no contrato.</p>
  {item.status==='PENDING_REVIEW'&&<p className="hint">Há um comprovante aguardando análise para esta parcela.</p>}
  {link&&<a className="wa-button" href={link} target="_blank" rel="noopener noreferrer">Enviar lembrete pelo WhatsApp</a>}</>;
 })():<p>Esta parcela não está mais disponível. Feche os detalhes e consulte o calendário novamente.</p>}
 <footer><button type="button" className="secondary" onClick={onClose}>Fechar</button></footer></div></dialog>;
}
