import { createDropdown } from "./dropdown.js";

export const CRON_PRESETS = [
  ["*/1 * * * *", "每分钟"],
  ["0 * * * *", "每小时"],
  ["0 */2 * * *", "每 2 小时"],
  ["0 */6 * * *", "每 6 小时"],
  ["0 8 * * *", "每天 08:00"],
  ["0 9 * * *", "每天 09:00"],
  ["0 10 * * 1", "每周一 10:00"],
];

export function cronDropdown(value, onChange) {
  return createDropdown({
    options: [
      ...CRON_PRESETS.map(([v, l]) => ({ value: v, label: l })),
      { value: "custom", label: "自定义 cron…" },
    ],
    value,
    onChange,
  });
}

export function cronLabel(cron) {
  const hit = CRON_PRESETS.find(([expr]) => expr === cron);
  return hit ? hit[1] : cron;
}
