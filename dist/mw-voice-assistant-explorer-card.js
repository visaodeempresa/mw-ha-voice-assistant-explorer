/* mw-ha-voice-assistant-explorer — custom:mw-voice-assistant-explorer-card
 * Explorador (estilo Windows Explorer) dos assistentes de voz do Home Assistant:
 * ANDAR › ÁREA › DISPOSITIVO › ENTIDADE numa árvore que desdobra, e um painel
 * FIXO ao lado — sem popup — para expor a entidade aos assistentes e editar os
 * apelidos. Trocar de entidade não fecha nem reabre nada.
 *
 * API usada (verificada no BASE-ALFA-01, HA 2026.8.1):
 *   homeassistant/expose_entity/list    → { exposed_entities: { <eid>: {<assist>: true} } }
 *                                         (só aparece quem está EXPOSTO)
 *   homeassistant/expose_entity         → { assistants, entity_ids, should_expose }
 *                                         ARMADILHA: é `expose_entity` seco. O
 *                                         irmão `expose_entity/list` tem sufixo,
 *                                         e `expose_entity/expose` devolve
 *                                         `unknown_command` — o card só mostrava
 *                                         "Falhou ao mudar a exposição".
 *   config/entity_registry/get          → traz `aliases` (o `list` não traz)
 *   config/entity_registry/update       → { entity_id, aliases }
 *   cloud/status                        → prefs.alexa_enabled / prefs.google_enabled
 * O `null` dentro de `aliases` é o "nome predefinido" — mesma convenção do
 * painel nativo de assistentes de voz.
 *
 * JS puro + <ha-form> no editor, arquivo único, sem build.
 * Repo: https://github.com/visaodeempresa/mw-ha-voice-assistant-explorer
 */
(() => {
  "use strict";

  const VERSION = "0.1.1";
  const CARD = "mw-voice-assistant-explorer-card";

  // ───────────────────────────────────────────────────────────── configuração
  const DEFAULTS = {
    title: "Assistentes de voz",
    root: "floor",            // floor | area  — o primeiro nível da árvore
    show_devices: true,       // false = área vai direto nas entidades
    show_hidden: false,       // entidades ocultas do registro
    show_diagnostic: true,    // entidades de configuração/diagnóstico
    domains: [],              // [] = todos os domínios
    filter: "all",            // all | exposed | unexposed
    expand_all: false,        // abrir a árvore inteira ao carregar
    height: "72vh",           // altura da área de rolagem ("" = automática)
    bulk_actions: true,       // expor/ocultar um grupo inteiro num clique
    show_entity_id: true,     // entity_id embaixo do nome, no painel
  };

  // Assistentes suportados pelo painel nativo do HA.
  // ARMADILHA: `mdi:amazon-alexa` e `mdi:amazon` NÃO existem no conjunto de
  // ícones do HA (marcas da Amazon foram retiradas do Material Design Icons) —
  // o ícone some sem erro nenhum no console. `mdi:circle-double` é o anel do
  // Echo e existe. `mdi:google-assistant` continua existindo. Verificado no
  // BASE-ALFA-01 instanciando <ha-icon> e olhando o <path> gerado.
  const ASSISTANTS = {
    conversation: { name: "Assist", icon: "mdi:comment-processing-outline", color: "#03a9f4" },
    "cloud.alexa": { name: "Amazon Alexa", icon: "mdi:circle-double", color: "#00c8ff" },
    "cloud.google_assistant": { name: "Google Assistant", icon: "mdi:google-assistant", color: "#f4b400" },
  };

  const DOMAIN_ICON = {
    alarm_control_panel: "mdi:shield-home", automation: "mdi:robot", binary_sensor: "mdi:radiobox-blank",
    button: "mdi:gesture-tap-button", calendar: "mdi:calendar", camera: "mdi:video", climate: "mdi:thermostat",
    conversation: "mdi:forum", cover: "mdi:window-shutter", device_tracker: "mdi:account", event: "mdi:eye-check",
    fan: "mdi:fan", humidifier: "mdi:air-humidifier", image: "mdi:image", input_boolean: "mdi:toggle-switch",
    input_button: "mdi:gesture-tap-button", input_datetime: "mdi:calendar-clock", input_number: "mdi:ray-vertex",
    input_select: "mdi:format-list-bulleted", input_text: "mdi:form-textbox", light: "mdi:lightbulb",
    lock: "mdi:lock", media_player: "mdi:cast", number: "mdi:ray-vertex", person: "mdi:account",
    remote: "mdi:remote", scene: "mdi:palette", script: "mdi:script-text", select: "mdi:format-list-bulleted",
    sensor: "mdi:eye", siren: "mdi:bullhorn", stt: "mdi:microphone-message", sun: "mdi:white-balance-sunny",
    switch: "mdi:toggle-switch-variant", text: "mdi:form-textbox", time: "mdi:clock", timer: "mdi:timer-outline",
    todo: "mdi:clipboard-list", tts: "mdi:speaker-message", update: "mdi:package-up", vacuum: "mdi:robot-vacuum",
    valve: "mdi:pipe-valve", wake_word: "mdi:chat-sleep", water_heater: "mdi:water-boiler", weather: "mdi:weather-partly-cloudy",
    zone: "mdi:map-marker-radius",
  };

  const NO_AREA = "__sem_area__";
  const NO_FLOOR = "__sem_andar__";
  const NO_DEVICE = "__sem_dispositivo__";
  const MAX_SEARCH_ROWS = 400;

  // ─────────────────────────────────────────────────────────────── utilidades
  const esc = (s) =>
    String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const norm = (s) =>
    String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const domainOf = (eid) => String(eid).split(".")[0];

  const byName = (a, b) => String(a.name).localeCompare(String(b.name), "pt-BR", { sensitivity: "base" });

  function entityName(hass, eid, reg) {
    const st = hass.states && hass.states[eid];
    return (st && st.attributes && st.attributes.friendly_name) || (reg && reg.name) || eid;
  }

  function entityIcon(hass, eid) {
    const st = hass.states && hass.states[eid];
    if (st && st.attributes && st.attributes.icon) return st.attributes.icon;
    const dc = st && st.attributes && st.attributes.device_class;
    if (dc === "motion" || dc === "occupancy") return "mdi:motion-sensor";
    if (dc === "door") return "mdi:door";
    if (dc === "window") return "mdi:window-closed-variant";
    if (dc === "temperature") return "mdi:thermometer";
    if (dc === "humidity") return "mdi:water-percent";
    if (dc === "power") return "mdi:flash";
    if (dc === "energy") return "mdi:lightning-bolt";
    if (dc === "battery") return "mdi:battery";
    return DOMAIN_ICON[domainOf(eid)] || "mdi:shape-outline";
  }

  const deviceName = (dev) => (dev && (dev.name_by_user || dev.name)) || "Dispositivo";

  // ═══════════════════════════════════════════════════════════════════ CARD
  class MwVoiceAssistantExplorerCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = { ...DEFAULTS };
      this._hass = null;
      this._shell = false;          // esqueleto já montado?
      this._sig = "";               // assinatura dos registros (evita re-render)
      this._model = null;
      this._expanded = new Set();
      this._selected = null;
      this._entry = null;           // registro completo da entidade selecionada
      this._entryError = "";
      this._aliases = [];
      this._exposed = null;         // { eid: { assistant: true } }
      this._assistants = ["conversation"];
      this._booted = false;
      this._search = "";
      this._filter = DEFAULTS.filter;
      this._busy = false;
      this._toast = "";
      this._toastTimer = null;
      this._mobileDetail = false;   // em tela estreita, painel por cima da árvore
    }

    // ── ciclo de vida do Lovelace ─────────────────────────────────────────
    static getConfigElement() {
      return document.createElement(CARD + "-editor");
    }

    static getStubConfig() {
      return { type: "custom:" + CARD, title: DEFAULTS.title };
    }

    setConfig(config) {
      const cfg = { ...DEFAULTS, ...(config || {}) };
      if (!["floor", "area"].includes(cfg.root)) cfg.root = "floor";
      if (!["all", "exposed", "unexposed"].includes(cfg.filter)) cfg.filter = "all";
      if (!Array.isArray(cfg.domains)) cfg.domains = [];
      this._config = cfg;
      this._filter = cfg.filter;
      this._sig = "";               // força reconstrução do modelo
      if (this._hass) this._update(true);
    }

    getCardSize() { return 14; }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      // guardado para o probe headless conseguir esperar a carga inicial
      if (first) this._bootPromise = this._boot();
      this._update(false);
    }

    get hass() { return this._hass; }

    // ── carga inicial (uma vez) ───────────────────────────────────────────
    async _boot() {
      if (this._booted) return;
      this._booted = true;
      await Promise.all([this._loadAssistants(), this._loadExposed()]);
      this._sig = "";
      this._update(true);
    }

    async _loadAssistants() {
      const list = ["conversation"];
      try {
        const st = await this._hass.callWS({ type: "cloud/status" });
        const p = (st && st.prefs) || {};
        const manual = (f) => !!f && (
          (f.include_entities || []).length || (f.include_domains || []).length ||
          (f.include_entity_globs || []).length || (f.exclude_entities || []).length ||
          (f.exclude_domains || []).length || (f.exclude_entity_globs || []).length
        );
        if (st && st.logged_in && p.alexa_enabled && !manual(st.alexa_entities)) list.push("cloud.alexa");
        if (st && st.logged_in && p.google_enabled && !manual(st.google_entities)) list.push("cloud.google_assistant");
      } catch (_e) {
        // sem Nabu Casa, ou usuário sem permissão: sobra o Assist.
      }
      this._assistants = list;
    }

    async _loadExposed() {
      try {
        const r = await this._hass.callWS({ type: "homeassistant/expose_entity/list" });
        this._exposed = (r && r.exposed_entities) || {};
      } catch (e) {
        this._exposed = {};
        this._toastMsg("Não consegui ler a exposição das entidades: " + (e.message || e), true);
      }
    }

    // ── render ────────────────────────────────────────────────────────────
    _update(force) {
      if (!this._hass) return;
      if (!this._shell) this._renderShell();
      const sig = this._signature();
      if (force || sig !== this._sig) {
        this._sig = sig;
        this._model = this._buildModel();
        if (this._config.expand_all && !this._expandedOnce) {
          this._expandedOnce = true;
          this._expandAll(true);
        }
        this._renderTree();
        this._renderDetail();
      } else {
        this._refreshLiveState();
      }
    }

    _signature() {
      const h = this._hass;
      const n = (o) => (o ? Object.keys(o).length : 0);
      return [n(h.entities), n(h.devices), n(h.areas), n(h.floors),
        this._config.root, this._config.show_devices, this._config.show_hidden,
        this._config.show_diagnostic, (this._config.domains || []).join(","),
        this._filter, this._search, this._assistants.join(","),
        this._exposed ? Object.keys(this._exposed).length : -1].join("|");
    }

    // ── modelo da árvore ──────────────────────────────────────────────────
    _buildModel() {
      const hass = this._hass;
      const cfg = this._config;
      const areas = hass.areas || {};
      const floors = hass.floors || {};
      const devices = hass.devices || {};
      const entities = hass.entities || {};
      const domains = cfg.domains || [];

      const wanted = [];
      for (const eid in entities) {
        const reg = entities[eid];
        if (reg.hidden && !cfg.show_hidden) continue;
        if (reg.entity_category && !cfg.show_diagnostic) continue;
        if (domains.length && !domains.includes(domainOf(eid))) continue;
        if (this._filter !== "all") {
          const ex = this._isExposed(eid);
          if (this._filter === "exposed" && !ex) continue;
          if (this._filter === "unexposed" && ex) continue;
        }
        wanted.push(reg);
      }

      // área → dispositivo → entidades
      const areaMap = new Map();
      const areaOf = (reg) => {
        if (reg.area_id) return reg.area_id;
        const d = reg.device_id && devices[reg.device_id];
        return (d && d.area_id) || NO_AREA;
      };
      for (const reg of wanted) {
        const aid = areaOf(reg);
        if (!areaMap.has(aid)) areaMap.set(aid, new Map());
        const devMap = areaMap.get(aid);
        const did = (cfg.show_devices && reg.device_id && devices[reg.device_id]) ? reg.device_id : NO_DEVICE;
        if (!devMap.has(did)) devMap.set(did, []);
        devMap.get(did).push(reg);
      }

      // monta os nós
      const areaNodes = [];
      for (const [aid, devMap] of areaMap) {
        const area = areas[aid];
        const devNodes = [];
        let loose = [];
        for (const [did, regs] of devMap) {
          const ents = regs.map((reg) => ({
            kind: "entity",
            id: "e:" + reg.entity_id,
            entity_id: reg.entity_id,
            name: entityName(hass, reg.entity_id, reg),
            icon: entityIcon(hass, reg.entity_id),
            reg,
          })).sort(byName);
          if (did === NO_DEVICE) { loose = ents; continue; }
          const dev = devices[did];
          devNodes.push({
            kind: "device",
            id: "d:" + did,
            name: deviceName(dev),
            sub: [dev && dev.manufacturer, dev && (dev.model_id || dev.model)].filter(Boolean).join(" · "),
            icon: "mdi:devices",
            children: ents,
          });
        }
        devNodes.sort(byName);
        areaNodes.push({
          kind: "area",
          id: "a:" + aid,
          area_id: aid,
          name: area ? area.name : "SEM ÁREA",
          icon: (area && area.icon) || "mdi:texture-box",
          floor_id: (area && area.floor_id) || NO_FLOOR,
          children: devNodes.concat(loose),
        });
      }
      areaNodes.sort(byName);

      let roots;
      if (this._config.root === "area") {
        roots = areaNodes;
      } else {
        const floorMap = new Map();
        for (const a of areaNodes) {
          const fid = a.floor_id;
          if (!floorMap.has(fid)) floorMap.set(fid, []);
          floorMap.get(fid).push(a);
        }
        roots = [];
        for (const [fid, kids] of floorMap) {
          const fl = floors[fid];
          roots.push({
            kind: "floor",
            id: "f:" + fid,
            name: fl ? fl.name : "SEM ANDAR",
            icon: (fl && fl.icon) || "mdi:floor-plan",
            level: fl && typeof fl.level === "number" ? fl.level : 9999,
            children: kids,
          });
        }
        roots.sort((a, b) => (a.level - b.level) || byName(a, b));
      }

      // conta de baixo para cima: o grupo só sabe o seu número depois dos filhos
      const count = (nodes) => {
        for (const n of nodes) {
          if (n.kind === "entity") { n.total = 1; n.exposedCount = this._isExposed(n.entity_id) ? 1 : 0; continue; }
          count(n.children || []);
          n.total = (n.children || []).reduce((s, c) => s + c.total, 0);
          n.exposedCount = (n.children || []).reduce((s, c) => s + c.exposedCount, 0);
        }
      };
      count(roots);
      const index = new Map();
      const idx = (nodes) => { for (const n of nodes) { index.set(n.id, n); if (n.children) idx(n.children); } };
      idx(roots);
      this._index = index;

      return { roots, totalEntities: wanted.length };
    }

    _isExposed(eid) {
      const rec = this._exposed && this._exposed[eid];
      if (!rec) return false;
      return this._assistants.some((a) => rec[a] === true);
    }

    _exposedOn(eid, assistant) {
      const rec = this._exposed && this._exposed[eid];
      return !!(rec && rec[assistant] === true);
    }

    // ── esqueleto ─────────────────────────────────────────────────────────
    _renderShell() {
      this._shell = true;
      const h = this._config.height ? `height:${this._config.height};` : "";
      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <ha-card>
          <div class="wrap">
            <div class="toolbar">
              <div class="ttl">
                <ha-icon icon="mdi:file-tree"></ha-icon>
                <span id="title">${esc(this._config.title)}</span>
                <span class="count" id="count"></span>
              </div>
              <div class="tools">
                <label class="search">
                  <ha-icon icon="mdi:magnify"></ha-icon>
                  <input id="q" type="search" placeholder="Buscar entidade, dispositivo, área…" autocomplete="off">
                </label>
                <div class="segs" id="filters">
                  <button data-act="filter" data-v="all" class="seg on">Todas</button>
                  <button data-act="filter" data-v="exposed" class="seg">Expostas</button>
                  <button data-act="filter" data-v="unexposed" class="seg">Fora</button>
                </div>
                <button class="ico-btn" data-act="expand" title="Expandir tudo"><ha-icon icon="mdi:unfold-more-horizontal"></ha-icon></button>
                <button class="ico-btn" data-act="collapse" title="Recolher tudo"><ha-icon icon="mdi:unfold-less-horizontal"></ha-icon></button>
                <button class="ico-btn" data-act="reload" title="Recarregar exposição"><ha-icon icon="mdi:refresh"></ha-icon></button>
              </div>
            </div>
            <div class="body" style="${h}">
              <div class="pane tree" id="tree"></div>
              <div class="pane detail" id="detail"></div>
            </div>
            <div class="toast" id="toast"></div>
          </div>
        </ha-card>`;

      const root = this.shadowRoot;
      root.getElementById("q").addEventListener("input", (ev) => {
        this._search = ev.target.value || "";
        this._sig = "";
        this._update(true);
      });
      root.addEventListener("click", (ev) => this._onClick(ev));
      root.getElementById("detail").addEventListener("change", (ev) => this._onDetailChange(ev));
      root.getElementById("detail").addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && ev.target.matches("input.alias")) ev.target.blur();
      });
    }

    // ── árvore ────────────────────────────────────────────────────────────
    _renderTree() {
      const el = this.shadowRoot.getElementById("tree");
      if (!el || !this._model) return;
      const cnt = this.shadowRoot.getElementById("count");
      if (cnt) cnt.textContent = `${this._model.totalEntities} entidades`;

      const q = norm(this._search).trim();
      let html;
      if (q) {
        html = this._renderSearch(q);
      } else if (!this._model.roots.length) {
        html = `<div class="empty">Nada bate com este filtro.</div>`;
      } else {
        html = this._model.roots.map((n) => this._renderNode(n, 0)).join("");
      }
      el.innerHTML = html;
      const sel = el.querySelector(".row.sel");
      if (sel && this._scrollToSel) { this._scrollToSel = false; sel.scrollIntoView({ block: "nearest" }); }
    }

    _renderSearch(q) {
      const hits = [];
      const walk = (nodes, path) => {
        for (const n of nodes) {
          if (n.kind === "entity") {
            if (norm(n.name).includes(q) || norm(n.entity_id).includes(q) || norm(path).includes(q)) {
              hits.push({ n, path });
            }
          } else {
            walk(n.children || [], path ? path + " › " + n.name : n.name);
          }
          if (hits.length >= MAX_SEARCH_ROWS) return;
        }
      };
      walk(this._model.roots, "");
      if (!hits.length) return `<div class="empty">Nenhuma entidade para “${esc(this._search)}”.</div>`;
      const rows = hits.map(({ n, path }) => `
        <div class="row entity ${this._selected === n.entity_id ? "sel" : ""}" data-act="pick" data-eid="${esc(n.entity_id)}" style="--lvl:0">
          <span class="twist"></span>
          <ha-icon class="ico" icon="${esc(n.icon)}"></ha-icon>
          <span class="nm">${esc(n.name)}<span class="path">${esc(path)}</span></span>
          ${this._chips(n.entity_id)}
        </div>`).join("");
      const more = hits.length >= MAX_SEARCH_ROWS
        ? `<div class="empty">Mostrando os primeiros ${MAX_SEARCH_ROWS} — refine a busca.</div>` : "";
      return `<div class="found">${hits.length} resultado(s)</div>${rows}${more}`;
    }

    _renderNode(n, lvl) {
      if (n.kind === "entity") {
        const sel = this._selected === n.entity_id ? "sel" : "";
        return `
          <div class="row entity ${sel}" data-act="pick" data-eid="${esc(n.entity_id)}" style="--lvl:${lvl}">
            <span class="twist"></span>
            <ha-icon class="ico" icon="${esc(n.icon)}"></ha-icon>
            <span class="nm">${esc(n.name)}</span>
            ${this._chips(n.entity_id)}
          </div>`;
      }
      const open = this._expanded.has(n.id);
      const kids = open ? (n.children || []).map((c) => this._renderNode(c, lvl + 1)).join("") : "";
      const badgeCls = n.exposedCount === 0 ? "zero" : (n.exposedCount === n.total ? "full" : "part");
      const bulk = this._config.bulk_actions
        ? `<button class="badge ${badgeCls}" data-act="bulk" data-id="${esc(n.id)}"
             title="${n.exposedCount === n.total ? "Ocultar" : "Expor"} as ${n.total} entidades deste grupo">${n.exposedCount}/${n.total}</button>`
        : `<span class="badge ${badgeCls}">${n.exposedCount}/${n.total}</span>`;
      return `
        <div class="row group ${n.kind}" data-act="toggle" data-id="${esc(n.id)}" style="--lvl:${lvl}">
          <span class="twist ${open ? "open" : ""}"><ha-icon icon="mdi:chevron-right"></ha-icon></span>
          <ha-icon class="ico" icon="${esc(n.icon)}"></ha-icon>
          <span class="nm">${esc(n.name)}${n.sub ? `<span class="path">${esc(n.sub)}</span>` : ""}</span>
          ${bulk}
        </div>${kids}`;
    }

    _chips(eid) {
      return `<span class="chips">` + this._assistants.map((a) => {
        const on = this._exposedOn(eid, a);
        return `<ha-icon class="chip ${on ? "on" : ""}" style="--c:${ASSISTANTS[a].color}"
                  icon="${ASSISTANTS[a].icon}" title="${ASSISTANTS[a].name}${on ? "" : " (fora)"}"></ha-icon>`;
      }).join("") + `</span>`;
    }

    // ── painel de detalhe ─────────────────────────────────────────────────
    _renderDetail() {
      const el = this.shadowRoot.getElementById("detail");
      if (!el) return;
      el.classList.toggle("open", this._mobileDetail);

      if (!this._selected) {
        el.innerHTML = `
          <div class="placeholder">
            <ha-icon icon="mdi:account-voice"></ha-icon>
            <p>Escolha uma entidade na árvore.</p>
            <p class="hint">O painel fica aqui, aberto. Trocar de entidade não fecha nada:
              você desdobra <b>andar › área › dispositivo</b>, clica na entidade e configura
              exposição e apelidos sem sair da tela.</p>
          </div>`;
        return;
      }

      const eid = this._selected;
      const hass = this._hass;
      const reg = (hass.entities || {})[eid] || {};
      const st = (hass.states || {})[eid];
      const name = entityName(hass, eid, reg);
      const path = this._pathOf(eid);

      const head = `
        <div class="dhead">
          <button class="back ico-btn" data-act="back" title="Voltar para a árvore"><ha-icon icon="mdi:arrow-left"></ha-icon></button>
          <ha-icon class="dico" icon="${esc(entityIcon(hass, eid))}"></ha-icon>
          <div class="dtitle">
            <div class="dname">${esc(name)}</div>
            <div class="dpath">${esc(path)}</div>
            ${this._config.show_entity_id ? `<code class="deid">${esc(eid)}</code>` : ""}
          </div>
          <button class="ico-btn" data-act="more-info" title="Mais informações"><ha-icon icon="mdi:information-outline"></ha-icon></button>
        </div>
        <div class="dstate" id="dstate">${st ? esc(this._stateText(st)) : "<i>sem estado</i>"}</div>`;

      const anyOn = this._assistants.some((a) => this._exposedOn(eid, a));
      const expose = `
        <section class="block">
          <div class="srow master">
            <div class="slabel"><b>Expor</b><span>Deixa esta entidade visível para os assistentes marcados abaixo.</span></div>
            ${this._switch("master", anyOn)}
          </div>
          <div class="divider"></div>
          ${this._assistants.map((a) => `
            <div class="srow">
              <ha-icon class="aico" style="--c:${ASSISTANTS[a].color}" icon="${ASSISTANTS[a].icon}"></ha-icon>
              <div class="slabel"><b>${esc(ASSISTANTS[a].name)}</b></div>
              ${this._switch("assist", this._exposedOn(eid, a), a)}
            </div>`).join("")}
        </section>`;

      let aliases;
      if (this._entryError) {
        aliases = `<section class="block"><div class="err">Não consegui ler os apelidos: ${esc(this._entryError)}</div></section>`;
      } else if (!this._entry || this._entry.entity_id !== eid) {
        aliases = `<section class="block"><div class="loading">Carregando apelidos…</div></section>`;
      } else {
        const defaultName = this._entry.original_name || name;
        const rows = this._aliases.map((a, i) => a === null ? "" : `
          <div class="arow">
            <input class="alias" type="text" data-i="${i}" value="${esc(a)}" placeholder="Apelido ${i + 1}">
            <button class="ico-btn danger" data-act="del-alias" data-i="${i}" title="Apagar apelido"><ha-icon icon="mdi:trash-can-outline"></ha-icon></button>
          </div>`).join("");
        aliases = `
          <section class="block">
            <h4>Apelidos</h4>
            <p class="note">Os apelidos são os nomes que os assistentes usam para esta entidade.
              A Alexa usa apenas o primeiro; o Assist usa todos igualmente.</p>
            <div class="srow">
              <div class="slabel"><b>${esc(defaultName)}</b><span>Nome predefinido. Quando ativado, é usado como o primeiro apelido.</span></div>
              ${this._switch("default-name", this._aliases.includes(null))}
            </div>
            ${rows}
            <button class="add" data-act="add-alias"><ha-icon icon="mdi:plus"></ha-icon> Adicionar apelido</button>
          </section>`;
      }

      el.innerHTML = head + expose + aliases;
    }

    _switch(act, on, value) {
      return `<button class="sw ${on ? "on" : ""}" data-act="sw" data-sw="${esc(act)}"
                ${value ? `data-v="${esc(value)}"` : ""} role="switch" aria-checked="${on}"><span></span></button>`;
    }

    _stateText(st) {
      const u = st.attributes && st.attributes.unit_of_measurement;
      return st.state + (u ? " " + u : "");
    }

    _refreshLiveState() {
      if (!this._selected) return;
      const el = this.shadowRoot.getElementById("dstate");
      const st = (this._hass.states || {})[this._selected];
      if (el && st) el.textContent = this._stateText(st);
    }

    _pathOf(eid) {
      const hass = this._hass;
      const reg = (hass.entities || {})[eid] || {};
      const dev = reg.device_id && (hass.devices || {})[reg.device_id];
      const aid = reg.area_id || (dev && dev.area_id);
      const area = aid && (hass.areas || {})[aid];
      const fl = area && area.floor_id && (hass.floors || {})[area.floor_id];
      return [fl && fl.name, area ? area.name : "SEM ÁREA", dev && deviceName(dev)]
        .filter(Boolean).join(" › ");
    }

    // ── interação ─────────────────────────────────────────────────────────
    _onClick(ev) {
      const t = ev.composedPath().find((n) => n && n.dataset && n.dataset.act);
      if (!t) return;
      const act = t.dataset.act;
      if (act === "toggle") {
        const id = t.dataset.id;
        if (this._expanded.has(id)) this._expanded.delete(id); else this._expanded.add(id);
        this._renderTree();
      } else if (act === "pick") {
        ev.stopPropagation();
        this._selectEntity(t.dataset.eid);
      } else if (act === "bulk") {
        ev.stopPropagation();
        this._bulk(t.dataset.id);
      } else if (act === "filter") {
        this._filter = t.dataset.v;
        this.shadowRoot.querySelectorAll("#filters .seg").forEach((b) =>
          b.classList.toggle("on", b.dataset.v === this._filter));
        this._sig = "";
        this._update(true);
      } else if (act === "expand") {
        this._expandAll(true); this._renderTree();
      } else if (act === "collapse") {
        this._expanded.clear(); this._renderTree();
      } else if (act === "reload") {
        this._reload();
      } else if (act === "back") {
        this._mobileDetail = false;
        this._renderDetail();
      } else if (act === "more-info") {
        this.dispatchEvent(new CustomEvent("hass-more-info", {
          bubbles: true, composed: true, detail: { entityId: this._selected },
        }));
      } else if (act === "sw") {
        this._onSwitch(t);
      } else if (act === "add-alias") {
        this._aliases = this._aliases.concat([""]);
        this._renderDetail();
        const inputs = this.shadowRoot.querySelectorAll("#detail input.alias");
        if (inputs.length) inputs[inputs.length - 1].focus();
      } else if (act === "del-alias") {
        const i = Number(t.dataset.i);
        this._aliases = this._aliases.filter((_a, k) => k !== i);
        this._saveAliases();
      }
    }

    _onDetailChange(ev) {
      const inp = ev.target;
      if (!inp.matches || !inp.matches("input.alias")) return;
      const i = Number(inp.dataset.i);
      this._aliases = this._aliases.map((a, k) => (k === i ? inp.value : a));
      this._saveAliases();
    }

    async _onSwitch(btn) {
      const kind = btn.dataset.sw;
      const on = !btn.classList.contains("on");
      if (kind === "default-name") {
        this._aliases = on
          ? [null].concat(this._aliases.filter((a) => a !== null))
          : this._aliases.filter((a) => a !== null);
        btn.classList.toggle("on", on);
        await this._saveAliases();
        return;
      }
      const assistants = kind === "master" ? this._assistants.slice() : [btn.dataset.v];
      btn.classList.toggle("on", on);
      await this._expose(assistants, [this._selected], on);
      this._renderDetail();
      this._renderTree();
    }

    async _selectEntity(eid) {
      this._selected = eid;
      this._entry = null;
      this._entryError = "";
      this._aliases = [];
      this._mobileDetail = true;
      this._renderTree();
      this._renderDetail();
      try {
        const entry = await this._hass.callWS({ type: "config/entity_registry/get", entity_id: eid });
        if (this._selected !== eid) return;
        this._entry = entry;
        this._aliases = Array.isArray(entry.aliases) ? entry.aliases.slice() : [];
      } catch (e) {
        this._entryError = String((e && e.message) || e);
      }
      this._renderDetail();
    }

    async _saveAliases() {
      const eid = this._selected;
      const clean = this._aliases.filter((a) => a === null || String(a).trim() !== "")
        .map((a) => (a === null ? null : String(a).trim()));
      // sem duplicados, preservando a ordem
      const seen = new Set();
      const aliases = clean.filter((a) => {
        const k = a === null ? "\u0000" : norm(a);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      try {
        const r = await this._hass.callWS({
          type: "config/entity_registry/update", entity_id: eid, aliases,
        });
        const entry = (r && r.entity_entry) || r;
        if (entry && entry.aliases) this._aliases = entry.aliases.slice();
        else this._aliases = aliases;
        this._toastMsg("Apelidos salvos.");
      } catch (e) {
        this._toastMsg("Falhou ao salvar apelidos: " + ((e && e.message) || e), true);
      }
      this._renderDetail();
    }

    async _expose(assistants, entity_ids, should_expose) {
      try {
        await this._hass.callWS({
          type: "homeassistant/expose_entity", assistants, entity_ids, should_expose,
        });
        for (const eid of entity_ids) {
          const rec = this._exposed[eid] || (this._exposed[eid] = {});
          for (const a of assistants) {
            if (should_expose) rec[a] = true; else delete rec[a];
          }
          if (!Object.keys(rec).length) delete this._exposed[eid];
        }
        return true;
      } catch (e) {
        this._toastMsg("Falhou ao mudar a exposição: " + ((e && e.message) || e), true);
        await this._loadExposed();
        this._renderTree();
        this._renderDetail();
        return false;
      }
    }

    async _bulk(nodeId) {
      const node = this._index && this._index.get(nodeId);
      if (!node) return;
      const ids = [];
      const walk = (n) => {
        if (n.kind === "entity") ids.push(n.entity_id);
        else (n.children || []).forEach(walk);
      };
      walk(node);
      if (!ids.length) return;
      const should = node.exposedCount !== node.total;
      const verb = should ? "Expor" : "Ocultar";
      if (ids.length > 25 &&
          !window.confirm(`${verb} ${ids.length} entidades de “${node.name}” para ${this._assistants.length} assistente(s)?`)) {
        return;
      }
      this._busy = true;
      const ok = await this._expose(this._assistants.slice(), ids, should);
      this._busy = false;
      if (ok) this._toastMsg(`${verb}: ${ids.length} entidade(s) de “${node.name}”.`);
      this._sig = "";
      this._update(true);
    }

    _expandAll(open) {
      this._expanded.clear();
      if (!open || !this._model) return;
      const walk = (nodes) => {
        for (const n of nodes) {
          if (n.kind === "entity") continue;
          this._expanded.add(n.id);
          walk(n.children || []);
        }
      };
      walk(this._model.roots);
    }

    async _reload() {
      await Promise.all([this._loadAssistants(), this._loadExposed()]);
      this._sig = "";
      this._update(true);
      this._toastMsg("Exposição recarregada.");
    }

    _toastMsg(msg, isError) {
      const el = this.shadowRoot.getElementById("toast");
      if (!el) return;
      el.textContent = msg;
      el.className = "toast show" + (isError ? " err" : "");
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { el.className = "toast"; }, isError ? 8000 : 2600);
    }
  }

  // ══════════════════════════════════════════════════════════════════ ESTILO
  const STYLE = `
  :host { display: block; }
  ha-card { overflow: hidden; }
  .wrap { display: flex; flex-direction: column; position: relative; }

  .toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center;
    justify-content: space-between; padding: 12px 14px 10px; border-bottom: 1px solid var(--divider-color); }
  .ttl { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 600;
    color: var(--primary-text-color); }
  .ttl ha-icon { --mdc-icon-size: 20px; color: var(--primary-color); }
  .count { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  .tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

  .search { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
    background: var(--input-fill-color, rgba(127,127,127,.12)); border: 1px solid var(--divider-color); }
  .search ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .search input { border: 0; outline: 0; background: transparent; color: var(--primary-text-color);
    font: inherit; font-size: 13px; width: 210px; max-width: 40vw; }

  .segs { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 999px; overflow: hidden; }
  .seg { border: 0; background: transparent; color: var(--secondary-text-color); font: inherit; font-size: 12px;
    padding: 5px 11px; cursor: pointer; }
  .seg + .seg { border-left: 1px solid var(--divider-color); }
  .seg.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }

  .ico-btn { border: 0; background: transparent; color: var(--secondary-text-color); cursor: pointer;
    border-radius: 50%; width: 32px; height: 32px; display: inline-grid; place-items: center; }
  .ico-btn:hover { background: rgba(127,127,127,.15); color: var(--primary-text-color); }
  .ico-btn ha-icon { --mdc-icon-size: 20px; }
  .ico-btn.danger:hover { color: var(--error-color, #db4437); }

  .body { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); min-height: 320px; }
  .pane { overflow: auto; }
  .tree { border-right: 1px solid var(--divider-color); padding: 6px 0 14px; }
  .detail { padding: 0 0 16px; }

  /* ── linhas da árvore ── */
  .row { display: flex; align-items: center; gap: 8px; min-height: 34px;
    padding: 2px 10px 2px calc(6px + var(--lvl) * 18px); cursor: pointer;
    border-left: 3px solid transparent; }
  .row:hover { background: rgba(127,127,127,.10); }
  .row.sel { background: color-mix(in srgb, var(--primary-color) 18%, transparent);
    border-left-color: var(--primary-color); }
  .row .twist { width: 18px; display: inline-grid; place-items: center; flex: 0 0 18px; }
  .row .twist ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color);
    transition: transform .12s ease; }
  .row .twist.open ha-icon { transform: rotate(90deg); }
  .row .ico { --mdc-icon-size: 19px; flex: 0 0 19px; color: var(--state-icon-color, var(--secondary-text-color)); }
  .row.floor .ico { color: var(--primary-color); }
  .row.area .ico { color: var(--accent-color, #ff9800); }
  .row .nm { flex: 1 1 auto; min-width: 0; font-size: 13.5px; color: var(--primary-text-color);
    display: flex; flex-direction: column; line-height: 1.25; }
  .row .nm .path { font-size: 10.5px; color: var(--secondary-text-color); overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .row.group > .nm { font-weight: 600; letter-spacing: .2px; }
  .row.floor > .nm { text-transform: uppercase; font-size: 12.5px; }

  .badge { font-size: 11px; font-variant-numeric: tabular-nums; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--divider-color); background: transparent; color: var(--secondary-text-color);
    cursor: pointer; font-family: inherit; }
  button.badge:hover { border-color: var(--primary-color); color: var(--primary-text-color); }
  .badge.full { background: color-mix(in srgb, var(--success-color, #43a047) 26%, transparent);
    color: var(--primary-text-color); border-color: transparent; }
  .badge.part { background: color-mix(in srgb, var(--warning-color, #ffa726) 26%, transparent);
    color: var(--primary-text-color); border-color: transparent; }

  .chips { display: inline-flex; gap: 3px; align-items: center; }
  .chip { --mdc-icon-size: 15px; color: var(--secondary-text-color); opacity: .28; }
  .chip.on { color: var(--c); opacity: 1; }

  .found, .empty { padding: 10px 14px; font-size: 12px; color: var(--secondary-text-color); }

  /* ── painel ── */
  .placeholder { padding: 34px 24px; text-align: center; color: var(--secondary-text-color); }
  .placeholder ha-icon { --mdc-icon-size: 46px; opacity: .35; }
  .placeholder p { margin: 10px 0 0; font-size: 13px; }
  .placeholder .hint { font-size: 12px; opacity: .8; max-width: 34em; margin: 12px auto 0; line-height: 1.5; }

  .dhead { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px 8px;
    position: sticky; top: 0; z-index: 2;
    background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
    border-bottom: 1px solid var(--divider-color); }
  .dhead .back { display: none; }
  .dico { --mdc-icon-size: 26px; color: var(--state-icon-color, var(--primary-color)); margin-top: 2px; }
  .dtitle { flex: 1 1 auto; min-width: 0; }
  .dname { font-size: 15px; font-weight: 600; color: var(--primary-text-color); }
  .dpath { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 1px; }
  .deid { font-size: 11px; color: var(--secondary-text-color); opacity: .8; word-break: break-all; }
  .dstate { padding: 6px 14px 0; font-size: 12px; color: var(--secondary-text-color); }

  .block { padding: 12px 14px; border-bottom: 1px solid var(--divider-color); }
  .block h4 { margin: 0 0 4px; font-size: 13px; color: var(--primary-text-color); }
  .block .note { margin: 0 0 10px; font-size: 11.5px; line-height: 1.45; color: var(--secondary-text-color); }
  .divider { height: 1px; background: var(--divider-color); margin: 8px 0; }

  .srow { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
  .srow .aico { --mdc-icon-size: 20px; color: var(--c); flex: 0 0 20px; }
  .slabel { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .slabel b { font-size: 13.5px; font-weight: 500; color: var(--primary-text-color); }
  .slabel span { font-size: 11.5px; line-height: 1.4; color: var(--secondary-text-color); }
  .master .slabel b { font-weight: 700; }

  .sw { position: relative; width: 42px; height: 22px; border-radius: 999px; border: 0; cursor: pointer;
    background: var(--switch-unchecked-track-color, rgba(127,127,127,.45)); flex: 0 0 42px; padding: 0;
    transition: background .15s ease; }
  .sw span { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
    background: var(--switch-unchecked-button-color, #fafafa); transition: transform .15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,.4); }
  .sw.on { background: color-mix(in srgb, var(--switch-checked-color, var(--primary-color)) 55%, transparent); }
  .sw.on span { transform: translateX(20px); background: var(--switch-checked-color, var(--primary-color)); }

  .arow { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  input.alias { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 13px; padding: 9px 10px;
    border-radius: 8px; border: 1px solid var(--divider-color); color: var(--primary-text-color);
    background: var(--input-fill-color, rgba(127,127,127,.10)); }
  input.alias:focus { outline: 0; border-color: var(--primary-color); }
  .add { margin-top: 12px; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px;
    padding: 7px 14px; border-radius: 999px; cursor: pointer; color: var(--primary-color);
    background: transparent; border: 1px solid var(--primary-color); }
  .add ha-icon { --mdc-icon-size: 18px; }
  .loading, .err { font-size: 12.5px; color: var(--secondary-text-color); padding: 6px 0; }
  .err { color: var(--error-color, #db4437); }

  .toast { position: absolute; left: 50%; bottom: 14px; transform: translate(-50%, 20px);
    background: var(--primary-color); color: var(--text-primary-color, #fff); font-size: 12.5px;
    padding: 8px 16px; border-radius: 999px; opacity: 0; pointer-events: none; transition: all .2s ease;
    max-width: 90%; text-align: center; z-index: 5; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .toast.err { background: var(--error-color, #db4437); }

  @media (max-width: 760px) {
    .body { grid-template-columns: 1fr; position: relative; }
    .tree { border-right: 0; }
    .detail { display: none; }
    .detail.open { display: block; position: absolute; inset: 0; z-index: 3;
      background: var(--ha-card-background, var(--card-background-color, #1c1c1c)); overflow: auto; }
    .dhead .back { display: inline-grid; }
    .search input { width: 150px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .row .twist ha-icon, .sw, .sw span, .toast { transition: none; }
  }`;

  // ══════════════════════════════════════════════════════════════════ EDITOR
  class MwVoiceAssistantExplorerCardEditor extends HTMLElement {
    setConfig(config) { this._config = { ...DEFAULTS, ...(config || {}) }; this._render(); }
    set hass(hass) { this._hass = hass; this._render(); }

    _domainOptions() {
      const set = new Set();
      const ents = (this._hass && this._hass.entities) || {};
      for (const eid in ents) set.add(domainOf(eid));
      return Array.from(set).sort().map((d) => ({ value: d, label: d }));
    }

    _schema() {
      return [
        { name: "title", selector: { text: {} } },
        {
          name: "", type: "grid", schema: [
            { name: "root", selector: { select: { mode: "dropdown", options: [
              { value: "floor", label: "Andar › Área › Dispositivo" },
              { value: "area", label: "Área › Dispositivo" },
            ] } } },
            { name: "filter", selector: { select: { mode: "dropdown", options: [
              { value: "all", label: "Todas" },
              { value: "exposed", label: "Só as expostas" },
              { value: "unexposed", label: "Só as de fora" },
            ] } } },
          ],
        },
        {
          name: "", type: "grid", schema: [
            { name: "show_devices", selector: { boolean: {} } },
            { name: "show_diagnostic", selector: { boolean: {} } },
            { name: "show_hidden", selector: { boolean: {} } },
            { name: "expand_all", selector: { boolean: {} } },
            { name: "bulk_actions", selector: { boolean: {} } },
            { name: "show_entity_id", selector: { boolean: {} } },
          ],
        },
        { name: "height", selector: { text: {} } },
        { name: "domains", selector: { select: { multiple: true, mode: "dropdown", options: this._domainOptions() } } },
      ];
    }

    _label(s) {
      return {
        title: "Título", root: "Primeiro nível", filter: "Filtro inicial",
        show_devices: "Agrupar por dispositivo", show_diagnostic: "Mostrar diagnóstico/configuração",
        show_hidden: "Mostrar entidades ocultas", expand_all: "Abrir a árvore inteira",
        bulk_actions: "Expor grupo inteiro num clique", show_entity_id: "Mostrar entity_id",
        height: "Altura da área de rolagem (ex.: 72vh)", domains: "Domínios (vazio = todos)",
      }[s.name] || s.name;
    }

    _render() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        this.innerHTML = "";
        this._form = document.createElement("ha-form");
        this._form.addEventListener("value-changed", (ev) => this._onChange(ev));
        this.appendChild(this._form);
      }
      this._form.hass = this._hass;
      this._form.schema = this._schema();
      this._form.data = this._config;
      this._form.computeLabel = (s) => this._label(s);
    }

    _onChange(ev) {
      ev.stopPropagation();
      const v = ev.detail.value || {};
      const clean = { type: "custom:" + CARD };
      for (const [k, val] of Object.entries(v)) {
        if (val === undefined || val === null || val === "") continue;
        if (Array.isArray(val) && !val.length) continue;
        if (DEFAULTS[k] !== undefined && DEFAULTS[k] === val) continue;   // default não polui o YAML
        clean[k] = val;
      }
      // campo escondido pelo esquema não volta no evento — sem isto sumiria do YAML
      for (const [k, val] of Object.entries(this._config)) {
        if (k === "type") continue;
        if (!(k in v) && clean[k] === undefined && DEFAULTS[k] !== val) clean[k] = val;
      }
      this._config = { ...DEFAULTS, ...clean };
      this.dispatchEvent(new CustomEvent("config-changed", {
        bubbles: true, composed: true, detail: { config: clean },
      }));
      this._render();
    }
  }

  customElements.define(CARD, MwVoiceAssistantExplorerCard);
  customElements.define(CARD + "-editor", MwVoiceAssistantExplorerCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD,
    name: "MW Voice Assistant Explorer",
    description: "Árvore andar › área › dispositivo › entidade com painel fixo para expor aos assistentes e editar apelidos.",
    preview: false,
    documentationURL: "https://github.com/visaodeempresa/mw-ha-voice-assistant-explorer",
  });

  console.info("%c MW-VOICE-ASSISTANT-EXPLORER %c " + VERSION + " ",
    "background:#1a1a1a;color:#fdfaf3;font-weight:700;",
    "background:#03a9f4;color:#1a1a1a;font-weight:700;");
})();
