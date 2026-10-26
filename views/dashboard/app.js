const bridge = window.AstrBotPluginView;

const state = {
  summary: null,
  rows: [],
  jobs: {}, // `${url}|${session}` -> next_run ts
  filter: "",
  sessionFilter: "",
  sort: { key: "title", dir: 1 },
  loading: true,
  error: null,
  addOpen: false,
  verified: null, // {url, title} from 验证
  editingKey: null,
  feedEditKey: null,
  confirmKey: null,
  previewKey: null,
  preview: { items: [], loading: false, error: null },
  selected: new Set(), // `${url}|${session}`
  pushingKey: null,
  settings: null,
  endpoints: { endpoints: [], default: "" },
};

const CRON_PRESETS = [
  ["*/1 * * * *", "每分钟"],
  ["0 * * * *", "每小时"],
  ["0 */2 * * *", "每 2 小时"],
  ["0 */6 * * *", "每 6 小时"],
  ["0 8 * * *", "每天 08:00"],
  ["0 9 * * *", "每天 09:00"],
  ["0 10 * * 1", "每周一 10:00"],
];

const ICONS = {
  rss: "M6.18 20a2.18 2.18 0 11-4.36 0 2.18 2.18 0 014.36 0zM2 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z",
  trash: "M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  clock: "M12 2a10 10 0 100 20 10 10 0 000-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z",
  chevron: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  open: "M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  server: "M4 4h16a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v3h16V6H4zm0 7h16a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3a2 2 0 012-2zm0 2v3h16v-3H4z",
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function iconSvg(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.appendChild(path);
  return svg;
}

function cronLabel(cron) {
  const hit = CRON_PRESETS.find(([expr]) => expr === cron);
  return hit ? hit[1] : cron;
}

function sessionLabel(origin) {
  const parts = origin.split(":");
  if (parts.length === 3) {
    const [platform, type, id] = parts;
    if (/aiocqhttp|napcat/i.test(platform)) {
      if (type === "FriendMessage") return `QQ 私聊 ${id}`;
      if (type === "GroupMessage") return `QQ 群 ${id}`;
    }
    return `${platform} · ${id}`;
  }
  return origin;
}

function relTime(ts) {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff >= 0) {
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  }
  const ahead = -diff;
  if (ahead < 3600) return `${Math.floor(ahead / 60)} 分钟后`;
  if (ahead < 86400) return `${Math.floor(ahead / 3600)} 小时后`;
  return `${Math.floor(ahead / 86400)} 天后`;
}

let toastTimer = null;
function toast(msg, type = "ok") {
  const node = document.getElementById("toast");
  node.textContent = msg;
  node.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = "toast"), 2600);
}

/* ---------- header & tabs ---------- */

function renderHead() {
  const s = state.summary;
  document.getElementById("statLine").textContent = state.loading
    ? "正在加载…"
    : state.error
      ? "加载失败"
      : s
        ? `${s.feeds} 个订阅源 · ${s.subscriptions} 条订阅 · AI 摘要${s.ai_summary ? "已开启" : "已关闭"} · ${s.sessions.length} 个会话`
        : "";
  const list = document.getElementById("sessionList");
  list.replaceChildren(
    ...(state.summary?.sessions || []).map((s) =>
      el("option", { value: s.origin, text: `${sessionLabel(s.origin)}（${s.count} 个源）` }),
    ),
  );
  const sf = document.getElementById("sessionFilter");
  const cur = sf.value;
  sf.replaceChildren(
    el("option", { value: "", text: "全部会话" }),
    ...(state.summary?.sessions || []).map((s) =>
      el("option", { value: s.origin, text: `${sessionLabel(s.origin)} (${s.count})` }),
    ),
  );
  sf.value = cur;
}

function switchTab(name) {
  for (const t of document.querySelectorAll(".tab")) {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on);
  }
  for (const p of document.querySelectorAll(".tab-panel")) {
    p.classList.toggle("active", p.id === `panel-${name}`);
  }
}

/* ---------- subscriptions tab ---------- */

function visibleRows() {
  const kw = state.filter.trim().toLowerCase();
  let rows = state.rows;
  if (state.sessionFilter) rows = rows.filter((r) => r.session === state.sessionFilter);
  if (kw) rows = rows.filter((r) => `${r.title} ${r.url} ${r.session}`.toLowerCase().includes(kw));
  const key = state.sort.key;
  const dir = state.sort.dir;
  rows = [...rows].sort((a, b) => {
    let va, vb;
    if (key === "next") {
      va = state.jobs[`${a.url}|${a.session}`] || 0;
      vb = state.jobs[`${b.url}|${b.session}`] || 0;
    } else if (key === "last") {
      va = a.last_update; vb = b.last_update;
    } else {
      va = (a.title || a.url).toLowerCase(); vb = (b.title || b.url).toLowerCase();
    }
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return 0;
  });
  return rows;
}

function renderTable() {
  const wrap = document.getElementById("tableWrap");
  const count = document.getElementById("rowCount");
  const batchBar = document.getElementById("batchBar");
  const toolbar = document.getElementById("subsToolbar");

  if (state.selected.size) {
    toolbar.hidden = true;
    batchBar.hidden = false;
    document.getElementById("batchCount").textContent = `已选 ${state.selected.size} 项`;
  } else {
    toolbar.hidden = false;
    batchBar.hidden = true;
  }

  if (state.loading) {
    wrap.replaceChildren(
      ...Array.from({ length: 6 }, () =>
        el("div", { class: "skeleton-row" },
          el("div", { class: "skeleton", style: "width:15px;height:15px" }),
          el("div", { class: "skeleton", style: "width:26px;height:26px;border-radius:7px" }),
          el("div", { class: "skeleton", style: "width:30%" }),
          el("div", { class: "skeleton", style: "flex:1" }),
          el("div", { class: "skeleton", style: "width:90px" }),
        ),
      ),
    );
    count.textContent = "";
    return;
  }
  if (state.error) {
    wrap.replaceChildren(
      el("div", { class: "error-bar" },
        el("span", { text: state.error }),
        el("button", { class: "btn small tonal", type: "button", onclick: load, text: "重试" }),
      ),
    );
    count.textContent = "";
    return;
  }

  const rows = visibleRows();
  count.textContent = state.filter || state.sessionFilter
    ? `${rows.length} / ${state.rows.length} 条`
    : `${rows.length} 条`;

  if (!rows.length) {
    wrap.replaceChildren(
      el("div", { class: "state-block" },
        iconSvg("rss"),
        el("div", { text: state.filter || state.sessionFilter ? "没有匹配的订阅" : "还没有订阅" }),
        el("div", {
          class: "hint",
          text: state.filter || state.sessionFilter ? "换个关键词或会话试试" : "点击右上角「添加订阅」，填入 RSS 地址或 RSSHub 路由",
        }),
      ),
    );
    return;
  }

  const table = el("table");
  const arrow = (k) => (state.sort.key === k ? el("span", { class: "sort-arrow", text: state.sort.dir > 0 ? "▲" : "▼" }) : null);
  const head = el("thead", {},
    el("tr", {},
      el("th", { class: "col-check" },
        el("input", {
          type: "checkbox",
          "aria-label": "全选",
          checked: rows.every((r) => state.selected.has(`${r.url}|${r.session}`)) ? "" : null,
          onchange: (ev) => {
            if (ev.target.checked) rows.forEach((r) => state.selected.add(`${r.url}|${r.session}`));
            else state.selected.clear();
            renderTable();
          },
        }),
      ),
      el("th", { class: "sortable", onclick: () => setSort("title") }, el("span", { text: "频道" }), arrow("title")),
      el("th", { text: "会话" }),
      el("th", { text: "频率" }),
      el("th", { class: "sortable col-time-next", onclick: () => setSort("next") }, el("span", { text: "下次推送" }), arrow("next")),
      el("th", { class: "sortable", onclick: () => setSort("last") }, el("span", { text: "最近检查" }), arrow("last")),
      el("th", { class: "col-actions-header", text: "操作" }),
    ),
  );
  // indeterminate state
  const headCb = head.querySelector("input");
  if (headCb) {
    const some = rows.some((r) => state.selected.has(`${r.url}|${r.session}`));
    const all = rows.every((r) => state.selected.has(`${r.url}|${r.session}`));
    headCb.indeterminate = some && !all;
  }
  table.appendChild(head);

  const tbody = el("tbody");
  for (const r of rows) {
    const key = `${r.url}|${r.session}`;
    tbody.appendChild(dataRow(r, key));
    if (state.previewKey === key) tbody.appendChild(previewRow(r));
  }
  table.appendChild(tbody);
  wrap.replaceChildren(table);
}

function setSort(k) {
  if (state.sort.key === k) state.sort.dir = -state.sort.dir;
  else state.sort = { key: k, dir: 1 };
  renderTable();
}

function dataRow(r, key) {
  const tr = el("tr", { class: `data-row${state.selected.has(key) ? " selected" : ""}` });

  tr.appendChild(
    el("td", { class: "col-check" },
      el("input", {
        type: "checkbox",
        "aria-label": "选择",
        checked: state.selected.has(key) ? "" : null,
        onchange: (ev) => {
          if (ev.target.checked) state.selected.add(key);
          else state.selected.delete(key);
          renderTable();
        },
      }),
    ),
  );

  const feedTd = el("td", { class: "col-feed" });
  if (state.feedEditKey === key) {
    const input = el("input", {
      type: "text", value: r.title || "", class: "feed-edit-input",
      style: "width:100%", placeholder: "频道显示名",
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") saveBtn.click();
      if (ev.key === "Escape") { state.feedEditKey = null; renderTable(); }
    });
    const saveBtn = el("button", { class: "btn small primary", type: "button", text: "保存" });
    saveBtn.addEventListener("click", async () => {
      const title = input.value.trim();
      if (!title) { toast("标题不能为空", "err"); return; }
      try {
        await bridge.apiPost("feed/rename", { url: r.url, title });
        state.feedEditKey = null;
        toast("已改名");
        await load();
      } catch (e) {
        toast(e.message || "改名失败", "err");
      }
    });
    feedTd.appendChild(
      el("div", { class: "feed-title" },
        el("span", { class: "feed-icon" }, iconSvg("rss")),
        el("div", { class: "cron-edit", style: "flex:1;min-width:0" }, input, saveBtn,
          el("button", { class: "btn small ghost", type: "button", onclick: () => { state.feedEditKey = null; renderTable(); }, text: "取消" }),
        ),
      ),
    );
  } else {
    feedTd.appendChild(
      el("div", { class: "feed-title" },
        el("span", { class: "feed-icon", title: r.url }, iconSvg("rss")),
        el("div", { style: "min-width:0" },
          el("div", {
            class: "feed-name feed-editable", text: r.title || r.url,
            title: "点击改名", role: "button", tabindex: "0",
            onclick: () => { state.feedEditKey = key; renderTable(); },
            onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { state.feedEditKey = key; renderTable(); } },
          }),
          el("span", { class: "feed-host", text: r.url }),
        ),
      ),
    );
  }
  tr.appendChild(feedTd);

  tr.appendChild(el("td", { class: "col-session", title: r.session, text: sessionLabel(r.session) }));

  const cronTd = el("td");
  if (state.editingKey === key) {
    const sel = el("select");
    for (const [expr, label] of CRON_PRESETS) sel.appendChild(el("option", { value: expr, text: label }));
    sel.appendChild(el("option", { value: "custom", text: "自定义…" }));
    sel.value = CRON_PRESETS.some(([e]) => e === r.cron_expr) ? r.cron_expr : "custom";
    const input = el("input", {
      type: "text", class: "cron-input", placeholder: "分 时 日 月 周",
      value: r.cron_expr, style: `display:${sel.value === "custom" ? "" : "none"};width:126px`,
    });
    sel.addEventListener("change", () => {
      input.style.display = sel.value === "custom" ? "" : "none";
      if (sel.value === "custom") input.focus();
    });
    const save = async () => {
      const cron = (sel.value === "custom" ? input.value : sel.value).trim();
      try {
        await bridge.apiPost("subscription/cron", { url: r.url, session: r.session, cron });
        state.editingKey = null;
        toast("频率已更新");
        await load();
      } catch (e) {
        toast(e.message || "更新失败", "err");
      }
    };
    cronTd.appendChild(
      el("div", { class: "cron-edit" }, sel, input,
        el("button", { class: "btn small primary", type: "button", onclick: save, text: "保存" }),
        el("button", { class: "btn small ghost", type: "button", onclick: () => { state.editingKey = null; renderTable(); }, text: "取消" }),
      ),
    );
  } else {
    cronTd.appendChild(
      el("span", { class: "cron-cell", title: r.cron_expr },
        el("span", { class: "cron-label", text: `${cronLabel(r.cron_expr)} ` }),
        r.cron_expr,
      ),
    );
  }
  tr.appendChild(cronTd);

  const next = state.jobs[key];
  const nextTd = el("td", { class: "col-time col-time-next", text: relTime(next || 0) });
  if (next && next - Date.now() / 1000 < 3600) nextTd.classList.add("soon");
  tr.appendChild(nextTd);

  tr.appendChild(el("td", { class: "col-time", text: relTime(r.last_update) }));

  const actions = el("td", { class: "col-actions" });
  const pushing = state.pushingKey === key;
  actions.appendChild(
    el("button", {
      class: "btn small ghost", type: "button", title: "立即推送一条最新摘要",
      disabled: pushing ? "" : null,
      onclick: () => pushNow(r, key),
    }, iconSvg("send"), el("span", { text: pushing ? "推送中…" : "推送" })),
  );
  actions.appendChild(
    el("button", {
      class: "btn small ghost", type: "button", title: "预览最新内容",
      onclick: () => togglePreview(key),
    }, iconSvg(state.previewKey === key ? "chevron" : "open"), el("span", { text: "预览" })),
  );
  actions.appendChild(
    el("button", {
      class: "btn small ghost", type: "button", title: "修改频率",
      onclick: () => { state.editingKey = key; state.confirmKey = null; renderTable(); },
    }, iconSvg("clock")),
  );
  if (state.confirmKey === key) {
    actions.appendChild(
      el("button", { class: "btn small danger", type: "button", onclick: () => removeSub(r), text: "确认删除" }),
      el("button", { class: "btn small ghost", type: "button", onclick: () => { state.confirmKey = null; renderTable(); }, text: "取消" }),
    );
  } else {
    actions.appendChild(
      el("button", {
        class: "btn small ghost", type: "button", title: "删除订阅",
        onclick: () => { state.confirmKey = key; renderTable(); },
      }, iconSvg("trash")),
    );
  }
  tr.appendChild(actions);
  return tr;
}

function previewRow(r) {
  const inner = el("div", { class: "preview-inner" });
  if (state.preview.loading) {
    inner.appendChild(el("div", { class: "preview-hint", text: "正在拉取最新内容…" }));
  } else if (state.preview.error) {
    inner.appendChild(el("div", { class: "preview-error", text: state.preview.error }));
  } else if (!state.preview.items.length) {
    inner.appendChild(el("div", { class: "preview-hint", text: "该源暂时拉取不到条目（可能是风控或源失效）" }));
  } else {
    const ul = el("ul", { class: "preview-list" });
    for (const it of state.preview.items) {
      ul.appendChild(
        el("li", {},
          el("a", { href: it.link, target: "_blank", rel: "noopener noreferrer", text: it.title || it.link }),
          it.pub_date ? el("span", { class: "p-date", text: it.pub_date.slice(0, 16) }) : null,
        ),
      );
    }
    inner.appendChild(ul);
  }
  if (r && r.latest_link && !state.preview.loading) {
    inner.appendChild(
      el("div", { class: "latest-pushed" },
        el("span", { text: "最近已推送：" }),
        el("a", { href: r.latest_link, target: "_blank", rel: "noopener noreferrer", text: r.latest_link }),
      ),
    );
  }
  const body = el("div", { class: "preview-body open" }, inner);
  return el("tr", { class: "preview-row" }, el("td", { colspan: "7" }, body));
}

async function togglePreview(key) {
  if (state.previewKey === key) {
    state.previewKey = null;
    renderTable();
    return;
  }
  state.previewKey = key;
  state.preview = { items: [], loading: true, error: null };
  renderTable();
  const url = key.split("|")[0];
  try {
    const items = await bridge.apiGet("preview", { url });
    state.preview = { items: items || [], loading: false, error: null };
  } catch (e) {
    state.preview = { items: [], loading: false, error: e.message || "拉取失败" };
  }
  if (state.previewKey === key) renderTable();
}

async function pushNow(r, key) {
  state.pushingKey = key;
  renderTable();
  try {
    const res = await bridge.apiPost("push", { url: r.url, session: r.session });
    toast(`已推送 ${res.pushed} 条最新内容`);
  } catch (e) {
    toast(e.message || "推送失败", "err");
  } finally {
    state.pushingKey = null;
    if (state.previewKey === key || true) renderTable();
  }
}

async function removeSub(r) {
  try {
    await bridge.apiPost("subscription/delete", { url: r.url, session: r.session });
    state.confirmKey = null;
    state.previewKey = null;
    state.selected.delete(`${r.url}|${r.session}`);
    toast(`已删除「${r.title || r.url}」`);
    await load();
  } catch (e) {
    toast(e.message || "删除失败", "err");
  }
}

async function batchDelete() {
  const items = [...state.selected].map((k) => {
    const [url, ...rest] = k.split("|");
    return { url, session: rest.join("|") };
  });
  if (!items.length) return;
  try {
    const res = await bridge.apiPost("subscription/delete-batch", { items });
    state.selected.clear();
    toast(`已删除 ${res.removed} 条订阅`);
    await load();
  } catch (e) {
    toast(e.message || "批量删除失败", "err");
  }
}

/* ---------- add form ---------- */

async function verifyUrl() {
  const input = document.getElementById("addUrl");
  const out = document.getElementById("verifyResult");
  const url = input.value.trim();
  state.verified = null;
  if (!url) {
    out.className = "verify-result err";
    out.textContent = "先填地址";
    return;
  }
  out.className = "verify-result";
  out.textContent = "验证中…";
  try {
    const items = await bridge.apiGet("preview", { url });
    state.verified = { url };
    out.className = "verify-result ok";
    out.textContent = items?.length
      ? `✓ 可用，最新一条：${(items[0].title || "").slice(0, 40)}`
      : "✓ 地址可访问，但当前拉不到条目";
  } catch (e) {
    out.className = "verify-result err";
    out.textContent = e.message || "验证失败";
  }
}

/* ---------- endpoints tab ---------- */

function renderEndpoints() {
  const wrap = document.getElementById("endpointWrap");
  const eps = state.endpoints.endpoints || [];
  if (!eps.length) {
    wrap.replaceChildren(
      el("div", { class: "state-block" },
        iconSvg("server"),
        el("div", { text: "还没有 RSSHub 端点" }),
        el("div", { class: "hint", text: "至少添加一个端点，「/路由」的简写才能用" }),
      ),
    );
    return;
  }
  wrap.replaceChildren(
    ...eps.map((u, i) =>
      el("div", { class: "endpoint-row" },
        el("span", { class: "badge", text: i === 0 ? "默认" : `#${i}` }),
        el("span", { class: "endpoint-url", text: u }),
        el("span", { style: "flex:1" }),
        el("button", {
          class: "btn small ghost", type: "button", title: "删除端点",
          onclick: async () => {
            try {
              await bridge.apiPost("endpoint/delete", { url: u });
              toast("端点已删除");
              await loadEndpoints();
            } catch (e) {
              toast(e.message || "删除失败", "err");
            }
          },
        }, iconSvg("trash")),
      ),
    ),
  );
}

async function loadEndpoints() {
  try {
    state.endpoints = await bridge.apiGet("endpoints");
  } catch (e) {
    state.endpoints = { endpoints: [], default: "" };
  }
  renderEndpoints();
}

/* ---------- settings tab ---------- */

function fillSettings() {
  const s = state.settings;
  if (!s) return;
  document.getElementById("setAiSummary").checked = !!s.ai_summary;
  document.getElementById("setAiPrompt").value = s.ai_summary_prompt || "";
  document.getElementById("setAiPrompt").placeholder = s.ai_summary_prompt_default || "";
  document.getElementById("setMaxItems").value = s.max_items_per_poll ?? "";
  document.getElementById("setTitleMax").value = s.title_max_length ?? "";
  document.getElementById("setDescMax").value = s.description_max_length ?? "";
  document.getElementById("setT2i").checked = !!s.t2i;
  document.getElementById("setHideUrl").checked = !!s.is_hide_url;
  document.getElementById("setCompose").checked = !!s.compose;
  document.getElementById("setReadPic").checked = !!s.pic_config?.is_read_pic;
  document.getElementById("setAdjustPic").checked = !!s.pic_config?.is_adjust_pic;
  document.getElementById("setMaxPic").value = s.pic_config?.max_pic_item ?? "";
}

async function loadSettings() {
  try {
    state.settings = await bridge.apiGet("settings");
    fillSettings();
  } catch (e) {
    /* settings tab shows empty; save will error clearly */
  }
}

async function saveSettings() {
  const num = (id) => {
    const v = document.getElementById(id).value.trim();
    return v === "" ? null : Number(v);
  };
  const payload = {
    ai_summary: document.getElementById("setAiSummary").checked,
    ai_summary_prompt: document.getElementById("setAiPrompt").value,
    title_max_length: num("setTitleMax"),
    description_max_length: num("setDescMax"),
    max_items_per_poll: num("setMaxItems"),
    t2i: document.getElementById("setT2i").checked,
    is_hide_url: document.getElementById("setHideUrl").checked,
    compose: document.getElementById("setCompose").checked,
    pic_config: {
      is_read_pic: document.getElementById("setReadPic").checked,
      is_adjust_pic: document.getElementById("setAdjustPic").checked,
      max_pic_item: num("setMaxPic"),
    },
  };
  for (const k of Object.keys(payload)) {
    if (payload[k] === null || payload[k] === undefined) delete payload[k];
  }
  for (const k of Object.keys(payload.pic_config || {})) {
    if (payload.pic_config[k] === null) delete payload.pic_config[k];
  }
  const btn = document.getElementById("settingsSave");
  const hint = document.getElementById("saveHint");
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    await bridge.apiPost("settings/save", payload);
    hint.textContent = "";
    toast("设置已保存");
    state.summary = await bridge.apiGet("summary");
    renderHead();
  } catch (e) {
    hint.textContent = "";
    toast(e.message || "保存失败", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "保存设置";
  }
}

/* ---------- load all ---------- */

async function load() {
  state.loading = true;
  state.error = null;
  renderHead();
  renderTable();
  try {
    const [summary, rows, jobs] = await Promise.all([
      bridge.apiGet("summary"),
      bridge.apiGet("subscriptions"),
      bridge.apiGet("jobs"),
    ]);
    state.summary = summary;
    state.rows = rows || [];
    state.jobs = Object.fromEntries((jobs || []).map((j) => [`${j.url}|${j.session}`, j.next_run]));
    state.loading = false;
  } catch (e) {
    state.loading = false;
    state.error = e.message || "加载失败";
  }
  renderHead();
  renderTable();
}

/* ---------- wire up ---------- */

for (const t of document.querySelectorAll(".tab")) {
  t.addEventListener("click", () => switchTab(t.dataset.tab));
}

document.getElementById("refreshBtn").addEventListener("click", () => {
  load();
  loadEndpoints();
  loadSettings();
});

document.getElementById("addBtn").addEventListener("click", () => {
  state.addOpen = !state.addOpen;
  document.getElementById("addPanel").hidden = !state.addOpen;
  if (state.addOpen) document.getElementById("addUrl").focus();
});
document.getElementById("addCancel").addEventListener("click", () => {
  state.addOpen = false;
  document.getElementById("addPanel").hidden = true;
});
document.getElementById("verifyBtn").addEventListener("click", verifyUrl);

const cronSel = document.getElementById("addCron");
const cronCustom = document.getElementById("addCronCustom");
cronSel.addEventListener("change", () => {
  cronCustom.hidden = cronSel.value !== "custom";
  if (!cronCustom.hidden) cronCustom.focus();
});

document.getElementById("addForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const url = document.getElementById("addUrl").value.trim();
  const session = document.getElementById("addSession").value.trim();
  const cron = (cronSel.value === "custom" ? cronCustom.value : cronSel.value).trim();
  if (!url || !session || !cron) {
    toast("请把地址、会话、频率都填上", "err");
    return;
  }
  const btn = document.getElementById("addSubmit");
  btn.disabled = true;
  btn.textContent = "订阅中…";
  try {
    const res = await bridge.apiPost("subscription", { url, session, cron });
    toast(`已订阅「${res.title || url}」`);
    document.getElementById("addUrl").value = "";
    document.getElementById("verifyResult").textContent = "";
    state.verified = null;
    state.addOpen = false;
    document.getElementById("addPanel").hidden = true;
    await load();
  } catch (e) {
    toast(e.message || "订阅失败", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "订阅";
  }
});

document.getElementById("searchInput").addEventListener("input", (ev) => {
  state.filter = ev.target.value;
  renderTable();
});
document.getElementById("sessionFilter").addEventListener("change", (ev) => {
  state.sessionFilter = ev.target.value;
  renderTable();
});
document.getElementById("batchCancel").addEventListener("click", () => {
  state.selected.clear();
  renderTable();
});
document.getElementById("batchDelete").addEventListener("click", batchDelete);

document.getElementById("endpointForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = document.getElementById("endpointUrl");
  const url = input.value.trim();
  if (!url) return;
  try {
    await bridge.apiPost("endpoint/add", { url });
    input.value = "";
    toast("端点已添加");
    await loadEndpoints();
    state.summary = await bridge.apiGet("summary");
    renderHead();
  } catch (e) {
    toast(e.message || "添加失败", "err");
  }
});

document.getElementById("settingsSave").addEventListener("click", saveSettings);
document.getElementById("promptReset").addEventListener("click", () => {
  document.getElementById("setAiPrompt").value = "";
  toast("已清空，保存后使用默认提示词");
});

async function main() {
  await bridge.ready();
  document.title = bridge.t("views.dashboard.title", "RSS 订阅管理");
  document.getElementById("pageTitle").textContent = bridge.t("views.dashboard.title", "RSS 订阅");
  bridge.onContext(() => {
    document.title = bridge.t("views.dashboard.title", "RSS 订阅管理");
  });
  await Promise.all([load(), loadEndpoints(), loadSettings()]);
}

main();
