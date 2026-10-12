// npm run db:seed. Creates the two accounts and, if the database has no boards yet, sample boards.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { addDays, format } from "date-fns";
import { PrismaClient, type Priority, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DONE, TEMPLATES, GROUP_COLORS } from "../src/lib/work";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL }) });
const day = (n: number) => format(addDays(new Date(), n), "yyyy-MM-dd");

async function upsertUser(email: string, name: string, role: "ADMIN" | "USER", envKey: string) {
  const password = process.env[envKey];
  if (!password || password.length < 8) throw new Error(`${envKey} must be set (8+ characters) in .env`);
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({ where: { email }, update: { name, role, passwordHash }, create: { email, name, role, passwordHash } });
}

async function main() {
  const admin = await upsertUser("admin@aiforhomebuilders.com", "Super Admin", "ADMIN", "SEED_ADMIN_PASSWORD");
  const user = await upsertUser("user@aiforhomebuilders.com", "Emily Carter", "USER", "SEED_USER_PASSWORD");
  console.log(`Users ready: ${admin.email} (admin), ${user.email} (user)`);

  if ((await prisma.board.count()) > 0) {
    console.log("Boards already exist, skipping sample data.");
    return;
  }

  type ItemSeed = { name: string; status: string; priority: Priority; who?: "admin" | "user"; start?: number; due?: number; description?: string; values?: Record<string, string | number | boolean>; subtasks?: [string, boolean][] };
  const ids = { admin: admin.id, user: user.id };

  async function board(position: number, name: string, workspace: string, description: string, tpl: string, groups: [string, number][] | null, columns: Prisma.InputJsonValue | null, items: ItemSeed[][]) {
    const made = TEMPLATES.find((t) => t.key === tpl)!.make();
    const b = await prisma.board.create({
      data: {
        name,
        workspace,
        description,
        position,
        statuses: made.statuses as unknown as Prisma.InputJsonValue,
        columns: columns ?? (made.columns as unknown as Prisma.InputJsonValue),
        groups: { create: (groups ?? made.groups.map((g) => [g.name, GROUP_COLORS.indexOf(g.color)] as [string, number])).map(([gName, c], i) => ({ name: gName, color: GROUP_COLORS[c], position: i })) },
      },
      include: { groups: { orderBy: { position: "asc" } } },
    });
    const cols = b.columns as unknown as { id: string; name: string }[];
    const colId = (n: string) => cols.find((c) => c.name === n)?.id ?? n;
    let pos = 0;
    for (const [gi, list] of items.entries()) {
      for (const it of list) {
        await prisma.item.create({
          data: {
            boardId: b.id,
            groupId: b.groups[gi].id,
            name: it.name,
            status: it.status,
            priority: it.priority,
            assigneeIds: it.who ? [ids[it.who]] : [],
            start: it.start === undefined ? null : day(it.start),
            due: it.due === undefined ? null : day(it.due),
            description: it.description ?? "",
            values: Object.fromEntries(Object.entries(it.values ?? {}).map(([k, v]) => [colId(k), v])),
            position: ++pos,
            subtasks: { create: (it.subtasks ?? []).map(([title, done], i) => ({ title, done, position: i, assigneeId: it.who ? ids[it.who] : null })) },
            activity: { create: { text: "Super Admin created this item" } },
          },
        });
      }
    }
    return b;
  }

  const bugs = await board(0, "Bugs", "Product", "Bugs reported by builders, homeowners and the team.", "bugs", null, null, [
    [
      { name: "Homeowner chat freezes after uploading 3+ photos", status: "WORKING", priority: "CRITICAL", who: "user", start: -2, due: 1, values: { Environment: "Mobile", "Reported by": "Mark Davies (Summit Builders)" }, subtasks: [["Reproduce on iOS Safari", true], ["Compress images before upload", false], ["Add upload progress indicator", false]] },
      { name: "Salesforce sync shows 'Pending' for closed leads", status: "STUCK", priority: "HIGH", who: "admin", start: -3, due: -1, values: { Environment: "Production", "Reported by": "James Wright (Legacy Homes)" }, description: "Waiting on API access from the client." },
    ],
    [
      { name: "Wrong timezone on booking confirmation email", status: "REVIEW", priority: "HIGH", who: "user", start: -4, due: 2, values: { Environment: "Production" } },
      { name: "Sales agent repeats the same answer twice", status: "WORKING", priority: "MEDIUM", who: "admin", start: -1, due: 4, values: { Environment: "Production" } },
      { name: "Invoice PDF cuts off the last line item", status: "NOT_STARTED", priority: "MEDIUM", who: "user", start: 2, due: 6 },
    ],
    [{ name: "CSV export ignores the date filter", status: "NOT_STARTED", priority: "LOW", due: 18 }],
  ]);

  await board(1, "Feature Requests", "Product", "Ideas and requests from clients, prioritised for the roadmap.", "blank", [["Under review", 3], ["Planned", 0], ["Shipped", 2]],
    [{ id: "requested", name: "Requested by", type: "text" }, { id: "votes", name: "Votes", type: "number" }, { id: "impact", name: "Impact", type: "rating" }],
    [
      [
        { name: "SMS reminder to trades 24h before appointment", status: "NOT_STARTED", priority: "MEDIUM", due: 20, values: { requested: "Brightview Builders", votes: 14, impact: 4 } },
        { name: "Export warranty tickets to Excel with photos", status: "REVIEW", priority: "MEDIUM", who: "user", due: 12, values: { requested: "Oakridge Homes", votes: 9, impact: 3 } },
      ],
      [{ name: "Bulk assign tickets to a trade", status: "WORKING", priority: "HIGH", who: "user", start: -5, due: 5, values: { requested: "Summit Builders", votes: 22, impact: 5 }, subtasks: [["Multi-select in ticket table", true], ["Bulk dispatch API", true], ["Confirmation dialog + toast", false]] }],
      [{ name: "Salesforce OAuth connection", status: DONE, priority: "HIGH", who: "admin", start: -20, due: -6, values: { requested: "Legacy Homes", votes: 18, impact: 5 } }],
    ]);

  const sprint = await board(2, "Sprint 14", "Product", "Current development sprint.", "sprint", null, null, [
    [
      { name: "Faster loading of the communities dashboard", status: "REVIEW", priority: "MEDIUM", who: "user", start: -4, due: 1, values: { "Story points": 5 } },
      { name: "Trade portal: upload completion photos", status: "WORKING", priority: "HIGH", who: "admin", start: -2, due: 5, values: { "Story points": 8 } },
      { name: "Weekly report email to builders", status: "NOT_STARTED", priority: "MEDIUM", who: "user", start: 3, due: 9, values: { "Story points": 3 } },
    ],
    [{ name: "Fix login redirect loop", status: DONE, priority: "CRITICAL", who: "user", start: -4, due: -3, values: { "Story points": 2 } }],
  ]);

  await board(3, "Client Onboarding", "Operations", "Setting up new builder companies on AI4Home.", "onboarding", [["Summit Builders", 1], ["Oakridge Homes", 0]], null, [
    [
      { name: "Kick-off call with Summit Builders", status: DONE, priority: "MEDIUM", who: "admin", due: -5, values: { "Client signed off": true } },
      { name: "Import 3 communities and 120 homeowners", status: "WORKING", priority: "HIGH", who: "user", start: -2, due: 2 },
    ],
    [{ name: "Kick-off call with Oakridge Homes", status: "NOT_STARTED", priority: "MEDIUM", who: "admin", due: 3 }],
  ]);

  await prisma.automation.createMany({
    data: [
      { boardId: bugs.id, trigger: { type: "created" }, action: { type: "assign", value: user.id } },
      { boardId: bugs.id, trigger: { type: "priority", to: "CRITICAL" }, action: { type: "notify", value: admin.id } },
      { boardId: null, trigger: { type: "status", to: DONE }, action: { type: "notify", value: admin.id } },
      { boardId: null, trigger: { type: "status", to: "STUCK" }, action: { type: "notify", value: admin.id } },
      { boardId: null, trigger: { type: "assigned" }, action: { type: "notify", value: "__assignees" } },
      { boardId: sprint.id, trigger: { type: "status", to: DONE }, action: { type: "move_group", value: sprint.groups[1].id } },
    ],
  });
  console.log("Sample boards, items and automations created.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
