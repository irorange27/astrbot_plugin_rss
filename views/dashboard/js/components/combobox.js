import { el } from "../core/dom.js";
import { portalMenu } from "../core/portal.js";

// Themed suggestion menu for a free-text input; typing filters, picking fills.
// Used for category (allows new values) and session (raw origin) inputs.
export function attachCombobox(input, getOptions) {
  const uid = `cbb-${Math.random().toString(36).slice(2, 8)}`;
  const wrap = el("div", { class: "cbox" });
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const menu = el("div", {
    class: "cselect-menu cbox-menu", role: "listbox", id: uid, hidden: "",
  });
  let portal = null;
  let active = -1;
  function visible() {
    const kw = input.value.trim().toLowerCase();
    return getOptions().filter((o) => !kw || o.toLowerCase().includes(kw));
  }
  function outside(e) {
    if (!wrap.contains(e.target) && !menu.contains(e.target)) close();
  }
  function close() {
    menu.hidden = true;
    active = -1;
    input.removeAttribute("aria-activedescendant");
    if (portal) { portal.stop(); portal = null; }
    document.removeEventListener("click", outside, true);
  }
  function pick(v) {
    input.value = v;
    close();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function paint() {
    [...menu.querySelectorAll(".cselect-opt")].forEach((b, i) => {
      b.classList.toggle("active", i === active);
      if (i === active) {
        b.setAttribute("id", `${uid}-active`);
        b.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", b.id);
      } else b.removeAttribute("id");
    });
  }
  function render() {
    const opts = visible();
    menu.replaceChildren(
      ...opts.map((o, i) =>
        el("button", {
          class: `cselect-opt${i === active ? " active" : ""}`,
          type: "button", role: "option", "aria-selected": "false",
          text: o,
          onclick: () => { pick(o); },
          onmouseenter: () => { active = i; paint(); },
        }),
      ),
    );
  }
  function open() {
    active = -1;
    render();
    if (!menu.children.length) return;
    menu.hidden = false;
    portal = portalMenu(menu, input);
    document.addEventListener("click", outside, true);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", uid);
  }
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");
  input.addEventListener("focus", open);
  input.addEventListener("input", () => {
    active = -1;
    open();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { close(); return; }
    const opts = visible();
    if (!opts.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (menu.hidden) open();
      active = Math.min(opts.length - 1, active + 1);
      paint();
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      active = Math.max(0, active - 1);
      paint();
      return;
    }
    if (ev.key === "Enter" && active >= 0) {
      ev.preventDefault();
      pick(opts[active]);
    }
  });
  return { refresh: render, close };
}
