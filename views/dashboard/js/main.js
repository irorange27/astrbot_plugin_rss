// Panel entry: bootstrap the bridge, initialize features, run the first loads.
import * as api from "./core/api.js";
import { init as initSubscriptions, load } from "./features/subscriptions.js";
import { init as initAddModal } from "./features/add-modal.js";
import { init as initEndpoints, loadEndpoints } from "./features/endpoints.js";
import { init as initSettings, loadSettings } from "./features/settings.js";

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

async function main() {
  await api.ready();
  document.title = api.t("views.dashboard.title", "RSS 订阅管理");
  document.getElementById("pageTitle").textContent = api.t("views.dashboard.title", "RSS 订阅");
  api.onContext(() => {
    document.title = api.t("views.dashboard.title", "RSS 订阅管理");
  });

  initSubscriptions();
  initAddModal();
  initEndpoints();
  initSettings();

  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => switchTab(t.dataset.tab));
  }
  document.getElementById("refreshBtn").addEventListener("click", () => {
    load();
    loadEndpoints();
    loadSettings();
  });

  await Promise.all([load(), loadEndpoints(), loadSettings()]);
}

main();
