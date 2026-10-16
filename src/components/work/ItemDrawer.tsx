"use client";

import { useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Check, Copy, Link2, Lock, Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DONE, PRIORITIES, TONES, isBlocked, prioMeta, statusOf, type Board, type Item, type NewItemFields, type Person, type Priority, type WorkState } from "@/lib/work";
import {
  addFile,
  addSubtask,
  addUpdate,
  createItem,
  deleteFile,
  deleteItems,
  deleteSubtask,
  duplicateItem,
  setCell,
  undo,
  updateItem,
  updateSubtask,
  usePeople,
} from "./store";
import { CellEditor, PeoplePicker, StatusPill, StatusSelect, fieldSelect, plainSelect } from "./ui";

const MAX_PREVIEW_BYTES = 700_000; // inline image previews stay small

export function ItemDrawer({ item, state, onClose, onOpen }: { item: Item; state: WorkState; onClose: () => void; onOpen: (id: string) => void }) {
  const { people } = usePeople();
  const [tab, setTab] = useState<"updates" | "subitems" | "files" | "activity">("updates");
  const [update, setUpdate] = useState("");
  const [subtask, setSubtask] = useState("");
  const board = state.boards.find((b) => b.id === item.boardId);
  const group = board?.groups.find((gr) => gr.id === item.groupId);
  const doneSubs = item.subtasks.filter((s) => s.done).length;
  const blocked = isBlocked(item, state.items);
  const candidates = state.items.filter((i) => i.boardId === item.boardId && i.id !== item.id);
  const others = people.filter((p) => p.id !== state.me.id);

  const postUpdate = () => {
    if (!update.trim()) return;
    addUpdate(item.id, update.trim());
    setUpdate("");
  };

  const addSub = () => {
    if (!subtask.trim()) return;
    addSubtask(item.id, subtask.trim());
    setSubtask("");
  };

  const attach = (f: File) => {
    if (f.type.startsWith("image/") && f.size <= MAX_PREVIEW_BYTES) {
      const r = new FileReader();
      r.onload = () => addFile(item.id, f.name, String(r.result));
      r.readAsDataURL(f);
    } else addFile(item.id, f.name);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-card shadow-2xl">
        <header className="border-b px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{board?.name}</span>
            <span>/</span>
            <span style={{ color: group?.color }} className="font-medium">{group?.name}</span>
            {blocked && (
              <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 font-medium text-red-700 dark:text-red-400">
                <Lock className="size-3" /> Blocked
              </span>
            )}
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon-sm" title="Duplicate" onClick={async () => { await duplicateItem(item.id); toast.success("Item duplicated"); }}>
                <Copy />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Delete item"
                onClick={() => {
                  deleteItems([item.id]);
                  onClose();
                  toast("Item deleted", { action: { label: "Undo", onClick: () => undo() } });
                }}
              >
                <Trash2 />
              </Button>
              <Button variant="ghost" size="icon-sm" title="Close (Esc)" onClick={onClose}><X /></Button>
            </div>
          </div>
          <input
            className="mt-1 w-full bg-transparent text-xl font-semibold outline-none"
            defaultValue={item.name}
            key={item.id + item.name}
            onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && updateItem(item.id, { name: e.target.value.trim() }, "renamed the item")}
          />
        </header>

        <div className="overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b px-6 py-4 text-sm sm:grid-cols-3">
            <Field label="Status">
              <StatusSelect board={board} value={item.status} onChange={(v) => updateItem(item.id, { status: v }, `changed status to ${statusOf(board, v).label}`)} />
            </Field>
            <Field label="Priority">
              <select
                className={`${fieldSelect} ${TONES[prioMeta(item.priority).tone].pill}`}
                value={item.priority}
                onChange={(e) => updateItem(item.id, { priority: e.target.value as Priority }, `set priority to ${prioMeta(e.target.value as Priority).label}`)}
              >
                {PRIORITIES.map((p) => <option key={p.key} value={p.key} className="bg-background text-foreground">{p.label}</option>)}
              </select>
            </Field>
            <Field label="Created by">
              <div className="flex h-8 items-center truncate">{people.find((p) => p.id === item.createdBy)?.name ?? "—"}</div>
            </Field>
            <Field label="Start">
              <Input type="date" className="h-8" value={item.start ?? ""} onChange={(e) => updateItem(item.id, { start: e.target.value }, "changed the start date")} />
            </Field>
            <Field label="Due">
              <Input type="date" className="h-8" value={item.due ?? ""} onChange={(e) => updateItem(item.id, { due: e.target.value }, "changed the due date")} />
            </Field>
            <Field label="Subitems">
              <div className="flex h-8 items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-emerald-600" style={{ width: `${item.subtasks.length ? (doneSubs / item.subtasks.length) * 100 : 0}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{doneSubs}/{item.subtasks.length}</span>
              </div>
            </Field>
            {board?.columns.map((c) => (
              <Field key={c.id} label={c.name}>
                <CellEditor boxed col={c} value={item.values[c.id]} onChange={(v) => setCell(item.id, c.id, v)} />
              </Field>
            ))}
          </div>

          {/* Dependencies */}
          <div className="border-b px-6 py-3 text-sm">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Link2 className="size-3.5" /> Blocked by
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ml-auto rounded px-1.5 py-0.5 normal-case tracking-normal hover:bg-muted">+ Add dependency</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-72 overflow-y-auto">
                  {candidates.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={item.dependsOn.includes(c.id)}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={(on) =>
                        updateItem(item.id, { dependsOn: on ? [...item.dependsOn, c.id] : item.dependsOn.filter((d) => d !== c.id) }, on ? `added dependency “${c.name}”` : `removed dependency “${c.name}”`)
                      }
                    >
                      <span className="truncate">{c.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {item.dependsOn.length === 0 && <p className="text-xs text-muted-foreground">No dependencies.</p>}
            <ul className="space-y-1">
              {item.dependsOn.map((id) => {
                const d = state.items.find((i) => i.id === id);
                if (!d) return null;
                return (
                  <li key={id} className="flex items-center gap-2">
                    {d.status === DONE ? <Check className="size-3.5 text-emerald-600" /> : <Lock className="size-3.5 text-red-500" />}
                    <button className="truncate hover:underline" onClick={() => onOpen(id)}>{d.name}</button>
                    <span className="ml-auto"><StatusPill board={board} status={d.status} /></span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="px-6 pt-4">
            <Textarea
              key={item.id}
              rows={3}
              placeholder="Add a description…"
              defaultValue={item.description}
              onBlur={(e) => e.target.value !== item.description && updateItem(item.id, { description: e.target.value }, "edited the description")}
            />
          </div>

          <nav className="mt-4 flex gap-4 border-b px-6 text-sm">
            {([
              ["updates", `Updates (${item.updates.length})`],
              ["subitems", `Subitems (${item.subtasks.length})`],
              ["files", `Files (${item.files.length})`],
              ["activity", "Activity"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`-mb-px border-b-2 pb-2 ${tab === k ? "border-primary font-medium dark:border-[#d4a853]" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="px-6 py-4 text-sm">
            {tab === "updates" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Textarea rows={3} placeholder="Write an update… use @Name to mention someone" value={update} onChange={(e) => setUpdate(e.target.value)} />
                  <div className="flex flex-wrap items-center gap-1">
                    {others.map((p) => (
                      <button key={p.id} onClick={() => setUpdate((u) => `${u}${u && !u.endsWith(" ") ? " " : ""}@${p.name} `)} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                        @{p.name}
                      </button>
                    ))}
                    <Button size="sm" className="ml-auto" onClick={postUpdate}>Update</Button>
                  </div>
                </div>
                {[...item.updates].reverse().map((u) => (
                  <div key={u.id} className="rounded-lg border p-3">
                    <div className="text-xs">
                      <span className="font-medium">{u.author}</span>
                      <span className="text-muted-foreground"> · {formatDistanceToNow(new Date(u.at), { addSuffix: true })}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{highlightMentions(u.body, people.map((p) => p.name))}</p>
                  </div>
                ))}
                {item.updates.length === 0 && <p className="text-center text-muted-foreground">No updates yet.</p>}
              </div>
            )}

            {tab === "subitems" && (
              <div className="space-y-1">
                {item.subtasks.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted">
                    <button
                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${s.done ? "border-emerald-600 bg-emerald-600 text-white" : ""}`}
                      onClick={() => updateSubtask(item.id, s.id, { done: !s.done })}
                    >
                      {s.done && <Check className="size-3" />}
                    </button>
                    <span className={`flex-1 ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.title}</span>
                    <div className="w-36">
                      <PeoplePicker single value={s.assignee ? [s.assignee] : []} onChange={(a) => updateSubtask(item.id, s.id, { assignee: a[0] ?? null })} />
                    </div>
                    <button className="text-muted-foreground hover:text-foreground" onClick={() => deleteSubtask(item.id, s.id)}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <Input placeholder="Add a subitem" value={subtask} onChange={(e) => setSubtask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub()} />
                  <Button variant="outline" onClick={addSub}>Add</Button>
                </div>
              </div>
            )}

            {tab === "files" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {item.files.map((f) => (
                    <div key={f.id} className="group relative overflow-hidden rounded-lg border">
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt={f.name} className="h-24 w-full object-cover" />
                        </a>
                      ) : (
                        <div className="flex h-24 items-center justify-center bg-muted"><Paperclip className="size-6 text-muted-foreground" /></div>
                      )}
                      <div className="truncate px-2 py-1 text-xs">{f.name}</div>
                      <button className="absolute right-1 top-1 hidden rounded bg-background/80 p-0.5 group-hover:block" onClick={() => deleteFile(item.id, f.id)}>
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <label className="flex cursor-pointer flex-col items-center rounded-lg border border-dashed p-6 text-muted-foreground hover:bg-muted">
                  <Paperclip className="mb-1 size-5" />
                  Click to attach a file (images under 700 KB get a preview)
                  <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ""; }} />
                </label>
              </div>
            )}

            {tab === "activity" && (
              <ul className="space-y-2 border-l pl-4">
                {[...item.activity].reverse().map((a, i) => (
                  <li key={i} className="text-xs">
                    <span>{a.text}</span>
                    <span className="text-muted-foreground"> · {formatDistanceToNow(new Date(a.at), { addSuffix: true })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── New item (draft until saved) ─────────────────────────────

type Draft = Required<Omit<NewItemFields, "due">> & { groupId: string; name: string; due: string };

const draftKey = (boardId: string) => `aw_new_item_${boardId}`;

function blankDraft(board: Board): Draft {
  return { groupId: board.groups[0]?.id ?? "", name: "", status: board.statuses[0]?.key ?? "NOT_STARTED", priority: "MEDIUM", assignees: [], due: "", description: "", values: {} };
}

// Drafts live in localStorage per board, so closing the drawer (or reloading) keeps what was typed.
function loadDraft(board: Board): Draft {
  const blank = blankDraft(board);
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(board.id)) ?? "null") as Partial<Draft> | null;
    if (!saved) return blank;
    const d = { ...blank, ...saved };
    if (!board.groups.some((g) => g.id === d.groupId)) d.groupId = blank.groupId;
    if (!board.statuses.some((x) => x.key === d.status)) d.status = blank.status;
    return d;
  } catch {
    return blank;
  }
}

function storeDraft(boardId: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(boardId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(boardId));
  } catch {}
}

export function NewItemDrawer({ board, me, onClose, onCreated }: { board: Board; me: Person; onClose: () => void; onCreated: (id: string) => void }) {
  const [d, setD] = useState(() => loadDraft(board));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false); // show required-field errors only after a save attempt
  const nameMissing = tried && !d.name.trim();
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) =>
    setD((prev) => {
      const next = { ...prev, ...patch };
      storeDraft(board.id, next);
      return next;
    });

  const save = async () => {
    setTried(true);
    if (!d.name.trim()) {
      toast.error("Item name is required");
      return nameRef.current?.focus();
    }
    setBusy(true);
    const { groupId, name, ...fields } = d;
    const id = await createItem(board.id, groupId, name, fields);
    setBusy(false);
    if (!id) return;
    storeDraft(board.id, null);
    toast.success("Item created");
    onCreated(id);
  };

  const discard = () => {
    storeDraft(board.id, null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-card shadow-2xl">
        <header className="border-b px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{board.name}</span>
            <span>/</span>
            <span className="font-medium">New item</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="icon-sm" title="Close (Esc). Your draft is kept" onClick={onClose}><X /></Button>
            </div>
          </div>
          <input
            ref={nameRef}
            autoFocus
            className={`mt-1 w-full rounded-md bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground/60 ${nameMissing ? "-mx-2 px-2 ring-2 ring-red-500 placeholder:text-red-400" : ""}`}
            placeholder="Item name"
            aria-invalid={nameMissing}
            aria-describedby={nameMissing ? "new-item-name-error" : undefined}
            value={d.name}
            onChange={(e) => set({ name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          {nameMissing && <p id="new-item-name-error" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">Item name is required.</p>}
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b px-6 py-4 text-sm sm:grid-cols-3">
            <Field label="Group">
              <select className={`${plainSelect} w-full`} value={d.groupId} onChange={(e) => set({ groupId: e.target.value })}>
                {board.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <StatusSelect board={board} value={d.status} onChange={(v) => set({ status: v })} />
            </Field>
            <Field label="Priority">
              <select className={`${fieldSelect} ${TONES[prioMeta(d.priority).tone].pill}`} value={d.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => <option key={p.key} value={p.key} className="bg-background text-foreground">{p.label}</option>)}
              </select>
            </Field>
            <Field label="Created by">
              <div className="flex h-8 items-center truncate">{me.name}</div>
            </Field>
            <Field label="Due">
              <Input type="date" className="h-8" value={d.due} onChange={(e) => set({ due: e.target.value })} />
            </Field>
            {board.columns.map((c) => (
              <Field key={c.id} label={c.name}>
                <CellEditor
                  boxed
                  col={c}
                  value={d.values[c.id]}
                  onChange={(v) => {
                    const values = { ...d.values };
                    if (v === undefined || v === "") delete values[c.id];
                    else values[c.id] = v;
                    set({ values });
                  }}
                />
              </Field>
            ))}
          </div>

          <div className="px-6 pt-4">
            <Textarea rows={5} placeholder="Add a description…" value={d.description} onChange={(e) => set({ description: e.target.value })} />
            <p className="mt-2 text-xs text-muted-foreground">Subitems, files and updates can be added after saving.</p>
          </div>
        </div>

        <footer className="flex items-center gap-2 border-t px-6 py-3">
          <span className="text-xs text-muted-foreground">Draft is kept if you close this panel.</span>
          <Button variant="ghost" className="ml-auto" onClick={discard}>Discard</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save item"}</Button>
        </footer>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function highlightMentions(body: string, names: string[]) {
  if (!names.length) return body;
  const pattern = names.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return body.split(new RegExp(`(@(?:${pattern}))`)).map((part, i) =>
    part.startsWith("@") && names.includes(part.slice(1)) ? (
      <span key={i} className="rounded bg-[#b48c3c]/15 px-1 font-medium text-[#8a6a2a] dark:text-[#d4a853]">{part}</span>
    ) : (
      part
    ),
  );
}
