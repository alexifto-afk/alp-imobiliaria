
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmarPagamentoPix } from '../src/pix-confirmation.js';

test('Pix aprovado deve quitar a parcela', async () => {
  const alteracoes = [];

  const tx = {
    pixPayment: {
      update: async (dados) => {
        alteracoes.push({ tipo: 'pix', ...dados });
      }
    },
    installment: {
      update: async (dados) => {
        alteracoes.push({ tipo: 'parcela', ...dados });
      }
    }
  };

  await confirmarPagamentoPix(
    tx,
    {
      status: 'approved',
      date_approved: '2026-11-07T12:00:00Z'
    },
    {
      id: 'pix-teste',
      installmentId: 'parcela-teste'
    }
  );

  assert.equal(alteracoes[0].data.status, 'approved');
  assert.equal(alteracoes[1].data.status, 'PAID');
  assert.equal(alteracoes[1].where.id, 'parcela-teste');
});
