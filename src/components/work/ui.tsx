"use client";

import { useState } from "react";
import { Star, ExternalLink } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TONES, prioMeta, statusOf, type Board, type CellValue, type Column, type Person, type Priority } from "@/lib/work";
import { updateColumn, usePeople } from "./store";

export const fieldSelect =
  "h-8 w-full cursor-pointer appearance-none rounded-full px-3 text-center text-xs font-medium outline-none transition hover:opacity-80";

export const plainSelect =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function StatusPill({ board, status }: { board?: Board; status: string }) {
  const s = statusOf(board, status);
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[s.tone].pill}`}>{s.label}</span>;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const m = prioMeta(priority);
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[m.tone].pill}`}>{m.label}</span>;
}

export function StatusSelect({ board, value, onChange }: { board?: Board; value: string; onChange: (v: string) => void }) {
  const s = statusOf(board, value);
  return (
    <select className={`${fieldSelect} ${TONES[s.tone].pill}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {(board?.statuses ?? [s]).map((x) => <option key={x.key} value={x.key} className="bg-background text-foreground">{x.label}</option>)}
    </select>
  );
}

/** Picks user ids; shows names. */
export function PeoplePicker({ value, onChange, single, options, boxed }: { value: string[]; onChange: (v: string[]) => void; single?: boolean; options?: Person[]; boxed?: boolean }) {
  const { people: all, names } = usePeople();
  const people = options ?? all;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`flex h-8 w-full items-center truncate rounded-md px-2 text-left text-sm hover:bg-muted ${boxed ? "border border-input" : ""}`}>
          {value.length ? names(value) : <span className="text-muted-foreground">Unassigned</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {people.map((p) => (
          <DropdownMenuCheckboxItem
            key={p.id}
            checked={value.includes(p.id)}
            onSelect={(e) => !single && e.preventDefault()}
            onCheckedChange={(c) => onChange(single ? (c ? [p.id] : []) : c ? [...value, p.id] : value.filter((x) => x !== p.id))}
          >
            {p.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ADD_NEW = "__add_new";

/** Dropdown cell; with a board, "+ Add new…" adds an option to the column and selects it. */
function DropdownCell({ className, board, col, value, onChange }: { className: string; board?: Board; col: Column; value: CellValue | undefined; onChange: (v: CellValue | undefined) => void }) {
  const [adding, setAdding] = useState(false);
  const options = col.options ?? [];
  const add = (raw: string) => {
    setAdding(false);
    const name = raw.trim().slice(0, 60);
    if (!name || !board) return;
    const existing = options.find((o) => o.toLowerCase() === name.toLowerCase());
    if (!existing) updateColumn(board, col.id, { options: [...options, name] });
    onChange(existing ?? name);
  };
  if (adding)
    return (
      <input
        autoFocus
        className={className}
        placeholder={`New ${col.name.toLowerCase()}…`}
        aria-label={`New ${col.name} option`}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { e.currentTarget.value = ""; e.currentTarget.blur(); }
        }}
        onBlur={(e) => add(e.target.value)}
      />
    );
  return (
    <select className={`${className} cursor-pointer`} value={String(value ?? "")} onChange={(e) => (e.target.value === ADD_NEW ? setAdding(true) : onChange(e.target.value))}>
      <option value="">—</option>
      {options.map((o) => <option key={o}>{o}</option>)}
      {board && <option value={ADD_NEW}>+ Add new…</option>}
    </select>
  );
}

/** Editor for one custom-column cell, by column type. */
/** `boxed` gives inputs a visible border, for forms; table cells stay borderless. */
export function CellEditor({ board, col, value: v, onChange, boxed }: { board?: Board; col: Column; value: CellValue | undefined; onChange: (v: CellValue | undefined) => void; boxed?: boolean }) {
  const base = `h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none hover:bg-muted focus:bg-background focus:ring-2 focus:ring-ring/40 ${boxed ? "border border-input placeholder:text-muted-foreground" : ""}`;
  switch (col.type) {
    case "checkbox":
      return (
        <div className="flex justify-center">
          <input type="checkbox" className="size-4 cursor-pointer accent-[#0e1623] dark:accent-[#d4a853]" checked={!!v} onChange={(e) => onChange(e.target.checked || undefined)} />
        </div>
      );
    case "rating":
      return (
        <div className="flex justify-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => onChange(v === n ? undefined : n)} title={`${n}/5`}>
              <Star className={`size-3.5 ${Number(v) >= n ? "fill-[#b48c3c] text-[#b48c3c]" : "text-muted-foreground/40"}`} />
            </button>
          ))}
        </div>
      );
    case "dropdown":
      return <DropdownCell className={base} board={board} col={col} value={v} onChange={onChange} />;
    case "date":
      return <input type="date" className={base} value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return (
        <input
          type="number"
          className={`${base} text-right tabular-nums`}
          defaultValue={v === undefined ? "" : String(v)}
          key={`${col.id}-${v}`}
          onBlur={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    case "link":
      return (
        <div className="flex items-center">
          <input className={base} placeholder="https://" defaultValue={String(v ?? "")} key={`${col.id}-${v}`} onBlur={(e) => onChange(e.target.value.trim())} />
          {v && /^https?:\/\//.test(String(v)) && (
            <a href={String(v)} target="_blank" rel="noreferrer" className="px-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      );
    default:
      return <input className={base} placeholder={boxed ? `Add ${col.name.toLowerCase()}…` : undefined} defaultValue={String(v ?? "")} key={`${col.id}-${v}`} onBlur={(e) => onChange(e.target.value.trim())} />;
  }
}
