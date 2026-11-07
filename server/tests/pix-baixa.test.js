
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

test('Pix aprovado atualiza a parcela no banco de testes', async () => {
  const url = process.env.TEST_DATABASE_URL;
  const producao = process.env.DATABASE_URL;

  if (!url || url === producao) {
    throw new Error('Configure um banco de testes separado em TEST_DATABASE_URL');
  }

  const db = new PrismaClient({
    datasources: { db: { url } }
  });

  try {
    await db.$transaction(async (tx) => {
      const usuario = await tx.user.create({
        data: {
          cpf: '00000000000',
          passwordHash: 'TESTE_NAO_UTILIZAR',
          name: 'Cliente Teste Pix'
        }
      });

      const cliente = await tx.client.create({
        data: { userId: usuario.id }
      });

      const imovel = await tx.property.create({
        data: {
          reference: 'TESTE-PIX',
          address: 'Imovel ficticio'
        }
      });

      const contrato = await tx.contract.create({
        data: {
          clientId: cliente.id,
          propertyId: imovel.id,
          downPayment: 0,
          installmentCount: 1,
          startDate: new Date()
        }
      });

      const parcela = await tx.installment.create({
        data: {
          contractId: contrato.id,
          number: 1,
          dueDate: new Date(),
          amount: 1000,
          status: 'OPEN'
        }
      });

      const pix = await tx.pixPayment.create({
        data: {
          installmentId: parcela.id,
          amount: 1000,
          idempotencyKey: crypto.randomUUID(),
          providerId: crypto.randomUUID(),
          status: 'pending'
        }
      });

      // Simula somente a resposta aprovada do provedor.
      await tx.pixPayment.update({
        where: { id: pix.id },
        data: { status: 'approved', paidAt: new Date() }
      });

      await tx.installment.update({
        where: { id: parcela.id },
        data: { status: 'PAID' }
      });

      const resultado = await tx.installment.findUnique({
        where: { id: parcela.id }
      });

      assert.equal(resultado.status, 'PAID');

      // Desfaz todas as insercoes do teste.
      throw new Error('ROLLBACK_TESTE_OK');
    });
  } catch (erro) {
    if (erro.message !== 'ROLLBACK_TESTE_OK') throw erro;
  } finally {
    await db.$disconnect();
  }
});


