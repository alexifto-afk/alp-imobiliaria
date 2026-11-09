# Pix: confirmação e recuperação de notificações

## Correção

O endpoint de status antes consultava somente o banco local. Se o webhook falhasse, a parcela continuava aberta mesmo com pagamento aprovado no Mercado Pago. A assinatura também comparava o timestamp diretamente com `Date.now()`, rejeitando timestamps em segundos.

- Webhook, consulta do cliente e rotina periódica usam a mesma função de confirmação.
- O botão **Verificar pagamento** consulta a API autenticada do Mercado Pago e grava a baixa antes de responder.
- O servidor consulta até 25 cobranças pendentes por ciclo, a cada 60 segundos e na inicialização. A fila prioriza as menos recentemente consultadas; um lote com falhas não bloqueia os demais. O prazo total depende do volume, da disponibilidade do servidor e da API.
- A baixa exige status `approved`, método Pix, moeda BRL, ID do pagamento, referência da parcela e valores correspondentes no provedor, na cobrança e na parcela.
- Notificações repetidas são seguras; uma resposta pendente atrasada não desfaz uma aprovação.
- A assinatura aceita timestamps em segundos ou milissegundos e exige HMAC válido; não foi removida a autenticação do webhook.
- Uma notificação que chega antes do vínculo local do pagamento recebe 503 para permitir reenvio.
- A reserva da cobrança usa bloqueio transacional no PostgreSQL para cliques simultâneos reutilizarem a mesma chave de idempotência.
- Ao abrir uma cobrança já aprovada, o frontend atualiza os dados sem oferecer um novo QR Code.

## Conferir no ambiente de produção

1. Publique o backend e o frontend desta correção. Não é necessária alteração do esquema do banco.
2. No backend, confira `MERCADOPAGO_ACCESS_TOKEN` da conta e do ambiente corretos, `MP_WEBHOOK_SECRET` e `MP_WEBHOOK_URL=https://SEU-BACKEND/api/webhooks/mercadopago`.
3. No painel do Mercado Pago, confira a URL HTTPS pública e a assinatura secreta da mesma aplicação, com notificações de pagamentos habilitadas. Para cobranças reais, o backend precisa estar acessível; hospedagem suspensa pode atrasar webhook e conciliação.
4. Nas entregas de webhook, confira o HTTP retornado: 401 indica assinatura inválida/expirada; 503 pode indicar cobrança ainda não vinculada; 502 indica falha de consulta ou divergência do pagamento. Erros de banco podem retornar 400 pelo tratamento geral existente.
5. Para pagamentos anteriores já registrados em `PixPayment.providerId`, a rotina recupera aprovações pendentes. O cliente também pode abrir o Pix e usar **Verificar pagamento** para consultar imediatamente.
6. Se o pagamento não possuir vínculo local, a recuperação automática não consegue associá-lo com segurança. Investigue o ID do pagamento e a referência no Mercado Pago antes de qualquer alteração financeira. Não marque parcelas pagas apenas por comprovante ou mensagem do navegador.

`MP_PAYMENTS_ENABLED` continua controlando a criação de cobranças; desligá-lo não interrompe a consulta de cobranças existentes. Não é necessário fornecer credenciais ao frontend. Nunca coloque tokens ou segredos em commits, logs ou mensagens.

## Validação

`cd server && npm test` executa testes sem serviços externos: assinaturas, aprovação, pendência, duplicação, divergências, perda de webhook e falha da API.

`npm run test:db` exige `TEST_DATABASE_URL` de um PostgreSQL separado, com o esquema aplicado. O teste usa a função real de confirmação e desfaz as inserções por rollback; recusa usar o mesmo valor de `DATABASE_URL`.

`cd client && npm run build` valida a compilação do frontend.

Os testes simulados não substituem a homologação com uma cobrança Pix no ambiente correto do Mercado Pago. Esta alteração não executa pagamentos nem modifica dados de produção durante o desenvolvimento.
