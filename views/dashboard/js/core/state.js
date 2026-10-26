// Central UI state shared across feature modules.
export const state = {
  summary: null,
  rows: [],
  jobs: {}, // `${url}|${session}` -> next_run ts
  filter: "",
  sessionFilter: "",
  sort: { key: "title", dir: 1 },
  loading: true,
  error: null,
  verified: null, // {url} result of 添加订阅 modal 验证
  editingKey: null, // row with the cron editor open
  feedEditKey: null, // row with the rename editor open
  catEditKey: null, // row with the category editor open
  categoryFilter: "",
  collapsed: new Set(), // category names hidden in the table
  catDrop: null, // toolbar category dropdown component
  sessDrop: null, // toolbar session dropdown component
  cronDrop: null, // add-modal frequency dropdown component
  confirmKey: null, // row with delete confirmation shown
  previewKey: null, // row with expanded detail/preview
  preview: { items: [], loading: false, error: null },
  selected: new Set(), // `${url}|${session}` checked rows
  pushingKey: null, // row currently pushing
  settings: null,
  endpoints: { endpoints: [], default: "" },
};
