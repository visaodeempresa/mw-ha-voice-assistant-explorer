#!/usr/bin/env python3
"""Gera um snapshot dos registros do seu HA para alimentar o probe.

    export HA_URL=http://192.168.1.71:8123
    export HA_TOKEN=<token de acesso de longa duração>
    python3 tools/snapshot.py > snapshot.json
    node tools/probe.js snapshot.json

Só lê. Não muda nada no Home Assistant. O arquivo gerado tem nomes de área,
dispositivo e entidade da sua casa — está no .gitignore de propósito.
"""
import asyncio
import json
import os
import sys

import websockets  # pip install websockets

URL = os.environ.get("HA_URL", "http://localhost:8123").rstrip("/")
TOKEN = os.environ.get("HA_TOKEN")
KEEP_ATTRS = ("friendly_name", "icon", "device_class", "unit_of_measurement")


async def main() -> int:
    if not TOKEN:
        print("defina HA_TOKEN", file=sys.stderr)
        return 2
    ws_url = URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"
    async with websockets.connect(ws_url, max_size=None) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": TOKEN}))
        if json.loads(await ws.recv()).get("type") != "auth_ok":
            print("autenticação recusada", file=sys.stderr)
            return 1

        msg_id = 0

        async def cmd(type_: str):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "type": type_}))
            while True:
                data = json.loads(await ws.recv())
                if data.get("id") == msg_id and data.get("type") == "result":
                    if not data.get("success"):
                        raise RuntimeError(f"{type_}: {data.get('error')}")
                    return data["result"]

        entities = await cmd("config/entity_registry/list")
        areas = {a["area_id"]: a for a in await cmd("config/area_registry/list")}
        floors = {f["floor_id"]: f for f in await cmd("config/floor_registry/list")}
        devices = {d["id"]: d for d in await cmd("config/device_registry/list")}
        exposed = (await cmd("homeassistant/expose_entity/list"))["exposed_entities"]
        states = {
            s["entity_id"]: {
                "entity_id": s["entity_id"],
                "state": s["state"],
                "attributes": {k: v for k, v in s["attributes"].items() if k in KEEP_ATTRS},
            }
            for s in await cmd("get_states")
        }

    # imita o hass.entities do frontend: registro de exibição, sem as desabilitadas
    display = {
        e["entity_id"]: {
            "entity_id": e["entity_id"],
            "name": e.get("name"),
            "device_id": e.get("device_id"),
            "area_id": e.get("area_id"),
            "labels": e.get("labels", []),
            "hidden": bool(e.get("hidden_by")),
            "entity_category": e.get("entity_category"),
            "platform": e.get("platform"),
        }
        for e in entities
        if not e.get("disabled_by")
    }

    json.dump(
        {"areas": areas, "floors": floors, "devices": devices, "entities": display,
         "states": states, "exposed": exposed, "aliases": {}},
        sys.stdout, ensure_ascii=False,
    )
    print(
        f"\n# {len(display)} entidades · {len(devices)} dispositivos · "
        f"{len(areas)} áreas · {len(floors)} andares · {len(exposed)} expostas",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
