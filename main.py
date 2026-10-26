import aiohttp
import asyncio
import time
import re
import logging
from datetime import datetime
from lxml import etree
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from astrbot.api.event import filter, AstrMessageEvent, MessageEventResult,MessageChain
from astrbot.api.star import Context, Star, register
from astrbot.api import AstrBotConfig
import astrbot.api.message_components as Comp

from .data_handler import DataHandler
from .pic_handler import RssImageHandler
from .rss import RSSItem
from typing import List

DEFAULT_DIGEST_PROMPT = (
    "你是我的 RSS 阅读助理。把下面的订阅条目整理成一份简洁的中文简报："
    "先一句话总结本期整体亮点，再逐条给出「一句话概括 + 为什么值得看」，"
    "保留每条的原文链接。全文控制在一屏以内，不要寒暄，不要多余标题。"
)


@register(
    "astrbot_plugin_rss",
    "Soulter",
    "RSS订阅插件",
    "1.2.0",
    "https://github.com/irorange27/astrbot_plugin_rss",
)
class RssPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig) -> None:
        super().__init__(context)

        self.logger = logging.getLogger("astrbot")
        self.context = context
        self.config = config
        self.data_handler = DataHandler()
        self.pic_handler = RssImageHandler()

        # 提取scheme文件中的配置
        self.title_max_length = config.get("title_max_length")
        self.description_max_length = config.get("description_max_length")
        self.max_items_per_poll = config.get("max_items_per_poll")
        self.t2i = config.get("t2i")
        self.is_hide_url = config.get("is_hide_url")
        self.is_read_pic= config.get("pic_config").get("is_read_pic")
        self.is_adjust_pic= config.get("pic_config").get("is_adjust_pic")
        self.max_pic_item = config.get("pic_config").get("max_pic_item")
        self.is_compose = config.get("compose")
        self.ai_summary = config.get("ai_summary", True)
        self.ai_summary_prompt = config.get("ai_summary_prompt") or DEFAULT_DIGEST_PROMPT

        self.pic_handler = RssImageHandler(self.is_adjust_pic)
        self.scheduler = AsyncIOScheduler()
        self.scheduler.start()

        self._fresh_asyncIOScheduler()

    def parse_cron_expr(self, cron_expr: str):
        fields = cron_expr.split(" ")
        return {
            "minute": fields[0],
            "hour": fields[1],
            "day": fields[2],
            "month": fields[3],
            "day_of_week": fields[4],
        }

    async def parse_channel_info(self, url):
        headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        connector = aiohttp.TCPConnector(ssl=False)
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
        try:
            async with aiohttp.ClientSession(trust_env=True,
                                        connector=connector,
                                        timeout=timeout,
                                        headers=headers
                                        ) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        self.logger.error(f"rss: 无法正常打开站点 {url}")
                        return None
                    text = await resp.read()
                    return text
        except asyncio.TimeoutError:
            self.logger.error(f"rss: 请求站点 {url} 超时")
            return None
        except aiohttp.ClientError as e:
            self.logger.error(f"rss: 请求站点 {url} 网络错误: {str(e)}")
            return None
        except Exception as e:
            self.logger.error(f"rss: 请求站点 {url} 发生未知错误: {str(e)}")
            return None

    def _build_system_prompt(self) -> str:
        """Compose the system prompt under the same rules as normal chats:
        persona first, then the optional datetime reminder."""
        try:
            cfg = self.context.get_config()
        except Exception:
            return ""
        parts = []
        pid = None
        try:
            pid = (
                cfg.get("agent_runner", {})
                .get("config", {})
                .get("persona", {})
                .get("persona_id")
            ) or cfg.get("provider_settings", {}).get("default_personality")
        except Exception:
            pid = None
        if pid:
            try:
                persona = self.context.persona_manager.get_persona_v3_by_id(pid)
                prompt = getattr(persona, "system_prompt", "") if persona else ""
                if prompt:
                    parts.append(prompt)
            except Exception:
                pass
        try:
            if cfg.get("provider_settings", {}).get("datetime_system_prompt"):
                now = None
                tz = cfg.get("timezone")
                if tz:
                    try:
                        import zoneinfo

                        now = datetime.now(zoneinfo.ZoneInfo(tz))
                    except Exception:
                        now = None
                if now is None:
                    now = datetime.now().astimezone()
                parts.append(
                    f"Current datetime: {now.strftime('%Y-%m-%d %H:%M (%Z)')}, "
                    f"Weekday: {now.strftime('%A')}"
                )
        except Exception:
            pass
        return "\n".join(parts)

    def _safety_blocked(self, text: str) -> bool:
        """Apply AstrBot's content safety rules to outgoing digests."""
        try:
            cfg = self.context.get_config()
            cs = cfg.get("content_safety", {})
            if not cs.get("also_use_in_response"):
                return False
            from astrbot.core.pipeline.content_safety_check.strategies.strategy import (
                StrategySelector,
            )

            ok, info = StrategySelector(cs).check(text)
            if not ok:
                self.logger.warning(f"rss: AI 摘要被内容安全策略拦截: {info}")
            return not ok
        except Exception as e:
            self.logger.warning(f"rss: 内容安全检查失败，默认放行: {e}")
            return False

    async def _ai_digest(self, rss_items: List[RSSItem]) -> str | None:
        """Use the current LLM provider to compress new items into one digest.

        Follows AstrBot's rules: persona + datetime as system prompt, and the
        content safety check on the response. Returns None when blocked."""
        provider = self.context.get_using_provider()
        if provider is None:
            raise RuntimeError("no available LLM provider")
        lines = []
        for it in rss_items:
            desc = self.data_handler.strip_html(it.description or "")[:400]
            lines.append(f"标题: {it.title}\n内容: {desc}\n链接: {it.link}")
        prompt = (
            self.ai_summary_prompt
            + "\n\n来源频道: "
            + (rss_items[0].chan_title or "")
            + "\n\n"
            + "\n\n".join(lines)
        )
        resp = await provider.text_chat(
            prompt=prompt,
            session_id="rss_digest",
            system_prompt=self._build_system_prompt() or None,
            persist=False,
        )
        digest = (resp.completion_text or "").strip()
        if self._safety_blocked(digest):
            return None
        return digest

    async def cron_task_callback(self, url: str, user: str):
        """定时任务回调"""

        if url not in self.data_handler.data:
            return
        if user not in self.data_handler.data[url]["subscribers"]:
            return

        self.logger.info(f"RSS 定时任务触发: {url} - {user}")
        last_update = self.data_handler.data[url]["subscribers"][user]["last_update"]
        latest_link = self.data_handler.data[url]["subscribers"][user]["latest_link"]
        max_items_per_poll = self.max_items_per_poll
        # 拉取 RSS
        rss_items = await self.poll_rss(
            url,
            num=max_items_per_poll,
            after_timestamp=last_update,
            after_link=latest_link,
        )
        max_ts = last_update

        # AI digest mode: compress new items into one summarized message.
        if rss_items and self.ai_summary:
            try:
                digest = await self._ai_digest(rss_items)
                if digest is None:
                    # Blocked by content safety: skip sending, advance watermark.
                    self.data_handler.data[url]["subscribers"][user]["last_update"] = max(
                        max_ts, max(i.pubDate_timestamp for i in rss_items)
                    )
                    self.data_handler.data[url]["subscribers"][user]["latest_link"] = (
                        rss_items[0].link
                    )
                    self.data_handler.save_data()
                    return
                msc = MessageChain(chain=[Comp.Plain(digest)], use_t2i_=self.t2i)
                await self.context.send_message(user, msc)
                self.data_handler.data[url]["subscribers"][user]["last_update"] = max(
                    max_ts, max(i.pubDate_timestamp for i in rss_items)
                )
                self.data_handler.data[url]["subscribers"][user]["latest_link"] = (
                    rss_items[0].link
                )
                self.data_handler.save_data()
                self.logger.info(f"RSS 定时任务 {url} AI 摘要推送成功 - {user}")
                return
            except Exception as e:
                self.logger.warning(f"rss: AI 摘要失败，回退原文推送: {str(e)}")

        # 分解MessageSesion
        platform_name,message_type,session_id = user.split(":")

        # 分平台处理消息
        if platform_name == "aiocqhttp" and self.is_compose:
            nodes = []
            for item in rss_items:
                comps = await self._get_chain_components(item)
                node = Comp.Node(
                            uin=0,
                            name="Astrbot",
                            content=comps
                        )
                nodes.append(node)
                self.data_handler.data[url]["subscribers"][user]["last_update"] = int(
                    time.time()
                )
                max_ts = max(max_ts, item.pubDate_timestamp)

            # 合并消息发送
            if len(nodes) > 0:
                msc = MessageChain(
                    chain=nodes,
                    use_t2i_= self.t2i
                )
                await self.context.send_message(user, msc)
        else:
            # 每个消息单独发送
            for item in rss_items:
                comps = await self._get_chain_components(item)
                msc = MessageChain(
                chain=comps,
                use_t2i_= self.t2i
            )
                await self.context.send_message(user, msc)
                self.data_handler.data[url]["subscribers"][user]["last_update"] = int(
                    time.time()
                )
                max_ts = max(max_ts, item.pubDate_timestamp)

        # 更新最后更新时间
        if rss_items:
            self.data_handler.data[url]["subscribers"][user]["last_update"] = max_ts
            self.data_handler.data[url]["subscribers"][user]["latest_link"] = rss_items[
                0
            ].link
            self.data_handler.save_data()
            self.logger.info(f"RSS 定时任务 {url} 推送成功 - {user}")
        else:
            self.logger.info(f"RSS 定时任务 {url} 无消息更新 - {user}")


    async def poll_rss(
        self,
        url: str,
        num: int = -1,
        after_timestamp: int = 0,
        after_link: str = "",
    ) -> List[RSSItem]:
        """从站点拉取RSS信息"""
        text = await self.parse_channel_info(url)
        if text is None:
            self.logger.error(f"rss: 无法解析站点 {url} 的RSS信息")
            return []
        root = etree.fromstring(text)
        items = root.xpath("//item")
        if not items:
            # Atom 格式：使用 <entry> 节点
            items = root.xpath("//*[local-name()='entry']")

        cnt = 0
        rss_items = []

        for item in items:
            try:
                chan_title = (
                    self.data_handler.data[url]["info"]["title"]
                    if url in self.data_handler.data
                    else "未知频道"
                )

                # RSS 2.0 <item> and Atom <entry> are both supported.
                title_els = item.xpath("title") or item.xpath(
                    "*[local-name()='title']"
                )
                title = (title_els[0].text or "") if title_els else ""
                if len(title) > self.title_max_length:
                    title = title[: self.title_max_length] + "..."

                link_els = item.xpath("link")
                if link_els and link_els[0].text:
                    link = link_els[0].text
                else:
                    hrefs = item.xpath(
                        "*[local-name()='link'][not(@rel) or @rel='alternate']/@href"
                    )
                    link = hrefs[0] if hrefs else ""
                if link and not re.match(r"^https?://", link):
                    link = self.data_handler.get_root_url(url) + link

                desc_els = (
                    item.xpath("description")
                    or item.xpath("*[local-name()='summary']")
                    or item.xpath("*[local-name()='content']")
                )
                description = "".join(desc_els[0].itertext()) if desc_els else ""

                pic_url_list = self.data_handler.strip_html_pic(description)
                description = self.data_handler.strip_html(description)

                if len(description) > self.description_max_length:
                    description = (
                        description[: self.description_max_length] + "..."
                    )

                pub_date = None
                pub_date_timestamp = 0
                pub_date_els = item.xpath("pubDate")
                if pub_date_els:
                    pub_date = pub_date_els[0].text
                    pub_date_parsed = time.strptime(
                        pub_date.replace("GMT", "+0000"),
                        "%a, %d %b %Y %H:%M:%S %z",
                    )
                    pub_date_timestamp = int(time.mktime(pub_date_parsed))
                else:
                    iso_els = item.xpath(
                        "*[local-name()='updated']"
                    ) or item.xpath("*[local-name()='published']")
                    if iso_els and iso_els[0].text:
                        pub_date = iso_els[0].text
                        pub_date_timestamp = int(
                            datetime.fromisoformat(
                                pub_date.replace("Z", "+00:00")
                            ).timestamp()
                        )

                if pub_date:
                    # 根据 pubDate 判断是否为新内容
                    if pub_date_timestamp > after_timestamp:
                        rss_items.append(
                            RSSItem(
                                chan_title,
                                title,
                                link,
                                description,
                                pub_date,
                                pub_date_timestamp,
                                pic_url_list
                            )
                        )
                        cnt += 1
                        if num != -1 and cnt >= num:
                            break
                    else:
                        break
                else:
                    # 根据 link 判断是否为新内容
                    if link != after_link:
                        rss_items.append(
                            RSSItem(chan_title, title, link, description, "", 0, pic_url_list)
                        )
                        cnt += 1
                        if num != -1 and cnt >= num:
                            break
                    else:
                        break

            except Exception as e:
                self.logger.error(f"rss: 解析Rss条目 {url} 失败: {str(e)}")
                break

        return rss_items

    def parse_rss_url(self, url: str) -> str:
        """解析RSS URL，确保以http或https开头"""
        if not re.match(r"^https?://", url):
            if not url.startswith("/"):
                url = "/" + url
            url = "https://" + url
        return url

    def _fresh_asyncIOScheduler(self):
        """刷新定时任务"""
        # 删除所有定时任务
        self.logger.info("刷新定时任务")
        self.scheduler.remove_all_jobs()

        # 为每个订阅添加定时任务
        for url, info in self.data_handler.data.items():
            if url == "rsshub_endpoints" or url == "settings":
                continue
            for user, sub_info in info["subscribers"].items():
                self.scheduler.add_job(
                    self.cron_task_callback,
                    "cron",
                    **self.parse_cron_expr(sub_info["cron_expr"]),
                    args=[url, user],
                )

    async def _add_url(self, url: str, cron_expr: str, message: AstrMessageEvent):
        """内部方法：添加URL订阅的共用逻辑"""
        user = message.unified_msg_origin
        if url in self.data_handler.data:
            latest_item = await self.poll_rss(url)
            self.data_handler.data[url]["subscribers"][user] = {
                "cron_expr": cron_expr,
                "last_update": latest_item[0].pubDate_timestamp,
                "latest_link": latest_item[0].link,
            }
        else:
            try:
                text = await self.parse_channel_info(url)
                title, desc = self.data_handler.parse_channel_text_info(text)
                latest_item = await self.poll_rss(url)
            except Exception as e:
                return message.plain_result(f"解析频道信息失败: {str(e)}")

            self.data_handler.data[url] = {
                "subscribers": {
                    user: {
                        "cron_expr": cron_expr,
                        "last_update": latest_item[0].pubDate_timestamp,
                        "latest_link": latest_item[0].link,
                    }
                },
                "info": {
                    "title": title,
                    "description": desc,
                },
            }
        self.data_handler.save_data()
        return self.data_handler.data[url]["info"]

    async def _get_chain_components(self, item: RSSItem):
        """组装消息链"""
        comps = []
        comps.append(Comp.Plain(f"频道 {item.chan_title} 最新 Feed\n---\n标题: {item.title}\n---\n"))
        if not self.is_hide_url:
            comps.append(Comp.Plain(f"链接: {item.link}\n---\n"))
        comps.append(Comp.Plain(item.description+"\n---\n"))
        if self.is_read_pic and item.pic_urls:
            # 如果max_pic_item为-1则不限制图片数量
            temp_max_pic_item = len(item.pic_urls) if self.max_pic_item == -1 else self.max_pic_item
            for pic_url in item.pic_urls[:temp_max_pic_item]:
                base64str = await self.pic_handler.modify_corner_pixel_to_base64(pic_url)
                if base64str is None:
                    comps.append(Comp.Plain("图片链接读取失败\n"))
                    continue
                else:
                    comps.append(Comp.Image.fromBase64(base64str))
        return comps


    def _is_url_or_ip(self,text: str) -> bool:
        """
        判断一个字符串是否为网址（http/https 开头）或 IP 地址。
        """
        url_pattern = r"^(?:http|https)://.+$"
        ip_pattern = r"^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
        return bool(re.match(url_pattern, text) or re.match(ip_pattern, text))

    @filter.command_group("rss", alias={"RSS"})
    def rss(self):
        """RSS订阅插件

        可以订阅和管理多个RSS源，支持cron表达式设置更新频率

        cron 表达式格式：
        * * * * *，分别表示分钟 小时 日 月 星期，* 表示任意值，支持范围和逗号分隔。例：
        1. 0 0 * * * 表示每天 0 点触发。
        2. 0/5 * * * * 表示每 5 分钟触发。
        3. 0 9-18 * * * 表示每天 9 点到 18 点触发。
        4. 0 0 1,15 * * 表示每月 1 号和 15 号 0 点触发。
        星期的取值范围是 0-6，0 表示星期天。
        """
        pass

    @rss.group("rsshub")
    def rsshub(self, event: AstrMessageEvent):
        """RSSHub相关操作

        可以添加、查看、删除RSSHub的端点
        """
        pass

    @rsshub.command("add")
    async def rsshub_add(self, event: AstrMessageEvent, url: str):
        """添加一个RSSHub端点

        Args:
            url: RSSHub服务器地址，例如：https://rsshub.app
        """
        if url.endswith("/"):
            url = url[:-1]
        # 检查是否为url或ip
        if not self._is_url_or_ip(url):
            yield event.plain_result("请输入正确的URL")
            return
        # 检查该网址是否已存在
        elif url in self.data_handler.data["rsshub_endpoints"]:
            yield event.plain_result("该RSSHub端点已存在")
            return
        else:
            self.data_handler.data["rsshub_endpoints"].append(url)
            self.data_handler.save_data()
            yield event.plain_result("添加成功")

    @rsshub.command("list")
    async def rsshub_list(self, event: AstrMessageEvent):
        """列出所有已添加的RSSHub端点"""
        ret = "当前Bot添加的rsshub endpoint：\n"
        yield event.plain_result(
            ret
            + "\n".join(
                [
                    f"{i}: {x}"
                    for i, x in enumerate(self.data_handler.data["rsshub_endpoints"])
                ]
            )
        )

    @rsshub.command("remove")
    async def rsshub_remove(self, event: AstrMessageEvent, idx: int):
        """删除一个RSSHub端点

        Args:
            idx: 要删除的端点索引，可通过list命令查看
        """
        if idx < 0 or idx >= len(self.data_handler.data["rsshub_endpoints"]):
            yield event.plain_result("索引越界")
            return
        else:
            # TODO:删除对应的定时任务
            self.scheduler.remove_job()
            self.data_handler.data["rsshub_endpoints"].pop(idx)
            self.data_handler.save_data()
            yield event.plain_result("删除成功")

    @rss.command("add")
    async def add_command(
        self,
        event: AstrMessageEvent,
        idx: int,
        route: str,
        minute: str,
        hour: str,
        day: str,
        month: str,
        day_of_week: str,
    ):
        """通过RSSHub路由添加订阅

        Args:
            idx: RSSHub端点索引，可通过/rss rsshub list查看
            route: RSSHub路由，需以/开头
            minute: Cron表达式分钟字段
            hour: Cron表达式小时字段
            day: Cron表达式日期字段
            month: Cron表达式月份字段
            day_of_week: Cron表达式星期字段
        """
        if idx < 0 or idx >= len(self.data_handler.data["rsshub_endpoints"]):
            yield event.plain_result(
                "索引越界, 请使用 /rss rsshub list 查看已经添加的 rsshub endpoint"
            )
            return
        if not route.startswith("/"):
            yield event.plain_result("路由必须以 / 开头")
            return

        url = self.data_handler.data["rsshub_endpoints"][idx] + route
        cron_expr = f"{minute} {hour} {day} {month} {day_of_week}"

        ret = await self._add_url(url, cron_expr, event)
        if isinstance(ret, MessageEventResult):
            yield ret
            return
        else:
            chan_title = ret["title"]
            chan_desc = ret["description"]

        # 刷新定时任务
        self._fresh_asyncIOScheduler()

        yield event.plain_result(
            f"添加成功。频道信息：\n标题: {chan_title}\n描述: {chan_desc}"
        )

    @rss.command("add-url")
    async def add_url_command(
        self,
        event: AstrMessageEvent,
        url: str,
        minute: str,
        hour: str,
        day: str,
        month: str,
        day_of_week: str,
    ):
        """直接通过Feed URL添加订阅

        Args:
            url: RSS Feed的完整URL
            minute: Cron表达式分钟字段
            hour: Cron表达式小时字段
            day: Cron表达式日期字段
            month: Cron表达式月份字段
            day_of_week: Cron表达式星期字段
        """
        cron_expr = f"{minute} {hour} {day} {month} {day_of_week}"
        ret = await self._add_url(url, cron_expr, event)
        if isinstance(ret, MessageEventResult):
            yield ret
            return
        else:
            chan_title = ret["title"]
            chan_desc = ret["description"]

        # 刷新定时任务
        self._fresh_asyncIOScheduler()

        yield event.plain_result(
            f"添加成功。频道信息：\n标题: {chan_title}\n描述: {chan_desc}"
        )

    @rss.command("list")
    async def list_command(self, event: AstrMessageEvent):
        """列出当前所有订阅的RSS频道"""
        user = event.unified_msg_origin
        subs_urls = self.data_handler.get_subs_channel_url(user)
        ret = f"当前订阅的频道（{len(subs_urls)} 个）：\n"
        cnt = 0
        for url in subs_urls:
            info = self.data_handler.data[url]["info"]
            ret += f"{cnt}. {info['title']} - {info['description']}\n"
            cnt += 1
        yield event.plain_result(ret)

    @rss.command("count")
    async def count_command(self, event: AstrMessageEvent):
        """查看全部订阅统计（跨会话）"""
        feeds = 0
        subs = 0
        sessions = {}
        for url, info in self.data_handler.data.items():
            if url == "rsshub_endpoints" or url == "settings":
                continue
            feeds += 1
            for user in info["subscribers"]:
                subs += 1
                sessions[user] = sessions.get(user, 0) + 1
        ret = f"全部订阅源: {feeds} 个，订阅关系: {subs} 条\n"
        ret += "\n".join(f"{s}: {c} 个源" for s, c in sessions.items())
        yield event.plain_result(ret)

    @rss.command("remove")
    async def remove_command(self, event: AstrMessageEvent, idx: int):
        """删除一个RSS订阅

        Args:
            idx: 要删除的订阅索引，可通过/rss list查看
        """
        subs_urls = self.data_handler.get_subs_channel_url(event.unified_msg_origin)
        if idx < 0 or idx >= len(subs_urls):
            yield event.plain_result("索引越界, 请使用 /rss list 查看已经添加的订阅")
            return
        url = subs_urls[idx]
        self.data_handler.data[url]["subscribers"].pop(event.unified_msg_origin)

        self.data_handler.save_data()

        # 刷新定时任务
        self._fresh_asyncIOScheduler()
        yield event.plain_result("删除成功")

    @rss.command("get")
    async def get_command(self, event: AstrMessageEvent, idx: int):
        """获取指定订阅的最新内容

        Args:
            idx: 要查看的订阅索引，可通过/rss list查看
        """
        subs_urls = self.data_handler.get_subs_channel_url(event.unified_msg_origin)
        if idx < 0 or idx >= len(subs_urls):
            yield event.plain_result("索引越界, 请使用 /rss list 查看已经添加的订阅")
            return
        url = subs_urls[idx]
        rss_items = await self.poll_rss(url)
        if not rss_items:
            yield event.plain_result("没有新的订阅内容")
            return
        item = rss_items[0]
        # 分解MessageSesion
        platform_name,message_type,session_id = event.unified_msg_origin.split(":")
        # 构造返回消息链
        comps = await self._get_chain_components(item)
        # 区分平台
        if(platform_name == "aiocqhttp" and self.is_compose):
            node = Comp.Node(
                    uin=0,
                    name="Astrbot",
                    content=comps
                )
            yield event.chain_result([node]).use_t2i(self.t2i)
        else:
            yield event.chain_result(comps).use_t2i(self.t2i)
