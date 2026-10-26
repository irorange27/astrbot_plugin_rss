// Render a dropdown menu at body level so no ancestor overflow clips it.
// Flips above the anchor when there is not enough room below.
export function portalMenu(menu, anchor, flip = true) {
  document.body.appendChild(menu);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    menu.style.left = r.left + "px";
    menu.style.minWidth = r.width + "px";
    const mh = menu.offsetHeight || 0;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    let top;
    if (flip && mh > below && above > below) top = r.top - 4 - mh;
    else top = r.bottom + 4;
    top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
    menu.style.top = top + "px";
  };
  place();
  const onMove = () => place();
  document.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  return {
    stop() {
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      menu.remove();
    },
  };
}
