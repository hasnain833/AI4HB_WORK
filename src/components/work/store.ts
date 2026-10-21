"use client";

// Client cache of the workspace. Mutations call server actions, then re-fetch.
// Simple edits are applied optimistically so the UI feels instant.

import { createContext, useContext, useSyncExternalStore } from "react";
import { toast } from "sonner";
import * as api from "@/lib/actions";
import { GROUP_COLORS, COLUMN_TYPES, assignableUsers, type Board, type CellValue, type ColumnType, type Group, type Item, type ItemPatch, type NewItemFields, type Person, type WorkState } from "@/lib/work";

let state: WorkState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function initState(s: WorkState) {
  if (!state) state = s;
}

export function useWork(): WorkState | null {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => state,
  );
}

let refreshing: Promise<void> | null = null;
export function refresh() {
  refreshing ??= api
    .getState()
    .then((s) => { state = s; emit(); })
    .catch(() => {})
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function run<T>(p: Promise<T>, optimistic?: (s: WorkState) => WorkState): Promise<T | undefined> {
  if (optimistic && state) { state = optimistic(state); emit(); }
  try {
    return await p;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Something went wrong");
    return undefined;
  } finally {
    await refresh();
  }
}

const patchItems = (ids: string[], fn: (i: Item) => Item) => (s: WorkState) => ({ ...s, items: s.items.map((i) => (ids.includes(i.id) ? fn(i) : i)) });
const patchBoard = (id: string, fn: (b: Board) => Board) => (s: WorkState) => ({ ...s, boards: s.boards.map((b) => (b.id === id ? fn(b) : b)) });


export const PeopleContext = createContext<Person[]>([]);
export function usePeople() {
  const people = useContext(PeopleContext);
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.name ?? "Unknown";
  return { people, nameOf, names: (ids: string[]) => ids.map(nameOf).join(", ") };
}
export function useAssignable() {
  const s = useWork();
  return s ? assignableUsers(s.me, s.users) : [];
}


type UndoOp = () => Promise<unknown>;
const undoStack: UndoOp[] = [];
export function undo(): boolean {
  const op = undoStack.pop();
  if (!op) return false;
  void run(op());
  return true;
}

// ── Items ────────────────────────────────────────────────────

export const createItem = (boardId: string, groupId: string, name: string, fields?: NewItemFields) => run(api.createItem(boardId, groupId, name, fields));

export const updateItem = (id: string, patch: ItemPatch, activityText?: string) => updateItems([id], patch, activityText);

export function updateItems(ids: string[], patch: ItemPatch, activityText?: string) {
  if (ids.length > 1 && state) {
    const snap = state.items.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, status: i.status, priority: i.priority, assignees: i.assignees, groupId: i.groupId }));
    undoStack.push(() => api.restoreItems(snap));
  }
  return run(api.updateItems(ids, patch, activityText), patchItems(ids, (i) => ({ ...i, ...patch })));
}

export function deleteItems(ids: string[]) {
  undoStack.push(() => api.undeleteItems(ids));
  return run(api.deleteItems(ids), (s) => ({ ...s, items: s.items.filter((i) => !ids.includes(i.id)) }));
}

export const duplicateItem = (id: string) => run(api.duplicateItem(id));

export function moveItem(id: string, groupId: string, beforeId?: string) {
  return run(api.moveItem(id, groupId, beforeId), (s) => {
    const item = s.items.find((i) => i.id === id);
    if (!item) return s;
    const rest = s.items.filter((i) => i.id !== id);
    let idx = beforeId ? rest.findIndex((i) => i.id === beforeId) : -1;
    if (idx < 0) idx = rest.map((i) => i.groupId === groupId).lastIndexOf(true) + 1 || rest.length;
    return { ...s, items: [...rest.slice(0, idx), { ...item, groupId }, ...rest.slice(idx)] };
  });
}

export const setCell = (itemId: string, colId: string, value: CellValue | undefined) =>
  run(api.setCell(itemId, colId, value), patchItems([itemId], (i) => {
    const values = { ...i.values };
    if (value === undefined || value === "") delete values[colId];
    else values[colId] = value;
    return { ...i, values };
  }));

export const addUpdate = (itemId: string, body: string) => run(api.addUpdate(itemId, body));

export const addSubtask = (itemId: string, title: string) => run(api.addSubtask(itemId, title));
export const updateSubtask = (itemId: string, id: string, patch: { done?: boolean; assignee?: string | null }) =>
  run(api.updateSubtask(id, patch), patchItems([itemId], (i) => ({ ...i, subtasks: i.subtasks.map((s) => (s.id === id ? { ...s, done: patch.done ?? s.done, assignee: patch.assignee === undefined ? s.assignee : (patch.assignee ?? undefined) } : s)) })));
export const deleteSubtask = (itemId: string, id: string) =>
  run(api.deleteSubtask(id), patchItems([itemId], (i) => ({ ...i, subtasks: i.subtasks.filter((s) => s.id !== id) })));

export const addFile = (itemId: string, name: string, content?: string | Blob) =>
  run(api.addFile(itemId, name, content)).then((err) => { if (err) toast.error(err); });
export const deleteFile = (itemId: string, id: string) =>
  run(api.deleteFile(id), patchItems([itemId], (i) => ({ ...i, files: i.files.filter((f) => f.id !== id) })));

// ── Boards ───────────────────────────────────────────────────

export const createProject = (name: string) => run(api.createProject(name));
export const renameProject = (id: string, name: string) =>
  run(api.renameProject(id, name), (s) => ({ ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)) }));
export const deleteProject = (id: string) => run(api.deleteProject(id), (s) => ({ ...s, projects: s.projects.filter((p) => p.id !== id) }));

export const createBoard = (name: string, templateKey: string, projectId: string) => run(api.createBoard(name, templateKey, projectId));
export const updateBoard = (id: string, patch: Partial<Pick<Board, "name" | "description" | "statuses" | "columns" | "projectId">>) =>
  run(api.updateBoard(id, patch), patchBoard(id, (b) => ({ ...b, ...patch })));
export const deleteBoard = (id: string) => run(api.deleteBoard(id), (s) => ({ ...s, boards: s.boards.filter((b) => b.id !== id) }));

export function addGroup(board: Board, name: string) {
  return run(api.addGroup(board.id, name, GROUP_COLORS[board.groups.length % GROUP_COLORS.length]));
}
export const updateGroup = (boardId: string, groupId: string, patch: Partial<Pick<Group, "name" | "color">>) =>
  run(api.updateGroup(groupId, patch), patchBoard(boardId, (b) => ({ ...b, groups: b.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) })));
export const deleteGroup = (boardId: string, groupId: string) =>
  run(api.deleteGroup(groupId), patchBoard(boardId, (b) => ({ ...b, groups: b.groups.filter((g) => g.id !== groupId) })));

export function addColumn(board: Board, type: ColumnType) {
  const label = COLUMN_TYPES.find((c) => c.type === type)!.label;
  return updateBoard(board.id, { columns: [...board.columns, { id: crypto.randomUUID(), name: label, type, options: type === "dropdown" ? ["Option 1", "Option 2", "Option 3"] : undefined }] });
}
export const updateColumn = (board: Board, colId: string, patch: Partial<Board["columns"][number]>) =>
  updateBoard(board.id, { columns: board.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) });
export const deleteColumn = (board: Board, colId: string) => updateBoard(board.id, { columns: board.columns.filter((c) => c.id !== colId) });

