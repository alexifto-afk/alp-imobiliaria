# Municípios brasileiros

Lista local com 5.571 municípios e as 27 UFs, carregada sob demanda no cadastro de imóveis. Inclui nome e código IBGE; não contém dados dos clientes.

Fonte: https://github.com/kelvins/municipios-brasileiros

Revisão utilizada: `503e2f70bbf1b4b7ec0b1f68b09086ccc38fe861`.

Arquivos de origem: `json/municipios.json` e `json/estados.json`. O módulo mantém somente pares `[codigo_ibge, nome]`, agrupados pela sigla da UF. A licença MIT da fonte está em `municipalities.LICENSE`.

A lista acompanha o app para evitar dependência da disponibilidade de APIs externas. Para atualizar, consulte a fonte, confira novos municípios/códigos e regenere o agrupamento preservando a licença. O teste do frontend verifica os grupos e municípios conhecidos.
