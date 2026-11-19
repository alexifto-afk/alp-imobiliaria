const fail=(status,message)=>Object.assign(new Error(message),{status});
export const PAID_CONTRACT_MESSAGE='Após o primeiro pagamento, não é permitido editar ou excluir este contrato.';

// As confirmações Pix e as análises de comprovantes também bloqueiam a parcela.
// Conferir e modificar dentro da mesma transação evita usar uma situação antiga.
export function withUnmovedContract(db,id,action){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Contract" WHERE "id" = ${id} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Installment" WHERE "contractId" = ${id} ORDER BY "id" FOR UPDATE`;
  const contract=await tx.contract.findUnique({where:{id},include:{installments:true}});
  if(!contract)throw fail(404,'Contrato não encontrado.');
  if(contract.installments.some(item=>item.status==='PAID'))throw fail(409,PAID_CONTRACT_MESSAGE);
  if(contract.installments.some(item=>item.status!=='OPEN'))throw fail(409,'Contrato com movimentações: edição e exclusão bloqueadas para preservar o histórico financeiro.');
  const receipts=await tx.receipt.count({where:{installment:{contractId:id}}}),payments=await tx.pixPayment.count({where:{installment:{contractId:id}}});
  if(receipts||payments)throw fail(409,'Contrato possui comprovantes ou cobranças Pix: edição e exclusão bloqueadas.');
  return action(tx,contract);
 });
}
