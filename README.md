# Carberry Command Center

A family dashboard for the iPad, the TV, and the desktop — shared calendar, chore
stars, meal plan, grocery savings, lists, countdowns, morning pre-flight, and
per-kid pages.

Built from the Claude Design prototype in [`project/`](project/) (the design
conversation is in [`chats/`](chats/); the original handoff note is
[`project/HANDOFF.md`](project/HANDOFF.md)). The UI is a faithful rebuild of that
prototype — same palette, spacing, and behaviour — in React + TypeScript.

Data lives in an **Obsidian vault** as readable markdown, and secrets live in
**1Password**. A small local sidecar owns both.

---

## Run it

```bash
npm install
cp .env.example .env      # set VAULT_PATH to your vault
npm run dev
```

That starts two things:

| | |
| --- | --- |
| **web** | Vite on `http://localhost:5173`, bound to `0.0.0.0` so the iPad and TV can reach it over the wifi |
| **sidecar** | Node on `http://localhost:8787` — owns the vault, watches it, resolves 1Password references, fetches ICS feeds |

For an always-on box: `npm run build && npm start` serves the built app from the
sidecar on one port.

The parent PIN starts at **1234** — change it in Settings.

---

## How the vault sync works

The vault is the durable store, not a backup. The sidecar reads it on boot,
writes it on every change, and watches the folder so an edit in Obsidian reaches
every open device within about a second.

```
Obsidian ──┐                            ┌── iPad
           ├── vault folder ── sidecar ─┼── TV
Vite app ──┘   (markdown)      (SSE)    └── desktop
```

Everything the app owns lives in one folder (`Family Council/` by default):

| File | Holds | You edit it by |
| --- | --- | --- |
| `Family.md` | People, colours, weather location, feeds, PIN, pre-flight setup | Note properties (frontmatter) — Obsidian renders these as a form |
| `Events.md` | The calendar | Table rows. Add a row and leave **ID** blank; the app fills it in |
| `Chores.md` | Chores, reward shop, redemption history | Table rows. `Days` takes `daily`, `weekdays`, or `Mon Wed Fri` |
| `Meals.md` | Dinner plan and favourites | Table rows |
| `Savings.md` | Grocery staples, store deals, the week's savings plan | Staples table rows; the app writes the deals (see [docs/grocery-savings.md](docs/grocery-savings.md)) |
| `Countdowns.md` | Countdowns | Table rows |
| `Lists/*.md` | One note per list | Ordinary `- [ ]` checkboxes; a `#by/name` tag records who added it |
| `Chore Log/*.md` | One note per day of ticked chores and pre-flight | Checkboxes — keep the `^id` block refs |
| `Secrets.md` | 1Password **references** (never values) | Note properties |

Two things to leave alone: the `^id` block references in the chore log and the
`ID` columns. They're how a renamed chore keeps its star history.

**Conflicts.** Every write carries the revision it was based on. If Obsidian and
the app move at the same time, the stale writer gets the newer state back and
reloads rather than clobbering it — you'll see a "the vault changed elsewhere"
toast. Off the wifi, the app falls back to per-device browser storage and says so
in Settings → Storage.

Round-trip fidelity is verified: writing the full state to markdown and reading
it back reproduces all 15 top-level fields exactly.

---

## How 1Password is used

The sidecar shells out to the `op` CLI. Values are read on demand, never written
to disk, never stored in the vault, and never sent to the browser except for an
explicit reveal.

- **Integration tokens** — `OP_WHOOP_REF`, `OP_OURA_REF`, `OP_GREENLIGHT_REF`,
  `OP_ANTHROPIC_REF` in `.env`. The **Connect** buttons on the wellness and
  Greenlight cards report whether the reference resolves, without ever showing it.
- **Family reference secrets** — school portals, activity logins, emergency info.
  Add them under Settings → Family vault as `op://Vault/Item/field`. Tapping
  **Reveal** asks the sidecar, which **checks the parent PIN server-side** before
  reading, and the value hides itself again after 30 seconds.
- **Calendar feeds** — paste an `op://…` reference instead of a URL and the
  sidecar resolves it at sync time, so a private school-calendar link never sits
  in the vault.

Requires `op` on `PATH` and a signed-in session. Without it the app runs fine;
those specific buttons just explain what's missing.

---

## What changed from the prototype

The prototype was a single-file mockup. Four things had to become real:

- **Storage** — `localStorage` → the vault sync above (with `localStorage` kept
  as the offline fallback).
- **Calendar feeds** — the prototype hit ICS urls from the browser and most
  school calendars refused (CORS). The sidecar fetches them server-side, so they
  work now.
- **Sidekick** — the prototype called `window.claude.complete`, which only exists
  inside the design tool. It now calls the Claude API from the sidecar using
  structured outputs, so the reply is schema-valid JSON and the key never reaches
  the browser.
- **Display props** — the design tool's tweak panel (TV mode, weather, week
  start) became a per-device Settings section, so the TV can run big type while
  the iPad stays compact.

Deliberately unchanged: voice control is still browser-side Web Speech, so it
needs Chrome or Edge and an https (or localhost) origin — on the iPad over plain
wifi it explains that and points at the Sidekick instead.

---

## Layout

```
src/
  pages/       one file per screen (Today, Member, Calendar, …)
  components/  rail, header, agenda row, pre-flight, dialogs, overlays
  store/       FamilyStore (data, nav, parent lock), ModalStore, sync client
  lib/         dates, selectors, theme tokens, weather, ICS, voice, kid themes
  data/        seed + migrations
server/
  index.ts     http + SSE + routes
  vault.ts     the two-way markdown mirror
  markdown.ts  frontmatter / table / checkbox helpers
  onepassword.ts, sidekick.ts, config.ts
```

Shared code (`src/types.ts`, `src/lib/dates.ts`, `src/lib/preflight.ts`,
`src/lib/ics.ts`) is imported by both sides so the markdown writer and the UI can
never disagree about the model.

---

## Checks

```bash
npx tsc --noEmit      # types
npm run build         # production bundle
npm run smoke         # 19 browser checks against a running dev server
```

The smoke test drives a real Chromium: every nav destination, the PIN gate, the
themed kid pages, the star toast, and the event dialog. It needs the dev server
up (`npm run dev`) and a browser (`npx playwright install chromium`).
