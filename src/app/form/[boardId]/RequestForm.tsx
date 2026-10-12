"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitForm } from "@/lib/actions";
import { PRIORITIES, type Column, type Priority } from "@/lib/work";

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function RequestForm({ board }: { board: { id: string; name: string; description: string; columns: Column[] } }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [f, setF] = useState({ name: "", description: "", priority: "MEDIUM" as Priority, reporter: "", email: "", values: {} as Record<string, string> });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const r = await submitForm(board.id, f).catch(() => ({ ok: false as const, error: "Something went wrong, please try again." }));
    setPending(false);
    if (r.ok) setDone(true);
    else setError(r.error);
  };

  if (done) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <CheckCircle2 className="mx-auto size-14 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-semibold">Thanks, we&apos;ve got it!</h1>
        <p className="mt-2 text-muted-foreground">Your request was added to <b>{board.name}</b> and the team has been notified.</p>
        <Button className="mt-6" onClick={() => { setDone(false); setF((x) => ({ ...x, name: "", description: "" })); }}>Submit another</Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{board.name}</h1>
      <p className="mt-2 text-muted-foreground">{board.description || "Submit a request to our team."}</p>
      <form onSubmit={submit} className="mt-8 space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1.5">
          <Label htmlFor="f-name">Title</Label>
          <Input id="f-name" required maxLength={200} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-desc">Details</Label>
          <Textarea id="f-desc" required rows={5} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="f-prio">Urgency</Label>
            <select id="f-prio" className={selectCls} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          {board.columns.map((c) => (
            <div key={c.id} className="space-y-1.5">
              <Label htmlFor={`f-${c.id}`}>{c.name}</Label>
              {c.type === "dropdown" ? (
                <select id={`f-${c.id}`} className={selectCls} value={f.values[c.id] ?? ""} onChange={(e) => setF({ ...f, values: { ...f.values, [c.id]: e.target.value } })}>
                  <option value="">—</option>
                  {(c.options ?? []).map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <Input id={`f-${c.id}`} maxLength={500} value={f.values[c.id] ?? ""} onChange={(e) => setF({ ...f, values: { ...f.values, [c.id]: e.target.value } })} />
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="f-rep">Your name</Label>
            <Input id="f-rep" required maxLength={100} value={f.reporter} onChange={(e) => setF({ ...f, reporter: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="f-email">Email</Label>
            <Input id="f-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" size="lg" disabled={pending}><Send /> {pending ? "Sending…" : "Submit"}</Button>
      </form>
    </>
  );
}
