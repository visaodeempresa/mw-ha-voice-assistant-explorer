---
name: mw-voice-assistant-explorer
description: Mexer no card explorador de assistentes de voz do HA (custom:mw-voice-assistant-explorer-card) — a árvore andar › área › dispositivo › entidade com painel fixo de exposição e apelidos. Use quando o Maycon falar em "explorador de voz", "tela dos assistentes", "expor entidade para a Letícia/Alexa", "apelido da entidade", "aquela tela em árvore", "o placar do grupo", ou quando pedir para publicar/atualizar este card. Cobre os comandos WebSocket certos (e os errados), o deploy de teste por SSH e as armadilhas que já custaram tempo.
---

# Card explorador de assistentes de voz

Arquivo único, sem build: `dist/mw-voice-assistant-explorer-card.js` é fonte
**e** artefato. JS puro; `<ha-form>` só no editor.

## Pré-condições

| Preciso de | Como obter | Se faltar |
|---|---|---|
| SSH no HA | `ssh -F PROJECTS/new_wakeword/ssh/ssh_config ha-leticia` | sem deploy de teste; só release pelo HACS |
| HTTP no HA | `curl -s -o /dev/null -w '%{http_code}' http://192.168.1.71:8123/` → `200` | cair para a Nabu Casa |
| Node | `node --version` | sem probe |

## Os comandos WebSocket, com o nome exato

Estes cinco são o card inteiro. **Confira o nome antes de escrever** — errar um
não dá erro de código, dá um toast de falha em produção.

| Comando | Para quê |
|---|---|
| `homeassistant/expose_entity/list` | quem está exposto — **só aparece quem está** |
| `homeassistant/expose_entity` | ligar/desligar a exposição |
| `config/entity_registry/get` | ler `aliases` |
| `config/entity_registry/update` | gravar `aliases` |
| `cloud/status` | `prefs.alexa_enabled` / `prefs.google_enabled` |

Descobrir/confirmar um nome na instância viva, sem chutar:

```python
# PROJECTS/ha-dashboards/scripts/ha_client.py
for c in ["homeassistant/expose_entity", "homeassistant/expose_entity/expose"]:
    try:    ha.cmd(c, assistants=["conversation"], entity_ids=[EID], should_expose=True)
    except Exception as e: print("ERRO", c, e)
```

## Fluxo padrão

1. **Editar** `dist/…-card.js` — defaults em `DEFAULTS`, rótulo em `_label()`,
   campo em `_schema()`. Default nunca vai para o YAML.
2. **Probe**: `node --check dist/…js && node tools/probe.js` (56 asserções).
3. **Probe com a casa real** (pega o que a fixture não tem):
   ```bash
   HA_URL=http://192.168.1.71:8123 HA_TOKEN=… python3 tools/snapshot.py > snapshot.json
   node tools/probe.js snapshot.json
   ```
4. **Deploy de teste** — `IA/runbooks/deploy-card-hacs-ssh.md`; subir `.js` **e**
   `.js.gz`, e trocar o `?v=` do recurso (o navegador não invalida sozinho):
   ```python
   ha.cmd("lovelace/resources/update", resource_id=RID, res_type="module",
          url=f"{BASE}?v=0.1.0-t{n+1}")
   ```
5. **Verificar no destino**, não no que foi enviado: comparar o sha256 do que o
   servidor entrega com o do fonte — vale mais que `grep`.
6. Commit assinado, feature branch, PR. **Merge é do dono.**

## Armadilhas (com sintoma)

| Sintoma | Causa | Correção |
|---|---|---|
| Toast "Falhou ao mudar a exposição: Unknown command" | usou `homeassistant/expose_entity/expose` | é `homeassistant/expose_entity` **seco**; só o `list` tem sufixo |
| O ícone da Alexa simplesmente não aparece, sem erro no console | `mdi:amazon-alexa` e `mdi:amazon` foram retirados do conjunto de ícones | `mdi:circle-double` (o anel do Echo). `mdi:google-assistant` ainda existe |
| Apelidos sempre vazios | `config/entity_registry/list` **não** devolve `aliases` | ler com `config/entity_registry/get`, só da entidade selecionada |
| O interruptor "Nome predefinido" não gruda | o `null` dentro de `aliases` é o nome predefinido; filtrar `null` apaga o recurso | preservar o `null` e mantê-lo **na primeira posição** |
| Entidade some da árvore | `hass.entities` é o registro de **exibição**: desabilitada não entra, oculta entra com `hidden: true` | `show_hidden` para as ocultas; desabilitada não tem estado mesmo |
| Card branco por 1–2 min ao abrir o dashboard | o frontend só monta a view depois de carregar os 85 recursos da instância, e `sidebar-organizer.js` falha em todo carregamento | não é deste card (o `planta-mw-01` fica branco junto) — é dívida da instância |
| Tela travando com a casa toda | re-render a cada `set hass` | só reconstrói quando a assinatura dos registros muda; nó fechado não renderiza filho |
| Ao testar escrita, sobra sujeira na casa | — | testar em entidade inofensiva (`…_linkquality`) e **reverter**; conferir que o total de expostas voltou ao número inicial |

## Verificação (o que faz a tarefa estar pronta)

```bash
node --check dist/mw-voice-assistant-explorer-card.js
node tools/probe.js                                   # 56 asserções
curl -s http://192.168.1.71:8123/hacsfiles/mw-ha-voice-assistant-explorer/mw-voice-assistant-explorer-card.js \
  | shasum -a256                                      # igual ao do fonte
git log -1 --pretty='%G? %an'                         # G + MAYCON WILLIAN OLIVEIRA
```

Na tela, o que prova: a árvore desdobra até a entidade, o painel abre **ao
lado** (nenhum diálogo), o placar do grupo bate com o `expose_entity/list`, e um
clique num interruptor muda de verdade no servidor. Diga o que **não** foi
conferido (regra global 30) — tipicamente o layout de celular.
