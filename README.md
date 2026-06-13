# HD HOUSIE 🪙

**Official Website**: [https://hd-housie.vercel.app](https://hd-housie.vercel.app)

HD HOUSIE is a premium, real-time multiplayer Housie (Bingo) web application built for seamless group play. The application is hosted directly on Vercel and backed by Firebase Realtime Database. Below is a comprehensive overview of the site structure, gameplay mechanics, and software architecture.

---

## 🎮 Complete Gameplay Walkthrough

### 1. Authentication & Lobby Entrance
- **Login screen**: Players land on the welcome portal where they enter their name.
- **Lobby**: After joining, players see two main pathways:
  - **Host a Game**: Creates a new room with a unique 5-letter access code.
  - **Join a Game**: Players enter a 5-letter code. Alternatively, they can visit a room-code share URL directly (e.g. `https://hd-housie.vercel.app/#ABCDE`) which auto-fills the room code and forwards the player to the game board immediately upon logging in.

### 2. Role Setup & TV Mode Switching
- **Player Mode**: The default gameplay interface. Players see stats, payouts, ticket management controls, and the number grid.
- **Switching to Host Mode**: The room creator has a pulsing orange "Host" badge in the header. Clicking this badge switches their device to **Host TV Mode** (`/hosttv`). The Host TV Mode contains both the full 90-number grid and integrated manual/auto-call controls directly on the same screen. It is fully responsive, adapting seamlessly to desktop/TV screens and mobile devices.

### 3. Ticket Selection & Buy Phase
- Before the game starts, players choose to buy between **1 and 4 tickets**.
- Tickets are generated using standard Housie card rules (9 columns x 3 rows grid, containing precisely 15 unique numbers per ticket with no duplicates).
- Buying tickets registers them under the player's active state in the room.

### 4. Game Loop: Number Drawing
- **Manual Draw**: The host clicks "Draw Next Number" (or presses the Spacebar on desktop) to select the next random number from the pool of remaining numbers (1–90).
- **Auto Call**: The host can input an interval (e.g., 5 seconds) and toggle "Start Auto Call". To prevent duplication, only the host client that clicks start runs the timer loop, updating Firebase which syncs the drawing interval globally.
- **Visual & Audio Announcements**:
  - The drawn number is highlighted in the grid and added to the **Draw History** (automatically scrolling to show the latest numbers).
  - A browser-based **Text-to-Speech (TTS)** voice caller speaks the drawn number out loud (single and double digits, e.g., "Single number 7, number seven... Two and three, twenty-three").
  - Mute state is synced; if the host mutes their remote, the callouts are silenced on all client screens.

### 5. Ticket Marking & Prize Claims
- **Marking**: As numbers are announced, players tap matching cells on their active tickets to mark them with a premium glassmorphic badge.
- **Claiming Prizes**: Players can claim specific milestones:
  - **Early 5**: First ticket to mark any 5 numbers.
  - **4 Corners**: First ticket to mark the first and last numbers on the top and bottom rows.
  - **Top Row / Middle Row / Bottom Row**: First ticket to mark all 5 numbers in a specific row.
  - **Full House**: First ticket to mark all 15 numbers.
- **Validation**: When a player clicks a claim button, the client-side game engine instantly validates the claim against the list of drawn numbers. Valid claims are registered under the room's global state and displayed immediately on all host and player screens.

### 6. Winning & Game Reset
- **Celebration**: Valid claims trigger a confetti pop on the player's screen and add their name next to the corresponding prize in the Host's winners list.
- **Game Reset**: Once the Full House is claimed, the host can click "Reset Game" to clear all active tickets, wipe the pot, empty the drawn numbers history, and prepare the room for the next round.

---

## 💻 How the Code Works

### 1. Single Page Application (SPA) View Routing
The site acts as a single page application. All screens (Login, Lobby, Game View, Shop, Host Mode) are defined inside `index.html`. The client-side logic swaps views by toggling the `.active` class and controlling CSS visibility. The pathname (`/hosttv`) is dynamically updated in the browser's URL using the HTML5 History API (`window.history.pushState` / `replaceState`), making routing seamless.

### 2. Firebase Event-Driven State Sync
Data updates are bound between clients using real-time database listeners:
- Player tickets, balances, and equipped markers are read and updated at `users/USERNAME`.
- Live game state (draw list, pot, player list, claims, auto-call loop state) is synced under `rooms/ROOMCODE`.
- All connected clients listen to modifications on their active room reference using Firebase's `onValue` method. When the host mutes their remote, draws a number, or a player claims a prize, every client screen automatically re-renders without refreshing.

### 3. Viewport Constraints & Scrolling Alignment
- **Viewport Lock**: To prevent card panels or layouts from leaking past the screen edges, the app locks the page container (`#app`) height to `100vh` and disables page scrollbars when game views are active.
- **Flex Column Sizing**: The columns use a `min-height: 0` layout, allowing the individual card panels (Winners, Payouts, Board) to scale to fit the available space and enable their internal vertical scrollbars (`overflow-y: auto`) instead of spilling out.
- **Draw History Scrolling**: The history box uses a vertical wrapping flex container. When a number is drawn, the JavaScript automatically sets the container's `scrollTop` to its `scrollHeight`, keeping the latest numbers scrolled in view.

---

## 📂 Project Structure

```
├── app.js                 # Core game state management, UI events & Firebase subscriptions
├── index.html             # Views layout markup & HTML structure
├── styles.css             # Theme stylesheets, animations, and viewport configurations
├── vercel.json            # Vercel single-page application routing configurations
├── package.json           # Dev scripts & project dependency list
└── package-lock.json      # Locked npm packages directory
```
