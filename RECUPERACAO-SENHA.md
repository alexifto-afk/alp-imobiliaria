# Recuperação de senha pelo Gmail no Render gratuito

## Fluxo do cliente

Na tela de login, o cliente seleciona **Esqueci minha senha**, informa o CPF e recebe um código de seis dígitos no e-mail já cadastrado. O código expira em dez minutos, aceita no máximo cinco erros e só pode ser usado uma vez para redefinir a senha. É possível reenviar após 60 segundos; um novo código invalida o anterior.

A tela não permite escolher outro destinatário. CPF inexistente, conta inativa e cadastro sem e-mail recebem a mesma resposta genérica. Quem perdeu acesso ao e-mail deve procurar a administração para conferir o cadastro. Administradores criados apenas pelo seed não possuem contato de cliente e não usam este fluxo.

## Por que usar a API do Gmail

O [Render gratuito bloqueia conexões SMTP nas portas 25, 465 e 587](https://render.com/docs/free). Por isso esta integração usa a API do Gmail por HTTPS, sem domínio próprio e sem senha de app. O envio sai de uma conta Gmail autorizada pela administração. Os clientes não precisam autorizar o Google nem conectar suas caixas de e-mail.

A autorização usa somente o escopo `https://www.googleapis.com/auth/gmail.send`, para envio de mensagens. Não é necessário conceder leitura da caixa de entrada. A implementação não usa o plugin Gmail do ChatGPT.

## 1. Preparar o projeto no Google

1. Entre no [Google Cloud Console](https://console.cloud.google.com/) com a conta que vai administrar o envio e crie ou selecione um projeto.
2. Em **APIs e serviços → Biblioteca**, habilite **Gmail API**.
3. Em **Google Auth Platform**, configure a identificação do aplicativo e os contatos de suporte.
4. Em **Audience/Público**, configure o público externo para uma conta Gmail pessoal. Para um primeiro teste, adicione o próprio endereço remetente como usuário de teste.
5. Em **Data Access/Acesso a dados**, adicione somente o escopo `https://www.googleapis.com/auth/gmail.send`.
6. Em **Clients/Clientes**, crie um cliente OAuth do tipo **Aplicativo da Web**. Em **URIs de redirecionamento autorizados**, inclua exatamente:
   `https://developers.google.com/oauthplayground`.
7. Guarde o **Client ID** e o **Client secret** nas configurações do backend. Não envie esses valores em chat nem os salve no GitHub.

Os nomes de menus podem variar conforme a versão do console.

## 2. Autorizar a conta remetente

1. Abra o [OAuth 2.0 Playground oficial do Google](https://developers.google.com/oauthplayground/).
2. Na engrenagem de configurações, marque **Use your own OAuth credentials** e informe o Client ID e o Client secret do seu projeto. Use acesso **Offline**.
3. No campo de escopos, informe `https://www.googleapis.com/auth/gmail.send` e selecione **Authorize APIs**.
4. Entre na conta Gmail que enviará os códigos e autorize o envio. Confira o projeto e a conta antes de conceder acesso.
5. Selecione **Exchange authorization code for tokens** e guarde o **Refresh token** no Render. Não use o access token temporário no lugar dele.
6. Se o Google impedir a autorização, siga os requisitos apresentados na plataforma. Não conceda permissões adicionais nem forneça sua senha a serviços de terceiros.

**Validade da autorização:** aplicativos externos com status **Testing/Em teste** podem ter refresh tokens que expiram em sete dias. Isso serve para homologação, mas não para deixar o sistema funcionando continuamente. Para uso permanente, ajuste o status de publicação no Google e cumpra as exigências de consentimento/verificação aplicáveis ao projeto e ao escopo. Gere o refresh token após finalizar essa configuração. Contas de organização podem exigir liberação do administrador.

Referências: [OAuth do Google](https://developers.google.com/identity/protocols/oauth2/web-server), [expiração de refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration) e [escopos do Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).

## 3. Configurar o Render

No serviço da API, em **Environment**, preencha:

```text
GMAIL_USER=seuemail@gmail.com
GMAIL_CLIENT_ID=<Client ID do seu projeto>
GMAIL_CLIENT_SECRET=<Client secret do seu projeto>
GMAIL_REFRESH_TOKEN=<Refresh token da conta autorizada>
```

- `GMAIL_USER` deve ser a mesma conta autorizada no passo anterior.
- Não use senha comum do Gmail, senha de app, credenciais do Mercado Pago ou `JWT_SECRET` nesses campos.
- Não é necessário configurar `RESEND_API_KEY` ou `RESET_EMAIL_FROM` para esta implementação.
- Salve as variáveis e publique backend e frontend. Mantenha as configurações existentes de Pix, banco e autenticação.
- Não coloque essas variáveis no frontend da Vercel.
- Sem configuração completa, a aplicação informa que a recuperação está indisponível.

## 4. Testar o recebimento real

1. No painel administrativo, confira o e-mail de uma conta de cliente de teste cuja caixa você controla.
2. Solicite a recuperação pela tela de login, confira o recebimento e o spam, redefina a senha e entre novamente.
3. Confira que a senha antiga deixou de funcionar e que o código não pode ser reutilizado.
4. A API do Gmail aceitar a mensagem não garante entrega na caixa de entrada. Confira também devoluções, spam e limites da conta Gmail.
5. Falhas de entrega deixam a resposta ao cliente genérica para não revelar contas cadastradas. Nos logs do Render, procure **Falha no envio de recuperação pelo Gmail** e o código de diagnóstico:
   - `GMAIL_AUTH_FAILED`: autorização recusada, refresh token expirado/revogado ou credenciais incorretas.
   - `GMAIL_AUTH_UNAVAILABLE`: falha de conexão com o serviço de autorização.
   - `GMAIL_SEND_FAILED`: envio recusado; confira se Gmail API e escopo de envio estão habilitados.
   - `GMAIL_QUOTA`: limite do Gmail atingido.
   - `GMAIL_SEND_UNAVAILABLE`: conexão com Gmail falhou; tente nova recuperação após o intervalo permitido.
6. Mudanças na conta Google ou revogação da autorização podem exigir gerar outro refresh token e atualizar o Render.

O backend renova o access token automaticamente e o mantém apenas em memória. Credenciais, tokens, destinatários e códigos de recuperação não são escritos nos logs de diagnóstico. Respeite os limites de envio do Gmail; para maior volume, avalie um serviço transacional dedicado.

## Sessões, banco e testes

O JWT contém uma versão derivada do hash da senha. Redefinir ou alterar a senha invalida os tokens anteriores. Na troca autenticada, o navegador recebe um token novo. Na primeira publicação dessa versão, usuários já conectados precisarão entrar novamente.

Não há mudança de esquema: o modelo `PasswordReset` já deve existir no banco. Não execute seed de administrador nem redefinição destrutiva para configurar o Gmail. O limite por IP é de 12 requisições por 15 minutos em cada processo; o intervalo por conta e o consumo dos códigos usam transação e bloqueio no PostgreSQL. Em produção, considera-se um proxy de entrada, conforme a configuração esperada no Render.

`cd server && npm test` executa os testes existentes de Pix, recuperação, rotas HTTP e envio pelo Gmail com rede e banco simulados. Não envia mensagens reais. `cd client && npm run build` compila o frontend. A entrega real depende da configuração e autorização da conta Gmail.
