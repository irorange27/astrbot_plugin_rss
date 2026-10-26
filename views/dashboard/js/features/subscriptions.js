import { state } from "../core/state.js";
import * as api from "../core/api.js";
import { el } from "../core/dom.js";
import { iconSvg } from "../core/icons.js";
import { sessionLabel, relTime } from "../core/format.js";
import { toast } from "../components/toast.js";
import { createDropdown } from "../components/dropdown.js";
import { CRON_PRESETS, cronDropdown, cronLabel } from "../components/cron.js";
import { attachCombobox } from "../components/combobox.js";

export function renderHead() {
  const s = state.summary;
  document.getElementById("statLine").textContent = state.loading
    ? "正在加载…"
    : state.error
      ? "加载失败"
      : s
        ? `${s.feeds} 个订阅源 · ${s.subscriptions} 条订阅 · AI 摘要${s.ai_summary ? "已开启" : "已关闭"} · ${s.sessions.length} 个会话`
        : "";
  if (state.sessDrop) {
    state.sessDrop.setOptions([
      { value: "", label: "全部会话" },
      ...(state.summary?.sessions || []).map((s) => ({
        value: s.origin,
        label: `${sessionLabel(s.origin)} (${s.count})`,
      })),
    ]);
  }
  if (state.catDrop) {
    const cats = state.summary?.categories || [];
    state.catDrop.setOptions([
      { value: "", label: "全部类别" },
      ...cats.map((c) => ({ value: c, label: c })),
    ]);
  }
}

function visibleRows() {
  const kw = state.filter.trim().toLowerCase();
  let rows = state.rows;
  if (state.categoryFilter) {
    rows = rows.filter((r) => (r.category || "") === state.categoryFilter);
  }
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
  count.textContent = state.filter || state.sessionFilter || state.categoryFilter
    ? `${rows.length} / ${state.rows.length} 条`
    : `${rows.length} 条`;

  if (!rows.length) {
    wrap.replaceChildren(
      el("div", { class: "state-block" },
        iconSvg("rss"),
        el("div", { text: state.filter || state.sessionFilter || state.categoryFilter ? "没有匹配的订阅" : "还没有订阅" }),
        el("div", {
          class: "hint",
          text: state.filter || state.sessionFilter || state.categoryFilter ? "换个关键词或筛选试试" : "点击右上角「添加订阅」，填入 RSS 地址或 RSSHub 路由",
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
      el("th", { class: "col-session", text: "会话" }),
      el("th", { text: "频率" }),
      el("th", { class: "sortable col-time-next", onclick: () => setSort("next") }, el("span", { text: "下次推送" }), arrow("next")),
      el("th", { class: "sortable col-last", onclick: () => setSort("last") }, el("span", { text: "最近检查" }), arrow("last")),
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
  // group rows by category; uncategorized last, groups sorted by name
  const groups = new Map();
  for (const r of rows) {
    const cat = r.category || "";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(r);
  }
  const catNames = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b, "zh");
  });
  const gt = document.getElementById("groupToggle");
  if (catNames.length > 1) {
    const anyCollapsed = catNames.some((c) => state.collapsed.has(c));
    gt.replaceChildren(
      el("button", {
        class: "btn small tonal icon-only", type: "button",
        "aria-label": anyCollapsed ? "展开全部分组" : "收起全部分组",
        title: anyCollapsed ? "展开全部分组" : "收起全部分组",
        onclick: () => {
          if (anyCollapsed) state.collapsed.clear();
          else catNames.forEach((c) => state.collapsed.add(c));
          renderTable();
        },
      },
        iconSvg(anyCollapsed ? "unfoldMore" : "unfoldLess"),
      ),
    );
  } else {
    gt.replaceChildren();
  }

  for (const cat of catNames) {
    const items = groups.get(cat);
    const collapsed = state.collapsed.has(cat);
    const chevron = iconSvg("chevron");
    chevron.setAttribute("class", `group-chevron${collapsed ? " collapsed" : ""}`);
    tbody.appendChild(
      el("tr", {
        class: "group-row",
        role: "button",
        tabindex: "0",
        "aria-expanded": collapsed ? "false" : "true",
        onclick: () => {
          if (collapsed) state.collapsed.delete(cat);
          else state.collapsed.add(cat);
          renderTable();
        },
        onkeydown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            if (collapsed) state.collapsed.delete(cat);
            else state.collapsed.add(cat);
            renderTable();
          }
        },
      },
        el("td", { colspan: "7" },
          el("span", { class: "group-head" },
            chevron,
            el("span", { class: "group-name", text: cat || "未分类" }),
            el("span", { class: "group-count", text: `${items.length} 个源` }),
          ),
        ),
      ),
    );
    if (collapsed) continue;
    for (const r of items) {
      const key = `${r.url}|${r.session}`;
      tbody.appendChild(dataRow(r, key));
      if (state.previewKey === key) tbody.appendChild(previewRow(r, key));
    }
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
        await api.apiPost("feed/rename", { url: r.url, title });
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
        el("span", { class: "feed-icon" }, iconSvg("rss")),
        el("div", { style: "min-width:0" },
          el("div", {
            class: "feed-name feed-editable", text: r.title || r.url,
            title: "点击改名", role: "button", tabindex: "0",
            onclick: () => { state.feedEditKey = key; renderTable(); },
            onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { state.feedEditKey = key; renderTable(); } },
          }),
          el("span", { class: "feed-host", text: r.url, title: r.url }),
        ),
      ),
    );
  }
  tr.appendChild(feedTd);

  tr.appendChild(
    el("td", { class: "col-session" },
      el("span", { class: "session-label", text: sessionLabel(r.session) }),
      el("span", { class: "session-raw", text: r.session, title: r.session }),
    ),
  );

  const cronTd = el("td");
  if (state.editingKey === key) {
    const isPreset = CRON_PRESETS.some(([e]) => e === r.cron_expr);
    const input = el("input", {
      type: "text", class: "cron-input", placeholder: "分 时 日 月 周",
      value: r.cron_expr, style: `display:${isPreset ? "none" : ""};width:126px`,
    });
    const cronDrop = cronDropdown(isPreset ? r.cron_expr : "custom", (v) => {
      input.style.display = v === "custom" ? "" : "none";
      if (v === "custom") input.focus();
    });
    const save = async () => {
      const cron = (cronDrop.value === "custom" ? input.value : cronDrop.value).trim();
      try {
        await api.apiPost("subscription/cron", { url: r.url, session: r.session, cron });
        state.editingKey = null;
        toast("频率已更新");
        await load();
      } catch (e) {
        toast(e.message || "更新失败", "err");
      }
    };
    cronTd.appendChild(
      el("div", { class: "cron-edit" }, cronDrop.el, input,
        el("button", { class: "btn small primary", type: "button", onclick: save, text: "保存" }),
        el("button", { class: "btn small ghost", type: "button", onclick: () => { state.editingKey = null; renderTable(); }, text: "取消" }),
      ),
    );
  } else {
    cronTd.appendChild(
      el("span", { class: "cron-cell", title: r.cron_expr },
        el("span", { class: "cron-label", text: cronLabel(r.cron_expr) }),
        el("span", { class: "cron-expr", text: r.cron_expr }),
      ),
    );
  }
  tr.appendChild(cronTd);

  const next = state.jobs[key];
  const nextTd = el("td", { class: "col-time col-time-next", text: relTime(next || 0) });
  if (next && next - Date.now() / 1000 < 3600) nextTd.classList.add("soon");
  tr.appendChild(nextTd);

  tr.appendChild(el("td", { class: "col-time col-last", text: relTime(r.last_update), title: r.last_update ? new Date(r.last_update * 1000).toLocaleString() : "" }));

  const actions = el("td", { class: "col-actions" });
  const pushing = state.pushingKey === key;
  actions.appendChild(
    el("button", {
      class: `btn small ghost expand-toggle${state.previewKey === key ? " open" : ""}`,
      type: "button",
      title: state.previewKey === key ? "收起详情" : "展开详情与预览",
      onclick: () => togglePreview(key),
    }, iconSvg("chevron")),
  );
  actions.appendChild(
    el("button", {
      class: "btn small ghost", type: "button", title: "立即推送一条最新摘要",
      disabled: pushing ? "" : null,
      onclick: () => pushNow(r, key),
    }, iconSvg("send")),
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
    );
    actions.appendChild(
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

function previewRow(r, key) {
  const inner = el("div", { class: "preview-inner" });

  // detail meta: full url, raw session, watermark
  const meta = el("div", { class: "detail-meta" });
  meta.appendChild(
    el("div", { class: "meta-row" },
      el("span", { class: "meta-k", text: "地址" }),
      el("a", { class: "meta-v mono", href: r.url, target: "_blank", rel: "noopener noreferrer", text: r.url }),
    ),
  );
  meta.appendChild(
    el("div", { class: "meta-row" },
      el("span", { class: "meta-k", text: "会话" }),
      el("span", { class: "meta-v mono", text: r.session }),
    ),
  );
  if (state.catEditKey === key) {
    const input = el("input", {
      type: "text", value: r.category || "",
      placeholder: "类别，留空为未分类", class: "cat-input",
    });
    attachCombobox(input, () => state.summary?.categories || []);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") catSave.click();
      if (ev.key === "Escape") { state.catEditKey = null; renderTable(); }
    });
    const catSave = el("button", { class: "btn small primary", type: "button", text: "保存" });
    catSave.addEventListener("click", async () => {
      try {
        await api.apiPost("feed/category", { url: r.url, category: input.value.trim() });
        state.catEditKey = null;
        toast("类别已更新");
        await load();
      } catch (e) {
        toast(e.message || "更新失败", "err");
      }
    });
    meta.appendChild(
      el("div", { class: "meta-row" },
        el("span", { class: "meta-k", text: "类别" }),
        input, catSave,
        el("button", { class: "btn small ghost", type: "button", onclick: () => { state.catEditKey = null; renderTable(); }, text: "取消" }),
      ),
    );
  } else {
    meta.appendChild(
      el("div", { class: "meta-row" },
        el("span", { class: "meta-k", text: "类别" }),
        el("a", {
          class: "meta-v cat-editable", role: "button", tabindex: "0",
          text: r.category || "未分类（点击设置）", title: "点击修改类别",
          onclick: () => { state.catEditKey = key; renderTable(); },
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { state.catEditKey = key; renderTable(); } },
        }),
      ),
    );
  }
  meta.appendChild(
    el("div", { class: "meta-row" },
      el("span", { class: "meta-k", text: "cron" }),
      el("span", { class: "meta-v mono", text: r.cron_expr }),
    ),
  );
  meta.appendChild(
    el("div", { class: "meta-row" },
      el("span", { class: "meta-k", text: "水位" }),
      r.last_update
        ? el("span", { class: "meta-v", text: `${new Date(r.last_update * 1000).toLocaleString()}（${relTime(r.last_update)}）` })
        : el("span", { class: "meta-v", text: "—" }),
    ),
  );
  if (r.latest_link) {
    meta.appendChild(
      el("div", { class: "meta-row" },
        el("span", { class: "meta-k", text: "最近推送" }),
        el("a", { class: "meta-v mono link-clip", href: r.latest_link, target: "_blank", rel: "noopener noreferrer", text: r.latest_link }),
      ),
    );
  }
  inner.appendChild(meta);

  const listHead = el("div", { class: "preview-head", text: "最新条目" });
  inner.appendChild(listHead);

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
    const items = await api.apiGet("preview", { url });
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
    const res = await api.apiPost("push", { url: r.url, session: r.session });
    toast(`已推送 ${res.pushed} 条最新内容`);
  } catch (e) {
    toast(e.message || "推送失败", "err");
  } finally {
    state.pushingKey = null;
    renderTable();
  }
}

async function removeSub(r) {
  try {
    await api.apiPost("subscription/delete", { url: r.url, session: r.session });
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
    const res = await api.apiPost("subscription/delete-batch", { items });
    state.selected.clear();
    toast(`已删除 ${res.removed} 条订阅`);
    await load();
  } catch (e) {
    toast(e.message || "批量删除失败", "err");
  }
}

export async function load() {
  state.loading = true;
  state.error = null;
  renderHead();
  renderTable();
  try {
    const [summary, rows, jobs] = await Promise.all([
      api.apiGet("summary"),
      api.apiGet("subscriptions"),
      api.apiGet("jobs"),
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

// Bind everything belonging to the subscriptions tab (toolbar, filters, batch bar).
export function init() {
  state.sessDrop = createDropdown({
    options: [{ value: "", label: "全部会话" }],
    value: "",
    onChange: (v) => { state.sessionFilter = v; renderTable(); },
  });
  document.getElementById("sessionFilter").replaceChildren(state.sessDrop.el);
  state.catDrop = createDropdown({
    options: [{ value: "", label: "全部类别" }],
    value: "",
    onChange: (v) => { state.categoryFilter = v; renderTable(); },
  });
  document.getElementById("categoryFilter").replaceChildren(state.catDrop.el);

  document.getElementById("searchInput").addEventListener("input", (ev) => {
    state.filter = ev.target.value;
    renderTable();
  });
  document.getElementById("batchCancel").addEventListener("click", () => {
    state.selected.clear();
    renderTable();
  });
  document.getElementById("batchDelete").addEventListener("click", batchDelete);
}
