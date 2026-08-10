# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) ·
Versionamento: [SemVer](https://semver.org/lang/pt-BR/).

## [0.1.0] — 2026-08-10

Primeira versão. Nasceu de um incômodo concreto: a tela nativa de assistentes
de voz é uma lista chapada de milhares de entidades, e cada ajuste custa abrir
um diálogo, mexer, fechar e procurar a próxima.

### Adicionado

- Árvore **andar › área › dispositivo › entidade** montada dos registros do HA.
  Entidade sem dispositivo aparece direto na área; sem área nenhuma, cai num nó
  próprio em vez de sumir.
- Painel **fixo ao lado, sem diálogo**: `Expor`, um interruptor por assistente,
  o **nome predefinido** e os **apelidos**, salvos na hora. Trocar de entidade
  só troca o conteúdo do painel.
- Placar `expostas/total` em cada nó; clicando, o grupo inteiro entra ou sai
  (confirmação acima de 25 entidades).
- Chips por linha mostrando quem já enxerga a entidade.
- Busca sem acento/caixa em nome, `entity_id` e caminho; filtros
  `Todas / Expostas / Fora`.
- Editor visual completo (`ha-form`), sem YAML obrigatório.
- Layout de celular: o painel cobre a árvore e volta num botão.
- `tools/probe.js` — 56 asserções sem navegador, incluindo os nomes exatos dos
  comandos WebSocket e a higiene do CSS.
- `tools/snapshot.py` — dump só-leitura da instância para rodar o probe contra
  a casa real (2.536 entidades no BASE-ALFA-01, ~0,5 s).

### Notas de descoberta

Duas coisas que só a instância viva conta, e que estão presas em asserção para
não voltarem:

- O comando de exposição é `homeassistant/expose_entity` **seco** —
  `expose_entity/expose` devolve `unknown_command`, e o sintoma na tela é só um
  toast de falha.
- `mdi:amazon-alexa` e `mdi:amazon` não existem mais no conjunto de ícones do
  HA: o ícone some sem erro nenhum no console.
