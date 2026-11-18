# Lembretes de vencimento no celular

O cliente pode ativar lembretes na tela Início ou em Meu perfil, em cada aparelho. O sistema solicita permissão somente após tocar em **Ativar lembretes neste aparelho**. Também mostra, dentro do app, as parcelas que vencem hoje.

O primeiro envio é agendado para **12h, America/Sao_Paulo (Brasília)**, somente na data do vencimento e para parcelas OPEN ou REJECTED. Parcelas PAID e comprovantes PENDING_REVIEW não recebem aviso. Várias parcelas do mesmo dia geram um aviso por aparelho. Não envia cobranças diárias de parcelas atrasadas.

## Compatibilidade

- Android: navegador atualizado com Web Push, HTTPS e permissão de notificações.
- iPhone/iPad: iOS/iPadOS 16.4 ou superior. No Safari, usar Compartilhar → Adicionar à Tela de Início e abrir pelo ícone instalado antes de ativar os lembretes.
- A entrega depende do navegador, conexão e configurações do aparelho. Não há garantia de chegada exatamente às 12h. O Render gratuito pode levar tempo para iniciar.
- Ao sair da conta pelo botão Sair, o app tenta remover a assinatura local e desativar o registro no servidor. É possível desativar manualmente no mesmo painel.

## Ativação na produção

1. No SQL Editor do Neon, selecionar **a mesma branch e banco usados por DATABASE_URL do Render** e executar [server/prisma/sql/notifications.sql](server/prisma/sql/notifications.sql). O arquivo cria apenas as duas tabelas e índices novos. Não usar `prisma migrate reset` nem substituir o banco.
2. Na pasta `server`, executar `npm ci` e `npm run push:keys` em um terminal privado. Copiar os valores diretamente para as variáveis de ambiente do Render. **Não enviar as chaves por chat nem salvar no GitHub**.
3. Configurar no Render:
   - `VAPID_PUBLIC_KEY`: chave pública gerada.
   - `VAPID_PRIVATE_KEY`: chave privada gerada.
   - `VAPID_SUBJECT`: `mailto:seu-email@gmail.com`, substituindo pelo contato real da empresa.
   - `NOTIFICATION_JOB_TOKEN`: segredo gerado, com pelo menos 32 caracteres.
4. Publicar o backend com a instalação atualizada e `npx prisma generate`, e o frontend com `npm ci && npm run build`. As chaves pertencem apenas ao backend; o app obtém a pública por uma rota autenticada. **Preservar as mesmas chaves nos próximos deploys**, pois trocá-las exige reativar aparelhos.
5. Configurar um agendador externo e então ativar os lembretes no aparelho de teste. Não depender de um temporizador dentro do Render gratuito, que pode ficar suspenso.

## Agendador gratuito externo

É possível usar cron-job.org. Criar um job com:

- URL: `https://SEU-BACKEND.onrender.com/api/internal/notifications/due`, substituindo pelo endereço real da API.
- Método: **POST**.
- Cabeçalho: `Authorization: Bearer SEU_NOTIFICATION_JOB_TOKEN` (mesmo valor privado do Render).
- Fuso: **America/Sao_Paulo**.
- Agenda personalizada: todos os dias, minutos **0, 15, 30 e 45**, horas **12 até 23**.

O primeiro acionamento ocorre às 12h. Os demais processam lotes restantes e novas tentativas após falhas temporárias. Cada chamada atende até 100 aparelhos. Não colocar o segredo na URL. Conferir o histórico do agendador após a publicação; 401 indica segredo incorreto e 503 indica configuração ou serviço indisponível. O início lento do Render pode exceder o tempo de espera do agendador; observar os acionamentos seguintes e os logs do backend.

A rota recusa chamadas sem segredo e não processa envios antes das 12h. O servidor registra entregas por aparelho/data, usa bloqueio temporário contra execuções concorrentes, tenta novamente após 15 minutos (até cinco tentativas) e desativa endpoints expirados (404/410). Há uma nova conferência das parcelas antes do envio. Uma confirmação perdida na rede após a entrega pode ocasionar reenvio; a tag do navegador ajuda a agrupar o aviso.

## Dados e segurança

As assinaturas são vinculadas à conta autenticada, com até dez aparelhos ativos por usuário. Endpoints são aceitos apenas dos serviços Google FCM, Apple Web Push e Mozilla. As chaves VAPID privadas e o segredo do job nunca são enviados ao frontend. O envio Web Push usa criptografia da biblioteca `web-push`.

O aviso na tela bloqueada é genérico, sem CPF, nome do cliente ou valor. Ao tocar, abre a área de parcelas e exige a sessão normal do app. O service worker não armazena páginas, tokens de login ou dados financeiros e ignora URLs recebidas no conteúdo push. Assinaturas e registros de entrega permanecem no banco; devem ser tratados como dados privados.

## Conferência após configurar

Com autorização do cliente de teste, ativar no Android e no iPhone instalado. Confirmar aviso e abertura de parcelas, desativação e ausência de envio para parcelas pagas. Antes das 12h a rota retorna `beforeWindow: true`. Após as 12h, com vencimento no dia, retorna contagens `sent`, `failed` e `skipped`; repetir a chamada não deve reenviar uma entrega já confirmada.

Os testes automatizados usam provedores e banco simulados, sem enviar notificações reais. A publicação, execução do SQL no Neon, variáveis do Render, criação do agendador e teste físico precisam ser feitos no ambiente da empresa.
