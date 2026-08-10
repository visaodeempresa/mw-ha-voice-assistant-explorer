#!/usr/bin/env node
/* probe.js — instancia o card fora do navegador e confere o HTML gerado.
 * Pega erro de árvore, de esquema e de chamada WebSocket sem depender de tela.
 *
 *   node tools/probe.js                 # fixture sintética (a do repositório)
 *   node tools/probe.js snapshot.json   # dump real: {areas,floors,devices,entities,states,exposed}
 *
 * Sai com código 1 na primeira asserção que falhar.
 */
"use strict";
const fs = require("fs");
const path = require("path");

// ── mini-DOM ────────────────────────────────────────────────────────────────
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag || "div").toUpperCase();
    this.children = [];
    this._html = "";
    this.style = {};
    this.dataset = {};
    this.classList = {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const v = on === undefined ? !this._s.has(c) : !!on; v ? this._s.add(c) : this._s.delete(c); return v; },
    };
  }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  set className(v) { this.classList._s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return Array.from(this.classList._s).join(" "); }
  addEventListener() {}
  removeEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  dispatchEvent() { return true; }
  focus() {}
  blur() {}
  matches() { return false; }
  scrollIntoView() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementById() { return null; }
}

class FakeRoot extends FakeEl {
  constructor() { super("shadow-root"); this._byId = new Map(); }
  set innerHTML(v) {
    this._html = String(v);
    this._byId = new Map();
    for (const m of this._html.matchAll(/id="([^"]+)"/g)) this._byId.set(m[1], new FakeEl("div"));
  }
  get innerHTML() { return this._html; }
  getElementById(id) { return this._byId.get(id) || null; }
  querySelector(sel) { const m = sel.match(/#([\w-]+)/); return m ? this.getElementById(m[1]) : null; }
  querySelectorAll() { return []; }
}

global.HTMLElement = class {
  constructor() { this.shadowRoot = null; }
  attachShadow() { this.shadowRoot = new FakeRoot(); return this.shadowRoot; }
  appendChild() {}
  dispatchEvent() { return true; }
  addEventListener() {}
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html || ""; }
};
const registry = {};
global.customElements = { define: (n, c) => { registry[n] = c; }, get: (n) => registry[n] };
global.document = { createElement: (t) => new FakeEl(t) };
global.window = { customCards: [], confirm: () => true };
global.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
const quiet = () => {};
const realInfo = console.info; console.info = quiet;

// ── fixture ────────────────────────────────────────────────────────────────
function fixture() {
  const entities = {};
  const states = {};
  const add = (eid, name, device_id, area_id, extra) => {
    entities[eid] = Object.assign({ entity_id: eid, name: null, device_id, area_id, labels: [] }, extra || {});
    states[eid] = { entity_id: eid, state: "on", attributes: { friendly_name: name } };
  };
  add("sensor.temperatura_cozinha", "🟨🌡️ Temperatura da Cozinha", "dev_tu", null);
  add("sensor.umidade_cozinha", "🟨💧 Umidade da Cozinha", "dev_tu", null);
  add("sensor.bateria_tu", "Bateria", "dev_tu", null, { entity_category: "diagnostic" });
  add("switch.geladeira", "🟨⚡ T GELADEIRA", "dev_tomada", null);
  add("light.escritorio", "Luz do Escritório", "dev_luz", null);
  add("input_boolean.modo_festa", "Modo Festa", null, "cozinha");     // sem dispositivo
  add("sensor.oculto", "Oculto", "dev_tu", null, { hidden: true });
  add("sensor.orfao", "Órfão sem área", null, null);

  return {
    floors: {
      apartamento: { floor_id: "apartamento", name: "APARTAMENTO 1503", level: 15, icon: "mdi:floor-plan" },
    },
    areas: {
      cozinha: { area_id: "cozinha", name: "COZINHA", floor_id: "apartamento", icon: "mdi:silverware-fork-knife" },
      escritorio: { area_id: "escritorio", name: "ESCRITÓRIO", floor_id: "apartamento", icon: null },
    },
    devices: {
      dev_tu: { id: "dev_tu", name: "T/U", name_by_user: "🟨🌡️💧 T/U DA COZINHA", area_id: "cozinha", manufacturer: "Tuya", model: "TS0201" },
      dev_tomada: { id: "dev_tomada", name: "Tomada", name_by_user: "🟨⚡ T GELADEIRA", area_id: "cozinha" },
      dev_luz: { id: "dev_luz", name: "Luz", name_by_user: null, area_id: "escritorio" },
    },
    entities,
    states,
    exposed: {
      "sensor.temperatura_cozinha": { conversation: true, "cloud.alexa": true },
      "switch.geladeira": { conversation: true },
    },
    aliases: { "sensor.temperatura_cozinha": ["Temperatura da Cozinha"], "sensor.umidade_cozinha": [null] },
  };
}

// ── hass falso ─────────────────────────────────────────────────────────────
function makeHass(fx, opts) {
  const calls = [];
  const exposed = JSON.parse(JSON.stringify(fx.exposed || {}));
  const aliases = JSON.parse(JSON.stringify(fx.aliases || {}));
  return {
    calls,
    exposedRef: exposed,
    areas: fx.areas, floors: fx.floors, devices: fx.devices,
    entities: fx.entities, states: fx.states,
    async callWS(msg) {
      calls.push(msg);
      switch (msg.type) {
        case "cloud/status":
          if (opts && opts.noCloud) throw new Error("unknown command");
          return {
            logged_in: true,
            prefs: { alexa_enabled: true, google_enabled: false },
            alexa_entities: {}, google_entities: {},
          };
        case "homeassistant/expose_entity/list":
          return { exposed_entities: exposed };
        case "homeassistant/expose_entity":
          for (const eid of msg.entity_ids) {
            const rec = exposed[eid] || (exposed[eid] = {});
            for (const a of msg.assistants) { if (msg.should_expose) rec[a] = true; else delete rec[a]; }
            if (!Object.keys(rec).length) delete exposed[eid];
          }
          return null;
        case "config/entity_registry/get":
          return Object.assign({}, fx.entities[msg.entity_id], {
            entity_id: msg.entity_id,
            original_name: (fx.states[msg.entity_id] || {}).attributes.friendly_name,
            aliases: aliases[msg.entity_id] ? aliases[msg.entity_id].slice() : [],
          });
        case "config/entity_registry/update":
          aliases[msg.entity_id] = msg.aliases.slice();
          return { entity_entry: { entity_id: msg.entity_id, aliases: msg.aliases.slice() } };
        default:
          throw new Error("comando não suportado no probe: " + msg.type);
      }
    },
  };
}

// ── asserções ──────────────────────────────────────────────────────────────
let fails = 0, checks = 0;
function ok(cond, label, extra) {
  checks++;
  if (cond) { console.log("  ✓ " + label); return true; }
  fails++;
  console.log("  ✗ " + label + (extra ? "\n      " + String(extra).slice(0, 400) : ""));
  return false;
}
const tick = () => new Promise((r) => setImmediate(r));

// ── execução ───────────────────────────────────────────────────────────────
(async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "dist", "mw-voice-assistant-explorer-card.js"), "utf8");
  eval(src);
  console.info = realInfo;

  const CARD = "mw-voice-assistant-explorer-card";
  console.log("\n[1] registro dos elementos");
  ok(!!registry[CARD], "custom element " + CARD + " definido");
  ok(!!registry[CARD + "-editor"], "editor definido");
  ok(window.customCards.length === 1 && window.customCards[0].type === CARD, "entrada em window.customCards");

  const arg = process.argv[2];
  const fx = arg ? JSON.parse(fs.readFileSync(arg, "utf8")) : fixture();
  if (arg) console.log("    (snapshot real: " + Object.keys(fx.entities).length + " entidades)");

  console.log("\n[2] árvore andar › área › dispositivo › entidade");
  const hass = makeHass(fx);
  const card = new registry[CARD]();
  card.setConfig({ type: "custom:" + CARD });
  card.hass = hass;
  await card._bootPromise;
  await tick();

  const shell = card.shadowRoot.innerHTML;
  ok(shell.includes('id="tree"') && shell.includes('id="detail"'), "esqueleto com árvore e painel");
  const tree = () => card.shadowRoot.getElementById("tree").innerHTML;
  ok(card._assistants.join(",") === "conversation,cloud.alexa",
    "assistentes = Assist + Alexa (Google desligado nas prefs)", card._assistants.join(","));

  const roots = card._model.roots;
  ok(roots.length >= 1 && roots[0].kind === "floor", "raiz é andar", roots.map((r) => r.kind + ":" + r.name).join(" | "));
  if (!arg) {
    ok(roots[0].name === "APARTAMENTO 1503", "nome do andar");
    const areas = roots[0].children.map((a) => a.name);
    ok(areas.includes("COZINHA") && areas.includes("ESCRITÓRIO"), "áreas sob o andar", areas.join(","));
    const semArea = roots.find((r) => r.name === "SEM ANDAR");
    ok(!!semArea, "entidade órfã cai num nó SEM ANDAR/SEM ÁREA");
    const cozinha = roots[0].children.find((a) => a.name === "COZINHA");
    const kinds = cozinha.children.map((c) => c.kind);
    ok(kinds.filter((k) => k === "device").length === 2, "2 dispositivos na cozinha", kinds.join(","));
    ok(kinds.includes("entity"), "entidade sem dispositivo listada direto na área", kinds.join(","));
    const tu = cozinha.children.find((c) => c.name.includes("T/U"));
    ok(tu && tu.children.length === 2 + 1, "T/U desdobra em temperatura, umidade e bateria (diagnóstico ligado)",
      tu && tu.children.map((e) => e.entity_id).join(","));
    ok(!JSON.stringify(card._model).includes("sensor.oculto"), "entidade oculta fora da árvore por padrão");
    ok(tu.exposedCount === 1 && tu.total === 3, "contagem exposta/total do dispositivo", tu.exposedCount + "/" + tu.total);
  }

  console.log("\n[3] render da árvore");
  card._expanded.add(roots[0].id);
  card._renderTree();
  ok(tree().includes('data-act="toggle"'), "nó de grupo clicável");
  ok(tree().includes('class="badge'), "badge de contagem");
  card._expandAll(true); card._renderTree();
  const t3 = tree();
  ok(t3.includes('data-act="pick"'), "linha de entidade clicável");
  ok(/title="Amazon Alexa/.test(t3), "chip da Alexa na linha");
  ok(!/undefined|\[object Object\]/.test(t3), "sem 'undefined' no HTML da árvore");

  console.log("\n[4] busca");
  card._search = "umidade"; card._sig = ""; card._update(true);
  const t4 = tree();
  ok(!arg ? t4.includes("Umidade da Cozinha") : t4.length > 0, "busca sem acento/caixa encontra a entidade");
  ok(!/Temperatura da Cozinha/.test(t4) || arg, "busca filtra o que não bate");
  card._search = ""; card._sig = ""; card._update(true);

  console.log("\n[5] painel: expor e assistentes");
  const target = arg ? Object.keys(fx.entities)[0] : "sensor.temperatura_cozinha";
  await card._selectEntity(target);
  const detail = () => card.shadowRoot.getElementById("detail").innerHTML;
  const d5 = detail();
  ok(d5.includes(">Expor<"), "linha mestra 'Expor'");
  ok(d5.includes("Amazon Alexa") && d5.includes("Assist"), "uma linha por assistente");
  ok(!d5.includes("Google Assistant"), "assistente desligado nas prefs não aparece");
  ok((d5.match(/class="sw /g) || []).length >= 3, "interruptores renderizados",
    (d5.match(/class="sw /g) || []).length);
  ok(!d5.includes("popup") && !d5.includes("<dialog"), "painel é inline, sem diálogo");

  console.log("\n[6] painel: apelidos e o null do nome predefinido");
  if (!arg) {
    ok(d5.includes('input class="alias"') || d5.includes('class="alias"'), "campo de apelido existente");
    ok(d5.includes("Nome predefinido"), "linha do nome predefinido");
    ok(card._aliases.length === 1 && card._aliases[0] === "Temperatura da Cozinha", "apelidos vindos do registro",
      JSON.stringify(card._aliases));

    // ligar o nome predefinido → null entra na PRIMEIRA posição
    const sw = { dataset: { sw: "default-name" }, classList: { contains: () => false, toggle() {} } };
    await card._onSwitch(sw);
    const upd = hass.calls.filter((c) => c.type === "config/entity_registry/update").pop();
    ok(upd && upd.aliases[0] === null, "null gravado como primeiro apelido", JSON.stringify(upd && upd.aliases));
    ok(upd && upd.aliases.length === 2, "apelido manual preservado", JSON.stringify(upd && upd.aliases));

    // desligar → null sai
    const sw2 = { dataset: { sw: "default-name" }, classList: { contains: () => true, toggle() {} } };
    await card._onSwitch(sw2);
    const upd2 = hass.calls.filter((c) => c.type === "config/entity_registry/update").pop();
    ok(upd2 && !upd2.aliases.includes(null), "null removido ao desligar", JSON.stringify(upd2.aliases));

    // duplicado não entra
    card._aliases = ["Cozinha", "cozinha ", "Outro"];
    await card._saveAliases();
    const upd3 = hass.calls.filter((c) => c.type === "config/entity_registry/update").pop();
    ok(upd3.aliases.length === 2, "apelido duplicado (acento/caixa) descartado", JSON.stringify(upd3.aliases));
  }

  console.log("\n[7] expor: chamada WebSocket correta");
  const before = hass.calls.length;
  const swm = { dataset: { sw: "master" }, classList: { contains: () => false, toggle() {} } };
  await card._onSwitch(swm);
  const exp = hass.calls.slice(before).find((c) => c.type === "homeassistant/expose_entity");
  ok(!!exp, "chamou homeassistant/expose_entity/expose");
  ok(exp && exp.should_expose === true && Array.isArray(exp.entity_ids) && exp.entity_ids[0] === target,
    "payload com entity_ids e should_expose", JSON.stringify(exp));
  ok(exp && exp.assistants.length === card._assistants.length, "mestre aplica em todos os assistentes visíveis");

  console.log("\n[8] ação em lote no grupo");
  if (!arg) {
    const cozinha = card._model.roots[0].children.find((a) => a.name === "COZINHA");
    const n0 = hass.calls.length;
    await card._bulk(cozinha.id);
    const bulk = hass.calls.slice(n0).find((c) => c.type === "homeassistant/expose_entity");
    ok(!!bulk && bulk.entity_ids.length === cozinha.total,
      "lote cobre todas as entidades do grupo", bulk && bulk.entity_ids.length + " de " + cozinha.total);
    ok(bulk && bulk.should_expose === true, "grupo parcialmente exposto → expõe o resto");
  }

  console.log("\n[9] degradação sem Nabu Casa");
  const card2 = new registry[CARD]();
  card2.setConfig({ type: "custom:" + CARD, root: "area", show_devices: false });
  card2.hass = makeHass(fx, { noCloud: true });
  await card2._bootPromise;
  await tick();
  ok(card2._assistants.length === 1 && card2._assistants[0] === "conversation",
    "cloud/status falhando deixa só o Assist", card2._assistants.join(","));
  ok(card2._model.roots.every((r) => r.kind === "area"), "root: area muda o primeiro nível");
  ok(card2._model.roots.every((a) => (a.children || []).every((c) => c.kind === "entity")),
    "show_devices: false lista entidades direto na área");

  console.log("\n[10] editor visual");
  const ed = new registry[CARD + "-editor"]();
  ed.hass = hass;
  ed.setConfig({ type: "custom:" + CARD });
  const schema = ed._schema();
  const names = [];
  const flat = (s) => s.forEach((f) => (f.schema ? flat(f.schema) : names.push(f.name)));
  flat(schema);
  ok(names.includes("root") && names.includes("filter") && names.includes("domains"),
    "esquema com root, filter e domains", names.join(","));
  const known =["title", "root", "filter", "show_devices", "show_diagnostic", "show_hidden",
    "expand_all", "bulk_actions", "show_entity_id", "height", "domains"];
  ok(names.every((n) => known.includes(n)), "todo campo do editor existe na config", names.join(","));
  ok(known.every((n) => names.includes(n)), "toda config tem campo no editor");
  let emitted = null;
  ed.dispatchEvent = (ev) => { emitted = ev.detail.config; return true; };
  ed._onChange({ stopPropagation() {}, detail: { value: { ...ed._config, title: "Vozes da casa" } } });
  ok(emitted && emitted.title === "Vozes da casa", "editor emite config-changed");
  ok(emitted && emitted.root === undefined, "default não polui o YAML", JSON.stringify(emitted));

  console.log("\n[11] nome exato dos comandos WebSocket");
  // `expose_entity/expose` existe na cabeça de quem escreve e não no HA:
  // devolve unknown_command e o sintoma é só um toast de falha.
  const COMANDOS = ["homeassistant/expose_entity", "homeassistant/expose_entity/list",
    "config/entity_registry/get", "config/entity_registry/update", "cloud/status"];
  COMANDOS.forEach((cmd) => ok(src.includes('"' + cmd + '"'), "usa " + cmd));
  ok(!src.includes('"homeassistant/expose_entity/expose"'),
    "não chama o inexistente expose_entity/expose (citá-lo em comentário vale)");

  console.log("\n[12] higiene do CSS (regras da casa)");
  const css = src.match(/const STYLE = `([\s\S]*?)`;/)[1];
  const kf = css.match(/@keyframes[\s\S]*?\}\s*\}/g) || [];
  const caro = /box-shadow|filter|width|height|left|top|margin|padding/;
  ok(kf.every((b) => !caro.test(b)), "nenhum @keyframes anima propriedade cara", kf.length + " blocos");
  ok(css.includes("prefers-reduced-motion"), "respeita prefers-reduced-motion");
  ok(!/\d+cqw/.test(css), "sem unidade de container (o card não usa tipografia proporcional)");
  // Ícone que não existe some sem erro nenhum: só o olho pega, e só na tela.
  const proibidos = ["mdi:amazon-alexa", "mdi:amazon", "mdi:alexa"];
  ok(proibidos.every((i) => !src.includes('"' + i + '"')),
    "sem ícone mdi retirado do conjunto do HA (marcas Amazon)",
    proibidos.filter((i) => src.includes('"' + i + '"')).join(","));

  console.log("\n" + (fails ? "✗ " + fails + " de " + checks + " falharam" : "✓ " + checks + " asserções passaram"));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("\nERRO NO PROBE:", e); process.exit(1); });
