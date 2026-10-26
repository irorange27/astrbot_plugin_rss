import { el } from "../core/dom.js";
import { iconSvg } from "../core/icons.js";
import { portalMenu } from "../core/portal.js";

// Select-style dropdown: trigger button + keyboard-navigable listbox.
// Keyboard: ArrowUp/Down/Home/End move, Enter/Space pick, Escape closes.
export function createDropdown({ options, value, onChange }) {
  let current = value;
  let list = options;
  let active = -1;
  const uid = `csl-${Math.random().toString(36).slice(2, 8)}`;
  const root = el("div", { class: "cselect" });
  const label = el("span", { class: "cselect-label" });
  const chev = iconSvg("chevron");
  chev.setAttribute("class", "cselect-chevron");
  const btn = el("button", {
    class: "cselect-btn", type: "button",
    "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-controls": uid,
  }, label, chev);
  const menu = el("div", {
    class: "cselect-menu", role: "listbox", id: uid, hidden: "",
  });

  function optionEls() { return [...menu.querySelectorAll(".cselect-opt")]; }
  function renderMenu() {
    menu.replaceChildren(
      ...list.map((o, i) => {
        const b = el("button", {
          class: `cselect-opt${o.value === current ? " selected" : ""}${i === active ? " active" : ""}`,
          type: "button",
          role: "option",
          "aria-selected": o.value === current ? "true" : "false",
          onclick: () => { pick(o.value); },
          onmouseenter: () => { active = i; paint(); },
        },
          el("span", { text: o.label }),
          o.value === current ? iconSvg("check") : null,
        );
        if (i === active) b.setAttribute("id", `${uid}-active`);
        return b;
      }),
    );
    const hit = list.find((o) => o.value === current);
    label.textContent = hit ? hit.label : current;
    const act = optionEls()[active];
    menu.setAttribute("aria-activedescendant", act ? act.id || "" : "");
  }
  function paint() {
    optionEls().forEach((b, i) => {
      b.classList.toggle("active", i === active);
      if (i === active) {
        b.setAttribute("id", `${uid}-active`);
        b.scrollIntoView({ block: "nearest" });
        menu.setAttribute("aria-activedescendant", b.id);
      } else b.removeAttribute("id");
    });
  }
  function pick(v) {
    current = v;
    close();
    renderMenu();
    if (onChange) onChange(v);
  }
  let portal = null;
  function outside(e) {
    if (!root.contains(e.target) && !menu.contains(e.target)) close();
  }
  function open() {
    active = Math.max(0, list.findIndex((o) => o.value === current));
    menu.hidden = false;
    portal = portalMenu(menu, btn);
    renderMenu();
    document.addEventListener("click", outside, true);
    btn.setAttribute("aria-expanded", "true");
    const act = optionEls()[active];
    if (act) act.scrollIntoView({ block: "nearest" });
  }
  function close() {
    menu.hidden = true;
    active = -1;
    if (portal) { portal.stop(); portal = null; }
    document.removeEventListener("click", outside, true);
    btn.setAttribute("aria-expanded", "false");
  }
  btn.addEventListener("click", () => {
    if (menu.hidden) { btn.focus(); open(); }
    else close();
  });
  root.addEventListener("keydown", (ev) => {
    if (menu.hidden) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter") {
        ev.preventDefault();
        open();
      }
      return;
    }
    if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    if (ev.key === "ArrowDown") { ev.preventDefault(); active = Math.min(list.length - 1, active + 1); paint(); return; }
    if (ev.key === "ArrowUp") { ev.preventDefault(); active = Math.max(0, active - 1); paint(); return; }
    if (ev.key === "Home") { ev.preventDefault(); active = 0; paint(); return; }
    if (ev.key === "End") { ev.preventDefault(); active = list.length - 1; paint(); return; }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (active >= 0 && list[active]) pick(list[active].value);
    }
  });
  root.append(btn, menu);
  renderMenu();
  return {
    el: root,
    setOptions(list2) { list = list2; if (active >= list.length) active = list.length - 1; renderMenu(); },
    get value() { return current; },
    setValue(v) { current = v; renderMenu(); },
  };
}
