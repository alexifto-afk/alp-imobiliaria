export const onlyDigits=value=>String(value??'').replace(/\D/g,'');
export const cpfDigits=value=>onlyDigits(value).slice(0,11);
export function phoneDigits(value){
 let digits=onlyDigits(value);
 if((digits.length===12||digits.length===13)&&digits.startsWith('55'))digits=digits.slice(2);
 return digits.slice(0,11);
}
export function formatCpf(value){
 const digits=cpfDigits(value);
 return digits.slice(0,3)+(digits.length>3?'.'+digits.slice(3,6):'')+(digits.length>6?'.'+digits.slice(6,9):'')+(digits.length>9?'-'+digits.slice(9):'');
}
export function formatPhone(value){
 const digits=phoneDigits(value);
 if(!digits)return '';
 if(digits.length<=2)return '('+digits;
 const number=digits.slice(2),split=number.length>8?5:4;
 return '('+digits.slice(0,2)+') '+number.slice(0,split)+(number.length>split?'-'+number.slice(split):'');
}
export function normalizeSex(value){
 const sex=String(value||'').trim().toUpperCase();
 return ['M','MASCULINO'].includes(sex)?'M':['F','FEMININO'].includes(sex)?'F':'';
}
export const clientPayload=value=>({...value,cpf:cpfDigits(value.cpf),phone:phoneDigits(value.phone),spouseCpf:cpfDigits(value.spouseCpf),sex:normalizeSex(value.sex)});
