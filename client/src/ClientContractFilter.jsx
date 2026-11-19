import React from 'react';
export default function ClientContractFilter({contracts,value,onChange}){
 if(contracts.length<2)return null;
 const selected=contracts.find(contract=>contract.id===value);
 return <section className="client-contract-filter" aria-label="Filtro de contrato"><label htmlFor="client-contract-selection">Selecionar contrato</label><select id="client-contract-selection" value={value} onChange={event=>onChange(event.target.value)}><option value="">Todos os contratos</option>{contracts.map((contract,index)=><option key={contract.id} value={contract.id}>Contrato {index+1} · {contract.property.reference||'Imóvel'} · {contract.property.address||'Endereço não informado'}</option>)}</select>{selected&&<p><strong>{selected.property.reference||'Imóvel'}</strong><span>{selected.property.address||'Endereço não informado'}</span><small>Contrato: {selected.id}</small></p>}</section>;
}
