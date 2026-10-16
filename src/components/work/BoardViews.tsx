"use client";

import { useState } from "react";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ListChecks,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COLUMN_TYPES, DONE, GROUP_COLORS, PRIORITIES, TONES, isBlocked, prioMeta, statusOf, type Board, type Item, type Priority } from "@/lib/work";
import {
  addColumn,
  addGroup,
  createItem,
  setCell,
  deleteColumn,
  deleteGroup,
  moveItem,
  updateColumn,
  updateGroup,
  updateItem,
  updateSubtask,
  usePeople,
} from "./store";
import { CellEditor, PriorityPill, StatusSelect, fieldSelect } from "./ui";
import { confirmDialog } from "./dialogs";

const todayStr = () => format(new Date(), "yyyy-MM-dd");
const isOverdue = (i: Item) => !!i.due && i.status !== DONE && i.due < todayStr();

export type SortKey = "name" | "status" | "priority" | "due" | "creator";
export type Sort = { key: SortKey; dir: 1 | -1 } | null;

// ── Table (Monday-style groups) ──────────────────────────────

export function TableView({
  board,
  items,
  allItems,
  onOpen,
  sort,
  onSort,
  selected,
  onSelect,
}: {
  board: Board;
  items: Item[];
  allItems: Item[];
  onOpen: (id: string) => void;
  sort: Sort;
  onSort: (k: SortKey) => void;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
}) {
  const { nameOf } = usePeople();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const colCount = 7 + board.columns.length;

  const SortHead = ({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) => (
    <th className={`px-2 py-2 font-medium ${className}`}>
      <button className="inline-flex items-center gap-0.5 uppercase hover:text-foreground" onClick={() => onSort(k)}>
        {label}
        {sort?.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );

  const onDrop = (groupId: string, beforeId?: string) => {
    if (dragId) moveItem(dragId, groupId, beforeId);
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="space-y-6">
      {sort && <p className="text-xs text-muted-foreground">Sorted by {sort.key}. Clear the sort to drag rows.</p>}
      {board.groups.map((g) => {
        const rows = items.filter((i) => i.groupId === g.id);
        const open = !collapsed[g.id];
        const allSel = rows.length > 0 && rows.every((r) => selected.has(r.id));
        return (
          <section key={g.id}>
            <div className="mb-1 flex items-center gap-2">
              <button onClick={() => setCollapsed((c) => ({ ...c, [g.id]: open }))} style={{ color: g.color }}>
                <ChevronDown className={`size-4 transition ${open ? "" : "-rotate-90"}`} />
              </button>
              <input
                key={g.name}
                defaultValue={g.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== g.name && updateGroup(board.id, g.id, { name: e.target.value.trim() })}
                className="w-auto bg-transparent text-base font-semibold outline-none focus:underline"
                style={{ color: g.color }}
                size={Math.max(g.name.length, 4)}
              />
              <span className="text-xs text-muted-foreground">{rows.length} items</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded p-0.5 text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-xs">Group color</DropdownMenuLabel>
                  <div className="flex gap-1.5 px-2 pb-2">
                    {GROUP_COLORS.map((c) => (
                      <button key={c} className="size-5 rounded-full ring-offset-2 hover:ring-2" style={{ background: c }} onClick={() => updateGroup(board.id, g.id, { color: c })} />
                    ))}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    disabled={board.groups.length <= 1}
                    onSelect={async () => {
                      if (await confirmDialog(`Delete group “${g.name}” and its ${rows.length} items?`)) deleteGroup(board.id, g.id);
                    }}
                  >
                    Delete group
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {open && (
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full min-w-225 text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b">
                      <th className="w-8 border-l-4 py-2 pl-2" style={{ borderLeftColor: g.color }}>
                        <input type="checkbox" className="accent-[#0e1623] dark:accent-[#d4a853]" checked={allSel} onChange={(e) => onSelect(rows.map((r) => r.id), e.target.checked)} />
                      </th>
                      <SortHead k="name" label="Item" className="min-w-72" />
                      <SortHead k="creator" label="Created by" className="w-40" />
                      <SortHead k="status" label="Status" className="w-36 text-center" />
                      <SortHead k="priority" label="Priority" className="w-28 text-center" />
                      <th className="w-32 px-2 py-2 font-medium">Timeline</th>
                      <SortHead k="due" label="Due" className="w-20" />
                      {board.columns.map((c) => (
                        <th key={c.id} className="group/col w-36 px-2 py-2 font-medium">
                          <div className="flex items-center gap-1">
                            <input
                              key={c.name}
                              defaultValue={c.name}
                              title={`${COLUMN_TYPES.find((t) => t.type === c.type)?.label} column. Click to rename`}
                              onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && updateColumn(board, c.id, { name: e.target.value.trim() })}
                              className="w-full min-w-0 bg-transparent uppercase outline-none focus:normal-case focus:text-foreground"
                            />
                              <button
                                className="hidden text-muted-foreground hover:text-red-600 group-hover/col:block"
                                title="Delete column"
                                onClick={async () => (await confirmDialog(`Delete column “${c.name}”?`)) && deleteColumn(board, c.id)}
                              >
                                <X className="size-3" />
                              </button>
                          </div>
                        </th>
                      ))}
                      <th className="w-10 px-1 py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex size-6 items-center justify-center rounded hover:bg-muted" title="Add column"><Plus className="size-4" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-xs">Add column</DropdownMenuLabel>
                            {COLUMN_TYPES.map((t) => (
                              <DropdownMenuItem key={t.type} onSelect={() => addColumn(board, t.type)}>{t.label}</DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((i) => {
                      const showSubs = expanded[i.id];
                      const blocked = isBlocked(i, allItems);
                      return [
                        <tr
                          key={i.id}
                          draggable={!sort}
                          onDragStart={(e) => { setDragId(i.id); e.dataTransfer.effectAllowed = "move"; }}
                          onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                          onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTarget(i.id); } }}
                          onDrop={(e) => { e.preventDefault(); onDrop(g.id, i.id); }}
                          className={`group border-b hover:bg-muted/30 ${selected.has(i.id) ? "bg-[#b48c3c]/5" : ""} ${dragId === i.id ? "opacity-40" : ""} ${dropTarget === i.id && dragId !== i.id ? "border-t-2 border-t-[#b48c3c]" : ""}`}
                        >
                          <td className="border-l-4 py-2 pl-2" style={{ borderLeftColor: g.color }}>
                            <input type="checkbox" className="accent-[#0e1623] dark:accent-[#d4a853]" checked={selected.has(i.id)} onChange={(e) => onSelect([i.id], e.target.checked)} />
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              {!sort && <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground/0 group-hover:text-muted-foreground" />}
                              <button
                                className={`shrink-0 text-muted-foreground transition ${i.subtasks.length ? "" : "invisible"}`}
                                onClick={() => setExpanded((x) => ({ ...x, [i.id]: !x[i.id] }))}
                                title="Show subitems"
                              >
                                <ChevronRight className={`size-3.5 transition ${showSubs ? "rotate-90" : ""}`} />
                              </button>
                              {blocked && <span title="Blocked by a dependency"><Lock className="size-3.5 shrink-0 text-red-500" /></span>}
                              <button onClick={() => onOpen(i.id)} className="truncate text-left font-medium group-hover:underline">{i.name}</button>
                              <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-xs text-muted-foreground">
                                {i.subtasks.length > 0 && (
                                  <span className="flex items-center gap-0.5"><ListChecks className="size-3.5" />{i.subtasks.filter((s) => s.done).length}/{i.subtasks.length}</span>
                                )}
                                <button onClick={() => onOpen(i.id)} className="flex items-center gap-0.5 hover:text-foreground" title="Updates">
                                  <MessageSquare className="size-3.5" />{i.updates.length || ""}
                                </button>
                              </span>
                            </div>
                          </td>
                          <td className="truncate px-2 py-1">{i.createdBy ? nameOf(i.createdBy) : <span className="text-muted-foreground">—</span>}</td>
                          <td className="px-2 py-1"><StatusSelect board={board} value={i.status} onChange={(v) => updateItem(i.id, { status: v }, `changed status to ${statusOf(board, v).label}`)} /></td>
                          <td className="px-2 py-1">
                            <select
                              className={`${fieldSelect} ${TONES[prioMeta(i.priority).tone].pill}`}
                              value={i.priority}
                              onChange={(e) => updateItem(i.id, { priority: e.target.value as Priority }, `set priority to ${prioMeta(e.target.value as Priority).label}`)}
                            >
                              {PRIORITIES.map((p) => <option key={p.key} value={p.key} className="bg-background text-foreground">{p.label}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1 text-xs text-muted-foreground">
                            {i.start && i.due ? `${format(parseISO(i.start), "MMM d")} – ${format(parseISO(i.due), "MMM d")}` : "—"}
                          </td>
                          <td className={`px-2 py-1 text-xs ${isOverdue(i) ? "font-semibold text-red-600" : "text-muted-foreground"}`}>
                            {i.due ? format(parseISO(i.due), "MMM d") : "—"}
                          </td>
                          {board.columns.map((c) => <td key={c.id} className="px-1 py-1"><CellEditor col={c} value={i.values[c.id]} onChange={(v) => setCell(i.id, c.id, v)} /></td>)}
                          <td />
                        </tr>,
                        ...(showSubs
                          ? i.subtasks.map((s) => (
                            <tr key={s.id} className="border-b bg-muted/20 text-xs">
                              <td className="border-l-4" style={{ borderLeftColor: `${g.color}55` }} />
                              <td className="py-1.5 pl-12 pr-2">
                                <div className="flex items-center gap-2">
                                  <button
                                    className={`flex size-3.5 items-center justify-center rounded border ${s.done ? "border-emerald-600 bg-emerald-600 text-white" : ""}`}
                                    onClick={() => updateSubtask(i.id, s.id, { done: !s.done })}
                                  >
                                    {s.done && <Check className="size-2.5" />}
                                  </button>
                                  <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.title}</span>
                                </div>
                              </td>
                              <td className="px-2 text-muted-foreground">{s.assignee ? nameOf(s.assignee) : "—"}</td>
                              <td colSpan={colCount - 2} />
                            </tr>
                          ))
                          : []),
                      ];
                    })}
                    <tr
                      onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropTarget(`end-${g.id}`); } }}
                      onDrop={(e) => { e.preventDefault(); onDrop(g.id); }}
                      className={dropTarget === `end-${g.id}` ? "border-t-2 border-t-[#b48c3c]" : ""}
                    >
                      <td colSpan={colCount + 1} className="border-l-4 px-3 py-1.5" style={{ borderLeftColor: `${g.color}55` }}>
                        <input
                          placeholder="+ Add item (Enter)"
                          className="w-full bg-transparent pl-8 text-sm outline-none placeholder:text-muted-foreground"
                          onKeyDown={(e) => {
                            const v = e.currentTarget.value.trim();
                            if (e.key === "Enter" && v) {
                              createItem(board.id, g.id, v);
                              e.currentTarget.value = "";
                            }
                          }}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
                {rows.length > 0 && <GroupFooter board={board} items={rows} />}
              </div>
            )}
          </section>
        );
      })}

      <div className="flex max-w-sm gap-2">
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newGroup.trim()) { addGroup(board, newGroup.trim()); setNewGroup(""); } }}
          placeholder="New group name"
          className="h-8 flex-1 rounded-lg border bg-background px-2 text-sm outline-none"
        />
        <Button variant="outline" onClick={() => { if (newGroup.trim()) addGroup(board, newGroup.trim()); setNewGroup(""); }}>
          <Plus /> Add group
        </Button>
      </div>
    </div>
  );
}

/** Monday's group footer: status distribution + number column sums. */
function GroupFooter({ board, items }: { board: Board; items: Item[] }) {
  const numberCols = board.columns.filter((c) => c.type === "number");
  return (
    <div className="flex flex-wrap items-center justify-end gap-4 px-3 py-2 text-[11px] text-muted-foreground">
      {numberCols.map((c) => (
        <span key={c.id}>
          {c.name}: <span className="font-semibold tabular-nums text-foreground">{items.reduce((sum, i) => sum + (Number(i.values[c.id]) || 0), 0)}</span>
        </span>
      ))}
      <span>Progress</span>
      <div className="flex h-2 w-48 overflow-hidden rounded-full bg-muted">
        {board.statuses.map((s) => {
          const n = items.filter((i) => i.status === s.key).length;
          return n ? <div key={s.key} className={TONES[s.tone].dot} style={{ width: `${(n / items.length) * 100}%` }} title={`${s.label}: ${n}`} /> : null;
        })}
      </div>
    </div>
  );
}

// ── Kanban ───────────────────────────────────────────────────

export function KanbanView({ board, items, allItems, onOpen }: { board: Board; items: Item[]; allItems: Item[]; onOpen: (id: string) => void }) {
  const { nameOf } = usePeople();
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {board.statuses.map((col) => {
        const cards = items.filter((i) => i.status === col.key);
        return (
          <div
            key={col.key}
            onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              const item = items.find((i) => i.id === id);
              if (item && item.status !== col.key) updateItem(id, { status: col.key }, `changed status to ${col.label}`);
            }}
            className={`flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 p-2 ${over === col.key ? "ring-2 ring-primary/40" : ""}`}
          >
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`size-2.5 rounded-full ${TONES[col.tone].dot}`} />
              <span className="text-sm font-semibold">{col.label}</span>
              <span className="ml-auto rounded-full bg-background px-2 text-xs text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex min-h-24 flex-col gap-2">
              {cards.map((i) => (
                <div
                  key={i.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", i.id)}
                  onClick={() => onOpen(i.id)}
                  className="cursor-grab rounded-lg border bg-card p-3 shadow-sm transition hover:shadow-md active:cursor-grabbing"
                >
                  <div className="flex gap-1.5 text-sm font-medium leading-snug">
                    {isBlocked(i, allItems) && <Lock className="mt-0.5 size-3.5 shrink-0 text-red-500" />}
                    {i.name}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{board.groups.find((x) => x.id === i.groupId)?.name}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <PriorityPill priority={i.priority} />
                    {i.due && <span className={isOverdue(i) ? "font-semibold text-red-600" : ""}>{format(parseISO(i.due), "MMM d")}</span>}
                    {i.subtasks.length > 0 && (
                      <span className="flex items-center gap-0.5"><ListChecks className="size-3.5" />{i.subtasks.filter((s) => s.done).length}/{i.subtasks.length}</span>
                    )}
                    {i.updates.length > 0 && <span className="flex items-center gap-0.5"><MessageSquare className="size-3.5" />{i.updates.length}</span>}
                  </div>
                  <div className="mt-2 truncate text-xs text-muted-foreground">{i.createdBy ? `Created by ${nameOf(i.createdBy)}` : ""}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Calendar ─────────────────────────────────────────────────

export function CalendarView({ board, items, onOpen }: { board: Board; items: Item[]; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);
  const days = eachDayOfInterval({ start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) });
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button variant="ghost" size="icon-sm" onClick={() => setMonth((m) => addMonths(m, -1))}><ChevronLeft /></Button>
        <span className="w-36 text-center font-semibold">{format(month, "MMMM yyyy")}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => setMonth((m) => addMonths(m, 1))}><ChevronRight /></Button>
        <Button variant="outline" size="sm" className="ml-2" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
        <span className="ml-auto text-xs text-muted-foreground">Drag an item to another day to change its due date</span>
      </div>
      <div className="grid grid-cols-7 border-b text-center text-[11px] uppercase tracking-wide text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const due = items.filter((i) => i.due === key);
          return (
            <div
              key={key}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) updateItem(dragId, { due: key }, `moved due date to ${format(d, "MMM d")}`);
                setDragId(null);
              }}
              className={`min-h-24 border-b border-r p-1 ${isSameMonth(d, month) ? "" : "bg-muted/30 text-muted-foreground"}`}
            >
              <div className={`mb-1 flex size-6 items-center justify-center rounded-full text-xs ${isToday(d) ? "bg-primary font-semibold text-primary-foreground" : ""}`}>
                {format(d, "d")}
              </div>
              <div className="space-y-1">
                {due.map((i) => (
                  <button
                    key={i.id}
                    draggable
                    onDragStart={() => setDragId(i.id)}
                    onClick={() => onOpen(i.id)}
                    className={`block w-full cursor-grab truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${TONES[statusOf(board, i.status).tone].pill}`}
                    title={i.name}
                  >
                    {i.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Timeline (Gantt) ─────────────────────────────────────────

export function TimelineView({ board, items, allItems, onOpen }: { board: Board; items: Item[]; allItems: Item[]; onOpen: (id: string) => void }) {
  const { nameOf } = usePeople();
  const start = addDays(startOfWeek(new Date()), -7);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const col = 28; // px per day
  const todayOffset = differenceInCalendarDays(new Date(), start);

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <div style={{ width: 260 + days.length * col }}>
        <div className="sticky top-0 flex border-b bg-card text-[10px] text-muted-foreground">
          <div className="w-65 shrink-0 px-3 py-2 text-[11px] font-medium uppercase tracking-wide">Item</div>
          {days.map((d) => (
            <div key={d.toISOString()} style={{ width: col }} className={`shrink-0 border-l py-1 text-center ${isToday(d) ? "font-bold text-foreground" : ""}`}>
              <div>{format(d, "EEEEE")}</div>
              <div>{format(d, "d")}</div>
            </div>
          ))}
        </div>
        {board.groups.map((g) => {
          const rows = items.filter((i) => i.groupId === g.id);
          if (!rows.length) return null;
          return (
            <div key={g.id}>
              <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold" style={{ color: g.color }}>{g.name}</div>
              {rows.map((i) => {
                const s = i.start ? parseISO(i.start) : i.due ? parseISO(i.due) : null;
                const e = i.due ? parseISO(i.due) : s;
                const left = s ? differenceInCalendarDays(s, start) : 0;
                const width = s && e ? differenceInCalendarDays(e, s) + 1 : 0;
                const blocked = isBlocked(i, allItems);
                return (
                  <div key={i.id} className="relative flex h-9 items-center border-b">
                    <button onClick={() => onOpen(i.id)} className="flex w-65 shrink-0 items-center gap-1 truncate px-3 text-left text-sm hover:underline">
                      {blocked && <Lock className="size-3 shrink-0 text-red-500" />}
                      <span className="truncate">{i.name}</span>
                    </button>
                    <div className="relative h-full flex-1">
                      <div className="absolute inset-y-0 w-px bg-red-500/60" style={{ left: todayOffset * col + col / 2 }} />
                      {s && left + width > 0 && (
                        <button
                          onClick={() => onOpen(i.id)}
                          title={`${i.name} · ${statusOf(board, i.status).label}${blocked ? " · blocked" : ""}`}
                          className={`absolute top-1.5 h-6 truncate rounded-full px-2 text-left text-[11px] font-medium ${TONES[statusOf(board, i.status).tone].pill} ${blocked ? "outline-1 outline-dashed outline-red-500" : ""}`}
                          style={{ left: Math.max(left, 0) * col, width: Math.max(width + Math.min(left, 0), 1) * col }}
                        >
                          {i.assignees[0] ? nameOf(i.assignees[0]) : ""}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
