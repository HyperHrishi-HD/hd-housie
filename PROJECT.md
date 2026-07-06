# Project: HD Housie UI & Theme Overhaul

## Architecture
- The application is a frontend-driven multiplayer Housie (Bingo) game.
- `index.html` holds the UI structure (draw panels, player lists, ticket area, chat box).
- `app.js` holds the client logic (socket events, ticket cell stamping, chat bubble rendering, theme selection).
- `styles.css` handles layout, theme variables, and visual presentation.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Analysis | Codebase investigation and mapping of CSS classes/variables for themes, stamps, and chat. | None | DONE |
| 2 | E2E Test Suite Setup | Creation of opaque-box E2E test cases (Tiers 1-4) in the E2E Testing Track. | M1 | IN_PROGRESS (Conv: 02710bbb-9a54-4f6a-bee7-e996b5d767a7) |
| 3 | Theme Style & Asset Implementation | Implementing the translucent theme, gold theme, neon bubble gradient, ocean outline, classic book, and backgrounds. | M1, M2 | IN_PROGRESS (Conv: b63778c1-9e49-4c7c-a854-3fba6a3fa756) |
| 4 | Review, Verification & Audit | Challenger verification and Forensic Auditor integrity verification. | M3 | PLANNED |
| 5 | Acceptance & Hardening | Final verification of E2E test suite and adversarial coverage hardening. | M4 | PLANNED |

## Interface Contracts
### Theme Switcher Interface
- HTML element with `id="theme-select"` (or similar theme selection dropdown).
- CSS classes prepended or appended to body or container (e.g., `body.theme-midnight`, `body.theme-translucent`).

### Chat Render Interface
- Chat container containing message elements.
- Bubble styles styled via CSS classes for different themes (e.g. `.gold-bubble`, `.neon-bubble`).

### Ticket Marker/Stamp Interface
- Element inside cell to represent the stamp.
- Custom shape or background styled dynamically or via theme-specific classes.

## Code Layout
- `index.html`: Main HTML file.
- `styles.css`: Central stylesheet containing layout and theme declarations.
- `app.js`: Main application script coordinating UI and WebSockets/Firebase.
- `public/`: Folder for premium background assets and other public files.
