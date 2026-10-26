import { state } from "../core/state.js";
import * as api from "../core/api.js";
import { toast } from "../components/toast.js";
import { load, renderHead } from "./subscriptions.js";

function fillSettings() {
  const s = state.settings;
  if (!s) return;
  document.getElementById("setAiSummary").checked = !!s.ai_summary;
  document.getElementById("setAiPrompt").value = s.ai_summary_prompt || "";
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

export async function loadSettings() {
  try {
    state.settings = await api.apiGet("settings");
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
    await api.apiPost("settings/save", payload);
    hint.textContent = "";
    toast("设置已保存");
    state.summary = await api.apiGet("summary");
    renderHead();
  } catch (e) {
    hint.textContent = "";
    toast(e.message || "保存失败", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "保存设置";
  }
}

export function init() {
  document.getElementById("settingsSave").addEventListener("click", saveSettings);
  document.getElementById("promptReset").addEventListener("click", () => {
    const def = state.settings?.ai_summary_prompt_default || "";
    document.getElementById("setAiPrompt").value = def;
    toast(def ? "已填入默认提示词，记得保存" : "未取到默认值");
  });
}
