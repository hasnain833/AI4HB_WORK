"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { format, parseISO, addDays } from "date-fns";
import {
  CalendarDays,
  ClipboardList,
  GanttChart,
  Home,
  KanbanSquare,
  Keyboard,
  LayoutList,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Table2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logout } from "@/lib/actions";
import { DONE, PRIORITIES, TONES, statusOf, type Board, type Item, type Priority, type WorkState } from "@/lib/work";
import {
  PeopleContext,
  deleteItems,
  initState,
  refresh,
  undo,
  updateItems,
  usePeople,
  useWork,
} from "./store";
import { CalendarView, KanbanView, TableView, TimelineView, type Sort, type SortKey } from "./BoardViews";
import { ItemDrawer, NewItemDrawer } from "./ItemDrawer";
import { BoardSettingsDialog, ConfirmHost, NewBoardDialog, SearchDialog } from "./dialogs";
import { StatusPill, plainSelect } from "./ui";

type Page = { kind: "home" } | { kind: "board"; id: string };
type View = "table" | "kanban" | "calendar" | "timeline";

const VIEWS: { key: View; label: string; icon: typeof Table2 }[] = [
  { key: "table", label: "Table", icon: Table2 },
  { key: "kanban", label: "Kanban", icon: KanbanSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "timeline", label: "Timeline", icon: GanttChart },
];

const POLL_MS = 5000; // ponytail: polling for teammates' changes; switch to Supabase Realtime if it needs to be instant

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
};

export function WorkApp({ initial }: { initial: WorkState }) {
  useState(() => initState(initial));
  const state = useWork() ?? initial;
  const [page, setPage] = useState<Page>(() => (initial.boards[0] ? { kind: "board", id: initial.boards[0].id } : { kind: "home" }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [newFor, setNewFor] = useState<string | null>(null); // board id the new-item drawer is open for
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Pick up teammates' changes
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing(e)) {
        e.preventDefault();
        if (undo()) toast("Undone");
      } else if (e.key === "Escape") {
        setOpenId(null);
        setNewFor(null);
      } else if (e.key === "?" && !typing(e)) {
        setHelpOpen((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = state.items.find((i) => i.id === openId);
  const newBoard = state.boards.find((b) => b.id === newFor);
  const go = (p: Page) => { setPage(p); setNavOpen(false); };
  const boardExists = page.kind !== "board" || state.boards.some((b) => b.id === page.id);

  return (
    <PeopleContext.Provider value={state.users}>
      <div className="flex min-h-screen bg-background text-foreground">
        <Sidebar state={state} page={page} go={go} open={navOpen} onSearch={() => setSearchOpen(true)} onNewBoard={() => setNewBoardOpen(true)} onHelp={() => setHelpOpen(true)} />
        {navOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setNavOpen(false)} />}

        <main className="min-w-0 flex-1 px-4 py-5 md:px-8">
          <div className="mb-3 flex items-center gap-2 md:hidden">
            <Button variant="outline" size="icon" onClick={() => setNavOpen(true)}><Menu /></Button>
            <Button variant="outline" size="icon" onClick={() => setSearchOpen(true)}><Search /></Button>
          </div>
          {(page.kind === "home" || !boardExists) && <Dashboard state={state} onOpen={setOpenId} />}
          {page.kind === "board" && boardExists && (
            <BoardPage key={page.id} state={state} boardId={page.id} onOpen={setOpenId} onNew={() => setNewFor(page.id)} onDeleted={() => go({ kind: "home" })} />
          )}
        </main>

        {open && <ItemDrawer item={open} state={state} onClose={() => setOpenId(null)} onOpen={setOpenId} />}
        {newBoard && <NewItemDrawer key={newBoard.id} board={newBoard} onClose={() => setNewFor(null)} onCreated={() => setNewFor(null)} />}
        <SearchDialog state={state} open={searchOpen} onClose={() => setSearchOpen(false)} onOpenItem={setOpenId} onOpenBoard={(id) => go({ kind: "board", id })} />
        <NewBoardDialog
          open={newBoardOpen}
          onClose={() => setNewBoardOpen(false)}
          onCreated={(id) => go({ kind: "board", id })}
        />
        <ConfirmHost />
        {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      </div>
    </PeopleContext.Provider>
  );
}

// ── Sidebar ──────────────────────────────────────────────────

function Sidebar({ state, page, go, open, onSearch, onNewBoard, onHelp }: { state: WorkState; page: Page; go: (p: Page) => void; open: boolean; onSearch: () => void; onNewBoard: () => void; onHelp: () => void }) {
  const { resolvedTheme, setTheme } = useTheme();
  const navCls = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-white transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="px-5 pb-3 pt-5">
        <BrandLogo className="h-9 w-auto" onDark />
        <div className="mt-2 text-[11px] uppercase tracking-widest text-white/40">Work Management</div>
      </div>

      <div className="px-3 pb-2">
        <button onClick={onSearch} className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-white/50 hover:bg-white/10">
          <Search className="size-4" /> Search
          <kbd className="ml-auto rounded border border-white/20 px-1 text-[10px]">Ctrl K</kbd>
        </button>
      </div>

      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3">
        <button className={navCls(page.kind === "home")} onClick={() => go({ kind: "home" })}><Home className="size-4" /> Dashboard</button>

        <div className="flex items-center justify-between px-3 pb-1 pt-5">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Boards</span>
          <button onClick={onNewBoard} className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white" title="New board"><Plus className="size-3.5" /></button>
        </div>
        {state.boards.map((b) => {
          const openCount = state.items.filter((i) => i.boardId === b.id && i.status !== DONE).length;
          const active = page.kind === "board" && page.id === b.id;
          return (
            <button key={b.id} className={navCls(active)} onClick={() => go({ kind: "board", id: b.id })}>
              <LayoutList className={`size-4 shrink-0 ${active ? "text-[#d4a853]" : ""}`} />
              <span className="truncate">{b.name}</span>
              {openCount > 0 && <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[11px] text-white/60">{openCount}</span>}
            </button>
          );
        })}
        {state.boards.length === 0 && (
          <button onClick={onNewBoard} className="mx-1 mt-1 flex w-[calc(100%-0.5rem)] items-center justify-center gap-2 rounded-lg border border-dashed border-white/15 px-3 py-3 text-sm text-white/50 hover:border-white/30 hover:text-white">
            <Plus className="size-4" /> Create your first board
          </button>
        )}
      </nav>

      <div className="space-y-2 border-t border-white/10 p-3">
        <div className="flex items-center gap-2 px-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{state.me.name}</div>
            <div className="truncate text-[11px] text-white/40">{state.me.email}</div>
          </div>
          <form action={logout}>
            <button className="rounded-lg p-1.5 text-white/50 hover:bg-white/5 hover:text-white" title="Log out"><LogOut className="size-4" /></button>
          </form>
        </div>
        <div className="flex gap-1">
          <button onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-white/50 hover:bg-white/5 hover:text-white" title="Toggle theme">
            <Sun className="hidden size-3.5 dark:block" /><Moon className="size-3.5 dark:hidden" /> Theme
          </button>
          <button onClick={onHelp} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-white/50 hover:bg-white/5 hover:text-white" title="Keyboard shortcuts (?)">
            <Keyboard className="size-3.5" /> Keys
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Board ────────────────────────────────────────────────────

const PRIO_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function BoardPage({ state, boardId, onOpen, onNew, onDeleted }: { state: WorkState; boardId: string; onOpen: (id: string) => void; onNew: () => void; onDeleted: () => void }) {
  const { people, nameOf } = usePeople();
  const [view, setView] = useState<View>("table");
  const [q, setQ] = useState("");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const board = state.boards.find((b) => b.id === boardId)!;

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = state.items.filter(
      (i) =>
        i.boardId === boardId &&
        (!s || i.name.toLowerCase().includes(s)) &&
        (!person || (person === "__none" ? i.assignees.length === 0 : i.assignees.includes(person))) &&
        (!status || i.status === status),
    );
    if (!sort) return list;
    const idx = (k: string) => board.statuses.findIndex((x) => x.key === k);
    const val = (i: Item): string | number =>
      sort.key === "name" ? i.name.toLowerCase()
        : sort.key === "status" ? idx(i.status)
          : sort.key === "priority" ? PRIO_RANK[i.priority]
            : sort.key === "due" ? (i.due ?? "9999")
              : i.assignees[0] ? nameOf(i.assignees[0]) : "~";
    return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.items, boardId, q, person, status, sort, board.statuses]);

  // "n" = new item
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !typing(e) && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onSort = (k: SortKey) => setSort((s) => (s?.key !== k ? { key: k, dir: 1 } : s.dir === 1 ? { key: k, dir: -1 } : null));
  const onSelect = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const sel = [...selected].filter((id) => state.items.some((i) => i.id === id));

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{board.name}</h1>
          {board.description && <p className="text-sm text-muted-foreground">{board.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              const url = `${window.location.origin}/form/${board.id}`;
              navigator.clipboard?.writeText(url).catch(() => {});
              window.open(url, "_blank");
              toast.success("Form link copied", { description: "Anyone with the link can submit items to this board." });
            }}
          >
            <ClipboardList /> Share form
          </Button>
          <Button variant="outline" size="icon" title="Board settings" onClick={() => setSettingsOpen(true)}><Settings /></Button>
          <Button onClick={onNew} title="New item (N)"><Plus /> New item</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <div className="flex rounded-lg border p-0.5">
          {VIEWS.map((v) => (
            <Button key={v.key} size="sm" variant={view === v.key ? "secondary" : "ghost"} onClick={() => setView(v.key)}>
              <v.icon /> {v.label}
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Filter items" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={plainSelect} value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Everyone</option>
          <option value="__none">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className={plainSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {board.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {(q || person || status || sort) && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); setPerson(""); setStatus(""); setSort(null); }}>
            <X /> Clear
          </Button>
        )}
      </div>

      {view === "table" && <TableView board={board} items={items} allItems={state.items} onOpen={onOpen} sort={sort} onSort={onSort} selected={selected} onSelect={onSelect} />}
      {view === "kanban" && <KanbanView board={board} items={items} allItems={state.items} onOpen={onOpen} />}
      {view === "calendar" && <CalendarView board={board} items={items} onOpen={onOpen} />}
      {view === "timeline" && <TimelineView board={board} items={items} allItems={state.items} onOpen={onOpen} />}

      {sel.length > 0 && <BulkBar board={board} ids={sel} onClear={() => setSelected(new Set())} />}
      <BoardSettingsDialog board={board} open={settingsOpen} onClose={() => setSettingsOpen(false)} onDeleted={onDeleted} />
    </div>
  );
}

function BulkBar({ board, ids, onClear }: { board: Board; ids: string[]; onClear: () => void }) {
  const { people } = usePeople();
  const bar = "h-8 rounded-lg bg-white/10 px-2 text-sm text-white outline-none";
  const undoToast = (msg: string) => toast(msg, { action: { label: "Undo", onClick: () => undo() } });
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl bg-[#0e1623] px-4 py-2.5 text-white shadow-2xl">
      <span className="text-sm font-medium">{ids.length} selected</span>
      <select className={bar} value="" onChange={(e) => { updateItems(ids, { status: e.target.value }, `changed status to ${statusOf(board, e.target.value).label}`); undoToast(`Updated ${ids.length} items`); }}>
        <option value="" disabled>Set status</option>
        {board.statuses.map((s) => <option key={s.key} value={s.key} className="text-foreground">{s.label}</option>)}
      </select>
      <select className={bar} value="" onChange={(e) => { updateItems(ids, { priority: e.target.value as Priority }, "changed priority"); undoToast(`Updated ${ids.length} items`); }}>
        <option value="" disabled>Set priority</option>
        {PRIORITIES.map((p) => <option key={p.key} value={p.key} className="text-foreground">{p.label}</option>)}
      </select>
      <select className={bar} value="" onChange={(e) => { const p = people.find((x) => x.id === e.target.value); updateItems(ids, { assignees: [e.target.value] }, `assigned ${p?.name}`); undoToast(`Assigned ${ids.length} items`); }}>
        <option value="" disabled>Assign to</option>
        {people.map((p) => <option key={p.id} value={p.id} className="text-foreground">{p.name}</option>)}
      </select>
      <select className={bar} value="" onChange={(e) => { updateItems(ids, { groupId: e.target.value }, "moved to another group"); undoToast(`Moved ${ids.length} items`); }}>
        <option value="" disabled>Move to group</option>
        {board.groups.map((gr) => <option key={gr.id} value={gr.id} className="text-foreground">{gr.name}</option>)}
      </select>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          deleteItems(ids);
          onClear();
          undoToast(`Deleted ${ids.length} items`);
        }}
      >
        <Trash2 /> Delete
      </Button>
      <button onClick={onClear} className="text-white/60 hover:text-white" title="Clear selection"><X className="size-4" /></button>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────

function Dashboard({ state, onOpen }: { state: WorkState; onOpen: (id: string) => void }) {
  const { people } = usePeople();
  const today = format(new Date(), "yyyy-MM-dd");
  const open = state.items.filter((i) => i.status !== DONE);
  const overdue = open.filter((i) => i.due && i.due < today);
  const weekEnd = format(addDays(new Date(), 7), "yyyy-MM-dd");
  const dueSoon = open.filter((i) => i.due && i.due >= today && i.due <= weekEnd).sort((a, b) => a.due!.localeCompare(b.due!));
  const boardOf = (id: string) => state.boards.find((b) => b.id === id);
  const maxLoad = Math.max(1, ...people.map((p) => open.filter((i) => i.assignees.includes(p.id)).length));
  const stuck = open.filter((i) => statusOf(boardOf(i.boardId), i.status).tone === "red");

  const tiles = [
    { label: "Open items", value: open.length },
    { label: "Overdue", value: overdue.length, alert: overdue.length > 0 },
    { label: "Stuck / blocked", value: stuck.length },
    { label: "Due this week", value: dueSoon.length },
    { label: "Completed", value: state.items.length - open.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Everything across all {state.boards.length} boards.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={`mt-1 text-3xl font-semibold ${t.alert ? "text-red-600" : ""}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Progress by board">
          <div className="space-y-2.5">
            {state.boards.map((b) => {
              const its = state.items.filter((i) => i.boardId === b.id);
              const done = its.filter((i) => i.status === DONE).length;
              return (
                <div key={b.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate">{b.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-emerald-600" style={{ width: `${its.length ? (done / its.length) * 100 : 0}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums text-muted-foreground">{done}/{its.length}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Workload (open items per person)">
          <div className="space-y-2.5">
            {people.map((p) => {
              const mine = open.filter((i) => i.assignees.includes(p.id));
              const byTone = (Object.keys(TONES) as (keyof typeof TONES)[]).map((t) => ({ t, n: mine.filter((i) => statusOf(boardOf(i.boardId), i.status).tone === t).length }));
              return (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 truncate">{p.name}</span>
                  <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    {byTone.map(({ t, n }) => (n ? <div key={t} className={TONES[t].dot} style={{ width: `${(n / maxLoad) * 100}%` }} /> : null))}
                  </div>
                  <span className="w-12 text-right tabular-nums text-muted-foreground">{mine.length}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title={`Overdue (${overdue.length})`}>
          <ItemList items={overdue} boardOf={boardOf} onOpen={onOpen} empty="Nothing overdue 🎉" />
        </Card>

        <Card title={`Due in the next 7 days (${dueSoon.length})`}>
          <ItemList items={dueSoon} boardOf={boardOf} onOpen={onOpen} empty="Nothing due this week." />
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ItemList({ items, boardOf, onOpen, empty }: { items: Item[]; boardOf: (id: string) => Board | undefined; onOpen: (id: string) => void; empty: string }) {
  const { names } = usePeople();
  if (!items.length) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y">
      {items.map((i) => (
        <li key={i.id}>
          <button onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-muted/40">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{i.name}</div>
              <div className="text-xs text-muted-foreground">
                {boardOf(i.boardId)?.name} · {names(i.assignees) || "Unassigned"}
                {i.due && ` · due ${format(parseISO(i.due), "MMM d")}`}
              </div>
            </div>
            <StatusPill board={boardOf(i.boardId)} status={i.status} />
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Shortcuts help ───────────────────────────────────────────

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const keys = [
    ["Ctrl / ⌘ + K", "Search everything"],
    ["N", "New item on the current board"],
    ["Ctrl / ⌘ + Z", "Undo last delete or bulk change"],
    ["Esc", "Close the item panel"],
    ["?", "Show / hide this list"],
  ];
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border bg-card p-4 shadow-2xl">
      <div className="mb-2 flex items-center">
        <span className="flex items-center gap-2 text-sm font-semibold"><Keyboard className="size-4" /> Keyboard shortcuts</span>
        <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={onClose}><X className="size-4" /></button>
      </div>
      <ul className="space-y-1.5 text-sm">
        {keys.map(([k, d]) => (
          <li key={k} className="flex items-center gap-2">
            <kbd className="rounded border bg-muted px-1.5 text-[11px]">{k}</kbd>
            <span className="text-muted-foreground">{d}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground"><Undo2 className="size-3" /> Deletes and bulk edits show an Undo button too.</div>
    </div>
  );
}
