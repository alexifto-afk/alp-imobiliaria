
export async function confirmarPagamentoPix(tx, pagamento, cobranca) {
  await tx.pixPayment.update({
    where: { id: cobranca.id },
    data: {
      status: pagamento.status || 'unknown',
      paidAt: pagamento.status === 'approved'
        ? new Date(pagamento.date_approved || Date.now())
        : null
    }
  });

  if (pagamento.status === 'approved') {
    await tx.installment.update({
      where: { id: cobranca.installmentId },
      data: { status: 'PAID' }
    });
  }
}
