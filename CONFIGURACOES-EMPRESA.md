# Identidade da empresa e suporte técnico

Administradores acessam **Configurações** no menu e podem editar o nome (2–80 caracteres) e enviar uma logomarca PNG, JPEG ou WebP de até 2 MB. O botão Restaurar logomarca padrão remove a imagem personalizada após salvar. O nome é obrigatório. Clientes não podem alterar esses dados.

A configuração é compartilhada entre usuários e persistida no Neon. O servidor decodifica a imagem, rejeita arquivos inválidos/animados ou com mais de 16 milhões de pixels e salva um JPEG estático de 330×220, com fundo branco e proporções preservadas, sem metadados. Não depende do armazenamento temporário de arquivos do Render.

## Ativação após o merge

1. No SQL Editor do Neon, selecionar a mesma branch e banco de `DATABASE_URL` do backend e executar [server/prisma/sql/company-settings.sql](server/prisma/sql/company-settings.sql). O SQL cria somente a nova tabela, sem apagar dados.
2. Publicar o backend com `npm ci` e `npx prisma generate`, conforme o processo de build da API. A nova dependência `sharp` valida e normaliza imagens. Publicar o frontend com `npm ci && npm run build`.
3. Entrar como administrador → Configurações → definir nome e imagem → Salvar configurações.
4. Atualizar a página de outro usuário para conferir a identidade. Antes de criar a tabela, a leitura mantém a identidade original e o salvamento informa que a configuração precisa ser habilitada.

Não há novas chaves ou variáveis de ambiente. Manter as configurações existentes de banco, Gmail, notificações e Pix.

## Onde é aplicada

- Login, primeiro acesso, menu, painéis e área do cliente.
- Relatório de parcelas no navegador e PDF do comprovante emitido pela API.
- Nome nas novas cobranças Pix, no remetente/assunto dos novos e-mails de recuperação e nos novos avisos de vencimento. Mensagens e pagamentos já emitidos mantêm seus dados originais.
- Apresentação pública: a identidade é atualizada pelo navegador ao carregar a configuração. O HTML inicial sem JavaScript continua contendo o nome e a imagem originais, para manter o conteúdo estático público. O nome legal no texto da política, a identificação do Google OAuth e os ícones/nome de instalação do manifesto continuam sendo configurações próprias; editar a identidade visual não altera esses registros nem solicita nova verificação do Google.

O contato técnico é fixo: **Alex Pereira de Sousa — (63) 99973-3884**, link `https://wa.me/5563999733884`. Aparece no rodapé do sistema, login e páginas públicas. O link abre o WhatsApp com uma mensagem genérica para o usuário revisar e enviar; não envia dados cadastrais ou financeiros e não dispara mensagens automaticamente. Ele é separado do contato da empresa para solicitações de privacidade.

## API e validação

`GET /api/company` retorna somente nome, logomarca e disponibilidade da configuração, sem autenticação, pois esses dados aparecem no login. Usa `Cache-Control: no-store`. `PUT /api/company` exige autenticação, conta ativa, senha provisória já alterada e função ADMIN, com limite de corpo de 3 MB. Omitir `logo` preserva a imagem existente; `logo: null` restaura a padrão. Não aceita URL externa ou SVG.

Testes automatizados usam banco e Gmail simulados; não modificam o Neon nem enviam e-mails ou notificações reais. Para conferir o uso real, após a publicação teste salvar, atualizar outro navegador, gerar um relatório/comprovante e abrir o contato de suporte sem enviar a mensagem.
