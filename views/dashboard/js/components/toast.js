let toastTimer = null;

export function toast(msg, type = "ok") {
  const node = document.getElementById("toast");
  node.textContent = msg;
  node.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.className = "toast"), 2600);
}
