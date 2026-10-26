import { state } from "../core/state.js";
import * as api from "../core/api.js";
import { el } from "../core/dom.js";
import { toast } from "../components/toast.js";
import { cronDropdown } from "../components/cron.js";
import { attachCombobox } from "../components/combobox.js";
import { load } from "./subscriptions.js";

const cronCustom = document.getElementById("addCronCustom");
let cronDrop = null;

function expandUrl(v) {
  v = (v || "").trim();
  if (v.startsWith("/") && state.endpoints.endpoints?.length) {
    return state.endpoints.endpoints[0].replace(/\/$/, "") + v;
  }
  return v;
}

async function verifyUrl() {
  const input = document.getElementById("addUrl");
  input.value = expandUrl(input.value);
  const out = document.getElementById("verifyResult");
  const wrap = document.getElementById("modalPreview");
  const body = document.getElementById("modalPreviewBody");
  const url = input.value.trim();
  state.verified = null;
  if (!url) {
    out.className = "verify-result err";
    out.textContent = "先填地址";
    wrap.hidden = true;
    return;
  }
  out.className = "verify-result";
  out.textContent = "验证中…";
  wrap.hidden = false;
  body.replaceChildren(el("div", { class: "preview-hint", text: "正在拉取…" }));
  try {
    const items = await api.apiGet("preview", { url });
    state.verified = { url };
    if (items?.length) {
      out.className = "verify-result ok";
      out.textContent = `✓ 可用，共拉到 ${items.length} 条`;
      const ul = el("ul", { class: "preview-list" });
      for (const it of items) {
        ul.appendChild(
          el("li", {},
            el("a", { href: it.link, target: "_blank", rel: "noopener noreferrer", text: it.title || it.link }),
            it.pub_date ? el("span", { class: "p-date", text: it.pub_date.slice(0, 16) }) : null,
          ),
        );
      }
      body.replaceChildren(ul);
    } else {
      out.className = "verify-result ok";
      out.textContent = "✓ 地址可访问，但当前拉不到条目";
      body.replaceChildren(el("div", { class: "preview-hint", text: "没有条目（可能是风控或源失效）" }));
    }
  } catch (e) {
    out.className = "verify-result err";
    out.textContent = e.message || "验证失败";
    body.replaceChildren(el("div", { class: "preview-error", text: e.message || "拉取失败" }));
  }
}

function closeAdd() {
  const modal = document.getElementById("addModal");
  modal.hidden = true;
  document.getElementById("addUrl").value = "";
  document.getElementById("addCategory").value = "";
  document.getElementById("addSession").value = "";
  cronDrop.setValue("0 */2 * * *");
  cronCustom.hidden = true;
  cronCustom.value = "";
  document.getElementById("verifyResult").textContent = "";
  document.getElementById("verifyResult").className = "verify-result";
  document.getElementById("modalPreview").hidden = true;
  document.getElementById("modalPreviewBody").replaceChildren();
  state.verified = null;
}

export function init() {
  const addModal = document.getElementById("addModal");

  cronDrop = cronDropdown("0 */2 * * *", (v) => {
    cronCustom.hidden = v !== "custom";
    if (v === "custom") cronCustom.focus();
  });
  document.getElementById("addCronSel").replaceChildren(cronDrop.el);
  state.cronDrop = cronDrop;

  attachCombobox(document.getElementById("addCategory"), () => state.summary?.categories || []);
  attachCombobox(document.getElementById("addSession"), () =>
    (state.summary?.sessions || []).map((s) => s.origin),
  );

  document.getElementById("addBtn").addEventListener("click", () => {
    addModal.hidden = false;
    document.getElementById("addUrl").focus();
  });
  document.getElementById("modalClose").addEventListener("click", closeAdd);
  document.getElementById("addCancel").addEventListener("click", closeAdd);
  addModal.addEventListener("click", (ev) => {
    if (ev.target === addModal) closeAdd();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !addModal.hidden) closeAdd();
  });
  document.getElementById("verifyBtn").addEventListener("click", verifyUrl);

  document.getElementById("addUrl").addEventListener("change", (ev) => {
    const expanded = expandUrl(ev.target.value);
    if (expanded !== ev.target.value.trim()) ev.target.value = expanded;
  });

  document.getElementById("addForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const url = expandUrl(document.getElementById("addUrl").value);
    const session = document.getElementById("addSession").value.trim();
    const dropVal = cronDrop.value;
    const cron = (dropVal === "custom" ? cronCustom.value : dropVal).trim();
    if (!url || !session || !cron) {
      toast("请把地址、会话、频率都填上", "err");
      return;
    }
    const category = document.getElementById("addCategory").value.trim();
    const btn = document.getElementById("addSubmit");
    btn.disabled = true;
    btn.textContent = "订阅中…";
    try {
      const res = await api.apiPost("subscription", { url, session, cron, category });
      toast(`已订阅「${res.title || url}」`);
      closeAdd();
      await load();
    } catch (e) {
      toast(e.message || "订阅失败", "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "订阅";
    }
  });
}
