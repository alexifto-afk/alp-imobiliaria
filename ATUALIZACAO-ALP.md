# ALP Imobiliária — Atualização consolidada

## Entregas incluídas
- Painel administrativo: calendário mensal de vencimentos com parcelas pagas, a vencer e atrasadas.
- Clientes: exclusão somente se não houver contratos, mantendo o histórico financeiro.
- Imóveis: modal de detalhes e exclusão somente se não houver contratos.
- Contratos: parcelas em modal, edição financeira antes de qualquer movimentação e exclusão de contratos sem movimentação.
- Cobranças: mensagem WhatsApp com **ALP Imobiliária** e link da área do cliente (envio manual via WhatsApp).
- Relatórios: CSV geral e CSV individual por cliente.
- Comprovantes: exclusão dos não aprovados, mantendo os aprovados para auditoria.
- Cliente: modal Pix com botão de fechar; não exibe upload para parcela paga ou em análise; numeração `n/total`.
- Perfil: nome, nascimento, e-mail e senha; CPF permanece como login.
- Primeiro acesso: clientes novos são obrigados a trocar senha provisória antes de navegar.
- Pix Mercado Pago: geração de cobrança Pix pela API, QR dinâmico, webhook com validação HMAC e confirmação por consulta à API; atualização de parcela e consulta periódica de status no modal.

## Atenção: pagamentos reais desativados por padrão
A variável `MP_PAYMENTS_ENABLED` deve permanecer `false` até validar integração e webhooks em ambiente isolado. O endpoint do Pix é `POST /api/my/installments/:id/pix`; webhook `POST /api/webhooks/mercadopago`.

## Variáveis no Render (server)

- `DATABASE_URL`: conexão do Neon (mantenha em segredo).
- `JWT_SECRET`: chave forte de autenticação.
- `CLIENT_ORIGIN`: `https://gestao-imoveis-v2.vercel.app` (ajuste ao seu domínio).
- `MERCADOPAGO_ACCESS_TOKEN`: token privado do Mercado Pago; nunca colocar no Vercel/GitHub.
- `MP_WEBHOOK_SECRET`: assinatura secreta gerada pelo Mercado Pago na tela de Webhooks.
- `MP_WEBHOOK_URL`: `https://gestao-imoveis-v2-api.onrender.com/api/webhooks/mercadopago` (ajuste ao domínio real).
- `MP_PAYMENTS_ENABLED`: `false` inicialmente; mudar para `true` somente após homologação.
- `ADMIN_CPF`, `ADMIN_PASSWORD`, `ADMIN_NAME`: usados somente no seed de primeiro administrador.

As variáveis antigas `NUBANK_PIX_KEY`, `PIX_RECEIVER_NAME`, `PIX_RECEIVER_CITY` não são usadas na nova cobrança Mercado Pago. Remova somente depois de verificar se não são utilizadas por outro serviço.

## Publicação sem afetar o projeto antigo
1. Faça backup do banco Neon antes de aplicar a nova estrutura.
2. Atualize o GitHub enviando **o conteúdo das pastas** `client` e `server` (sem `node_modules` nem `.env`).
3. No backend, execute `npm install && npx prisma generate && npx prisma db push` **uma única vez**, após conferir que `DATABASE_URL` aponta para a branch correta do V2. Não autorize redefinição destrutiva.
4. Restaure o Build Command do Render para `npm install && npx prisma generate`.
5. O frontend usa `VITE_API_URL=https://gestao-imoveis-v2-api.onrender.com/api`.
6. Teste autenticação, edição, relatórios, exclusões e o ciclo completo de pagamento **antes** de ativar cobranças reais.

## Segurança e limitações
- A exclusão de registros com histórico financeiro é bloqueada para evitar perda de auditoria.
- O pagamento só é considerado quitado após webhook assinado **e** consulta de confirmação na API do Mercado Pago.
- O valor e a referência da cobrança são conferidos antes da baixa.
- Não há envio automático de WhatsApp. O botão abre a mensagem pronta; para automação é necessária a WhatsApp Business Platform, consentimento e templates aprovados.
- O projeto usa armazenamento local para arquivos de comprovantes; o disco efêmero do Render pode perder arquivos. Configure armazenamento persistente externo antes de produção.
- **Não foi realizado teste de integração com a API real do Mercado Pago**; valide em sandbox/homologação, incluindo assinaturas e idempotência. Credenciais de teste podem ter restrições específicas para Pix.
- Este pacote é uma versão candidata para testes, não homologada para operação financeira real.
