"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LayoutList, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  COLUMN_TYPES,
  DEFAULT_STATUSES,
  DONE,
  TEMPLATES,
  TONES,
  type Board,
  type ColumnType,
  type Tone,
  type WorkState,
} from "@/lib/work";
import { createBoard, deleteBoard, deleteColumn, updateBoard, updateColumn, usePeople } from "./store";
import { StatusPill, plainSelect } from "./ui";

// ── Confirm (replaces window.confirm) ────────────────────────

type ConfirmReq = { text: string; resolve: (ok: boolean) => void };
let showConfirm: ((req: ConfirmReq) => void) | null = null;

export const confirmDialog = (text: string) =>
  new Promise<boolean>((resolve) => (showConfirm ? showConfirm({ text, resolve }) : resolve(false)));

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  useEffect(() => {
    showConfirm = setReq;
    return () => { showConfirm = null; };
  }, []);
  const close = (ok: boolean) => { req?.resolve(ok); setReq(null); };
  return (
    <Dialog open={!!req} onOpenChange={(o) => !o && close(false)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>{req?.text}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button variant="destructive" autoFocus onClick={() => close(true)}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── New board ────────────────────────────────────────────────

export function NewBoardDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [tpl, setTpl] = useState("blank");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create a board</DialogTitle>
          <DialogDescription>Start blank or from a template.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const id = await createBoard(name.trim() || "Untitled board", tpl);
            setBusy(false);
            if (!id) return;
            setName("");
            onCreated(id);
            onClose();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="nb-name">Board name</Label>
            <Input id="nb-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing Q4" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTpl(t.key)}
                className={`rounded-lg border p-3 text-left transition hover:bg-muted ${tpl === t.key ? "border-primary ring-2 ring-primary/30 dark:border-[#d4a853]" : ""}`}
              >
                <LayoutList className="mb-1 size-4 text-muted-foreground" />
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
              </button>
            ))}
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create board"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Board settings ───────────────────────────────────────────

export function BoardSettingsDialog({ board, open, onClose, onDeleted }: { board: Board; open: boolean; onClose: () => void; onDeleted: () => void }) {
  const setStatuses = (statuses: Board["statuses"]) => updateBoard(board.id, { statuses });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
        </DialogHeader>

        <section className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input defaultValue={board.name} key={board.id + "n"} onBlur={(e) => e.target.value.trim() && e.target.value !== board.name && updateBoard(board.id, { name: e.target.value.trim() })} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={2} defaultValue={board.description} key={board.id + "d"} onBlur={(e) => e.target.value !== board.description && updateBoard(board.id, { description: e.target.value })} />
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Status labels</h3>
          <p className="text-xs text-muted-foreground">Rename, recolor or add statuses for this board. The “done” status can&apos;t be removed.</p>
          {board.statuses.map((s, idx) => (
            <div key={s.key} className="flex items-center gap-2">
              <Input
                className="h-8 flex-1"
                defaultValue={s.label}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.label && setStatuses(board.statuses.map((x, j) => (j === idx ? { ...x, label: e.target.value.trim() } : x)))}
              />
              <select className={plainSelect} value={s.tone} onChange={(e) => setStatuses(board.statuses.map((x, j) => (j === idx ? { ...x, tone: e.target.value as Tone } : x)))}>
                {(Object.keys(TONES) as Tone[]).map((t) => <option key={t} value={t}>{TONES[t].label}</option>)}
              </select>
              <span className="w-28"><StatusPill board={board} status={s.key} /></span>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={s.key === DONE}
                title={s.key === DONE ? "Done status is required" : "Remove"}
                onClick={() => setStatuses(board.statuses.filter((x) => x.key !== s.key))}
              >
                <X />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStatuses([...board.statuses.filter((x) => x.key !== DONE), { key: crypto.randomUUID(), label: "New status", tone: "slate" }, ...board.statuses.filter((x) => x.key === DONE)])}>
              <Plus /> Add status
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStatuses(DEFAULT_STATUSES)}>Reset to defaults</Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Custom columns</h3>
          {board.columns.length === 0 && <p className="text-xs text-muted-foreground">No custom columns. Add them with the + at the end of the table header.</p>}
          {board.columns.map((c) => (
            <div key={c.id} className="space-y-1 rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <Input className="h-8 flex-1" defaultValue={c.name} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && updateColumn(board, c.id, { name: e.target.value.trim() })} />
                <select
                  className={plainSelect}
                  value={c.type}
                  onChange={(e) => updateColumn(board, c.id, { type: e.target.value as ColumnType, options: e.target.value === "dropdown" ? (c.options ?? ["Option 1", "Option 2"]) : c.options })}
                >
                  {COLUMN_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                </select>
                <Button variant="ghost" size="icon-sm" onClick={async () => (await confirmDialog(`Delete column “${c.name}”?`)) && deleteColumn(board, c.id)}><Trash2 /></Button>
              </div>
              {c.type === "dropdown" && (
                <Input
                  className="h-8 text-xs"
                  defaultValue={(c.options ?? []).join(", ")}
                  placeholder="Options, comma separated"
                  onBlur={(e) => updateColumn(board, c.id, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                />
              )}
            </div>
          ))}
        </section>

        <section className="flex items-center justify-between rounded-lg border border-red-500/30 p-3">
          <div>
            <div className="text-sm font-medium">Delete this board</div>
            <div className="text-xs text-muted-foreground">Removes the board and all its items. This can&apos;t be undone.</div>
          </div>
          <Button
            variant="destructive"
            onClick={async () => {
              if (!(await confirmDialog(`Delete board “${board.name}” and all its items? This can’t be undone.`))) return;
              deleteBoard(board.id);
              onDeleted();
              onClose();
              toast("Board deleted");
            }}
          >
            Delete board
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}

// ── Global search (Ctrl/Cmd + K) ─────────────────────────────

export function SearchDialog({ state, open, onClose, onOpenItem, onOpenBoard }: { state: WorkState; open: boolean; onClose: () => void; onOpenItem: (id: string) => void; onOpenBoard: (id: string) => void }) {
  const { names } = usePeople();
  const [q, setQ] = useState("");
  const close = () => { setQ(""); onClose(); };
  const s = q.trim().toLowerCase();
  const boards = useMemo(() => state.boards.filter((b) => !s || b.name.toLowerCase().includes(s)), [state.boards, s]);
  const items = useMemo(
    () =>
      s
        ? state.items
          .filter((i) => i.name.toLowerCase().includes(s) || i.description.toLowerCase().includes(s) || names(i.assignees).toLowerCase().includes(s) || i.updates.some((u) => u.body.toLowerCase().includes(s)))
          .slice(0, 12)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.items, s],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items, people, updates, boards…" className="h-12 flex-1 bg-transparent text-sm outline-none" />
          <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2 text-sm">
          {boards.length > 0 && <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Boards</div>}
          {boards.map((b) => (
            <button key={b.id} onClick={() => { onOpenBoard(b.id); close(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
              <LayoutList className="size-4 text-muted-foreground" /> {b.name}
            </button>
          ))}
          {items.length > 0 && <div className="mt-2 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">Items</div>}
          {items.map((i) => {
            const b = state.boards.find((x) => x.id === i.boardId);
            return (
              <button key={i.id} onClick={() => { onOpenBoard(i.boardId); onOpenItem(i.id); close(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted">
                <span className="min-w-0 flex-1 truncate">{i.name}</span>
                <span className="text-xs text-muted-foreground">{b?.name}</span>
                <StatusPill board={b} status={i.status} />
              </button>
            );
          })}
          {s && items.length === 0 && boards.length === 0 && <p className="p-6 text-center text-muted-foreground">No results for “{q}”.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
