# 10 · App shell & tooling

**Files:** `src/app/{App,main,app.css}.tsx`, root config (`vite.config.ts`,
`tsconfig*.json`, `eslint.config.js`, `.prettierrc.json`, `package.json`,
`index.html`).

## App shell (`src/app`)

- **`main.tsx`** — mounts `<App/>` under `#root`; imports Leaflet CSS + `app.css`.
- **`App.tsx`** — the composition root and the **only place** map + panels meet.
  Layout: CSS grid, map left (`1fr`), side pane right (`420px`). Header
  (title + Regenerate), `Tabs` (Risk appetite | COAs), the active panel, then the
  Cell inspector. Calls `regenerate()` once on mount.
- **`app.css`** — plain CSS with variables; no CSS framework. Owns the grid
  layout, panel/slider/chart/inspector styling, and the Leaflet container height
  (Leaflet needs an explicit height).

Keep the shell thin — it wires modules, it doesn't contain feature logic.

## Tooling

| Tool | Config | Notes |
|------|--------|-------|
| Vite 6 | `vite.config.ts` | React plugin; `@`→`src`, `@domain`→`src/domain` aliases; ES worker format; Vitest block |
| TypeScript 5 | `tsconfig.json` | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, bundler resolution |
| Vitest 3 | in `vite.config.ts` | jsdom env, globals, `setupTests.ts` (jest-dom) |
| ESLint 9 (flat) | `eslint.config.js` | js + typescript-eslint + react-hooks/react-refresh |
| Prettier 3 | `.prettierrc.json` | single quotes, trailing commas, width 100 |

### Scripts

```
npm run dev        # Vite dev server (HMR)
npm run build      # tsc --noEmit && vite build
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # vitest (watch)
npm run test:run   # vitest run (CI)
npm run lint       # eslint .
npm run format     # prettier --write
```

All of these pass on the current scaffold.

## CI (recommended, not yet added)

A single GitHub Actions job: `npm ci` → `lint` → `typecheck` → `test:run` →
`build`. Cache `~/.npm`. This is also a good fit for a Claude-Code-on-the-web
**SessionStart hook** (see the `session-start-hook` skill) so web sessions can run
the same checks. Add `dist/` is already git-ignored.

## Conventions for all contributors

- Import shared types/values from **`@domain`** (never reach across modules).
- UI imports **store + domain only**; engine imports **domain only**.
- No `Math.random()` — take an `Rng`. No private copies of the cost function.
- Keep modules behind their `create*()`/component interface so they stay
  swappable.
- New cross-module types go in `@domain` with a heads-up (it's the public API).
