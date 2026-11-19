import React from 'react';
import {createRoot} from 'react-dom/client';
import SupportContact from './SupportContact.jsx';
import {loadCompany,applyPublicCompany} from './company-client.js';

// A apresentação pública fica no HTML, acessível mesmo sem JavaScript ou login.
// Mantém sessões existentes e o destino dos avisos enviados ao celular.
const params=new URLSearchParams(window.location.search);
const openSystem=window.location.pathname.replace(/\/$/,'')==='/login'
 ||Boolean(sessionStorage.getItem('gi-token'))||params.get('view')==='installments';
if(openSystem){
 document.body.classList.remove('alp-public-page');
 Promise.all([import('./App.jsx'),import('./style.css')]).then(([{default:App}])=>{
  document.title='A.L.P Imobiliária — Sistema';
  createRoot(document.getElementById('root')).render(<><App/><SupportContact/></>);
 });
}

else{loadCompany().then(applyPublicCompany).catch(()=>{});}
