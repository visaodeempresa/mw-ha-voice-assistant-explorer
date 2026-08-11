<!-- MW-BRAND:BEGIN — gerado por IA/tools/mw-brand.sh · não editar à mão -->
<p align="center">
  <a href="https://github.com/visaodeempresa">
    <img src="docs/brand/logo.png" alt="Visão de Empresa — MAYCON WILLIAN OLIVEIRA" width="96">
  </a>
  <br>
  <sub><b>Visão de Empresa</b> · componente de Home Assistant por MAYCON WILLIAN OLIVEIRA</sub>
</p>
<!-- MW-BRAND:END -->

# MW Voice Assistant Explorer

Um **explorador de arquivos** para os assistentes de voz do Home Assistant.

A tela nativa de *Assistentes de voz* é uma lista chapada de milhares de
entidades, e cada ajuste custa abrir um diálogo, mexer, fechar, achar a próxima
e abrir de novo. Aqui a casa aparece como ela é —
**andar › área › dispositivo › entidade** — e o painel de configuração fica
**fixo ao lado, sempre aberto**: clicar em outra entidade só troca o conteúdo do
painel. Nenhum popup, nenhum clique de fechar.

```
▾ 🏢 APARTAMENTO 1503                                    412/1851
   ▾ 🟨 COZINHA                                            96/271
      ▾ 🟨🌡️💧 T/U DA COZINHA                                2/3
           🟨🌡️ Temperatura da Cozinha        💬 ⭕        ← clique aqui…
           🟨💧 Umidade da Cozinha             💬 ⭕
           Bateria                             ·  ·
```

…e o painel do lado já mostra **Expor**, um interruptor por assistente e os
**apelidos**, prontos para editar.

## O que a tela faz

- **Árvore que desdobra** — andar › área › dispositivo › entidade, na mesma
  hierarquia dos registros do HA. Entidade sem dispositivo aparece direto na
  área; o que não tem área nenhuma cai num nó próprio, em vez de sumir.
- **Painel fixo, sem diálogo** — `Expor`, um interruptor por assistente
  (Assist, Amazon Alexa, Google Assistant), o **nome predefinido** e a lista de
  **apelidos**, tudo salvo na hora.
- **Placar em cada nó** — `96/271` diz quantas entidades daquele grupo estão
  expostas. Clicando no placar, o grupo inteiro entra ou sai de uma vez
  (confirmação acima de 25 entidades).
- **Chips por linha** — o ícone de cada assistente aceso ou apagado mostra, sem
  abrir nada, quem enxerga aquela entidade.
- **Busca e filtros** — busca ignora acento e caixa e varre nome, `entity_id` e
  o caminho; os filtros `Todas / Expostas / Fora` fazem a faxina render.
- **Celular** — em tela estreita o painel cobre a árvore e volta num botão só.

## Instalação

### HACS (recomendado)

1. HACS › Dashboards › ⋮ › *Custom repositories*
2. `https://github.com/visaodeempresa/mw-ha-voice-assistant-explorer`, tipo
   **Dashboard**
3. Instalar e recarregar (⌘⇧R / Ctrl+F5)

### Manual

Copie `dist/mw-voice-assistant-explorer-card.js` para
`/config/www/community/mw-ha-voice-assistant-explorer/` e cadastre o recurso
`/hacsfiles/mw-ha-voice-assistant-explorer/mw-voice-assistant-explorer-card.js`
como **JavaScript Module**.

## Uso

A tela rende mais em **view do tipo painel** (`type: panel`), que dá largura
para as duas colunas:

```yaml
views:
  - title: Assistentes de voz
    path: vozes
    type: panel
    cards:
      - type: custom:mw-voice-assistant-explorer-card
        title: Assistentes de voz
```

Mais receitas em [`examples/`](examples).

## Opções

| Opção | Padrão | O que faz |
|---|---|---|
| `title` | `Assistentes de voz` | Título na barra de cima |
| `root` | `floor` | Primeiro nível: `floor` (andar) ou `area` |
| `show_devices` | `true` | `false` põe as entidades direto na área |
| `show_diagnostic` | `true` | Mostra entidades de configuração/diagnóstico |
| `show_hidden` | `false` | Mostra entidades ocultas no registro |
| `domains` | `[]` | Lista de domínios; vazio = todos |
| `filter` | `all` | Filtro inicial: `all`, `exposed`, `unexposed` |
| `expand_all` | `false` | Abre a árvore inteira ao carregar |
| `height` | `72vh` | Altura da área de rolagem; `""` = automática |
| `bulk_actions` | `true` | Placar do grupo vira botão de expor/ocultar |
| `show_entity_id` | `true` | Mostra o `entity_id` no painel |

Tudo isso também está no **editor visual** — não é preciso escrever YAML.

## Permissões

Ler a árvore funciona para qualquer usuário. **Mudar** exposição
(`homeassistant/expose_entity/expose`) e apelidos
(`config/entity_registry/update`) exige usuário **administrador** — para um
usuário comum o card mostra o erro do próprio HA em vez de fingir que salvou.

Sem Nabu Casa, ou com Alexa/Google desligados nas preferências da nuvem, os
assistentes correspondentes simplesmente não aparecem: sobra o Assist. Se a
Alexa ou o Google estiverem configurados por YAML (`filter:` em
`configuration.yaml`), os interruptores da UI não valem para eles — e por isso
também não são mostrados.

## Como isto conversa com o Home Assistant

Nada de gambiarra: são as mesmas chamadas do painel nativo de assistentes de
voz, verificadas contra uma instância real (HA 2026.8.1).

| Chamada | Para quê |
|---|---|
| `homeassistant/expose_entity/list` | quem está exposto (só aparece quem está) |
| `homeassistant/expose_entity/expose` | ligar/desligar a exposição |
| `config/entity_registry/get` | ler os apelidos (o `list` **não** traz `aliases`) |
| `config/entity_registry/update` | gravar os apelidos |
| `cloud/status` | descobrir se Alexa/Google estão ligados |

O `null` dentro de `aliases` é a convenção do HA para *"use o nome predefinido
como primeiro apelido"* — é exatamente o que o interruptor **Nome predefinido**
liga e desliga.

## Desenvolvimento

Arquivo único, sem build: `dist/mw-voice-assistant-explorer-card.js` é fonte
**e** artefato.

```bash
node --check dist/mw-voice-assistant-explorer-card.js
node tools/probe.js                 # 50 asserções, sem navegador
node tools/probe.js snapshot.json   # contra um dump da sua casa
```

O probe monta o card fora do navegador com um `hass` falso e confere a árvore,
o painel, o `null` do nome predefinido, os payloads WebSocket e a higiene do
CSS. `docs/SNAPSHOT.md` mostra como gerar o dump da sua instância.

## Licença

MIT © MAYCON WILLIAN OLIVEIRA
