import MaskedInput from './MaskedInput.jsx';
import React,{useEffect,useState} from 'react';

export default function PasswordRecovery({request,initialCpf='',onBack,onSuccess}){
 const [step,setStep]=useState('request');
 const [cpf,setCpf]=useState(initialCpf.replace(/\D/g,'').slice(0,11));
 const [code,setCode]=useState('');
 const [password,setPassword]=useState('');
 const [confirmation,setConfirmation]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [emailHint,setEmailHint]=useState('');
 const [error,setError]=useState('');
 const [seconds,setSeconds]=useState(0);
 const counting=seconds>0;
 useEffect(()=>{
  if(!counting)return;
  const timer=setInterval(()=>setSeconds(v=>Math.max(0,v-1)),1000);
  return()=>clearInterval(timer);
 },[counting]);
 const data=()=>({cpf,channel:'EMAIL',code});
 async function sendCode(event){
  event?.preventDefault();
  if(busy||seconds>0)return;
  setBusy(true);setError('');setEmailHint('');
  try{
   const result=await request('/auth/password-reset/request','POST',{cpf,channel:'EMAIL'});
   setCode('');setPassword('');setConfirmation('');
   setEmailHint(result.emailHint||'');
   setSeconds(result.retryAfterSeconds||60);setNotice(result.message);setStep('verify');
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function verify(event){
  event.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{await request('/auth/password-reset/verify','POST',data());setStep('password');setNotice('Código conferido. Defina sua nova senha antes de ele expirar.')}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function confirm(event){
  event.preventDefault();if(busy)return;setError('');
  if(password!==confirmation){setError('As senhas não coincidem.');return}
  if(password.length<10||new TextEncoder().encode(password).length>72){setError('Use de 10 a 72 caracteres. Se usar muitos acentos ou símbolos, escolha uma senha mais curta.');return}
  setBusy(true);
  try{await request('/auth/password-reset/confirm','POST',{...data(),newPassword:password});onSuccess(cpf)}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 function restart(){setStep('request');setCode('');setPassword('');setConfirmation('');setError('');setNotice('');setEmailHint('')}
 return <>
  <button className="alp-auth-back" type="button" disabled={busy} onClick={onBack}>← Voltar ao login</button>
  <span className="alp-auth-kicker">RECUPERAÇÃO DE ACESSO</span>
  <h2>{step==='request'?'Esqueceu sua senha?':step==='verify'?'Confira seu e-mail':'Crie uma nova senha'}</h2>
  <p className="alp-auth-description">{step==='request'?'Informe seu CPF. O código será enviado ao e-mail cadastrado na sua conta.':step==='verify'?'Digite o código de seis dígitos recebido por e-mail. Ele vale por 10 minutos.':'Escolha uma senha com pelo menos 10 caracteres.'}</p>
  {notice&&<div className="alp-auth-alert" role="status">{notice}</div>}
  {step==='verify'&&emailHint&&<p className="alp-auth-description">E-mail de recuperação: <strong>{emailHint}</strong></p>}
  {error&&<div className="alp-auth-alert" role="alert">{error}</div>}
  {step==='request'?<form onSubmit={sendCode}>
   <label className="alp-auth-field"><span>CPF cadastrado</span><MaskedInput kind="cpf" required autoComplete="username" minLength={14} disabled={busy} value={cpf} placeholder="Digite seu CPF" onValueChange={setCpf}/></label>
   <button className="alp-auth-primary" disabled={busy||seconds>0}>{busy?'Enviando...':seconds>0?'Aguarde '+seconds+'s':'Enviar código por e-mail'}</button>
   <p className="alp-auth-help">Sem acesso ao e-mail cadastrado? Fale com a administração.</p>
  </form>:step==='verify'?<form onSubmit={verify}>
   <label className="alp-auth-field"><span>Código de recuperação</span><input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} disabled={busy} value={code} placeholder="Código de seis dígitos" onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))}/></label>
   <button className="alp-auth-primary" disabled={busy}>{busy?'Verificando...':'Verificar código'}</button>
   <button type="button" className="alp-auth-textbutton" disabled={busy||seconds>0} onClick={sendCode}>{seconds>0?'Reenviar em '+seconds+'s':'Reenviar código'}</button>
   <button type="button" className="alp-auth-textbutton" disabled={busy} onClick={restart}>Usar outro CPF</button>
   <p className="alp-auth-help">Não recebeu? Confira o spam ou fale com a administração.</p>
  </form>:<form onSubmit={confirm}>
   <label className="alp-auth-field"><span>Nova senha</span><input required type="password" autoComplete="new-password" minLength={10} maxLength={72} disabled={busy} value={password} onChange={e=>setPassword(e.target.value)}/></label>
   <label className="alp-auth-field"><span>Confirme a nova senha</span><input required type="password" autoComplete="new-password" minLength={10} maxLength={72} disabled={busy} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
   <button className="alp-auth-primary" disabled={busy}>{busy?'Salvando...':'Redefinir senha'}</button>
   <button type="button" className="alp-auth-textbutton" disabled={busy} onClick={restart}>Solicitar outro código</button>
  </form>}
 </>;
}
