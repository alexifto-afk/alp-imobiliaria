import React,{useRef,useState} from 'react';
export default function ReceiptSubmission({installment,request,token,onSubmitted,onFile}){
 const [file,setFile]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');const input=useRef(null);
 const receipts=[...(installment.receipts||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),pending=receipts.some(value=>value.status==='PENDING')||installment.status==='PENDING_REVIEW',paid=installment.status==='PAID';
 async function submit(event){
  event.preventDefault();setMessage('');
  if(!file){setMessage('Selecione um comprovante.');return}
  if(file.size>8*1024*1024){setMessage('O comprovante deve ter até 8 MB.');return}
  setBusy(true);
  try{
   const body=new FormData();body.append('file',file);
   await request('/installments/'+installment.id+'/receipts','POST',body,token);
   setFile(null);if(input.current)input.current.value='';setMessage('Comprovante enviado. Aguarde a conferência da administração para a baixa.');await onSubmitted();
  }catch(error){setMessage(error.message)}finally{setBusy(false)}
 }
 if((paid||!installment.manualReceiptEnabled)&&!receipts.length)return null;
 return <section className="receipt-submission" aria-label="Comprovante da parcela"><h3>{paid?'Comprovantes enviados':'Já paguei / Enviar comprovante'}</h3>
 {!paid&&installment.manualReceiptEnabled&&<p>Se você já pagou e a parcela continua em aberto, envie o comprovante desta parcela. A administração vai conferir o recebimento e dar a baixa.</p>}
 {pending&&!paid?<p className="receipt-review-notice" role="status">Comprovante em análise. Aguarde a conferência antes de fazer outro pagamento.</p>:!paid&&installment.manualReceiptEnabled&&<form onSubmit={submit}><label className="field"><span>Comprovante de pagamento</span><input ref={input} type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]||null);setMessage('')}}/></label><small>PDF, JPEG, PNG ou WebP, até 8 MB. O envio não confirma o pagamento automaticamente.</small><button type="submit" disabled={busy}>{busy?'Enviando...':'Enviar comprovante para análise'}</button></form>}
 {!paid&&!pending&&!installment.manualReceiptEnabled&&<p>O envio de novos comprovantes está desabilitado para esta parcela. O histórico continua disponível.</p>}
 {message&&<p role="status">{message}</p>}
 {receipts.length>0&&<div className="receipt-history"><h4>Histórico desta parcela</h4>{receipts.map(receipt=><article key={receipt.id}><strong>{receipt.status==='APPROVED'?'Aprovado':receipt.status==='REJECTED'?'Rejeitado':'Aguardando análise'}</strong><small>{new Date(receipt.createdAt).toLocaleDateString('pt-BR')} · {receipt.originalName}</small>{receipt.note&&<p>Observação da administração: {receipt.note}</p>}<button type="button" className="secondary" onClick={()=>onFile(receipt.id)}>Ver comprovante enviado</button></article>)}</div>}
 </section>;
}
