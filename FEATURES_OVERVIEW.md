# HD HOUSIE Web Application – Feature Overview & Implementation Details

---

## Table of Contents
1. [High‑Level Architecture](#high‑level-architecture)
2. [Application State (`appState`)](#application-state-appstate)
3. [Core UI Views & Navigation](#core-ui-views--navigation)
4. [Authentication & Player Login](#authentication--player-login)
5. [Room Lifecycle & Firebase Integration](#room-lifecycle--firebase-integration)
6. [Mobile Haptic Feedback (Retained Feature)](#mobile-haptic-feedback-retained-feature)
7. [End‑of‑Game Match Summary Modal (Retained Feature)](#end‑of‑game-match-summary-modal-retained-feature)
8. [QR Code Scanner (Utility)
   * Static CDN import
   * Camera selection logic
   * Autoplay / playsinline handling
   * Responsive viewport configuration
   * Pinch‑to‑zoom support (future note)](#qr-code-scanner-utility)
9. [Hidden / Secret Behaviors](#hidden--secret-behaviors)
10. [Theming System (Theme Rules)](#theming-system)
11. [Interaction Diagram (Mermaid)](#interaction-diagram)
12. [Key Functions (with line references)](#key-functions-with-line-references)
13. [Known Limitations & Future Work](#known-limitations--future-work)

---

## High‑Level Architecture
The application is a **single‑page client‑side web app** built with **Vite** (v5.4.21) and plain JavaScript modules.  It follows a **state‑driven UI** pattern where a global `appState` object (defined at the top of `app.js` – lines **18‑60**) holds all mutable data.  UI updates are performed through direct DOM manipulation; there is no virtual DOM library.

Key architectural components:
- **Firebase Realtime Database** – used for persisting rooms, players, and game state. The integration is optional; a dummy local‑only mode is automatically enabled when the placeholder config is detected (see `init()` lines **101‑124**).
- **Modular Event Handlers** – all event listeners are registered inside `setupEventListeners()` (lines **188‑654**). This guarantees they are attached once on app start.
- **Routing via URL hash** – hash‑based routing is employed to avoid Vercel 404 on page refresh (see `init()` lines **130‑176** and `switchView()` lines **749‑775**).
- **Theme Variables** – UI styling is driven entirely by CSS custom properties defined under `body.theme‑<name>` in accordance with the project's **Theme Implementation Rules** located at `.agents/AGENTS.md`.

---

## Application State (`appState`)
`appState` is a plain object that tracks:
```js
let appState = {
    player: { name: null, coins: 100, highestCoins: 100, inventory: { themes: ['default'] }, equipped: { theme: 'default' } },
    room:   { code: null, isHost: false, pot: 0, numbers: [], claims: {}, status: 'waiting' },
    myTickets: [],
    boardNumbers: Array.from({length:90}, (_,i)=>i+1),
    ttsEnabled: true,
    lastDbTtsMuted: false,
    isFirstSync: true,
    pendingRoomCode: null,
    isHostView: false,
    isPlayerTvView: false,
    autoCallActive: false,
    autoCallSeconds: 5,
    isAutoCallLeader: false,
    autoCallIntervalId: null,
    chatHistory: [],
    lastChatId: null,
    joinTime: 0,
    matchEarnings: 0,
    aiModeEnabled: false,
    bots: [],
    isAdminView: false,
    currentRankName: null,
    rankNotificationEnabled: false,
    sessionId: Math.floor(Math.random()*1_000_000)
};
```
- **Room timestamps** – after the recent fix, `appState.room.createdAt` is populated from the Firebase snapshot (see added lines **1279‑1284**). This acts as a fallback start time for match‑duration calculations.
- The state is mutated directly by UI actions and Firebase listeners; after each mutation the UI is refreshed by the corresponding rendering functions.

---

## Core UI Views & Navigation
The app contains the following top‑level view containers (`<div class="view" id="...-view">`):
- `lobby-view` – entry screen with name input, join/create room buttons, and QR scanner.
- `game-view` – the primary player view where tickets are displayed and numbers are drawn.
- `host-display-view` – host‑only UI with manual/auto draw controls.
- `shop‑view`, `admin‑view`, `feedback‑modal`, etc.

Navigation is handled by `switchView(viewId)` (lines **749‑775**). It updates `appState.currentView`, toggles the `active` class on the target view, and calls `updateHeader()` to reflect the new context.

---

## Authentication & Player Login
Login is purely nickname‑based; there is no password or OAuth. The flow:
1. User enters a name in `#player-name-input`.
2. `handleLogin()` (search for its definition – around line **910**) validates uniqueness via Firebase (`users/<name>/activeRoom`).
3. Successful login stores the name in `localStorage` (`hdhousie_saved_name`) for auto‑login on subsequent visits (see `init()` lines **180‑184**).
4. Upon logout, the name is cleared and the UI reverts to the auth view (`showConfirm` + `leaveGameLocally`).

---

## Room Lifecycle & Firebase Integration
### Creation / Joining
- **Create Room** – `handleCreateRoom()` (approx. line **860**) writes a new entry under `rooms/<code>` with initial state, sets `appState.room.isHost = true`, and updates the UI.
- **Join Room** – `handleJoinRoom()` (approx. line **880**) validates the room exists, marks the player as a participant under `rooms/<code>/players/<name>`, and loads the room snapshot.

### Real‑time Sync
The listener `onValue(roomRef, snapshot => { … })` subscribes to the room data (around line **1245‑1288**). It:
- Stores `appState.room` fields.
- Sets `appState.room.createdAt` if missing (new lines **1279‑1284**).
- Triggers UI rendering (`renderRoom()`).

### Score & Claims
Claims are stored under `room/claims/<type>` with the player name and timestamp. The modal for end‑of‑game summary aggregates these.

---

## Mobile Haptic Feedback (Retained Feature)
Implemented in `triggerHaptic(pattern = 35)` – lines **3804‑3812** (see later key functions). It:
- Checks for `navigator.vibrate` support.
- Calls `navigator.vibrate(pattern)` inside a `try/catch`.
- Used in two places:
  - Ticket cell click handler (calls with pattern `35` for a short buzz).
  - Celebration when the match summary is shown (`triggerHaptic(70)`).

The helper is exposed globally via `window.triggerHaptic` for potential external calls.

---

## End‑of‑Game Match Summary Modal (Retained Feature)
The modal lives in `index.html` (DOM element `#game-summary-modal`). Core logic resides in `showMatchSummaryModal(data)` – lines **3817‑3864**.
Key responsibilities:
- **Winner Display** – `data.winnerName`.
- **Numbers Drawn** – uses `appState.room.numbers` (the canonical array) for the "Winning Number" field.
- **Duration Calculation** – now uses the fallback start time hierarchy:
  ```js
  const startTime = data.gameStartTime || appState.gameStartTime || appState.room.createdAt || Date.now();
  const durationMs = data.durationMs || (Date.now() - startTime);
  const secondsTotal = Math.max(1, Math.floor(durationMs/1000));
  ```
  This guarantees a non‑zero duration even if the host never called `startGame`.
- **Awards** – Speed, Most Daubed, Lucky Number are computed from the snapshot data.
- **Claims Log** – iterates over `data.claims` to render a list of claim entries.
- The modal’s close button (`#summary-back-btn`) was changed to **Close** and now only hides the modal without navigating away (updated in `index.html` line **622**, and the click handler is bound in `DOMContentLoaded` – lines **3871‑3874**).

---

## QR Code Scanner (Utility)
Although not part of the retained feature set, the scanner remains functional and is used for quick room joining.
### Static Script Import
`index.html` includes a CDN load:
```html
<script src="https://unpkg.com/html5-qrcode"></script>
```
This ensures the library is cached and available globally as `Html5Qrcode`.
### Camera Selection Logic
`openQrCodeModal()` (around line **470‑492**) now attempts to fetch the list of cameras via `Html5Qrcode.getCameras()`. It prefers a rear‑facing camera by matching labels containing "back", "rear", or "environment". If none match, the first camera is used.
### Autoplay / playsinline Fixes
A `MutationObserver` (added in earlier iterations – see lines **530‑540** in the previous version) injects `playsinline`, `webkit-playsinline`, and `autoplay` attributes onto the `<video>` element upon creation, and forces a programmatic `play()` to bypass iOS restrictions.
### Responsive Viewport
Scanner configuration (`config` object) sets `fps: 15` and calculates `qrbox` size as 70 % of the current viewport dimensions, keeping the UI fluid on all devices.
### Pinch‑to‑Zoom (Future Note)
The library currently disables pinch‑zoom. Re‑enabling it would involve removing the `disableZoom` flag in the `Html5Qrcode` options.

---

## Hidden / Secret Behaviors
| Behavior | Description | Location |
|----------|-------------|----------|
| **Dummy Firebase mode** | If the config still contains placeholder values, the app runs entirely client‑side with `db = null`. | `init()` lines **101‑124** |
| **Room `createdAt` fallback** | When a room snapshot is first received, `createdAt` is stored on `appState.room`. Used for duration calculation if the host never set `gameStartTime`. | Added lines **1279‑1284** |
| **Hash‑based routing for Host TV** | Host view URLs are transformed to `/#hosttv#CODE` to avoid Vercel 404s on refresh. | `init()` lines **163‑171**, `switchView()` lines **758‑770** |
| **Automatic re‑login** | On page load, if a saved name exists in `localStorage`, the app auto‑submits the login form. | `init()` lines **180‑185** |
| **Silent UI updates** | Many UI changes (e.g., header badge, coin count) happen via direct DOM manipulation without a framework, which can cause stale DOM if state changes are made off‑screen. |
| **Background music & Solo practice removal** | The entire `AmbientMusicEngine` class and Solo Practice UI were stripped out, leaving only the retained features. | Removed sections around lines **3816‑3915** and **3984‑4009** |
| **Admin view hash handling** | Admin dashboard forces a `#admin` hash to keep the path `/` while still enabling navigation. | `init()` lines **158‑164**, `switchView()` lines **758‑770** |

---

## Theming System (Theme Rules)
All UI components must use CSS custom properties defined at the root of each theme selector (`body.theme‑<name>`). Required variables include:
- `--bg-color`, `--text-color`
- `--primary-color`, `--primary-hover`, `--secondary-color`
- Card styles: `--card-bg`, `--glass-border`, `--primary-glow`, `--primary-glow-dim`
- Button states: `--btn-primary-bg`, `--btn-primary-color`, …
- Ticket cell colors, chat bubbles, etc.
The theme files live in `styles/theme‑*.css` (not shown here) and are toggled via `appState.player.equipped.theme`.

---

## Interaction Diagram
```mermaid
flowchart TD
    A[Start – Load index.html] --> B{Firebase Config
    Valid?}
    B -- Yes --> C[Initialize Firebase]
    B -- No --> D[Local‑Only Mode]
    C --> E[setupEventListeners]
    D --> E
    E --> F[Check URL hash]
    F -->|HostTV| G[Enter Host View]
    F -->|Admin| H[Enter Admin View]
    F --> I[Show Lobby]
    I --> J{User enters name}
    J -->|Enter| K[handleLogin]
    K --> L[Save name to localStorage]
    L --> M[Show Lobby UI]
    M --> N{Create or Join Room}
    N -->|Create| O[handleCreateRoom]
    N -->|Join| P[handleJoinRoom]
    O & P --> Q[Subscribe to room snapshot]
    Q --> R[Render Room UI]
    R --> S{Host?
    (isHost)}
    S -- Yes --> T[Host Controls (draw, reset, auto)]
    S -- No --> U[Player View (ticket click, claim)]
    T & U --> V[Number drawn -> update appState.room.numbers]
    V --> W[Check for match end]
    W -->|Match End| X[showMatchSummaryModal]
    X --> Y[User clicks Close]
    Y --> Z[Modal hides, UI returns to Lobby]
```
---

## Key Functions (with line references)
| Function | Purpose | File & Line Range |
|----------|---------|-------------------|
| `init()` | Application bootstrapping, Firebase init, URL parsing, auto‑login. | `app.js` **101‑186** |
| `setupEventListeners()` | Registers all DOM listeners for navigation, game controls, QR scanner, feedback, admin, AI bots. | **188‑654** |
| `triggerHaptic()` | Vibrates device for tactile feedback. | **3804‑3812** |
| `showMatchSummaryModal(data)` | Builds and displays the end‑of‑game summary modal with winner, duration, awards, claims. | **3817‑3864** |
| `closeMatchSummaryModal()` | Hides the summary modal. | **3865‑3868** |
| `openQrCodeModal()` / `closeQrCodeModal()` | Show/hide QR scanner modal and initialise the scanner. | **470‑480** and **533‑539** |
| `handleLogin()` | Validates nickname, writes player presence, and transitions to lobby. | ~**910‑945** |
| `handleCreateRoom()` / `handleJoinRoom()` | Create or join a game room, set host flag. | ~**860‑899** and **880‑915** |
| `onValue(roomRef, …)` listener | Syncs room data in real‑time, adds `createdAt` fallback. | **1245‑1288** |
| `renderRoom()` | Updates UI based on current `appState.room`. | ~**1310‑1365** |
| `handleNextNumber()` | Host draws the next number, updates DB. | ~**960‑990** |
| `handleClaim(claimType)` | Player claims a win condition, writes to DB. | ~**1010‑1035** |
| `updateHeader()` | Adjusts header visibility (user info, TV mode badge). | **785‑799** |
| `switchView(viewId)` | Central navigation between major UI sections. | **749‑775** |

---

## Known Limitations & Future Work
- **Pinch‑to‑zoom** for the QR scanner is currently disabled; re‑enable by removing the `disableZoom` flag in the scanner config.
- **Ambient Music & Solo Practice** code has been stripped; if these features are required again, the removed classes (`AmbientMusicEngine`, Solo practice engine) need to be restored.
- **Accessibility**: No ARIA labels are present on many interactive elements.
- **Error handling** for Firebase network failures could be more robust (currently only console warnings).
- **Theming**: While variables are defined, there is no UI for theme selection; adding a theme picker would improve UX.
- **Unit Tests**: The project lacks a test suite; adding Jest or Vitest tests would help prevent regressions.

---

*This document was generated automatically to provide an exhaustive overview of the current HD HOUSIE web application, focusing on the retained features (Mobile Haptic Feedback and End‑of‑Game Match Summary) while also describing the surrounding infrastructure and hidden behaviours.*
