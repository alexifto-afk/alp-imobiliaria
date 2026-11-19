const API=(import.meta.env.VITE_API_URL||'http://localhost:3001/api').replace(/\/$/,'');
export async function loadCompany(){
 const response=await fetch(API+'/company',{cache:'no-store'});
 if(!response.ok)throw Error('Não foi possível carregar a empresa.');
 const data=await response.json();
 if(typeof data.name!=='string'||!data.name.trim())throw Error('Configuração inválida.');
 return {name:data.name,logo:typeof data.logo==='string'&&data.logo.startsWith('data:image/jpeg;base64,')?data.logo:null,configured:data.configured};
}
export function applyPublicCompany(company){
 document.title=company.name+' | Portal de clientes';
 const walker=document.createTreeWalker(document.getElementById('root'),NodeFilter.SHOW_TEXT);
 let node;
 while((node=walker.nextNode())){
  if(['SCRIPT','STYLE'].includes(node.parentElement?.tagName))continue;
  node.textContent=node.textContent.replace(/A\.L\.P Imobiliária|ALP Imobiliária|A\.L\.P IMOBILIÁRIA|ALP IMOBILIÁRIA/g,()=>company.name);
 }
 const brand=document.querySelector('.public-brand span');if(brand)brand.textContent=company.name;
 const logo=document.querySelector('.public-brand img');if(logo&&company.logo)logo.src=company.logo;
}
