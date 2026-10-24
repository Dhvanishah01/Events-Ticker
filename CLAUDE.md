# Events Ticker

## The spine
**Goal: land a product design / UX engineering / design technologist job by 2026-12-05 (6 weeks from 2026-10-24).** This tool exists to pick **3 high-value events a week** that move that goal forward. Every feature, score and UI decision should be judged against it.

A static web page that ranks upcoming Luma events by a **Tier score** and surfaces the top 5 for the next 7 days. No backend, no database, no build step.

## Tier score (`public/scoring.js`)
`tierScore = acceptance × (host 35% + venue 25% + fit 40%) × small distance discount`
- **Host**: target orgs (`profile.json` → `hosts.tierA`) = 100, notable orgs (`tierB`) = 75, otherwise verified/org calendar/crowd size signals.
- **Venue**: known company offices and venues (`venues.great`), host's own space, coworking/campus (`venues.good`); hidden venues (approval-only) = neutral.
- **Fit**: interest keywords from `profile.md` (design, UX, design engineering, hiring, portfolio…); `avoid` terms cut fit by 60%.
- **Acceptance** (odds of getting in): open 95, filling up 85, approval required 55–90 scaled by fit, exclusive audience 20–50, waitlist 30, sold out 5.
- **Distance**: from Salesforce Tower (`profile.home`).
- Tier 1 ≥ 45, Tier 2 ≥ 28, else Tier 3. Top 5 excludes off-topic and long shots (acceptance < 35).
- `node scripts/top-picks.mjs [days] [count]` prints the same ranking in the terminal.

## How it works
1. `scripts/fetch-events.mjs` (Node 24, no dependencies) calls Luma's public Discover feed (`api.lu.ma/discover/get-paginated-events`, the same endpoint the luma-mcp server uses) and writes `public/events.json`.
2. `.github/workflows/refresh-events.yml` runs that script daily and commits `events.json` if it changed.
3. Vercel is linked to the GitHub repo and redeploys `public/` on every push (`vercel.json` sets `outputDirectory`).
4. `public/app.js` loads `events.json` + `profile.json`, scores with `scoring.js`, and renders the goal tracker (3/week, "Plan to go" saved in localStorage), the top 5 and the full list. Export PDF = `window.print()` (prints goal + top 5).

## Files
- `public/profile.json`: criteria the site reads (goal, home = Salesforce Tower, feeds, interests, target hosts/venues, avoid terms, exclusive phrases).
- `profile.md`: human notes from LinkedIn; update `profile.json` from it.
- `docs/system-design.html`: architecture diagrams (Mermaid).

## Rules
- Keep it static: plain HTML/CSS/ES modules, no framework or bundler unless a version plan says otherwise.
- The Luma endpoint is undocumented. The fetch script must fail loudly and never overwrite `events.json` with an empty result.
- Escape all event text before inserting it into HTML.
- Run locally: `node scripts/fetch-events.mjs && npx serve public`. Test scoring: `node --test`.

## Plan
- **V0**: fetch + static ranked list + GitHub to Vercel auto-deploy. ← current
- **V1**: import the Claude design for a more interactive UI; fill in `profile.md` from LinkedIn; consider headless Claude (`claude -p`) in CI for semantic match scoring and "why this fits you" blurbs.
