# Comprovantes de parcelas e baixa manual

Por padrão, o pagamento continua sendo por Pix e a opção manual fica **desabilitada**. O administrador libera somente a parcela desejada: na Visão geral, abrir a parcela no calendário e marcar **Permitir envio de comprovante nesta parcela**, ou usar **Liberar comprovante** na linha correspondente da Central de cobranças. A liberação de uma parcela não libera as demais nem substitui o Pix. Desabilitar impede novos envios, mas mantém os documentos e a análise de comprovantes já enviados. A API também verifica a liberação; o cliente não pode habilitá-la.

Depois da liberação, o cliente abre a parcela por **Já paguei / Enviar comprovante**, escolhe um PDF, JPEG, PNG ou WebP de até 8 MB e envia para análise. A opção aparece na fatura da tela inicial e na lista de parcelas. Também é possível enviar dentro dos detalhes da parcela.

O envio não confirma pagamento: altera a situação para **Em análise**. A opção fica visível somente para a parcela liberada. O cliente acompanha o histórico, abre o arquivo enviado e vê o motivo de uma rejeição. Enquanto houver análise pendente, não pode enviar outro comprovante da mesma parcela. Após rejeição, pode reenviar se a opção manual continuar liberada para aquela parcela. Enquanto a tela estiver aberta e houver parcela em análise, a área do cliente consulta a situação a cada 15 segundos e ao voltar à aba.

No painel do administrador, em **Comprovantes**, abrir o arquivo e conferir se o dinheiro foi recebido na conta. Somente então clicar em **Confirmar pagamento e dar baixa** e confirmar a parcela, cliente e valor apresentados. Isso registra comprovante aprovado, parcela paga, data da análise e identificador do administrador. O envio pelo cliente nunca aprova o próprio pagamento. A rejeição exige um motivo; cancelar a pergunta não rejeita o arquivo.

## Antes de publicar a API

1. No SQL Editor do Neon, selecionar a mesma branch e banco usados por `DATABASE_URL` e executar [server/prisma/sql/receipt-proof.sql](server/prisma/sql/receipt-proof.sql). O SQL adiciona duas colunas opcionais à tabela Receipt e a opção manualReceiptEnabled, com padrão false, à tabela Installment, sem apagar dados.
2. Concluir o merge e publicar o backend com `npm ci` e `npx prisma generate`, conforme o processo atual da API. Publicar o frontend com `npm ci && npm run build`.
3. Testar com um cliente de teste: liberar uma parcela em aberto, confirmar que as demais continuam sem a opção, enviar o arquivo, conferir o arquivo como administrador, aprovar e atualizar a área do cliente. Não aprovar uma parcela real sem confirmar o recebimento.

Não há novas variáveis de ambiente ou serviços externos. Os novos arquivos ficam em `Receipt.fileData` no PostgreSQL/Neon, protegidos pelas mesmas permissões da parcela. Não ficam dependentes do disco temporário do Render gratuito. Os arquivos consomem armazenamento do banco; acompanhar o uso do plano. O conteúdo binário é omitido das consultas comuns do Prisma e só é retornado na rota privada de arquivo.

Comprovantes antigos continuam usando o arquivo legado no diretório `UPLOAD_DIR` quando fileData estiver vazio. Arquivos antigos que já foram perdidos pelo Render não podem ser recuperados por esta alteração: o administrador pode rejeitar a análise pendente com explicação e solicitar um novo envio. A implantação não migra arquivos do disco da produção automaticamente.

## Consistência e acesso

- Upload e análise usam transação e bloqueio da linha da parcela. Envios duplicados pendentes e análises repetidas retornam conflito.
- Toda alteração manual de situação preserva uma parcela que já estiver PAID. Rejeitar/excluir um comprovante não desfaz a confirmação do Pix. As rotas de Pix existentes continuam operando.
- Baixa manual e comprovante são gravados na mesma transação; falha reverte a operação.
- A baixa registra a data da análise, não extrai automaticamente a data ou o valor do documento.
- Aprovação/rejeição/exclusão exigem administrador ativo e sessão válida. Clientes só enviam/consultam arquivos vinculados às próprias parcelas.
- Comprovante aprovado não pode ser excluído. Download usa autenticação, Cache-Control privado e no-store, e nosniff. Arquivos não têm URL pública.
- Formato é identificado pela assinatura do arquivo, com limite de tamanho no servidor. Essa identificação não comprova autenticidade do pagamento; a conferência humana continua obrigatória.

## Testes

`cd server && npm test` testa upload multipart, autorização, limite/formato, armazenamento, revisão, auditoria, duplicidade e proteção de parcelas pagas, além dos testes anteriores. O banco é simulado nesses testes. `npm run test:receipts:db` executa a verificação com PostgreSQL real em um banco **de testes separado**, informado em TEST_DATABASE_URL, com nome contendo test e diferente de DATABASE_URL. O esquema precisa estar preparado nesse banco. Não usar o Neon de produção para esse comando.

`cd client && npm test && npm run build` verifica o frontend. Nenhum teste envia e-mails, mensagens ou notificações reais.
