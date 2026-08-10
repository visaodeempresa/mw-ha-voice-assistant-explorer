# Probe contra a sua própria casa

O probe roda com uma fixture sintética pequena — boa para CI, ruim para
descobrir que a sua casa tem uma área sem andar, um dispositivo com 300
entidades ou um nome com emoji que quebra o layout. Para isso existe o
snapshot.

```bash
export HA_URL=http://192.168.1.71:8123
export HA_TOKEN=<token de acesso de longa duração>   # Perfil › Segurança
python3 tools/snapshot.py > snapshot.json
node tools/probe.js snapshot.json
```

`tools/snapshot.py` **só lê**. Ele guarda os registros de andar, área,
dispositivo e entidade, os estados (só os atributos que o card usa) e o mapa de
exposição.

O arquivo tem os nomes da sua casa — `snapshot*.json` está no `.gitignore`.
Não commite.

## O que muda com o snapshot

Com a fixture, o probe roda 50 asserções, incluindo as que dependem de nomes
conhecidos. Com um snapshot real ele pula as asserções específicas da fixture e
mantém as estruturais — árvore, render, painel, payloads WebSocket e CSS. É a
diferença entre "o código roda" e "o código aguenta 2.500 entidades".

Medição no BASE-ALFA-01 (2.536 entidades, 637 dispositivos, 28 áreas,
4 andares): árvore montada, renderizada e checada em ~0,5 s, incluindo a
partida do Node.
