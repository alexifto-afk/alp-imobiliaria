import React,{useState} from 'react';

export default function CompanySettings({company,request,token,onSaved}){
 const [name,setName]=useState(company.name),[logo,setLogo]=useState(company.logo),[changed,setChanged]=useState(false),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[message,setMessage]=useState('');
 async function choose(event){
  const file=event.target.files?.[0];if(!file)return;
  setMessage('');event.target.value='';
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){setMessage('Escolha uma imagem PNG, JPEG ou WebP de até 2 MB.');return}
  setReading(true);
  try{
   const value=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Não foi possível ler a imagem.'));reader.readAsDataURL(file)});
   setLogo(value);setChanged(true);
  }catch(error){setMessage(error.message)}finally{setReading(false)}
 }
 async function save(event){
  event.preventDefault();setBusy(true);setMessage('');
  try{const saved=await request('/company','PUT',{name,...(changed?{logo}:{})},token);onSaved(saved);setName(saved.name);setLogo(saved.logo);setChanged(false);setMessage('Identidade da empresa salva com sucesso.')}
  catch(error){setMessage(error.message)}finally{setBusy(false)}
 }
 return <section className="panel company-settings"><h2>Configurações da empresa</h2><p>Defina o nome e a logomarca exibidos no sistema. As alterações são compartilhadas com os demais usuários ao abrir ou atualizar a página.</p>
 {company.configured===false&&<p role="alert">A configuração precisa ser habilitada no banco antes de salvar. Execute o SQL indicado no guia CONFIGURACOES-EMPRESA.md.</p>}
 <form onSubmit={save}><label className="field"><span>Nome da empresa</span><input required minLength={2} maxLength={80} value={name} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
 <label className="field"><span>Logomarca da empresa</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} disabled={busy||reading}/></label><small>PNG, JPEG ou WebP, até 2 MB. A imagem é ajustada para as telas e documentos.</small>
 {logo?<img className="company-logo-preview" src={logo} alt="Prévia da logomarca"/>:<p>Será utilizada a logomarca padrão do sistema.</p>}
 <div className="actions"><button type="button" className="secondary" disabled={busy||reading} onClick={()=>{setLogo(null);setChanged(true)}}>Restaurar logomarca padrão</button><button disabled={busy||reading}>{busy?'Salvando...':'Salvar configurações'}</button></div>
 {message&&<p role="status">{message}</p>}</form></section>;
}
