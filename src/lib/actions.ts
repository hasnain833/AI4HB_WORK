"use server";

import bcrypt from "bcryptjs";
import { format } from "date-fns";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createSession, destroySession, requireUser } from "./auth";
import { inngest, URGENT } from "./inngest";
import {
  TEMPLATES,
  prioMeta,
  statusOf,
  type Action,
  type Automation,
  type Board,
  type CellValue,
  type Column,
  type Group,
  type Item,
  type ItemPatch,
  type NewItemFields,
  type Person,
  type Priority,
  type StatusDef,
  type Trigger,
  type WorkState,
} from "./work";

// ── Auth ─────────────────────────────────────────────────────

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return "Wrong email or password.";
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// ── Read ─────────────────────────────────────────────────────

const itemInclude = {
  subtasks: { orderBy: { position: "asc" } },
  updates: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
  files: { orderBy: { createdAt: "asc" } },
  activity: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.ItemInclude;

type DbItem = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

function toItem(i: DbItem): Item {
  return {
    id: i.id,
    boardId: i.boardId,
    groupId: i.groupId,
    name: i.name,
    status: i.status,
    priority: i.priority,
    assignees: i.assigneeIds,
    createdBy: i.createdById ?? undefined,
    start: i.start ?? undefined,
    due: i.due ?? undefined,
    description: i.description,
    values: (i.values ?? {}) as Record<string, CellValue>,
    dependsOn: i.dependsOn,
    subtasks: i.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, assignee: s.assigneeId ?? undefined })),
    updates: i.updates.map((u) => ({ id: u.id, author: u.author.name, body: u.body, at: u.createdAt.toISOString() })),
    files: i.files.map((f) => ({ id: f.id, name: f.name, url: f.url ?? undefined })),
    activity: i.activity.map((a) => ({ at: a.createdAt.toISOString(), text: a.text })),
    createdAt: i.createdAt.toISOString(),
  };
}

function toBoard(b: Prisma.BoardGetPayload<{ include: { groups: true } }>): Board {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    workspace: b.workspace,
    statuses: b.statuses as unknown as StatusDef[],
    columns: b.columns as unknown as Column[],
    groups: [...b.groups].sort((x, y) => x.position - y.position).map((gr) => ({ id: gr.id, name: gr.name, color: gr.color })),
  };
}

// ponytail: loads the whole workspace in one go, fine for a team-sized demo; paginate per board if it grows.
export async function getState(): Promise<WorkState> {
  const me = await requireUser();
  const [users, boards, items] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { createdAt: "asc" } }),
    prisma.board.findMany({ include: { groups: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    prisma.item.findMany({ where: { deletedAt: null }, include: itemInclude, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    me,
    users,
    boards: boards.map(toBoard),
    items: items.map(toItem),
  };
}

// ── Automations engine ───────────────────────────────────────

type Event = { type: "created" } | { type: "status"; to: string } | { type: "assigned"; added: string[] } | { type: "priority"; to: Priority };
type ItemFields = { id: string; boardId: string; groupId: string; name: string; status: string; priority: Priority; assigneeIds: string[] };
type Effects = { fields: ItemFields; activity: string[]; notes: { userId: string; text: string }[] };

function matches(t: Trigger, e: Event) {
  if (t.type !== e.type) return false;
  if (t.type === "status" && e.type === "status") return t.to === e.to;
  if (t.type === "priority" && e.type === "priority") return t.to === e.to;
  return true;
}

async function runAutomations(item: ItemFields, events: Event[], actor: Person): Promise<Effects> {
  const out: Effects = { fields: { ...item }, activity: [], notes: [] };
  if (!events.length) return out;
  const [rules, boardRow, users] = await Promise.all([
    prisma.automation.findMany({ where: { enabled: true, OR: [{ boardId: null }, { boardId: item.boardId }] }, orderBy: { createdAt: "asc" } }),
    prisma.board.findUnique({ where: { id: item.boardId }, include: { groups: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const board = boardRow ? toBoard(boardRow) : undefined;
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "someone";
  const it = out.fields;

  for (const r of rules) {
    const trigger = r.trigger as unknown as Trigger;
    const action = r.action as unknown as Action;
    const e = events.find((ev) => matches(trigger, ev));
    if (!e) continue;
    switch (action.type) {
      case "notify": {
        const to = action.value === "__assignees" ? (e.type === "assigned" ? e.added : it.assigneeIds) : [action.value];
        const text =
          e.type === "assigned" ? `${actor.name} assigned you “${it.name}”`
            : e.type === "created" ? `“${it.name}” was created on ${board?.name ?? "a board"} by ${actor.name}`
              : e.type === "status" ? `“${it.name}” was set to ${statusOf(board, e.to).label} by ${actor.name}`
                : `“${it.name}” was set to ${prioMeta(e.to).label} priority by ${actor.name}`;
        to.filter((id) => id !== actor.id).forEach((userId) => out.notes.push({ userId, text }));
        break;
      }
      case "assign":
        if (!it.assigneeIds.includes(action.value)) {
          it.assigneeIds = [...it.assigneeIds, action.value];
          out.activity.push(`⚡ Automation: assigned ${nameOf(action.value)}`);
          if (action.value !== actor.id) out.notes.push({ userId: action.value, text: `You were auto-assigned “${it.name}”` });
        }
        break;
      case "set_priority":
        it.priority = action.value;
        out.activity.push(`⚡ Automation: set priority to ${prioMeta(action.value).label}`);
        break;
      case "set_status":
        it.status = action.value;
        out.activity.push(`⚡ Automation: set status to ${statusOf(board, action.value).label}`);
        break;
      case "move_group": {
        const target = board?.groups.find((gr) => gr.id === action.value);
        if (target && it.groupId !== target.id) {
          it.groupId = target.id;
          out.activity.push(`⚡ Automation: moved to group ${target.name}`);
        }
        break;
      }
    }
  }
  return out;
}

async function writeEffects(fx: Effects, extraActivity: string[] = []) {
  const id = fx.fields.id;
  await prisma.$transaction([
    prisma.item.update({
      where: { id },
      data: { status: fx.fields.status, priority: fx.fields.priority, assigneeIds: fx.fields.assigneeIds, groupId: fx.fields.groupId },
    }),
    prisma.activity.createMany({ data: [...extraActivity, ...fx.activity].map((text) => ({ itemId: id, text })) }),
    prisma.notification.createMany({ data: fx.notes.map((n) => ({ ...n, itemId: id })) }),
  ]);
}

/** Slack alert (via Inngest) when an item ends up High/Critical and wasn't before. Never blocks the edit. */
async function alertIfUrgent(fx: Effects, prev: Priority | null, actor: Person) {
  if (!URGENT.includes(fx.fields.priority) || (prev && URGENT.includes(prev))) return;
  await inngest.send({ name: "work/item.urgent", data: { itemId: fx.fields.id, actor: actor.name } }).catch((e) => console.error("Slack alert not queued:", e));
}

// ── Items ────────────────────────────────────────────────────

async function nextPosition(groupId: string) {
  const last = await prisma.item.aggregate({ where: { groupId }, _max: { position: true } });
  return (last._max.position ?? 0) + 1;
}

type ItemExtra = Partial<Pick<Prisma.ItemUncheckedCreateInput, "description" | "priority" | "values" | "assigneeIds" | "status" | "start" | "due" | "createdById">>;

async function insertItem(boardId: string, groupId: string, name: string, actor: Person, extra: ItemExtra, firstActivity: string) {
  const row = await prisma.item.create({
    // ponytail: "today" is the server's date; pass the client's date in if users span timezones.
    data: { ...extra, start: format(new Date(), "yyyy-MM-dd"), boardId, groupId, name, position: await nextPosition(groupId) },
  });
  const events: Event[] = [{ type: "created" }];
  if (row.assigneeIds.length) events.push({ type: "assigned", added: row.assigneeIds });
  const fx = await runAutomations(row, events, actor);
  await writeEffects(fx, [firstActivity]);
  await alertIfUrgent(fx, null, actor);
  return row.id;
}

export async function createItem(boardId: string, groupId: string, name: string, f: NewItemFields = {}): Promise<string> {
  const me = await requireUser();
  // Pick fields explicitly so the client can't write anything else.
  const extra: ItemExtra = {
    createdById: me.id,
    status: f.status,
    priority: f.priority,
    assigneeIds: f.assignees,
    due: f.due || null,
    description: f.description,
    values: f.values as Prisma.InputJsonValue | undefined,
  };
  return insertItem(boardId, groupId, name.trim() || "New item", me, extra, `${me.name} created this item`);
}

export async function updateItems(ids: string[], patch: ItemPatch, activityText?: string) {
  const me = await requireUser();
  const prev = await prisma.item.findMany({ where: { id: { in: ids } } });
  for (const p of prev) {
    const data: Prisma.ItemUpdateInput = {
      name: patch.name,
      status: patch.status,
      priority: patch.priority,
      assigneeIds: patch.assignees,
      description: patch.description,
      dependsOn: patch.dependsOn,
      group: patch.groupId ? { connect: { id: patch.groupId } } : undefined,
      // a present-but-empty date clears it
      start: "start" in patch ? patch.start || null : undefined,
      due: "due" in patch ? patch.due || null : undefined,
    };
    const row = await prisma.item.update({ where: { id: p.id }, data });

    const events: Event[] = [];
    if (patch.status && patch.status !== p.status) events.push({ type: "status", to: patch.status });
    if (patch.priority && patch.priority !== p.priority) events.push({ type: "priority", to: patch.priority });
    if (patch.assignees) {
      const added = patch.assignees.filter((a) => !p.assigneeIds.includes(a));
      if (added.length) events.push({ type: "assigned", added });
    }
    const fx = await runAutomations(row, events, me);
    await writeEffects(fx, activityText ? [`${me.name} ${activityText}`] : []);
    await alertIfUrgent(fx, p.priority, me);
  }
}

/** Undo for bulk edits: write back the previous field values. */
export async function restoreItems(snapshots: { id: string; status: string; priority: Priority; assignees: string[]; groupId: string }[]) {
  await requireUser();
  await prisma.$transaction(
    snapshots.map((s) => prisma.item.update({ where: { id: s.id }, data: { status: s.status, priority: s.priority, assigneeIds: s.assignees, groupId: s.groupId } })),
  );
}

export async function deleteItems(ids: string[]) {
  await requireUser();
  await prisma.item.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
}

export async function undeleteItems(ids: string[]) {
  await requireUser();
  await prisma.item.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
}

export async function duplicateItem(id: string) {
  const me = await requireUser();
  const src = await prisma.item.findUnique({ where: { id }, include: { subtasks: true } });
  if (!src) return;
  const copy = await prisma.item.create({
    data: {
      boardId: src.boardId,
      groupId: src.groupId,
      name: `${src.name} (copy)`,
      status: src.status,
      priority: src.priority,
      assigneeIds: src.assigneeIds,
      createdById: me.id,
      start: src.start,
      due: src.due,
      description: src.description,
      values: src.values ?? {},
      dependsOn: src.dependsOn,
      position: src.position + 0.5,
      subtasks: { create: src.subtasks.map((s) => ({ title: s.title, done: s.done, assigneeId: s.assigneeId, position: s.position })) },
      activity: { create: { text: `${me.name} duplicated this item` } },
    },
  });
  return copy.id;
}

export async function moveItem(id: string, groupId: string, beforeId?: string) {
  const me = await requireUser();
  const item = await prisma.item.findUnique({ where: { id }, include: { group: true } });
  if (!item || id === beforeId) return;
  let position: number;
  if (beforeId) {
    const before = await prisma.item.findUnique({ where: { id: beforeId } });
    const prev = before
      ? await prisma.item.findFirst({ where: { groupId, deletedAt: null, position: { lt: before.position }, id: { not: id } }, orderBy: { position: "desc" } })
      : null;
    position = before ? ((prev?.position ?? before.position - 1) + before.position) / 2 : await nextPosition(groupId);
  } else {
    position = await nextPosition(groupId);
  }
  await prisma.item.update({ where: { id }, data: { groupId, position } });
  if (item.groupId !== groupId) {
    const target = await prisma.group.findUnique({ where: { id: groupId } });
    await prisma.activity.create({ data: { itemId: id, text: `${me.name} moved to ${target?.name}` } });
  }
}

export async function setCell(itemId: string, colId: string, value: CellValue | undefined) {
  await requireUser();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { values: true } });
  const values = { ...((item?.values ?? {}) as Record<string, CellValue>) };
  if (value === undefined || value === "") delete values[colId];
  else values[colId] = value;
  await prisma.item.update({ where: { id: itemId }, data: { values } });
}

export async function addUpdate(itemId: string, body: string) {
  const me = await requireUser();
  const [item, users] = await Promise.all([prisma.item.findUnique({ where: { id: itemId } }), prisma.user.findMany({ select: { id: true, name: true } })]);
  if (!item || !body.trim()) return;
  const mentioned = users.filter((u) => body.includes(`@${u.name}`) && u.id !== me.id);
  await prisma.$transaction([
    prisma.update.create({ data: { itemId, authorId: me.id, body } }),
    prisma.activity.create({ data: { itemId, text: `${me.name} posted an update` } }),
    prisma.notification.createMany({ data: mentioned.map((u) => ({ userId: u.id, itemId, text: `${me.name} mentioned you on “${item.name}”` })) }),
  ]);
}

// Subitems

export async function addSubtask(itemId: string, title: string) {
  const me = await requireUser();
  const count = await prisma.subtask.count({ where: { itemId } });
  await prisma.$transaction([
    prisma.subtask.create({ data: { itemId, title, position: count } }),
    prisma.activity.create({ data: { itemId, text: `${me.name} added subitem “${title}”` } }),
  ]);
}

export async function updateSubtask(id: string, patch: { done?: boolean; assignee?: string | null; title?: string }) {
  const me = await requireUser();
  const s = await prisma.subtask.update({ where: { id }, data: { done: patch.done, title: patch.title, assigneeId: patch.assignee === undefined ? undefined : patch.assignee } });
  if (patch.done !== undefined) await prisma.activity.create({ data: { itemId: s.itemId, text: `${me.name} ${patch.done ? "completed" : "reopened"} subitem “${s.title}”` } });
}

export async function deleteSubtask(id: string) {
  await requireUser();
  await prisma.subtask.delete({ where: { id } });
}

// Files

export async function addFile(itemId: string, name: string, url?: string) {
  const me = await requireUser();
  if (url && url.length > 1_500_000) throw new Error("File too large for the demo (max ~1MB image)");
  await prisma.$transaction([
    prisma.file.create({ data: { itemId, name, url } }),
    prisma.activity.create({ data: { itemId, text: `${me.name} attached ${name}` } }),
  ]);
}

export async function deleteFile(id: string) {
  await requireUser();
  await prisma.file.delete({ where: { id } });
}

// ── Boards, groups, columns ─────────────────────────

export async function createBoard(name: string, templateKey: string): Promise<string> {
  await requireUser();
  const tpl = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0];
  const made = tpl.make();
  const count = await prisma.board.count();
  const board = await prisma.board.create({
    data: {
      name: name.trim() || "Untitled board",
      description: tpl.key === "blank" ? "" : `Created from the ${tpl.name} template.`,
      statuses: made.statuses as unknown as Prisma.InputJsonValue,
      columns: made.columns as unknown as Prisma.InputJsonValue,
      position: count,
      groups: { create: made.groups.map((gr, i) => ({ ...gr, position: i })) },
    },
  });
  return board.id;
}

export async function updateBoard(id: string, patch: Partial<Pick<Board, "name" | "description" | "statuses" | "columns">>) {
  await requireUser();
  await prisma.board.update({
    where: { id },
    data: {
      name: patch.name,
      description: patch.description,
      statuses: patch.statuses as unknown as Prisma.InputJsonValue | undefined,
      columns: patch.columns as unknown as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function deleteBoard(id: string) {
  await requireUser();
  await prisma.board.delete({ where: { id } });
}

export async function addGroup(boardId: string, name: string, color: string) {
  await requireUser();
  const count = await prisma.group.count({ where: { boardId } });
  await prisma.group.create({ data: { boardId, name, color, position: count } });
}

export async function updateGroup(groupId: string, patch: Partial<Pick<Group, "name" | "color">>) {
  await requireUser();
  await prisma.group.update({ where: { id: groupId }, data: patch });
}

export async function deleteGroup(groupId: string) {
  await requireUser();
  await prisma.group.delete({ where: { id: groupId } });
}

// ── Notifications ────────────────────────────────────────────

export async function markRead() {
  const me = await requireUser();
  await prisma.notification.updateMany({ where: { userId: me.id, read: false }, data: { read: true } });
}

// ── Automations (admin) ──────────────────────────────────────

export async function addAutomation(a: Omit<Automation, "id" | "enabled">) {
  await requireUser();
  await prisma.automation.create({
    data: {
      boardId: a.boardId === "*" ? null : a.boardId,
      trigger: a.trigger as unknown as Prisma.InputJsonValue,
      action: a.action as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function toggleAutomation(id: string) {
  await requireUser();
  const a = await prisma.automation.findUnique({ where: { id } });
  if (a) await prisma.automation.update({ where: { id }, data: { enabled: !a.enabled } });
}

export async function deleteAutomation(id: string) {
  await requireUser();
  await prisma.automation.delete({ where: { id } });
}

// ── Public form (no login) ───────────────────────────────────

export async function submitForm(
  boardId: string,
  f: { name: string; description: string; priority: Priority; reporter: string; email: string; values: Record<string, string> },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = f.name.trim().slice(0, 200);
  const reporter = f.reporter.trim().slice(0, 100);
  const email = f.email.trim().slice(0, 200);
  if (!name || !reporter || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Please fill in all required fields." };
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(f.priority)) return { ok: false, error: "Invalid priority." };

  const board = await prisma.board.findUnique({ where: { id: boardId }, include: { groups: { orderBy: { position: "asc" }, take: 1 } } });
  if (!board?.groups[0]) return { ok: false, error: "This form is no longer available." };
  const columns = board.columns as unknown as Column[];
  const allowed = new Set(columns.filter((c) => c.type === "text" || c.type === "dropdown").map((c) => c.id));
  const values = Object.fromEntries(Object.entries(f.values).filter(([k, v]) => allowed.has(k) && v).map(([k, v]) => [k, String(v).slice(0, 500)]));

  // Automations run as a virtual "Form" actor.
  const formActor: Person = { id: "__form", name: reporter, email };
  await insertItem(
    board.id,
    board.groups[0].id,
    name,
    formActor,
    { description: `${f.description.slice(0, 5000)}\n\nSubmitted by ${reporter} <${email}>`, priority: f.priority, values },
    `${reporter} submitted this via the public form`,
  );
  return { ok: true };
}

export async function getFormBoard(boardId: string) {
  const b = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true, name: true, description: true, columns: true } });
  if (!b) return null;
  return { ...b, columns: (b.columns as unknown as Column[]).filter((c) => c.type === "text" || c.type === "dropdown") };
}
