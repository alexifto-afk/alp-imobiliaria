# Gestão de Imóveis — projeto completo

Aplicação React/Vite + API Express/Prisma + PostgreSQL (Neon). Inclui autenticação por CPF, painel administrativo, clientes com RG/nascimento/estado civil/cônjuge, imóveis com localização e situação, contratos com juros simples/Price/sem juros, tabela pesquisável de contratos, parcelas, área do cliente e comprovantes com aprovação/rejeição.

## Desenvolvimento local

Requisitos: Node.js 20+ e PostgreSQL (pode ser Neon).

1. Copie `server/.env.example` para `server/.env` e configure `DATABASE_URL`, `JWT_SECRET`, `ADMIN_CPF`, `ADMIN_PASSWORD` e `CLIENT_ORIGIN`.
2. Copie `client/.env.example` para `client/.env`.
3. Execute `cd server && npm install && npx prisma generate && npx prisma db push && npm run seed && npm run dev`.
4. Em outro terminal, execute `cd client && npm install && npm run dev`.
5. Acesse `http://localhost:5173` e entre com o CPF e a senha configurados no seed.

**Atenção:** `prisma db push` altera a estrutura do banco. Use banco novo/vazio para a primeira implantação. Não aponte esta versão diretamente para um banco de produção existente sem revisar o esquema e fazer backup.

## Implantação

### Neon
Crie um projeto ou branch PostgreSQL **novo**, copie a URL de conexão para `DATABASE_URL`.

### Render (Web Service)
- Repositório: o GitHub com este projeto.
- Root Directory: `server`
- Build Command: `npm install && npx prisma generate`
- Start Command: `npm start`
- Variáveis: `DATABASE_URL`, `JWT_SECRET` (aleatória, longa), `CLIENT_ORIGIN` (URL da Vercel), `NODE_ENV=production`.
- **Antes do primeiro deploy**, aplique o esquema em um ambiente com acesso ao banco: `cd server && npx prisma db push`. Depois execute `npm run seed` com `ADMIN_CPF`, `ADMIN_PASSWORD` e `ADMIN_NAME` configurados. Não inclua o seed em todo deploy.

### Vercel
- Root Directory: `client`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Variável: `VITE_API_URL=https://SEU-SERVICO.onrender.com/api`.

## Notas importantes

- Valores monetários são armazenados em centavos; a taxa de juros é percentual **mensal**. O cálculo Price é uma aproximação financeira de parcelas fixas com distribuição de centavos; revise regras contratuais e de arredondamento antes de uso jurídico/financeiro.
- O CPF do cliente é usado como identificador de login. A senha inicial deve ser comunicada de forma segura. A recuperação por e-mail usa a API do Gmail, compatível com Render gratuito e sem domínio próprio; exige autorizar a conta remetente pelo Google. Veja [RECUPERACAO-SENHA.md](RECUPERACAO-SENHA.md).
- No cadastro e na edição, CPF do cliente e CPF do cônjuge (quando preenchido) são validados pelos dígitos verificadores. Sequências repetidas e CPF de cliente duplicado são bloqueados na tela e na API. Essa checagem não consulta a Receita Federal nem comprova que o CPF pertence ao nome informado. Cadastros antigos não são alterados automaticamente; um CPF inválido precisa ser corrigido ao editar, sem impedir o login existente.
- Os comprovantes ficam em `private-uploads` no disco local do servidor. **Em Render sem disco persistente, uploads podem desaparecer em redeploy.** Para uso real, substitua por armazenamento persistente (S3, R2 etc.) antes de receber documentos importantes.
- Arquivos PDF/JPEG/PNG/WEBP de até 8 MB. A validação é baseada no MIME informado no upload; para produção sensível, implemente verificação de conteúdo e varredura de arquivos.
- Não inclui emissão de boletos, assinatura digital, integração bancária nem notificações automáticas.
- Teste login, cadastros, contratos e comprovantes num ambiente de homologação antes de substituir o sistema atual.


## Pix Nubank — modo inicial (sem conciliação automática)

A área do cliente tem botão **Pagar com Pix**, QR Code e Copia e Cola com valor da parcela. Configure `NUBANK_PIX_KEY`, `PIX_RECEIVER_NAME` e `PIX_RECEIVER_CITY` no Render. A chave deve ser da conta Nubank que receberá o valor. **Não coloque senha ou token do Nubank no código.**

**Limitação importante:** QR estático não comprova pagamento e o Nubank não disponibiliza publicamente uma integração geral de webhook Pix para esse uso. O cliente deve enviar o comprovante no formulário existente e o administrador aprova após conferir o crédito no extrato. O sistema não marca como pago apenas porque o QR foi gerado ou o cliente enviou um arquivo.

Para confirmação automática segura, contratar/habilitar um PSP com API de cobranças Pix e webhook, validar assinatura, valor, txid, idempotência e liquidação; verificar se ele permite repasse para a conta Nubank. Não utilizar leitura de e-mails bancários como confirmação financeira.


## Novidades V2: painel, cobranças, relatórios e WhatsApp

- Painel moderno responsivo e área do cliente com Pix estático Nubank CPF, comprovante e aprovação administrativa.
- **Cobranças:** lista de parcelas, valores, vencimentos, atrasos, status e botão de lembrete WhatsApp. O botão `Enviar lembrete` abre `wa.me` com texto pronto para o administrador conferir e enviar. **Não envia mensagens automaticamente.** O cliente precisa ter telefone cadastrado com DDD.
- **Relatórios:** totais contratados, recebidos, pendentes, resumo por imóvel, barras financeiras e exportação CSV para Excel.
- **WhatsApp automático (não implementado):** exige WhatsApp Business Platform/Cloud API, credenciais, consentimento do destinatário, templates aprovados e configuração de agendamento. Não use automação não oficial de WhatsApp pessoal.
- **Pix automático (não implementado):** chave CPF Nubank gera Pix estático, sem confirmação bancária. Confirme o crédito no aplicativo Nubank antes de aprovar o comprovante.
- **Arquivos em produção:** o upload atual usa disco local. Render pode apagar arquivos em redeploy; configure armazenamento persistente antes de uso real.
- **Privacidade:** nunca inclua CPF, chave Pix, token, JWT_SECRET ou DATABASE_URL no GitHub. Configure `NUBANK_PIX_KEY` (CPF sem pontuação), `PIX_RECEIVER_NAME` e `PIX_RECEIVER_CITY` no ambiente do backend.

### Publicação
Crie um repositório GitHub novo, envie o conteúdo desta pasta mantendo `client/` e `server/` na raiz. Configure Vercel com root `client`, Render com root `server`, PostgreSQL Neon, `DATABASE_URL`, `JWT_SECRET` e `CLIENT_ORIGIN`. Execute `npx prisma db push` no banco **novo** e crie o usuário admin com as instruções do seed. Teste login, parcelas e aprovação antes de produção.
