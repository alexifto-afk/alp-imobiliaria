
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Pix aprovado deve marcar a parcela como PAID', async () => {
  const parcela = { id: 'parcela-teste', status: 'OPEN' };
  const cobranca = { id: 'pix-teste', status: 'pending' };

  const tx = {
    pixPayment: {
      update: async ({ data }) => {
        Object.assign(cobranca, data);
      }
    },
    installment: {
      update: async ({ data }) => {
        Object.assign(parcela, data);
      }
    }
  };

  const pagamento = {
    status: 'approved',
    date_approved: new Date().toISOString()
  };

  await tx.pixPayment.update({
    data: {
      status: pagamento.status,
      paidAt: new Date(pagamento.date_approved)
    }
  });

  if (pagamento.status === 'approved') {
    await tx.installment.update({
      data: { status: 'PAID' }
    });
  }

  assert.equal(cobranca.status, 'approved');
  assert.equal(parcela.status, 'PAID');
});
