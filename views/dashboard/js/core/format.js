// Display formatters shared by the table and detail views.

export function sessionLabel(origin) {
  const parts = origin.split(":");
  if (parts.length === 3) {
    const [platform, type, id] = parts;
    if (/aiocqhttp|napcat/i.test(platform)) {
      if (type === "FriendMessage") return `QQ 私聊 ${id}`;
      if (type === "GroupMessage") return `QQ 群 ${id}`;
    }
    return `${platform} · ${id}`;
  }
  return origin;
}

export function relTime(ts) {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff >= 0) {
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
  }
  const ahead = -diff;
  if (ahead < 3600) return `${Math.floor(ahead / 60)} 分钟后`;
  if (ahead < 86400) return `${Math.floor(ahead / 3600)} 小时后`;
  return `${Math.floor(ahead / 86400)} 天后`;
}
