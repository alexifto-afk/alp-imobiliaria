# Recuperação de senha por e-mail

## Fluxo do cliente

Na tela de login, o cliente seleciona **Esqueci minha senha**, informa o CPF e recebe um código de seis dígitos no e-mail já cadastrado. O código expira em dez minutos, aceita no máximo cinco erros e só pode ser usado uma vez para redefinir a senha. É possível reenviar após 60 segundos; um novo código invalida o anterior.

A tela não permite escolher outro destinatário. CPF inexistente, conta inativa e cadastro sem e-mail recebem a mesma resposta genérica. O cliente sem acesso ao e-mail deve procurar a administração para conferir o cadastro. Administradores criados apenas pelo seed não possuem contato de cliente e não usam este fluxo.

## Ativar o envio no Resend

1. Crie uma conta em https://resend.com e confirme seu endereço de e-mail.
2. Em **Domains**, adicione um domínio ou subdomínio que você controla, por exemplo `email.seudominio.com.br`.
3. No provedor DNS do domínio, cadastre os registros indicados pelo Resend. Aguarde o domínio aparecer como verificado. Copie os valores exibidos pelo serviço; não invente registros.
4. Em **API Keys**, crie uma chave de envio para o domínio verificado. Guarde a chave somente nas configurações do backend.
5. No Render, abra o serviço da API e configure em **Environment**:

   ```text
   RESEND_API_KEY=<chave criada no Resend>
   RESET_EMAIL_FROM=A.L.P Imobiliária <acesso@email.seudominio.com.br>
   ```

   O domínio do remetente precisa corresponder ao domínio verificado. Não use a chave do Mercado Pago, `JWT_SECRET` ou credenciais do frontend nesses campos.
6. Salve as variáveis e publique a versão atualizada do backend e do frontend. Confira também `CLIENT_ORIGIN` e `VITE_API_URL`, já usados pela aplicação.

O remetente de testes `onboarding@resend.dev` tem restrições e não serve para liberar recuperação a todos os clientes. Para produção, use seu domínio verificado. Não envie chaves em mensagens nem as inclua no GitHub.

## Conferir antes de disponibilizar aos clientes

- No painel administrativo, confirme que cada cliente possui e-mail correto. O destinatário é sempre o e-mail desse cadastro.
- Use primeiro uma conta de cliente de teste com uma caixa de e-mail que você controla. Solicite o código, confira o recebimento, redefina a senha e faça login com a nova senha.
- Confira que a senha antiga deixou de funcionar e que o código não pode ser reutilizado. Não compartilhe o código para testar com terceiros.
- No Resend, confira a entrega da mensagem. Aceitação da API não garante chegada à caixa de entrada: verifique rejeições, spam, domínio e remetente.
- Se as variáveis estiverem ausentes, a aplicação informa que a recuperação ainda não está disponível. Falhas de entrega após a solicitação geram aviso nos logs do backend; a resposta ao cliente permanece genérica para não revelar contas cadastradas.

## Sessões e publicação

O JWT agora contém uma versão derivada do hash da senha. Redefinir ou alterar a senha invalida os tokens anteriores, sem expor o hash ao navegador. Na troca de senha autenticada, o navegador recebe um token novo.

Na primeira publicação desta versão, usuários que já estiverem conectados precisam entrar novamente. A alteração não exige novo campo no banco: utiliza o modelo `PasswordReset` já existente. Confirme que esse modelo está aplicado no banco antes de usar o fluxo. Não execute redefinição destrutiva nem seed de administrador para configurar o envio.

O limite por IP é de 12 requisições de recuperação por 15 minutos e fica na memória de cada processo. O intervalo por conta e o consumo de códigos usam transação e bloqueio no PostgreSQL. O backend considera um proxy em produção, adequado à configuração de entrada esperada no Render; revise essa configuração se mudar a infraestrutura.

## Testes de desenvolvimento

`cd server && npm test` executa os testes de recuperação e os testes existentes de Pix. As chamadas de envio e o banco são simulados; os testes HTTP usam as rotas reais. Não enviam mensagens reais.

`cd client && npm run build` compila o frontend. A entrega real de e-mails só pode ser homologada após configurar o Resend e o domínio.
