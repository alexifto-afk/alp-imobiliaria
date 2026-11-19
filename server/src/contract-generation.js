const invalid=message=>Object.assign(new Error(message),{status:400});
const cents=value=>{const amount=Number(value);if(!Number.isSafeInteger(amount)||amount<0)throw invalid('Valor monetário inválido (centavos).');return amount};
function schedule(principal,n,type,rate){
 const r=rate/100;let total;
 if(type==='NONE'||type==='PRICE'&&r===0)total=principal;
 else if(type==='SIMPLE')total=Math.round(principal*(1+r*n));
 else if(type==='PRICE')total=Math.round(principal*(r*Math.pow(1+r,n))/(Math.pow(1+r,n)-1)*n);
 else throw invalid('Modalidade de juros inválida.');
 if(!Number.isSafeInteger(total))throw invalid('O valor calculado das parcelas é inválido.');
 const base=Math.floor(total/n),remainder=total%n;
 return Array.from({length:n},(_,index)=>base+(index<remainder?1:0));
}
export function entryInstallments(price,financed,n,type,rate){
 const downPayment=price-financed;
 if(!Number.isSafeInteger(downPayment)||downPayment<=0)throw invalid('A entrada deve ser maior que zero para gerar as parcelas do cliente.');
 const amounts=schedule(downPayment,n,type,rate);
 if(amounts.some(value=>value<1))throw invalid('A quantidade de parcelas não pode gerar valores inferiores a um centavo.');
 return {downPayment,amounts};
}
function addMonth(date,n){const y=date.getUTCFullYear(),m=date.getUTCMonth()+n,d=date.getUTCDate(),last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(d,last),12))}
function fields(body){
 const n=Number(body.installmentCount),price=cents(body.propertyPrice),financed=cents(body.financedAmount),rate=Number(body.monthlyRate||0),type=String(body.interestType||'NONE').trim();
 const start=new Date(String(body.startDate||'').slice(0,10)+'T12:00:00Z');
 if(!price||financed>price||!Number.isInteger(n)||n<1||n>600||!['NONE','SIMPLE','PRICE'].includes(type)||!Number.isFinite(rate)||rate<0||rate>100||Number.isNaN(start.getTime()))throw invalid('Dados do contrato inválidos.');
 const {downPayment,amounts}=entryInstallments(price,financed,n,type,rate);
 return {propertyPrice:price,financedAmount:financed,downPayment,interestType:type,monthlyRate:rate,installmentCount:n,startDate:start,installments:{create:amounts.map((amount,index)=>({number:index+1,amount,dueDate:addMonth(start,index)}))}};
}
export function registerContractGenerationRoutes(app,{db,auth,current,admin,contractInclude}){
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 app.post('/api/contracts',auth,current,admin,wrap(async(req,res)=>{
  const body=req.body||{},data=fields(body);
  const [client,property]=await Promise.all([db.client.findUnique({where:{id:body.clientId},include:{user:true}}),db.property.findUnique({where:{id:body.propertyId}})]);
  if(!client?.user.active||!property?.active)return res.status(400).json({error:'Cliente ou imóvel inexistente/inativo'});
  const result=await db.contract.create({data:{clientId:client.id,propertyId:property.id,...data},include:contractInclude});res.status(201).json(result);
 }));
 app.patch('/api/contracts/:id',auth,current,admin,wrap(async(req,res)=>{
  const contract=await db.contract.findUnique({where:{id:req.params.id},include:{installments:true}});
  if(!contract)return res.status(404).json({error:'Contrato não encontrado'});
  if(contract.installments.some(item=>item.status!=='OPEN'))return res.status(409).json({error:'Contrato com movimentações: edição financeira bloqueada para preservar pagamentos'});
  const data=fields(req.body||{});
  const receiptCount=await db.receipt.count({where:{installment:{contractId:contract.id}}}),paymentCount=await db.pixPayment.count({where:{installment:{contractId:contract.id}}});
  if(receiptCount||paymentCount)return res.status(409).json({error:'Contrato possui comprovantes ou cobranças Pix: edição bloqueada'});
  await db.$transaction(async tx=>{await tx.installment.deleteMany({where:{contractId:contract.id}});await tx.contract.update({where:{id:contract.id},data})});res.json({ok:true});
 }));
}
