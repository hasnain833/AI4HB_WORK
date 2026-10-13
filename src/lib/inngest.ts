import "server-only";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Inngest } from "inngest";
import { prisma } from "./prisma";
import { DONE, prioMeta, type Priority } from "./work";

export const inngest = new Inngest({ id: "ai4home-work" });

// ponytail: digest time and "today" use this one zone; make it per-team if the team spans zones.
const TZ = "Asia/Karachi";
export const URGENT: Priority[] = ["HIGH", "CRITICAL"];

type SlackMessage = { text: string; blocks?: unknown[]; attachments?: unknown[] };

async function postToSlack(msg: SlackMessage) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error("SLACK_WEBHOOK_URL is not set (see .env.example)");
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg) });
  if (!res.ok) throw new Error(`Slack webhook ${res.status}: ${await res.text()}`); // thrown → Inngest retries
}

// Slack mrkdwn treats & < > as control characters.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nice = (d: string) => format(parseISO(d), "EEE, MMM d");
const md = (text: string) => ({ type: "mrkdwn", text });

const names = async (ids: string[]) =>
  ids.length ? (await prisma.user.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((u) => u.name).join(", ") : "Unassigned";

/** Fired from actions.ts when an item becomes High/Critical. */
const urgentItem = inngest.createFunction(
  { id: "slack-urgent-item", triggers: [{ event: "work/item.urgent" }] },
  async ({ event, step }) => {
    const { itemId, actor } = event.data as { itemId: string; actor: string };
    await step.run("post", async () => {
      const it = await prisma.item.findUnique({ where: { id: itemId }, include: { board: { select: { name: true } } } });
      if (!it || it.deletedAt || !URGENT.includes(it.priority)) return; // changed back before we ran
      const critical = it.priority === "CRITICAL";
      const label = `${critical ? "🚨" : "⚠️"} ${prioMeta(it.priority).label} priority`;
      await postToSlack({
        text: `${label}: ${it.name}`, // notification preview
        attachments: [
          {
            color: critical ? "#dc2626" : "#b48c3c",
            blocks: [
              { type: "section", text: md(`*${label}*\n*${esc(it.name)}*`) },
              {
                type: "section",
                fields: [
                  md(`*Board*\n${esc(it.board.name)}`),
                  md(`*Assignee*\n${esc(await names(it.assigneeIds))}`),
                  md(`*Due*\n${it.due ? nice(it.due) : "No date"}`),
                  md(`*Set by*\n${esc(actor)}`),
                ],
              },
            ],
          },
        ],
      });
    });
  },
);

/** Daily digest of everything past its due date and not done. */
const overdueDigest = inngest.createFunction(
  { id: "slack-overdue-digest", triggers: [{ cron: `TZ=${TZ} 0 9 * * *` }] },
  async ({ step }) => {
    await step.run("post", async () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // yyyy-MM-dd, same format as Item.due
      const items = await prisma.item.findMany({
        where: { deletedAt: null, status: { not: DONE }, due: { lt: today } },
        include: { board: { select: { name: true } } },
        orderBy: [{ boardId: "asc" }, { due: "asc" }],
      });
      if (!items.length) return;
      const users = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
      const byBoard = new Map<string, string[]>();
      for (const i of items) {
        const who = i.assigneeIds.map((id) => users.get(id)).filter(Boolean).join(", ") || "Unassigned";
        const late = differenceInCalendarDays(parseISO(today), parseISO(i.due!));
        const line = `• *${esc(i.name)}*\n      ${esc(who)}  ·  _${late} day${late > 1 ? "s" : ""} late_ (due ${nice(i.due!)})`;
        byBoard.set(i.board.name, [...(byBoard.get(i.board.name) ?? []), line]);
      }
      const title = `⏰ ${items.length} overdue task${items.length > 1 ? "s" : ""}`;
      // ponytail: Slack caps a section at 3000 chars and a message at 50 blocks; fine for a team-sized board list.
      const sections = [...byBoard].flatMap(([board, lines]) => [
        { type: "divider" },
        { type: "section", text: md(`*📋 ${esc(board)}*  (${lines.length})\n${lines.join("\n")}`.slice(0, 3000)) },
      ]);
      await postToSlack({
        text: title,
        blocks: [
          { type: "header", text: { type: "plain_text", text: title, emoji: true } },
          { type: "context", elements: [md(`Not done and past their due date · ${nice(today)}`)] },
          ...sections.slice(0, 48),
        ],
      });
    });
  },
);

export const functions = [urgentItem, overdueDigest];
