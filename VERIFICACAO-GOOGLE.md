# Páginas públicas e verificação do Google

O HTML inicial contém a meta tag pública do Search Console fornecida pela administração. A página inicial apresenta a A.L.P sem exigir conta, e a política fica em `/privacidade.html`, também sem autenticação e sem JavaScript. O botão Entrar aponta para `/login`. Sessões existentes na raiz e o link `/?view=installments` das notificações continuam abrindo o sistema.

## Após concluir o merge e a publicação na Vercel

1. Abra `https://alp-imobiliaria.vercel.app/` em janela anônima: a apresentação e o link de privacidade devem estar visíveis. Abra também `https://alp-imobiliaria.vercel.app/privacidade.html`.
2. No Search Console, selecione a propriedade de **Prefixo do URL** `https://alp-imobiliaria.vercel.app/`, mantenha o método **Tag HTML** e clique em **Verificar**. Não remova a meta tag após verificar.
3. No Google Auth Platform → Branding, configure a página inicial como `https://alp-imobiliaria.vercel.app/` e a política de privacidade como `https://alp-imobiliaria.vercel.app/privacidade.html`. Salve. Não use a tela de login como endereço da política.
4. O aviso exibido pelo Google pede aguardar 24 horas após verificar a propriedade antes de tentar novamente. Depois, em Ver problemas, selecione Corrigir os problemas e siga a solicitação de nova verificação. A aprovação depende da análise do Google e pode exigir outras informações.
5. Confira separadamente o status em Público-alvo para sair de Testando e publicar o app, cumprindo as exigências de consentimento e verificação aplicáveis. Quando a configuração estiver concluída, autorize novamente a conta remetente para gerar um refresh token novo e atualize diretamente no Render. Veja RECUPERACAO-SENHA.md.

A política usa o contato `alexifto@gmail.com`, confirmado pela administração, e descreve as funções presentes no código. A administração deve mantê-la coerente com suas práticas reais de conservação, atendimento e tratamento de dados. Estas alterações não verificam automaticamente a propriedade, não enviam o app para revisão e não modificam as credenciais do Gmail.
