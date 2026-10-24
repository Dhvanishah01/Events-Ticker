# Events Ticker

A static web page that shows upcoming Luma events ranked by **match** (fit with my profile), **reach** (RSVP count) and **distance** (from home). No backend, no database, no build step.

## How it works
1. `scripts/fetch-events.mjs` (Node 24, no dependencies) calls Luma's public Discover feed (`api.lu.ma/discover/get-paginated-events`, the same endpoint the luma-mcp server uses) and writes `public/events.json`.
2. `.github/workflows/refresh-events.yml` runs that script daily and commits `events.json` if it changed.
3. Vercel is linked to the GitHub repo and redeploys `public/` on every push (`vercel.json` sets `outputDirectory`).
4. `public/app.js` loads `events.json` + `profile.json` and scores everything in the browser. Export PDF = `window.print()` with print styles.

## Files
- `public/profile.json`: criteria the site reads (home location, categories, interest keywords and weights, default score weights).
- `profile.md`: human notes from LinkedIn; update `profile.json` from it.
- `docs/system-design.html`: architecture diagrams (Mermaid).

## Rules
- Keep it static: plain HTML/CSS/ES modules, no framework or bundler unless a version plan says otherwise.
- The Luma endpoint is undocumented. The fetch script must fail loudly and never overwrite `events.json` with an empty result.
- Escape all event text before inserting it into HTML.
- Run locally: `node scripts/fetch-events.mjs && npx serve public`.

## Plan
- **V0**: fetch + static ranked list + GitHub to Vercel auto-deploy. ← current
- **V1**: import the Claude design for a more interactive UI; fill in `profile.md` from LinkedIn; consider headless Claude (`claude -p`) in CI for semantic match scoring and "why this fits you" blurbs.
