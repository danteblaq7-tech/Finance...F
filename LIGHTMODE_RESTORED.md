# Light mode restored on top of the production build

Overlay these files onto your repo (all under `finesse/`). No dependency, backend, database or lockfile changes.

Web: light/dark colour system (index.css, tailwind.config.ts), theme.ts + ThemeToggle (follows the OS until the user chooses), no-flash script in index.html, deep teal side panel, theme-aware status colours (TONE), Monaco editor follows the theme.
Mobile: Daylight/Midnight palettes, theme-aware tab bar, Badge accepts palette keys, system light/dark on first launch.

Kept from production: ErrorBoundary, Dashboard nav item + page, statement verification / revoke flows, min-payment %, QR verify.
Also themed (new in production, was hard-coded dark-only): dashboard charts, exam card + staff badges (statement, revoked, awaiting verification) on web and mobile. New colours: --c-purple, TONE.purple, TONE.orange.

## Layout refresh (web)
Full-bleed (edge to edge) layout, fixed sidebar (only the content scrolls), curved active tab that flows into the content panel,
roomier spacing (cards, page headers, nav), sentence-case nav in Lexend. Dark mode sidebar now has its own deep teal
(--side-bg in index.css) so the curved tab shows. To use a blue sidebar like the reference, change --side-* in index.css.

Sidebar: no visible scrollbar (still scrolls on very short windows), tighter spacing so it normally fits. Dark mode: lighter teal outline around the active tab (--nav-edge in index.css). Slim themed scrollbar on the content area.
