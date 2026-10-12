# AI4Home Work

Monday.com-style work management for the AI4Home team: boards, groups, items, custom columns, Table / Kanban / Calendar / Timeline views, subitems, dependencies, @mentions, automations, public request forms and a dashboard.

Stack: Next.js 16 (App Router, server actions) · Prisma 7 · PostgreSQL (Supabase) · Tailwind 4. Same design system as the warranty portal.

## Setup

1. Create a Supabase project, then copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL`: Supabase **Transaction pooler** string (port 6543, add `?pgbouncer=true`)
   - `DIRECT_URL`: Supabase **Session pooler** or direct string (port 5432), used for schema changes
   - `AUTH_SECRET`: any long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - `SEED_ADMIN_PASSWORD`, `SEED_USER_PASSWORD`: passwords for the two accounts (8+ characters)
2. Install and create the tables:
   ```bash
   npm install
   npm run db:push     # creates the tables in Supabase
   npm run db:seed     # creates the 2 accounts + sample boards
   ```
3. Run it: `npm run dev` → http://localhost:3001

## Accounts

| Email | Role | Can do |
|---|---|---|
| `admin@ai4home.work` | Admin | Everything: create/delete boards, groups, columns, statuses, automations |
| `user@ai4home.work` | User | Work on items: create, edit, assign, comment, subitems, files, bulk edits |

Re-running `npm run db:seed` resets both passwords to the values in `.env` and never touches existing boards.

## Where things live

- `prisma/schema.prisma`: database tables (schema changes go through `npm run db:push`)
- `src/lib/actions.ts`: the backend (server actions) and the automations engine
- `src/lib/auth.ts`: login sessions (signed httpOnly cookie)
- `src/lib/work.ts`: shared types, statuses, templates
- `src/components/work/`: the UI (`WorkApp.tsx` is the shell, `store.ts` the client cache)
- `src/app/form/[boardId]`: public request form (no login)

## Known limits (deliberate, for now)

- Teammates' changes appear within ~5 seconds (polling), not instantly.
- Attachments: images under 700 KB are stored inline in the database; other files store the name only. Move to Supabase Storage for real files.
- No email notifications yet, only the in-app Inbox.
- Public forms have no rate limiting or captcha.
