# Ajustes para celulares e Safari

A interface limita o conteúdo à largura disponível sem esconder a rolagem horizontal da página como solução. Nomes, referências, endereços e valores extensos podem quebrar linha. Tabelas e calendário mantêm rolagem horizontal dentro de suas próprias seções, acessíveis também por teclado.

Os ajustes são compartilhados pelo login, recuperação de senha, primeiro acesso, painel administrativo e área do cliente, em `client/src/responsive.css`. Essa folha é aplicada após os temas existentes para manter o mesmo comportamento em todas as telas.

## Comportamentos

- Formulários e ações se reorganizam em telas estreitas; campos podem encolher sem ultrapassar o cartão.
- Campos em telas de toque usam fonte de pelo menos 16 px para evitar o zoom automático do Safari ao focar.
- O viewport preserva o zoom manual e permite respeitar as áreas seguras do iPhone.
- Alturas usam unidades de viewport modernas com fallback para navegadores anteriores.
- Janelas do Pix e de detalhes limitam a altura ao espaço disponível, preservam a proporção do QR Code e permitem alcançar os botões por rolagem interna.
- Abrir uma janela bloqueia a rolagem do fundo; fechar restaura o estado anterior.
- Referências longas, valores altos, nomes compridos e botões de relatório não ampliam a página.

## Verificação

Foram usados dados fictícios, incluindo nomes e referências sem espaços e valores monetários altos, em telas de login, recuperação, primeiro acesso, sete abas administrativas, duas janelas administrativas, início do cliente, Pix, parcelas abertas/pagas, detalhes e perfil.

Larguras verificadas no Chromium: 320, 360, 375, 390, 414, 430, 768, 896, 1024 e 1440 px. Também foram verificadas alturas reduzidas para telas de 320 e 414 px.

O WebKit foi usado nas larguras 320, 375, 414, 430 e 896 px, incluindo dimensões do iPhone 11 em retrato e paisagem. A altura útil de 715 px também foi verificada para a largura de 414 px.

Os testes medem excesso de largura no documento e em textos/botões, verificam tamanho de fonte e navegam entre as telas com rede simulada. A verificação em navegador não equivale a executar no aparelho físico; após publicar, conferir no iPhone 11 o Safari, a rotação e a abertura do teclado.

Publicação: somente frontend/Vercel. Nenhuma alteração de banco, pagamentos, credenciais ou variáveis de ambiente.
