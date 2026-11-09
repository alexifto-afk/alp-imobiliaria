const invalidPayment = () => Object.assign(new Error('Pagamento Pix não corresponde à cobrança cadastrada'), {status: 502});

// Usar exclusivamente com a resposta autenticada da API do Mercado Pago.
export async function confirmarPagamentoPix(tx, pagamento, cobranca) {
  const parcela = await tx.installment.findUnique({where: {id: cobranca.installmentId}});
  const amount = Number(pagamento.transaction_amount);
  if (!parcela || String(pagamento.id) !== cobranca.providerId ||
      pagamento.payment_method_id !== 'pix' || pagamento.currency_id !== 'BRL' ||
      pagamento.external_reference !== cobranca.installmentId ||
      !Number.isFinite(amount) || Math.round(amount * 100) !== cobranca.amount ||
      parcela.amount !== cobranca.amount) throw invalidPayment();

  // Uma consulta pendente iniciada antes da aprovação não pode desfazer a confirmação.
  if (pagamento.status === 'approved') {
    await tx.pixPayment.update({where: {id: cobranca.id}, data: {
      status: 'approved', paidAt: new Date(pagamento.date_approved || Date.now())
    }});
    await tx.installment.update({where: {id: cobranca.installmentId}, data: {status: 'PAID'}});
  } else {
    await tx.pixPayment.updateMany({where: {id: cobranca.id, status: {not: 'approved'}},
      data: {status: pagamento.status || 'unknown'}});
  }
}

export async function reconciliarCobranca(db, mpCall, cobranca) {
  const pagamento = await mpCall('/v1/payments/' + encodeURIComponent(cobranca.providerId));
  await db.$transaction(tx => confirmarPagamentoPix(tx, pagamento, cobranca));
  return pagamento;
}

export async function reconciliarParcela(db, mpCall, installmentId) {
  // Inclui cobranças antigas: uma tentativa mais recente não esconde um Pix já pago.
  const cobrancas = await db.pixPayment.findMany({where: {installmentId, providerId: {not: null}}, orderBy: {createdAt: 'desc'}});
  for (const cobranca of cobrancas) {
    await reconciliarCobranca(db, mpCall, cobranca);
    const parcela = await db.installment.findUnique({where: {id: installmentId}});
    if (parcela.status === 'PAID') return parcela;
  }
  return db.installment.findUnique({where: {id: installmentId}});
}

export async function reconciliarPendentes(db, mpCall, onError = () => {}) {
  // updatedAt distribui as consultas entre lotes, inclusive após uma falha do provedor.
  const cobrancas = await db.pixPayment.findMany({where: {
    providerId: {not: null}, installment: {status: {not: 'PAID'}},
    status: {notIn: ['rejected', 'cancelled', 'refunded', 'charged_back']}
  }, orderBy: {updatedAt: 'asc'}, take: 25});
  for (const cobranca of cobrancas) {
    try { await reconciliarCobranca(db, mpCall, cobranca); }
    catch { onError(cobranca.id); }
    finally { await db.pixPayment.update({where: {id: cobranca.id}, data: {updatedAt: new Date()}}); }
  }
}
