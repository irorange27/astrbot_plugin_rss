const bridge = window.AstrBotPluginView;

const state = {
  summary: null,
  rows: [],
  filter: "",
  loading: true,
  error: null,
  addOpen: false,
  editingKey: null, // `${url}|${session}`
  confirmKey: null, // two-step delete confirm
  previewKey: null,
  preview: { items: [], loading: false, error: null },
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
  rss:
    "M6.18 20a2.18 2.18 0 11-4.36 0 2.18 2.18 0 014.36 0zM2 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z",
  trash:
    "M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  clock:
    "M12 2a10 10 0 100 20 10 10 0 000-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z",
  chevron: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  open: "M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
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

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function relTime(ts) {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 0) return "刚刚";
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

let toastTimer = null;
function toast(msg, type = "ok") {
  const node = document.getElementById("toast");
  node.textContent = msg;
  node.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = "toast"), 2600);
}

function statLine() {
  const s = state.summary;
  if (!s) return "";
  const bits = [
    `${s.feeds} 个订阅源`,
    `${s.subscriptions} 条订阅关系`,
    `AI 摘要${s.ai_summary ? "已开启" : "已关闭"}`,
  ];
  if (s.sessions.length) bits.push(`${s.sessions.length} 个会话`);
  return bits.join(" · ");
}

function renderHead() {
  document.getElementById("statLine").textContent = state.loading
    ? "正在加载…"
    : state.error
      ? "加载失败"
      : statLine();
  const list = document.getElementById("sessionList");
  list.replaceChildren(
    ...(state.summary?.sessions || []).map((s) =>
      el("option", { value: s.origin, text: `${sessionLabel(s.origin)}（${s.count} 个源）` }),
    ),
  );
}

function renderTable() {
  const wrap = document.getElementById("tableWrap");
  const count = document.getElementById("rowCount");

  if (state.loading) {
    wrap.replaceChildren(
      ...Array.from({ length: 6 }, () =>
        el("div", { class: "skeleton-row" },
          el("div", { class: "skeleton", style: "width:26px;height:26px;border-radius:7px" }),
          el("div", { class: "skeleton", style: "width:32%" }),
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

  const kw = state.filter.trim().toLowerCase();
  const rows = kw
    ? state.rows.filter((r) =>
        `${r.title} ${r.url} ${r.session}`.toLowerCase().includes(kw),
      )
    : state.rows;
  count.textContent = kw ? `${rows.length} / ${state.rows.length} 条` : `${rows.length} 条`;

  if (!rows.length) {
    wrap.replaceChildren(
      el("div", { class: "state-block" },
        iconSvg("rss"),
        el("div", { text: kw ? "没有匹配的订阅" : "还没有订阅" }),
        el("div", {
          class: "hint",
          text: kw ? "换个关键词试试" : "点击右上角「添加订阅」，填入 RSS 地址或 RSSHub 路由",
        }),
      ),
    );
    return;
  }

  const table = el("table");
  table.appendChild(
    el("thead", {},
      el("tr", {},
        el("th", { text: "频道" }),
        el("th", { text: "会话" }),
        el("th", { text: "频率" }),
        el("th", { text: "最近检查" }),
        el("th", { class: "col-actions-header", text: "操作" }),
      ),
    ),
  );
  const tbody = el("tbody");
  for (const r of rows) {
    const key = `${r.url}|${r.session}`;
    tbody.appendChild(dataRow(r, key));
    if (state.previewKey === key) tbody.appendChild(previewRow(r, key));
  }
  table.appendChild(tbody);
  wrap.replaceChildren(table);
}

function dataRow(r, key) {
  const tr = el("tr", { class: "data-row" });

  // feed
  tr.appendChild(
    el("td", { class: "col-feed" },
      el("div", { class: "feed-title" },
        el("span", { class: "feed-icon", title: r.url }, iconSvg("rss")),
        el("div", { style: "min-width:0" },
          el("div", { class: "feed-name", text: r.title || r.url }),
          el("span", { class: "feed-host", text: r.url }),
        ),
      ),
    ),
  );

  // session
  tr.appendChild(el("td", { class: "col-session", title: r.session, text: sessionLabel(r.session) }));

  // cron / inline editor
  const cronTd = el("td");
  if (state.editingKey === key) {
    const sel = el("select");
    for (const [expr, label] of CRON_PRESETS) {
      sel.appendChild(el("option", { value: expr, text: label }));
    }
    sel.appendChild(el("option", { value: "custom", text: "自定义…" }));
    const input = el("input", {
      type: "text",
      class: "cron-input",
      placeholder: "分 时 日 月 周",
      value: r.cron_expr,
      style: "display:none;width:130px;font-family:var(--mono)",
    });
    sel.value = CRON_PRESETS.some(([e]) => e === r.cron_expr) ? r.cron_expr : "custom";
    if (sel.value === "custom") input.style.display = "";
    sel.addEventListener("change", () => {
      input.style.display = sel.value === "custom" ? "" : "none";
      input.focus();
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
        el("button", {
          class: "btn small ghost", type: "button",
          onclick: () => { state.editingKey = null; renderTable(); },
          text: "取消",
        }),
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

  // last update
  tr.appendChild(el("td", { class: "col-time", text: relTime(r.last_update) }));

  // actions
  const actions = el("td", { class: "col-actions" });
  actions.appendChild(
    el("button", {
      class: `btn small ghost`, type: "button", title: "预览最新内容",
      onclick: () => togglePreview(key),
    }, iconSvg(state.previewKey === key ? "chevron" : "open"), el("span", { text: "预览" })),
  );
  actions.appendChild(
    el("button", {
      class: "btn small ghost", type: "button", title: "修改频率",
      onclick: () => { state.editingKey = key; state.confirmKey = null; renderTable(); },
    }, iconSvg("clock"), el("span", { text: "频率" })),
  );
  if (state.confirmKey === key) {
    actions.appendChild(
      el("button", {
        class: "btn small danger", type: "button",
        onclick: () => removeSub(r),
        text: "确认删除",
      }),
    );
    actions.appendChild(
      el("button", {
        class: "btn small ghost", type: "button",
        onclick: () => { state.confirmKey = null; renderTable(); },
        text: "取消",
      }),
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

function previewRow(r, key) {
  const td = el("td", { colspan: "5" });
  const body = el("div", { class: "preview-body open" });
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
  body.appendChild(inner);
  td.appendChild(body);
  return el("tr", { class: "preview-row" }, td);
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

async function removeSub(r) {
  try {
    await bridge.apiPost("subscription/delete", { url: r.url, session: r.session });
    state.confirmKey = null;
    state.previewKey = null;
    toast(`已删除「${r.title || r.url}」`);
    await load();
  } catch (e) {
    toast(e.message || "删除失败", "err");
  }
}

async function load() {
  state.loading = true;
  state.error = null;
  renderHead();
  renderTable();
  try {
    const [summary, rows] = await Promise.all([
      bridge.apiGet("summary"),
      bridge.apiGet("subscriptions"),
    ]);
    state.summary = summary;
    state.rows = rows || [];
    state.loading = false;
  } catch (e) {
    state.loading = false;
    state.error = e.message || "加载失败";
  }
  renderHead();
  renderTable();
}

// ---- wire up ----

document.getElementById("refreshBtn").addEventListener("click", load);

document.getElementById("addBtn").addEventListener("click", () => {
  state.addOpen = !state.addOpen;
  const panel = document.getElementById("addPanel");
  panel.hidden = !state.addOpen;
  if (state.addOpen) document.getElementById("addUrl").focus();
});

document.getElementById("addCancel").addEventListener("click", () => {
  state.addOpen = false;
  document.getElementById("addPanel").hidden = true;
});

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
    toast(`已订阅「${res.title || url}」，下次触发时生效`);
    document.getElementById("addUrl").value = "";
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

async function main() {
  const ctx = await bridge.ready();
  document.title = bridge.t("views.dashboard.title", "RSS 订阅管理");
  document.getElementById("pageTitle").textContent = bridge.t(
    "views.dashboard.title",
    "RSS 订阅",
  );
  bridge.onContext(() => {
    document.title = bridge.t("views.dashboard.title", "RSS 订阅管理");
  });
  await load();
}

main();
