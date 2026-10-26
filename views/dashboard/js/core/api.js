// Thin facade over the AstrBotPluginView bridge injected by the dashboard.
const bridge = window.AstrBotPluginView;

export async function ready() {
  return bridge.ready();
}

export function t(key, fallback) {
  return bridge.t(key, fallback);
}

export function onContext(fn) {
  return bridge.onContext(fn);
}

export async function apiGet(endpoint, params) {
  return bridge.apiGet(endpoint, params);
}

export async function apiPost(endpoint, body) {
  return bridge.apiPost(endpoint, body);
}
