import { state } from "../core/state.js";
import * as api from "../core/api.js";
import { el } from "../core/dom.js";
import { iconSvg } from "../core/icons.js";
import { toast } from "../components/toast.js";
import { load, renderHead } from "./subscriptions.js";

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
              await api.apiPost("endpoint/delete", { url: u });
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

export async function loadEndpoints() {
  try {
    state.endpoints = await api.apiGet("endpoints");
  } catch (e) {
    state.endpoints = { endpoints: [], default: "" };
  }
  renderEndpoints();
}

export function init() {
  document.getElementById("endpointForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = document.getElementById("endpointUrl");
    const url = input.value.trim();
    if (!url) return;
    try {
      await api.apiPost("endpoint/add", { url });
      input.value = "";
      toast("端点已添加");
      await loadEndpoints();
      state.summary = await api.apiGet("summary");
      renderHead();
    } catch (e) {
      toast(e.message || "添加失败", "err");
    }
  });
}
