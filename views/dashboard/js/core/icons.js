// Inline icon set. unfold* are MDI paths (Apache-2.0, Templarian/MaterialDesign-SVG);
// the rest match the dashboard's Material look.
export const ICONS = {
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  unfoldMore: "M12,18.17L8.83,15L7.42,16.41L12,21L16.59,16.41L15.17,15M12,5.83L15.17,9L16.58,7.59L12,3L7.41,7.59L8.83,9L12,5.83Z",
  unfoldLess: "M16.59,5.41L15.17,4L12,7.17L8.83,4L7.41,5.41L12,10M7.41,18.59L8.83,20L12,16.83L15.17,20L16.58,18.59L12,14L7.41,18.59Z",
  rss: "M6.18 20a2.18 2.18 0 11-4.36 0 2.18 2.18 0 014.36 0zM2 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z",
  trash: "M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  clock: "M12 2a10 10 0 100 20 10 10 0 000-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z",
  chevron: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  open: "M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  send: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
  server: "M4 4h16a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v3h16V6H4zm0 7h16a2 2 0 012 2v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3a2 2 0 012-2zm0 2v3h16v-3H4z",
};

export function iconSvg(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.appendChild(path);
  return svg;
}
