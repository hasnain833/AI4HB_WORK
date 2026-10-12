// Shared types, constants and helpers, safe to import from server and client.

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Role = "ADMIN" | "USER";
export type Tone = "neutral" | "navy" | "gold" | "green" | "red" | "slate";
export type ColumnType = "text" | "number" | "dropdown" | "checkbox" | "link" | "rating" | "date";
export type CellValue = string | number | boolean;

export interface Person { id: string; name: string; email: string; role: Role }
export interface StatusDef { key: string; label: string; tone: Tone }
export interface Column { id: string; name: string; type: ColumnType; options?: string[] }
export interface Group { id: string; name: string; color: string }
export interface Board {
  id: string;
  name: string;
  description: string;
  workspace: string;
  groups: Group[];
  statuses: StatusDef[];
  columns: Column[];
}

export interface Subtask { id: string; title: string; done: boolean; assignee?: string }
export interface Update { id: string; author: string; body: string; at: string }
export interface Activity { at: string; text: string }
export interface FileRef { id: string; name: string; url?: string }

export interface Item {
  id: string;
  boardId: string;
  groupId: string;
  name: string;
  status: string; // StatusDef.key, "DONE" means complete
  priority: Priority;
  assignees: string[]; // user ids
  start?: string; // yyyy-MM-dd
  due?: string; // yyyy-MM-dd
  description: string;
  values: Record<string, CellValue>;
  dependsOn: string[];
  subtasks: Subtask[];
  updates: Update[];
  files: FileRef[];
  activity: Activity[];
  createdAt: string;
}

export interface Notification { id: string; text: string; itemId?: string; at: string; read: boolean }

export type Trigger = { type: "created" } | { type: "status"; to: string } | { type: "assigned" } | { type: "priority"; to: Priority };
export type Action =
  | { type: "notify"; value: string } // user id or "__assignees"
  | { type: "assign"; value: string } // user id
  | { type: "set_priority"; value: Priority }
  | { type: "move_group"; value: string }
  | { type: "set_status"; value: string };
export interface Automation { id: string; boardId: string; trigger: Trigger; action: Action; enabled: boolean } // boardId "*" = all

export interface WorkState {
  me: Person;
  users: Person[];
  boards: Board[];
  items: Item[];
  notifications: Notification[];
  automations: Automation[];
}

/** Fields of an item the client may patch directly. */
export type ItemPatch = Partial<Pick<Item, "name" | "status" | "priority" | "assignees" | "start" | "due" | "description" | "dependsOn" | "groupId">>;

// ── Reference data ───────────────────────────────────────────

export const DONE = "DONE";

// Tones follow the platform palette (navy / gold / cream); red only for blocked / critical.
export const TONES: Record<Tone, { pill: string; dot: string; label: string }> = {
  neutral: { pill: "bg-muted text-muted-foreground", dot: "bg-muted-foreground", label: "Grey" },
  navy: { pill: "bg-primary/10 text-foreground", dot: "bg-primary", label: "Navy" },
  gold: { pill: "bg-[#b48c3c]/15 text-[#8a6a2a] dark:text-[#d4a853]", dot: "bg-[#b48c3c]", label: "Gold" },
  green: { pill: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-600", label: "Green" },
  red: { pill: "bg-red-500/10 text-red-700 dark:text-red-400", dot: "bg-red-500", label: "Red" },
  slate: { pill: "bg-slate-500/15 text-slate-700 dark:text-slate-300", dot: "bg-slate-500", label: "Slate" },
};

export const DEFAULT_STATUSES: StatusDef[] = [
  { key: "NOT_STARTED", label: "Not started", tone: "neutral" },
  { key: "WORKING", label: "Working on it", tone: "gold" },
  { key: "STUCK", label: "Stuck", tone: "red" },
  { key: "REVIEW", label: "In review", tone: "navy" },
  { key: DONE, label: "Done", tone: "green" },
];

export const PRIORITIES: { key: Priority; label: string; tone: Tone }[] = [
  { key: "LOW", label: "Low", tone: "neutral" },
  { key: "MEDIUM", label: "Medium", tone: "navy" },
  { key: "HIGH", label: "High", tone: "gold" },
  { key: "CRITICAL", label: "Critical", tone: "red" },
];

export const COLUMN_TYPES: { type: ColumnType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "dropdown", label: "Dropdown" },
  { type: "checkbox", label: "Checkbox" },
  { type: "link", label: "Link" },
  { type: "rating", label: "Rating" },
  { type: "date", label: "Date" },
];

// Group accent colors (left bar + title), kept to the platform palette.
export const GROUP_COLORS = ["#0e1623", "#b48c3c", "#059669", "#64748b", "#c2410c"];

export const statusOf = (board: Board | undefined, key: string): StatusDef =>
  board?.statuses.find((s) => s.key === key) ?? { key, label: key, tone: "neutral" };
export const prioMeta = (p: Priority) => PRIORITIES.find((x) => x.key === p)!;
export const isBlocked = (item: Item, items: Item[]) =>
  item.dependsOn.some((id) => items.find((i) => i.id === id && i.status !== DONE));

// ── Templates ────────────────────────────────────────────────

const uid = () => crypto.randomUUID();
const g = (name: string, color: number) => ({ name, color: GROUP_COLORS[color] });

export interface Template {
  key: string;
  name: string;
  description: string;
  make: () => { groups: { name: string; color: string }[]; statuses: StatusDef[]; columns: Column[] };
}

export const TEMPLATES: Template[] = [
  { key: "blank", name: "Blank board", description: "Start from scratch", make: () => ({ groups: [g("To do", 0), g("Done", 2)], statuses: DEFAULT_STATUSES, columns: [] }) },
  {
    key: "bugs",
    name: "Bug tracking",
    description: "Severity, environment and reproduction steps",
    make: () => ({
      groups: [g("Urgent", 4), g("This week", 1), g("Backlog", 3)],
      statuses: [
        { key: "NOT_STARTED", label: "New", tone: "neutral" },
        { key: "WORKING", label: "Fixing", tone: "gold" },
        { key: "STUCK", label: "Blocked", tone: "red" },
        { key: "REVIEW", label: "QA", tone: "navy" },
        { key: DONE, label: "Fixed", tone: "green" },
      ],
      columns: [
        { id: uid(), name: "Environment", type: "dropdown", options: ["Production", "Staging", "Mobile"] },
        { id: uid(), name: "Reported by", type: "text" },
      ],
    }),
  },
  {
    key: "sprint",
    name: "Sprint planning",
    description: "Story points and sprint backlog",
    make: () => ({ groups: [g("Sprint backlog", 0), g("Completed", 2)], statuses: DEFAULT_STATUSES, columns: [{ id: uid(), name: "Story points", type: "number" }] }),
  },
  {
    key: "onboarding",
    name: "Client onboarding",
    description: "One group per client, with checklists",
    make: () => ({ groups: [g("New client", 1)], statuses: DEFAULT_STATUSES, columns: [{ id: uid(), name: "Client signed off", type: "checkbox" }] }),
  },
  {
    key: "content",
    name: "Content calendar",
    description: "Plan posts, channels and publish dates",
    make: () => ({
      groups: [g("Ideas", 3), g("In production", 1), g("Published", 2)],
      statuses: [
        { key: "NOT_STARTED", label: "Idea", tone: "neutral" },
        { key: "WORKING", label: "Writing", tone: "gold" },
        { key: "REVIEW", label: "Editing", tone: "navy" },
        { key: DONE, label: "Published", tone: "green" },
      ],
      columns: [
        { id: uid(), name: "Channel", type: "dropdown", options: ["Blog", "LinkedIn", "Newsletter"] },
        { id: uid(), name: "Link", type: "link" },
      ],
    }),
  },
];
