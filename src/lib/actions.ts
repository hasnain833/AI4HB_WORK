"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createSession, destroySession, requireUser } from "./auth";
import { inngest, URGENT } from "./inngest";
import {
  TEMPLATES,
  defaultGroup,
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
    statuses: b.statuses as unknown as StatusDef[],
    columns: b.columns as unknown as Column[],
    groups: [...b.groups].sort((x, y) => x.position - y.position).map((gr) => ({ id: gr.id, name: gr.name, color: gr.color })),
  };
}

// ponytail: loads the whole workspace in one go, fine for a team-sized demo; paginate per board if it grows.
export async function getState(): Promise<WorkState> {
  const me = await requireUser();
  const [users, boards, items] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true }, orderBy: { createdAt: "asc" } }),
    prisma.board.findMany({ include: { groups: true }, orderBy: { createdAt: "asc" } }),
    prisma.item.findMany({ where: { deletedAt: null }, include: itemInclude, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  ]);
  return {
    me,
    users,
    boards: boards.map(toBoard),
    items: items.map(toItem),
  };
}

/** Slack alert (via Inngest) when an item ends up High/Critical and wasn't before. Never blocks the edit. */
async function alertIfUrgent(itemId: string, priority: Priority, prev: Priority | null, actor: Person) {
  if (!URGENT.includes(priority) || (prev && URGENT.includes(prev))) return;
  await inngest.send({ name: "work/item.urgent", data: { itemId, actor: actor.name } }).catch((e) => console.error("Slack alert not queued:", e));
}

// ── Items ────────────────────────────────────────────────────

async function nextPosition(groupId: string) {
  const last = await prisma.item.aggregate({ where: { groupId }, _max: { position: true } });
  return (last._max.position ?? 0) + 1;
}

type ItemExtra = Partial<Pick<Prisma.ItemUncheckedCreateInput, "description" | "priority" | "values" | "assigneeIds" | "status" | "due" | "createdById">>;

async function insertItem(boardId: string, groupId: string, name: string, actor: Person, extra: ItemExtra, firstActivity: string) {
  const row = await prisma.item.create({
    data: { ...extra, boardId, groupId, name, position: await nextPosition(groupId), activity: { create: { text: firstActivity } } },
  });
  await alertIfUrgent(row.id, row.priority, null, actor);
  return row.id;
}

const adminIds = async () => (await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((u) => u.id);

/** Sales users may only assign to admins; enforced here so the browser can't bypass it. */
async function checkAssignees(me: Person, ids?: string[]) {
  if (me.role !== "SALES" || !ids?.length) return;
  const admins = await adminIds();
  if (ids.some((id) => !admins.includes(id))) throw new Error("Sales can only assign tickets to an admin");
}

export async function createItem(boardId: string, groupId: string, name: string, f: NewItemFields = {}): Promise<string> {
  const me = await requireUser();
  await checkAssignees(me, f.assignees);
  // Pick fields explicitly so the client can't write anything else.
  const extra: ItemExtra = {
    createdById: me.id,
    status: f.status,
    priority: f.priority,
    // Sales tickets default to the admins
    assigneeIds: f.assignees?.length || me.role !== "SALES" ? f.assignees : await adminIds(),
    due: f.due || null,
    description: f.description,
    values: f.values as Prisma.InputJsonValue | undefined,
  };
  return insertItem(boardId, groupId, name.trim() || "New item", me, extra, `${me.name} created this item`);
}

export async function updateItems(ids: string[], patch: ItemPatch, activityText?: string) {
  const me = await requireUser();
  await checkAssignees(me, patch.assignees);
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
      due: "due" in patch ? patch.due || null : undefined,
    };
    if (activityText) data.activity = { create: { text: `${me.name} ${activityText}` } };
    const row = await prisma.item.update({ where: { id: p.id }, data });
    await alertIfUrgent(row.id, row.priority, p.priority, me);
  }
}

/** Undo for bulk edits: write back the previous field values. */
export async function restoreItems(snapshots: { id: string; status: string; priority: Priority; assignees: string[]; groupId: string }[]) {
  // ponytail: a Sales user can't undo back to a non-admin assignee; compare against the current value if that matters.
  await checkAssignees(await requireUser(), snapshots.flatMap((s) => s.assignees));
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
  if (!body.trim()) return;
  await prisma.$transaction([
    prisma.update.create({ data: { itemId, authorId: me.id, body } }),
    prisma.activity.create({ data: { itemId, text: `${me.name} posted an update` } }),
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
  const board = await prisma.board.create({
    data: {
      name: name.trim() || "Untitled board",
      description: tpl.key === "blank" ? "" : `Created from the ${tpl.name} template.`,
      statuses: made.statuses as unknown as Prisma.InputJsonValue,
      columns: made.columns as unknown as Prisma.InputJsonValue,
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

// ── Public form (no login) ───────────────────────────────────

export async function submitForm(
  boardId: string,
  f: { name: string; description: string; priority: Priority; reporter: string; email: string; values: Record<string, string>; files?: { name: string; url: string }[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = f.name.trim().slice(0, 200);
  const reporter = f.reporter.trim().slice(0, 100);
  const email = f.email.trim().slice(0, 200);
  if (!name || !reporter || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Please fill in all required fields." };
  if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(f.priority)) return { ok: false, error: "Invalid priority." };
  // Public endpoint: screenshots only, a few, small (they are stored inline).
  const files = f.files ?? [];
  if (files.length > 3 || files.some((x) => !/^data:image\/(png|jpeg|gif|webp);base64,/.test(x.url) || x.url.length > 700_000))
    return { ok: false, error: "Attach up to 3 images (screenshots)." };

  const board = await prisma.board.findUnique({ where: { id: boardId }, include: { groups: { orderBy: { position: "asc" } } } });
  const group = board && defaultGroup(board.groups);
  if (!board || !group) return { ok: false, error: "This form is no longer available." };
  const columns = board.columns as unknown as Column[];
  const allowed = new Set(columns.filter((c) => c.type === "text" || c.type === "dropdown").map((c) => c.id));
  const values = Object.fromEntries(Object.entries(f.values).filter(([k, v]) => allowed.has(k) && v).map(([k, v]) => [k, String(v).slice(0, 500)]));

  // Form submitters have no account; this names them in the Slack alert.
  const formActor: Person = { id: "__form", name: reporter, email };
  const id = await insertItem(
    board.id,
    group.id,
    name,
    formActor,
    { description: `${f.description.slice(0, 5000)}\n\nSubmitted by ${reporter} <${email}>`, priority: f.priority, values, assigneeIds: await adminIds() },
    `${reporter} submitted this via the public form`,
  );
  if (files.length) await prisma.file.createMany({ data: files.map((x) => ({ itemId: id, name: String(x.name).slice(0, 200), url: x.url })) });
  return { ok: true };
}

export async function getFormBoard(boardId: string) {
  const b = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true, name: true, description: true, columns: true } });
  if (!b) return null;
  return { ...b, columns: (b.columns as unknown as Column[]).filter((c) => c.type === "text" || c.type === "dropdown") };
}
