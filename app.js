// v1 RELEASE
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, remove, child, increment, onDisconnect } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-database.js";

// Configuration for Firebase
// USER INSTRUCTION: Replace this with your actual Firebase project config.
const firebaseConfig = {
    apiKey: "AIzaSyDP9aLqf60MxbJidjfrWur3wCmd0KoCxbc",
    authDomain: "hd-housie.firebaseapp.com",
    projectId: "hd-housie",
    storageBucket: "hd-housie.firebasestorage.app",
    messagingSenderId: "779056798170",
    appId: "1:779056798170:web:36b4e0d4483aebb27f08e3",
    databaseURL: "https://hd-housie-default-rtdb.firebaseio.com"
};

// Application State
let appState = {
    player: {
        name: null,
        coins: 100,
        inventory: {
            themes: ['default'],
            skins: ['none'],
            markers: ['glass-stamp']
        },
        equipped: {
            theme: 'default',
            skin: 'none',
            marker: 'glass-stamp'
        }
    },
    room: {
        code: null,
        isHost: false,
        pot: 0,
        numbers: [],
        claims: {},
        status: 'waiting' // waiting, playing
    },
    myTickets: [],
    boardNumbers: Array.from({length: 90}, (_, i) => i + 1),
    ttsEnabled: true,
    lastDbTtsMuted: false,
    isFirstSync: true,
    pendingRoomCode: null,
    isHostView: false,
    isPlayerTvView: false,
    autoCallActive: false,
    autoCallSeconds: 5,
    isAutoCallLeader: false,
    autoCallIntervalId: null
};

// Shop Items Database
const shopItems = {
    themes: [
        { id: 'default', name: 'Default Dark', price: 0 },
        { id: 'midnight-star', name: 'Midnight Star', price: 50 },
        { id: 'gold-plate', name: 'Gold Plate', price: 100 },
        { id: 'matrix-rain', name: 'Matrix Rain', price: 500 },
        { id: 'neon', name: 'Neon', price: 1000 },
        { id: 'waves', name: 'Waves', price: 5000 }
    ],
    skins: [
        { id: 'none', name: 'Basic', price: 0 },
        { id: 'ruby', name: 'Ruby', price: 20 },
        { id: 'sapphire', name: 'Sapphire', price: 30 },
        { id: 'emerald', name: 'Emerald', price: 40 },
        { id: 'amethyst', name: 'Amethyst', price: 50 },
        { id: 'gold', name: 'Gold', price: 60 },
        { id: 'holographic', name: 'Holographic', price: 200 }
    ],
    markers: [
        { id: 'glass-stamp', name: 'Glass Stamp', price: 0 },
        { id: 'fire-glow', name: 'Fire Glow', price: 100 }
    ]
};

// Firebase References
let db, userRef, roomRef;
let unsubscribeRoom = null;

// Initialize App
function init() {
    if (firebaseConfig.projectId === "YOUR_PROJECT_ID" || firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.warn("Dummy Firebase config detected. Running in local-only mode.");
        db = null;
    } else {
        try {
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);
        } catch (e) {
            console.warn("Firebase not configured correctly. Running in local-only mode.", e);
            db = null; 
        }
    }

    setupEventListeners();
    initMatrixCanvas();

    // Check for sharing room code in URL hash
    const hash = window.location.hash.slice(1).trim().toUpperCase();
    if (/^[A-Z]{5}$/.test(hash)) {
        appState.pendingRoomCode = hash;
    }

    // Check if URL pathname indicates Host Mode
    const path = window.location.pathname;
    const isHostRoute = path.endsWith('/host') || path.includes('/host/') ||
                        path.endsWith('/hosttv') || path.includes('/hosttv/') ||
                        path.endsWith('/hostrt') || path.includes('/hostrt/');
    if (isHostRoute) {
        if (appState.pendingRoomCode) {
            appState.isHostView = true;
            if (path !== '/hosttv') {
                window.history.replaceState(null, '', '/hosttv' + window.location.hash);
            }
        } else {
            appState.isHostView = false;
            window.history.replaceState(null, '', '/');
        }
    }

    const savedName = localStorage.getItem('hdhousie_saved_name');
    if (savedName) {
        document.getElementById('player-name-input').value = savedName;
        handleLogin();
    }
}

function setupEventListeners() {
    // Nav
    document.getElementById('nav-lobby-btn').addEventListener('click', () => {
        if (appState.room.code) {
            if (appState.room.isHost) {
                showConfirm("Close Room", "You are the Host. Leaving will close this room permanently. Are you sure?", () => {
                    if (db && roomRef) set(roomRef, null); // Delete room
                    leaveGameLocally();
                });
            } else {
                showConfirm("Leave Room", "Are you sure you want to leave the room?", () => {
                    leaveGameLocally();
                });
            }
        } else {
            switchView('lobby-view');
        }
    });

    document.getElementById('nav-shop-btn').addEventListener('click', () => {
        const activeView = document.querySelector('.view.active');
        if (activeView && activeView.id === 'shop-view') {
            switchView(previousView || 'lobby-view');
        } else {
            renderShop();
            switchView('shop-view');
        }
    });
    
    // Shop Close Button
    document.getElementById('close-shop-btn').addEventListener('click', () => switchView(previousView));

    // History button
    document.getElementById('show-history-btn').addEventListener('click', () => {
        const container = document.getElementById('history-list');
        container.innerHTML = '';
        if (appState.room.numbers.length === 0) {
            container.innerHTML = '<p style="opacity: 0.7;">No numbers drawn yet.</p>';
        } else {
            appState.room.numbers.forEach((num, index) => {
                const bubble = document.createElement('div');
                bubble.style.cssText = 'background: var(--primary-color); color: #fff; width: 45px; height: 45px; border-radius: 50%; display: flex; justify-content: center; align-items: center; font-weight: bold; font-size: 1.2rem; box-shadow: 0 0 10px var(--primary-glow); position: relative; border: 1px solid var(--glass-border);';
                bubble.innerHTML = `<span>${num}</span><span style="position: absolute; top: -5px; right: -5px; background: rgba(0,0,0,0.8); font-size: 0.6rem; padding: 2px 4px; border-radius: 4px;">#${index + 1}</span>`;
                container.appendChild(bubble);
            });
        }
        document.getElementById('history-modal').style.display = 'flex';
    });

    document.getElementById('close-history-btn').addEventListener('click', () => {
        document.getElementById('history-modal').style.display = 'none';
    });

    // Instruction Manual
    document.getElementById('manual-btn').addEventListener('click', () => {
        document.getElementById('manual-modal').style.display = 'flex';
    });

    document.getElementById('close-manual-btn').addEventListener('click', () => {
        document.getElementById('manual-modal').style.display = 'none';
    });

    // Auth
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('player-name-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // Lobby
    document.getElementById('create-room-btn').addEventListener('click', handleCreateRoom);
    document.getElementById('join-room-btn').addEventListener('click', handleJoinRoom);
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleJoinRoom();
    });
    document.getElementById('logout-btn').addEventListener('click', () => {
        showConfirm("Logout", "Are you sure you want to logout? You will have to enter your name again.", () => {
            localStorage.removeItem('hdhousie_saved_name');
            appState.player = {
                name: null,
                coins: 100,
                inventory: {
                    themes: ['default'],
                    skins: ['none'],
                    markers: ['glass-stamp']
                },
                equipped: {
                    theme: 'default',
                    skin: 'none',
                    marker: 'glass-stamp'
                }
            };
            document.getElementById('player-name-input').value = '';
            document.getElementById('header-user-info').style.display = 'none';
            window.location.hash = ''; // Clear hash on logout
            switchView('auth-view');
        });
    });

    // Game
    document.getElementById('buy-tickets-btn').addEventListener('click', handleBuyTickets);
    document.getElementById('next-number-btn').addEventListener('click', handleNextNumber);
    document.getElementById('reset-game-btn').addEventListener('click', handleResetGame);
    
    // Claims
    document.querySelectorAll('.claim-btn').forEach(btn => {
        btn.addEventListener('click', (e) => handleClaim(e.target.dataset.claim));
    });

    // Close modals on background click
    document.querySelectorAll('div[id$="-modal"]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    // Keyboard Shortcuts for Game Controls
    document.addEventListener('keydown', (e) => {
        // Ignore key presses if typing in an input
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
            return;
        }

        const gameView = document.getElementById('game-view');
        const hostView = document.getElementById('host-display-view');
        const isGameActive = gameView && gameView.classList.contains('active');
        const isHostActive = hostView && hostView.classList.contains('active');

        if (!isGameActive && !isHostActive) {
            return;
        }

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (appState.room.isHost) {
                if (isGameActive) {
                    const nextBtn = document.getElementById('next-number-btn');
                    if (nextBtn && !nextBtn.disabled && nextBtn.style.display !== 'none') {
                        nextBtn.click();
                    }
                } else if (isHostActive) {
                    const hostDrawBtn = document.getElementById('host-draw-btn');
                    if (hostDrawBtn && !hostDrawBtn.disabled && hostDrawBtn.style.display !== 'none') {
                        hostDrawBtn.click();
                    }
                }
            }
        } else if (isGameActive) {
            if (e.key === '1') {
                const btn = document.querySelector('.claim-btn[data-claim="Early 5"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.key === '2') {
                const btn = document.querySelector('.claim-btn[data-claim="4 Corners"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.key === '3') {
                const btn = document.querySelector('.claim-btn[data-claim="Top Row"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.key === '4') {
                const btn = document.querySelector('.claim-btn[data-claim="Middle Row"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.key === '5') {
                const btn = document.querySelector('.claim-btn[data-claim="Bottom Row"]');
                if (btn && !btn.disabled) btn.click();
            } else if (e.key === '6') {
                const btn = document.querySelector('.claim-btn[data-claim="Full House"]');
                if (btn && !btn.disabled) btn.click();
            }
        }
    });

    // TTS Toggle Button
    document.getElementById('tts-toggle-btn').addEventListener('click', () => {
        appState.ttsEnabled = !appState.ttsEnabled;
        updateTtsButtonUI();
        
        if (appState.ttsEnabled) {
            showNotification("Voice callouts enabled.");
            speakText("voice enabled");
        } else {
            showNotification("Voice callouts disabled.");
        }
        
        // If user is host, sync to database
        if (appState.room.isHost && db && roomRef) {
            update(roomRef, { ttsMuted: !appState.ttsEnabled });
        }
    });

    // Role badge toggle listener (Host toggles Host TV Mode, Player toggles Player TV Mode)
    document.getElementById('role-badge').addEventListener('click', () => {
        if (appState.room.isHost) {
            // Toggle Host View
            appState.isHostView = !appState.isHostView;
            
            // Update URL
            let path = '/';
            if (appState.isHostView) {
                path = '/hosttv';
            }
            window.history.pushState(null, '', path + window.location.hash);
            
            // Update UI
            joinGameUI();
        } else {
            // Toggle Player TV View (does NOT change URL)
            appState.isPlayerTvView = !appState.isPlayerTvView;
            
            // Update UI
            joinGameUI();
        }
    });

    // Integrated Host Mode UI Tabs
    const toggleManualBtn = document.getElementById('toggle-manual-btn');
    const toggleAutoBtn = document.getElementById('toggle-auto-btn');
    const manualPanel = document.getElementById('control-manual-panel');
    const autoPanel = document.getElementById('control-auto-panel');

    if (toggleManualBtn && toggleAutoBtn && manualPanel && autoPanel) {
        toggleManualBtn.addEventListener('click', () => {
            toggleManualBtn.classList.add('active');
            toggleAutoBtn.classList.remove('active');
            manualPanel.style.display = 'flex';
            autoPanel.style.display = 'none';
        });

        toggleAutoBtn.addEventListener('click', () => {
            toggleAutoBtn.classList.add('active');
            toggleManualBtn.classList.remove('active');
            manualPanel.style.display = 'none';
            autoPanel.style.display = 'flex';
        });
    }

    // Integrated Host Mode Controls
    const hostDrawBtn = document.getElementById('host-draw-btn');
    if (hostDrawBtn) {
        hostDrawBtn.addEventListener('click', handleNextNumber);
    }
    
    const hostResetBtn = document.getElementById('host-reset-btn');
    if (hostResetBtn) {
        hostResetBtn.addEventListener('click', handleResetGame);
    }

    const hostAutoBtn = document.getElementById('host-auto-btn');
    if (hostAutoBtn) {
        hostAutoBtn.addEventListener('click', () => {
            const seconds = parseInt(document.getElementById('host-auto-seconds').value) || 5;
            toggleAutoCall(seconds);
        });
    }

    const hostAutoSeconds = document.getElementById('host-auto-seconds');
    if (hostAutoSeconds) {
        hostAutoSeconds.addEventListener('input', (e) => {
            const valSpan = document.getElementById('host-auto-seconds-val');
            if (valSpan) {
                valSpan.innerText = e.target.value + 's';
            }
        });
    }
    
    // Resize/Orientation listener for Host Mode
    window.addEventListener('resize', () => {
        const hostView = document.getElementById('host-display-view');
        if (appState.isHostView && hostView && hostView.classList.contains('active')) {
            renderHostMode();
        }
    });
}

// ==========================================
// VIEWS & UI
// ==========================================

let previousView = 'start-view';

function leaveGameLocally() {
    if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
    }
    if (db && roomRef) {
        const playerPresRef = child(roomRef, `players/${appState.player.name}`);
        set(playerPresRef, null);
    }
    
    // Clear auto call timer if active
    if (appState.autoCallIntervalId) {
        clearInterval(appState.autoCallIntervalId);
        appState.autoCallIntervalId = null;
    }
    appState.autoCallActive = false;
    appState.isAutoCallLeader = false;

    appState.room = { code: '', isHost: false, pot: 0, numbers: [], claims: {}, status: 'waiting' };
    
    document.getElementById('header-room-code-container').style.display = 'none';
    document.getElementById('header-role-badge-container').style.display = 'none';
    document.getElementById('header-host-stats').style.display = 'none';
    document.getElementById('tts-toggle-btn').style.display = 'none';
    
    appState.isHostView = false;
    appState.isPlayerTvView = false;
    
    // Clear URL path and hash
    window.history.pushState(null, '', '/');
    window.location.hash = '';
    
    switchView('lobby-view');
}

function showConfirm(title, message, onConfirm) {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');
    
    // Replace nodes to clear old event listeners
    const newConfirm = confirmBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    
    newCancel.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    newConfirm.addEventListener('click', () => {
        modal.style.display = 'none';
        onConfirm();
    });
    
    modal.style.display = 'flex';
}

function switchView(viewId) {
    if (viewId === 'shop-view') {
        const currentActive = document.querySelector('.view.active');
        if (currentActive && currentActive.id !== 'shop-view') {
            previousView = currentActive.id;
        }
    }
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function updateHeader() {
    document.getElementById('header-user-info').style.display = 'flex';
    document.getElementById('header-name').innerText = appState.player.name;
    document.getElementById('header-coins').innerText = appState.player.coins;
    
    // Update Rank Badge
    const rankInfo = getPlayerRankInfo(appState.player.coins);
    const badgeEl = document.getElementById('header-badge');
    if (badgeEl) {
        badgeEl.innerText = rankInfo.name;
        badgeEl.className = 'badge ' + rankInfo.className;
        
        if (appState.currentRankName && appState.currentRankName !== rankInfo.name) {
            const ranksOrder = ['Novice', 'Apprentice', 'Expert', 'Pro', 'Elite', 'Champion', 'Master', 'Grandmaster', 'Mythic', 'Legend'];
            const oldIdx = ranksOrder.indexOf(appState.currentRankName);
            const newIdx = ranksOrder.indexOf(rankInfo.name);
            
            if (newIdx > oldIdx) {
                showNotification(`🎉 Rank Up! You are now ${rankInfo.name}!`);
            } else if (newIdx < oldIdx) {
                showNotification(`Rank Changed: You are now ${rankInfo.name}.`);
            }
        }
        appState.currentRankName = rankInfo.name;
    }
    
    applyTheme(appState.player.equipped.theme);
}

function applyTheme(themeId) {
    document.body.className = '';
    if (themeId !== 'default') {
        document.body.classList.add(`theme-${themeId}`);
    }
}

function showNotification(message) {
    const container = document.getElementById('notifications-container');
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.innerHTML = `<span>${message}</span>`;
    container.appendChild(notif);

    setTimeout(() => {
        notif.classList.add('fadeOut');
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

// ==========================================
// AUTH & USER DATA
// ==========================================

async function handleLogin() {
    const nameInput = document.getElementById('player-name-input').value.trim();
    if (!nameInput) return showNotification("Please enter a name.");
    
    // Reset player state to default values to prevent inheriting previous logged-in user data
    appState.player = {
        name: nameInput,
        coins: 100,
        inventory: {
            themes: ['default'],
            skins: ['none'],
            markers: ['glass-stamp']
        },
        equipped: {
            theme: 'default',
            skin: 'none',
            marker: 'glass-stamp'
        }
    };
    
    localStorage.setItem('hdhousie_saved_name', nameInput);
    
    const loginBtn = document.getElementById('login-btn');
    const originalText = loginBtn.innerText;
    loginBtn.innerText = "Connecting...";
    loginBtn.disabled = true;

    try {
        if (db) {
            userRef = ref(db, `users/${nameInput}`);
            const snapshot = await get(userRef);
            if (snapshot.exists()) {
                const data = snapshot.val();
                appState.player.coins = data.coins || 100;
                appState.player.inventory = data.inventory || {
                    themes: ['default'],
                    skins: ['none'],
                    markers: ['glass-stamp']
                };
                appState.player.equipped = data.equipped || {
                    theme: 'default',
                    skin: 'none',
                    marker: 'glass-stamp'
                };
            } else {
                // New user
                await set(userRef, appState.player);
            }
        } else {
            // Local mode fallback
            const localData = localStorage.getItem(`user_${nameInput}`);
            if(localData) {
                appState.player = JSON.parse(localData);
            }
        }

        updateHeader();
        
        // Auto-join if there is a pending sharing link room code
        if (appState.pendingRoomCode) {
            document.getElementById('room-code-input').value = appState.pendingRoomCode;
            appState.pendingRoomCode = null; // Clear so we don't auto-join again if they log out
            await handleJoinRoom();
        } else {
            switchView('lobby-view');
        }
    } catch (e) {
        console.error(e);
        showNotification("Failed to connect.");
    } finally {
        loginBtn.innerText = originalText;
        loginBtn.disabled = false;
    }
}

function saveUser() {
    if (db && userRef) {
        set(userRef, appState.player);
    } else {
        localStorage.setItem(`user_${appState.player.name}`, JSON.stringify(appState.player));
    }
    updateHeader();
}

// ==========================================
// LOBBY & ROOM MANAGEMENT
// ==========================================

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function handleCreateRoom() {
    if (db) {
        // Garbage Collection: Delete old or zombie rooms
        try {
            const roomsRef = ref(db, 'rooms');
            const snap = await get(roomsRef);
            if (snap.exists()) {
                const now = Date.now();
                const allRooms = snap.val();
                for (const [rCode, rData] of Object.entries(allRooms)) {
                    // Delete rooms older than 12 hours or legacy rooms without a timestamp
                    if (!rData.createdAt || (now - rData.createdAt > 12 * 60 * 60 * 1000)) {
                        remove(ref(db, `rooms/${rCode}`));
                    }
                }
            }
        } catch(e) { console.error("Cleanup failed", e); }
    }

    const code = generateRoomCode();
    appState.room = {
        code: code,
        isHost: true,
        pot: 0,
        numbers: [],
        claims: {},
        status: 'waiting'
    };

    if (db) {
        roomRef = ref(db, `rooms/${code}`);
        await set(roomRef, {
            host: appState.player.name,
            pot: 0,
            numbers: [],
            claims: {},
            status: 'waiting',
            createdAt: Date.now()
        });
    }

    await joinGameUI();
}

async function handleJoinRoom() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length !== 5) return showNotification("Invalid room code.");

    if (db) {
        roomRef = ref(db, `rooms/${code}`);
        const snapshot = await get(roomRef);
        if (!snapshot.exists()) {
            showNotification("Room not found.");
            leaveGameLocally();
            return;
        }
        
        const data = snapshot.val();
        appState.room.code = code;
        appState.room.isHost = (data.host === appState.player.name);
        await joinGameUI();
    } else {
        showNotification("Local Mode: Mock joining room.");
        appState.room.code = code;
        appState.room.isHost = false;
        await joinGameUI();
    }
}

async function joinGameUI() {
    // Update hash for sharing link
    window.location.hash = appState.room.code;

    if (appState.isHostView || appState.isPlayerTvView) {
        if (appState.isHostView && !appState.room.isHost) {
            showNotification("You are not the host of this room.");
            leaveGameLocally();
            return;
        }
        document.getElementById('current-room-code').innerText = appState.room.code;
        
        if (appState.room.isHost) {
            document.getElementById('role-badge').innerText = 'Host Mode';
            document.getElementById('role-badge').className = 'role-badge host';
            document.getElementById('header-host-stats').style.display = 'inline';
            const ctrlBox = document.querySelector('.host-controls-box');
            if (ctrlBox) ctrlBox.style.display = 'block';
        } else {
            document.getElementById('role-badge').innerText = 'TV Mode';
            document.getElementById('role-badge').className = 'role-badge player';
            document.getElementById('header-host-stats').style.display = 'none';
            const ctrlBox = document.querySelector('.host-controls-box');
            if (ctrlBox) ctrlBox.style.display = 'none';
        }
        
        document.getElementById('header-room-code-container').style.display = 'block';
        document.getElementById('header-role-badge-container').style.display = 'block';
        
        document.getElementById('tts-toggle-btn').style.display = 'inline-block';
        updateTtsButtonUI();

        renderHostBoard();
        renderHostMode();
        syncHostGameState();
        
        switchView('host-display-view');
    } else {
        document.getElementById('current-room-code').innerText = appState.room.code;
        document.getElementById('role-badge').innerText = appState.room.isHost ? 'Host' : 'Player';
        document.getElementById('role-badge').className = `role-badge ${appState.room.isHost ? 'host' : 'player'}`;
        document.getElementById('host-controls').style.display = appState.room.isHost ? 'block' : 'none';
        
        document.getElementById('header-room-code-container').style.display = 'block';
        document.getElementById('header-host-stats').style.display = 'none';
        document.getElementById('header-role-badge-container').style.display = 'block';
        
        document.getElementById('tts-toggle-btn').style.display = 'inline-block';
        appState.isFirstSync = true;
        appState.lastSpokenNumber = null;
        appState.lastDbTtsMuted = false;
        appState.ttsEnabled = true;
        updateTtsButtonUI();
        
        // Ensure controls are visible when in normal view
        const ctrlBox = document.querySelector('.host-controls-box');
        if (ctrlBox) ctrlBox.style.display = 'block';
    }
    
    // Check for saved tickets
    let hasTickets = false;
    if (db && roomRef) {
        const ticketsRef = child(roomRef, `tickets/${appState.player.name}`);
        const snap = await get(ticketsRef);
        if (snap.exists()) {
            appState.myTickets = snap.val();
            hasTickets = true;
        }
    } else {
        const savedTickets = localStorage.getItem(`tickets_${appState.room.code}_${appState.player.name}`);
        if (savedTickets) {
            appState.myTickets = JSON.parse(savedTickets);
            hasTickets = true;
        }
    }

    if (hasTickets) {
        document.getElementById('ticket-setup').style.display = 'none';
        document.getElementById('claims-area').style.display = 'block';
        renderTickets();
    } else {
        document.getElementById('tickets-container').innerHTML = '';
        appState.myTickets = [];
        document.getElementById('ticket-setup').style.display = 'block';
        document.getElementById('claims-area').style.display = 'none';

        // Clear local storage markers for new game
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('mark_')) localStorage.removeItem(key);
        });
    }

    if (db && roomRef) {
        const playerPresRef = child(roomRef, `players/${appState.player.name}`);
        set(playerPresRef, true);
        onDisconnect(playerPresRef).remove();
    } else {
        appState.room.playerCount = 1;
        syncGameState();
    }

    renderBoard();
    if (!appState.isHostView && !appState.isPlayerTvView) {
        switchView('game-view');
    }

    // Setup listener
    if (db && roomRef) {
        if (unsubscribeRoom) unsubscribeRoom();
        unsubscribeRoom = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                // Room was deleted
                showNotification("The host has closed this room.");
                leaveGameLocally();
                return;
            }
            
            const oldClaims = appState.room.claims || {};
            const newClaims = data.claims || {};
            
            for (const [claimType, winner] of Object.entries(newClaims)) {
                if (!oldClaims[claimType] && winner !== appState.player.name) {
                    showNotification(`${winner} won ${claimType}!`);
                }
            }

            // If Full House has been claimed, stop auto call on host client
            if (newClaims['Full House'] && appState.autoCallActive && appState.room.isHost) {
                stopAutoCall();
            }

            appState.room.pot = data.pot || 0;
            appState.room.numbers = data.numbers || [];
            appState.room.claims = newClaims;
            appState.room.status = data.status || 'waiting';
            
            const playersObj = data.players || {};
            appState.room.playerCount = Object.keys(playersObj).length;

            // Handle host-propagated mute
            const newTtsMuted = !!data.ttsMuted;
            if (newTtsMuted && !appState.lastDbTtsMuted) {
                appState.ttsEnabled = false;
                updateTtsButtonUI();
                showNotification("Host disabled game voice callouts.");
            }
            appState.lastDbTtsMuted = newTtsMuted;

            // Handle auto call state sync
            const autoCallData = data.autoCall || { active: false, seconds: 5 };
            appState.autoCallActive = !!autoCallData.active;
            appState.autoCallSeconds = parseInt(autoCallData.seconds) || 5;

            if (!appState.autoCallActive) {
                appState.isAutoCallLeader = false;
                if (appState.autoCallIntervalId) {
                    clearInterval(appState.autoCallIntervalId);
                    appState.autoCallIntervalId = null;
                }
            } else {
                if (appState.room.isHost) {
                    appState.isAutoCallLeader = true;
                }
                if (appState.isAutoCallLeader && !appState.autoCallIntervalId) {
                    startAutoCallTimer();
                }
            }
            syncAutoCallUI();

            // Check if game was reset (no tickets on server, but player has local tickets)
            const incomingPot = data.pot || 0;
            const incomingNumbers = data.numbers || [];
            if (incomingPot === 0 && incomingNumbers.length === 0 && (!data.tickets || !data.tickets[appState.player.name])) {
                if (appState.myTickets && appState.myTickets.length > 0) {
                    appState.myTickets = [];
                    localStorage.removeItem(`tickets_${appState.room.code}_${appState.player.name}`);
                    
                    // CRITICAL FIX: Clear old markers from the cache so new tickets aren't pre-stamped!
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith(`mark_${appState.room.code}`)) localStorage.removeItem(key);
                    });

                    document.getElementById('tickets-container').innerHTML = '';
                    document.getElementById('ticket-setup').style.display = 'block';
                    document.getElementById('claims-area').style.display = 'none';
                    showNotification("Game was reset! Please buy new tickets.");
                }
            }

            syncGameState();
        });
    }
}

// ==========================================
// GAME LOGIC
// ==========================================

function syncGameState() {
    if (appState.isHostView || appState.isPlayerTvView) {
        syncHostGameState();
        return;
    }
    // Update Stats
    document.getElementById('room-pot').innerText = appState.room.pot;
    document.getElementById('room-player-count').innerText = appState.room.playerCount || 0;
    
    // Update Payouts
    const pot = appState.room.pot;
    document.getElementById('payout-early').innerText = Math.floor(pot * 0.10);
    document.getElementById('payout-corners').innerText = Math.floor(pot * 0.10);
    document.getElementById('payout-row').innerText = Math.floor(pot * 0.10);
    document.getElementById('payout-fh').innerText = Math.floor(pot * 0.50);

    // Update Board
    document.querySelectorAll('.board-cell').forEach(cell => cell.classList.remove('called'));
    appState.room.numbers.forEach(num => {
        const cell = document.getElementById(`board-cell-${num}`);
        if(cell) cell.classList.add('called');
    });

    // Update Last Called
    const lastCalled = appState.room.numbers[appState.room.numbers.length - 1];
    document.getElementById('last-called-number').innerText = lastCalled || '-';

    // Update Claims Buttons
    document.querySelectorAll('.claim-btn').forEach(btn => {
        const claimType = btn.dataset.claim;
        if (appState.room.claims[claimType]) {
            btn.disabled = true;
            btn.innerText = `${claimType} (Won by ${appState.room.claims[claimType]})`;
        } else {
            btn.disabled = false;
            btn.innerText = claimType; // reset text
        }
    });

    // Call out the new number using TTS if enabled
    if (lastCalled) {
        if (appState.isFirstSync) {
            appState.lastSpokenNumber = lastCalled;
            appState.isFirstSync = false;
        } else if (lastCalled !== appState.lastSpokenNumber) {
            speakNumber(lastCalled);
            appState.lastSpokenNumber = lastCalled;
        }
    } else {
        appState.lastSpokenNumber = null;
        appState.isFirstSync = false;
    }

    // Check if new number matches tickets, show notifications
    // Real implementation would have logic here.
}

function renderBoard() {
    const board = document.getElementById('housie-board');
    board.innerHTML = '';
    for (let i = 1; i <= 90; i++) {
        const cell = document.createElement('div');
        cell.className = 'board-cell';
        cell.id = `board-cell-${i}`;
        cell.innerText = i;
        board.appendChild(cell);
    }
}

async function handleBuyTickets() {
    const count = parseInt(document.getElementById('ticket-count-select').value);
    const betPerTicket = Math.max(0, parseInt(document.getElementById('bet-amount').value) || 0);
    let cost = count * betPerTicket;

    if (appState.player.coins < cost) {
        showNotification("Not enough coins, bet waived. Free tickets!");
        cost = 0;
    } else {
        showNotification(`Bought ${count} ticket(s) for ${cost} coins!`);
    }

    // Deduct coins
    if (cost > 0) {
        appState.player.coins -= cost;
        saveUser();

        // Add to pot
        if (db && roomRef) {
            update(roomRef, {
                pot: increment ? increment(cost) : appState.room.pot + cost
            });
        }
    }

    // Generate Tickets (Strip logic)
    appState.myTickets = generateTickets(count);
    
    if (db && roomRef) {
        const ticketsRef = child(roomRef, `tickets/${appState.player.name}`);
        set(ticketsRef, appState.myTickets);
    }
    // Fallback for local testing
    localStorage.setItem(`tickets_${appState.room.code}_${appState.player.name}`, JSON.stringify(appState.myTickets));
    
    renderTickets();

    document.getElementById('ticket-setup').style.display = 'none';
    document.getElementById('claims-area').style.display = 'block';
}

function generateTickets(numTickets) {
    const tickets = [];

    for (let t = 0; t < numTickets; t++) {
        // Generates non-repeating numbers across each ticket individually to prevent column pool exhaustion
        // 9 Columns mapping
        const colPools = [
            Array.from({length: 9}, (_,i)=>i+1),     // 1-9
            Array.from({length: 10}, (_,i)=>i+10),   // 10-19
            Array.from({length: 10}, (_,i)=>i+20),   // 20-29
            Array.from({length: 10}, (_,i)=>i+30),   // 30-39
            Array.from({length: 10}, (_,i)=>i+40),   // 40-49
            Array.from({length: 10}, (_,i)=>i+50),   // 50-59
            Array.from({length: 10}, (_,i)=>i+60),   // 60-69
            Array.from({length: 10}, (_,i)=>i+70),   // 70-79
            Array.from({length: 11}, (_,i)=>i+80)    // 80-90
        ];

        // Shuffle pools
        colPools.forEach(pool => pool.sort(() => Math.random() - 0.5));
        let validLayout = false;
        let layout = [];
        
        while(!validLayout) {
            layout = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0)];
            for(let r=0; r<3; r++) {
                let cols = [0,1,2,3,4,5,6,7,8].sort(()=>Math.random()-0.5).slice(0, 5);
                cols.forEach(c => layout[r][c] = 1);
            }
            validLayout = true;
            for(let c=0; c<9; c++) {
                if(layout[0][c] === 0 && layout[1][c] === 0 && layout[2][c] === 0) {
                    validLayout = false; break;
                }
            }
            if (validLayout) {
                let colCounts = Array(9).fill(0);
                for(let r=0; r<3; r++) {
                    for(let c=0; c<9; c++) {
                        if(layout[r][c]) colCounts[c]++;
                    }
                }
                for(let c=0; c<9; c++) {
                    if (colCounts[c] > colPools[c].length) {
                        validLayout = false; break;
                    }
                }
            }
        }

        let ticket = [Array(9).fill(0), Array(9).fill(0), Array(9).fill(0)];
        for (let r = 0; r < 3; r++) {
            for(let c=0; c<9; c++) {
                if (layout[r][c]) {
                    ticket[r][c] = colPools[c].pop();
                }
            }
        }
        tickets.push(ticket);
    }

    // Dynamic repeating chance for multi-ticket sets (2-4 tickets)
    let repeatChance = 0;
    let maxRepeats = 0;
    if (numTickets === 2) {
        repeatChance = 0.25;
        maxRepeats = 2;
    } else if (numTickets === 3) {
        repeatChance = 0.50;
        maxRepeats = 3;
    } else if (numTickets === 4) {
        repeatChance = 0.75;
        maxRepeats = 4;
    }

    if (numTickets > 1 && Math.random() < repeatChance) {
        const numRepeats = Math.floor(Math.random() * maxRepeats) + 1;
        // Choose distinct columns to perform the repeat on
        const columns = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5).slice(0, numRepeats);
        
        columns.forEach(c => {
            // Pick a source ticket index
            const srcIdx = Math.floor(Math.random() * numTickets);
            // Pick a destination ticket index (different from source)
            let destIdx = Math.floor(Math.random() * numTickets);
            while (destIdx === srcIdx) {
                destIdx = Math.floor(Math.random() * numTickets);
            }
            
            // Find all rows in source ticket that have a number in column c
            const srcRows = [];
            for (let r = 0; r < 3; r++) {
                if (tickets[srcIdx][r][c] !== 0) srcRows.push(r);
            }
            
            // Find all rows in destination ticket that have a number in column c
            const destRows = [];
            for (let r = 0; r < 3; r++) {
                if (tickets[destIdx][r][c] !== 0) destRows.push(r);
            }
            
            if (srcRows.length > 0 && destRows.length > 0) {
                const srcRow = srcRows[Math.floor(Math.random() * srcRows.length)];
                const destRow = destRows[Math.floor(Math.random() * destRows.length)];
                const numToRepeat = tickets[srcIdx][srcRow][c];
                
                // Ensure the destination ticket does not already contain this number to prevent internal duplicates
                let alreadyHasNum = false;
                for (let r = 0; r < 3; r++) {
                    if (tickets[destIdx][r][c] === numToRepeat) {
                        alreadyHasNum = true;
                        break;
                    }
                }
                
                // Perform the repeat only if it's unique in the destination ticket
                if (!alreadyHasNum) {
                    tickets[destIdx][destRow][c] = numToRepeat;
                }
            }
        });
    }

    // Sort each column internally for readability
    tickets.forEach(ticket => {
        for(let c=0; c<9; c++) {
            let colNums = [];
            for(let r=0; r<3; r++) if(ticket[r][c] !== 0) colNums.push(ticket[r][c]);
            colNums.sort((a,b)=>a-b);
            let idx = 0;
            for(let r=0; r<3; r++) if(ticket[r][c] !== 0) ticket[r][c] = colNums[idx++];
        }
    });

    return tickets;
}

function renderTickets() {
    const container = document.getElementById('tickets-container');
    container.innerHTML = '';

    appState.myTickets.forEach((ticketData, tIdx) => {
        const tDiv = document.createElement('div');
        tDiv.className = `ticket skin-${appState.player.equipped.skin}`;
        
        const grid = document.createElement('div');
        grid.className = 'ticket-grid';

        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 9; c++) {
                const val = ticketData[r][c];
                const cell = document.createElement('div');
                cell.className = 't-cell' + (val === 0 ? ' empty' : '');
                
                if (val !== 0) {
                    const span = document.createElement('span');
                    span.innerText = val;
                    cell.appendChild(span);
                    
                    // Click to mark
                    cell.addEventListener('click', () => {
                        const markerKey = `mark_${appState.room.code}_${tIdx}_${r}_${c}`;
                        if (cell.querySelector('.marker')) {
                            cell.querySelector('.marker').remove();
                            localStorage.removeItem(markerKey);
                        } else {
                            const marker = document.createElement('div');
                            marker.className = `marker marker-${appState.player.equipped.marker}`;
                            cell.appendChild(marker);
                            localStorage.setItem(markerKey, '1');
                        }
                    });

                    // Restore marker
                    const markerKey = `mark_${appState.room.code}_${tIdx}_${r}_${c}`;
                    if (localStorage.getItem(markerKey)) {
                        const marker = document.createElement('div');
                        marker.className = `marker marker-${appState.player.equipped.marker}`;
                        cell.appendChild(marker);
                    }
                }
                
                grid.appendChild(cell);
            }
        }
        tDiv.appendChild(grid);
        container.appendChild(tDiv);
    });
}

async function stopAutoCall() {
    appState.isAutoCallLeader = false;
    if (db && roomRef) {
        try {
            await update(child(roomRef, 'autoCall'), { active: false });
        } catch (e) {
            console.error("Error stopping auto call in Firebase:", e);
        }
    } else {
        appState.autoCallActive = false;
        if (appState.autoCallIntervalId) {
            clearInterval(appState.autoCallIntervalId);
            appState.autoCallIntervalId = null;
        }
        syncAutoCallUI();
    }
}

async function handleNextNumber() {
    if (!appState.room.isHost) return;
    
    // Pick number not in appState.room.numbers
    const available = appState.boardNumbers.filter(n => !appState.room.numbers.includes(n));
    if (available.length === 0) {
        if (appState.autoCallActive) {
            await stopAutoCall();
        }
        return showNotification("All numbers drawn!");
    }

    const nextNum = available[Math.floor(Math.random() * available.length)];
    const newNumbers = [...appState.room.numbers, nextNum];

    // If this is the last number, stop the auto call
    if (newNumbers.length === 90 && appState.autoCallActive) {
        await stopAutoCall();
    }

    if (db && roomRef) {
        update(roomRef, { numbers: newNumbers });
    } else {
        // Local mode
        appState.room.numbers = newNumbers;
        syncGameState();
    }

    // Reset autocall interval on draw if active
    if (appState.autoCallActive && appState.isAutoCallLeader) {
        startAutoCallTimer();
    }
}

function handleResetGame() {
    if (!appState.room.isHost) return;
    
    showConfirm("Reset Game", "Are you sure you want to reset the game? This will wipe the pot and everyone's tickets!", () => {
        if (db && roomRef) {
            update(roomRef, {
                numbers: [],
                claims: {},
                pot: 0,
                status: 'waiting',
                tickets: null,
                'autoCall/active': false
            });
        } else {
            // Local mode fallback
            appState.room.numbers = [];
            appState.room.claims = {};
            appState.room.pot = 0;
            appState.room.status = 'waiting';
            appState.autoCallActive = false;
            appState.isAutoCallLeader = false;
            if (appState.autoCallIntervalId) {
                clearInterval(appState.autoCallIntervalId);
                appState.autoCallIntervalId = null;
            }
            syncGameState();
        }
        showNotification("Game reset!");
    });
}

async function handleClaim(claimType) {
    if (appState.room.claims[claimType]) {
        return showNotification("Already claimed!");
    }

    // Validate the claim against drawn numbers
    let validClaim = false;
    const drawnNumbers = new Set(appState.room.numbers);

    for (const ticket of appState.myTickets) {
        if (claimType === 'Early 5') {
            let matchedCount = 0;
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 9; c++) {
                    const num = ticket[r][c];
                    if (num !== 0 && drawnNumbers.has(num)) matchedCount++;
                }
            }
            if (matchedCount >= 5) validClaim = true;
        } 
        else if (claimType === 'Top Row') {
            let rowMatched = true;
            for (let c = 0; c < 9; c++) {
                const num = ticket[0][c];
                if (num !== 0 && !drawnNumbers.has(num)) rowMatched = false;
            }
            if (rowMatched) validClaim = true;
        }
        else if (claimType === 'Middle Row') {
            let rowMatched = true;
            for (let c = 0; c < 9; c++) {
                const num = ticket[1][c];
                if (num !== 0 && !drawnNumbers.has(num)) rowMatched = false;
            }
            if (rowMatched) validClaim = true;
        }
        else if (claimType === 'Bottom Row') {
            let rowMatched = true;
            for (let c = 0; c < 9; c++) {
                const num = ticket[2][c];
                if (num !== 0 && !drawnNumbers.has(num)) rowMatched = false;
            }
            if (rowMatched) validClaim = true;
        }
        else if (claimType === '4 Corners') {
            let corners = [];
            for (let c = 0; c < 9; c++) { if (ticket[0][c] !== 0) { corners.push(ticket[0][c]); break; } }
            for (let c = 8; c >= 0; c--) { if (ticket[0][c] !== 0) { corners.push(ticket[0][c]); break; } }
            for (let c = 0; c < 9; c++) { if (ticket[2][c] !== 0) { corners.push(ticket[2][c]); break; } }
            for (let c = 8; c >= 0; c--) { if (ticket[2][c] !== 0) { corners.push(ticket[2][c]); break; } }
            
            if (corners.length === 4 && corners.every(num => drawnNumbers.has(num))) {
                validClaim = true;
            }
        }
        else if (claimType === 'Full House') {
            let houseMatched = true;
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 9; c++) {
                    const num = ticket[r][c];
                    if (num !== 0 && !drawnNumbers.has(num)) houseMatched = false;
                }
            }
            if (houseMatched) validClaim = true;
        }
    }

    if (!validClaim) {
        return showNotification("Invalid claim! Your ticket does not match the drawn numbers.");
    }
    let payoutPercent = 0;
    if (claimType === 'Full House') payoutPercent = 0.50;
    else if (claimType === 'Top Row' || claimType === 'Middle Row' || claimType === 'Bottom Row' || claimType === 'Early 5' || claimType === '4 Corners') payoutPercent = 0.10;

    const winnings = Math.floor(appState.room.pot * payoutPercent);

    if (db && roomRef) {
        const claimsUpdate = { ...appState.room.claims };
        claimsUpdate[claimType] = appState.player.name;
        
        update(roomRef, { claims: claimsUpdate });
        
        appState.player.coins += winnings;
        saveUser();
        showNotification(`You won ${claimType}! +${winnings} coins.`);
        
        if (claimType === 'Full House') {
            triggerConfetti();
        }
    }
}

function triggerConfetti() {
    if (typeof confetti !== 'undefined') {
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 3000 };

        const interval = setInterval(function() {
            const timeLeft = animationEnd - Date.now();
            if (timeLeft <= 0) {
                return clearInterval(interval);
            }
            const particleCount = 50 * (timeLeft / duration);
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: Math.random(), y: Math.random() - 0.2 } }));
        }, 250);
    }
}

// ==========================================
// SHOP SYSTEM
// ==========================================

function renderShop() {
    ['themes', 'skins', 'markers'].forEach(category => {
        const container = document.getElementById(`shop-${category}`);
        container.innerHTML = '';
        
        shopItems[category].forEach(item => {
            const isOwned = appState.player.inventory[category].includes(item.id);
            const isEquipped = appState.player.equipped[category.slice(0,-1)] === item.id;
            
            const div = document.createElement('div');
            div.className = `shop-item ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''}`;
            
            div.innerHTML = `
                <div class="item-name">${item.name}</div>
                <div class="item-price">${isOwned ? 'Owned' : `🪙 ${item.price}`}</div>
                <button class="item-action secondary-btn" ${isEquipped ? 'disabled' : ''}>
                    ${isEquipped ? 'Equipped' : (isOwned ? 'Equip' : 'Buy')}
                </button>
            `;

            div.querySelector('button').addEventListener('click', () => {
                if (!isOwned) {
                    if (appState.player.coins >= item.price) {
                        appState.player.coins -= item.price;
                        appState.player.inventory[category].push(item.id);
                        appState.player.equipped[category.slice(0,-1)] = item.id;
                        saveUser();
                        showNotification(`Bought ${item.name}!`);
                        renderShop();
                        if(category === 'themes') applyTheme(item.id);
                    } else {
                        showNotification("Not enough coins!");
                    }
                } else {
                    appState.player.equipped[category.slice(0,-1)] = item.id;
                    saveUser();
                    renderShop();
                    if(category === 'themes') applyTheme(item.id);
                    if(category === 'skins' || category === 'markers') renderTickets(); // update visible tickets
                }
            });

            container.appendChild(div);
        });
    });
}

// ==========================================
// MATRIX EFFECT
// ==========================================
function initMatrixCanvas() {
    const canvas = document.getElementById('matrix-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const letters = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const fontSize = 16;
    const columns = canvas.width / fontSize;
    const drops = Array.from({length: columns}, () => 1);
    
    function draw() {
        if (!document.body.classList.contains('theme-matrix-rain')) return;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = '#0F0';
        ctx.font = fontSize + 'px Share Tech Mono';
        
        for (let i = 0; i < drops.length; i++) {
            const text = letters.charAt(Math.floor(Math.random() * letters.length));
            ctx.fillText(text, i * fontSize, drops[i] * fontSize);
            
            if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
                drops[i] = 0;
            }
            drops[i]++;
        }
    }
    
    setInterval(draw, 33);
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

function updateTtsButtonUI() {
    const btn = document.getElementById('tts-toggle-btn');
    if (btn) {
        btn.innerText = appState.ttsEnabled ? '🔈' : '🔇';
    }
}

function speakText(text) {
    if (!appState.ttsEnabled) return;
    
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            const voices = window.speechSynthesis.getVoices();
            let selectedVoice = voices.find(voice => 
                voice.lang.includes('en') && 
                (voice.name.toLowerCase().includes('google') || voice.name.toLowerCase().includes('female') || voice.name.toLowerCase().includes('zira') || voice.name.toLowerCase().includes('samantha') || voice.name.toLowerCase().includes('hazel'))
            );
            if (!selectedVoice) {
                selectedVoice = voices.find(voice => voice.lang.includes('en'));
            }
            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }
            window.speechSynthesis.speak(utterance);
        }
    } catch (e) {
        console.error("TTS speak failed", e);
    }
}

function getNumberSpokenText(n) {
    if (n < 10) {
        return `single number ${n}`;
    } else {
        const digits = n.toString().split('');
        const digitNames = {
            '0': 'zero',
            '1': 'one',
            '2': 'two',
            '3': 'three',
            '4': 'four',
            '5': 'five',
            '6': 'six',
            '7': 'seven',
            '8': 'eight',
            '9': 'nine'
        };
        const d1 = digitNames[digits[0]];
        const d2 = digitNames[digits[1]];
        return `${d1}, ${d2}, ${n}`;
    }
}

function speakNumber(number) {
    if (!appState.ttsEnabled) return;

    // Explicitly detect Smart TVs, Google TVs, and custom TV browsers
    const isTV = /TV|GoogleTV|AndroidTV|TCL|SmartTV|BrowseHere|TV Bro/i.test(navigator.userAgent);

    if (!isTV && 'speechSynthesis' in window && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
        // Standard Desktop/Mobile Path
        const text = getNumberSpokenText(number); // Keep your existing text construction helper here
        speakText(text); // Keep your existing execution engine
    } else {
        // Hail Mary Fallback Path: Hard-route to root-relative audio files generated previously
        try {
            const audioPath = `/audio/${number}.mp3`; // Leading slash fixes path-rewriting bugs
            const gameVoice = new Audio(audioPath);
            gameVoice.play().catch(err => console.warn("TV playback blocked:", err));
        } catch (error) {
            console.error("TV audio hardware completely failed instantiation:", error);
        }
    }
}

function getPlayerRankInfo(coins) {
    if (coins < 1000) return { name: 'Novice', className: 'badge-novice' };
    if (coins < 2000) return { name: 'Apprentice', className: 'badge-apprentice' };
    if (coins < 5000) return { name: 'Expert', className: 'badge-expert' };
    if (coins < 10000) return { name: 'Pro', className: 'badge-pro' };
    if (coins < 20000) return { name: 'Elite', className: 'badge-elite' };
    if (coins < 50000) return { name: 'Champion', className: 'badge-champion' };
    if (coins < 100000) return { name: 'Master', className: 'badge-master' };
    if (coins < 500000) return { name: 'Grandmaster', className: 'badge-grandmaster' };
    if (coins < 1000000) return { name: 'Mythic', className: 'badge-mythic' };
    return { name: 'Legend', className: 'badge-legend' };
}

function renderHostBoard() {
    const board = document.getElementById('host-housie-board');
    if (!board) return;
    board.innerHTML = '';
    for (let i = 1; i <= 90; i++) {
        const cell = document.createElement('div');
        cell.className = 'board-cell host-board-cell';
        cell.id = `host-board-cell-${i}`;
        cell.innerText = i;
        board.appendChild(cell);
    }
}

function renderHostMode() {
    const displayLayout = document.getElementById('host-display-layout');
    if (displayLayout) displayLayout.style.display = 'grid';
    if (appState.isHostView && !window.location.pathname.endsWith('/hosttv')) {
        window.history.replaceState(null, '', '/hosttv' + window.location.hash);
    }
}

function syncHostGameState() {
    const numbers = appState.room.numbers || [];
    
    // Update top bar stats
    const pot = appState.room.pot || 0;
    const headerPotEl = document.getElementById('header-pot');
    const headerPlayersEl = document.getElementById('header-players');
    if (headerPotEl) headerPotEl.innerText = pot;
    if (headerPlayersEl) headerPlayersEl.innerText = appState.room.playerCount || 0;

    // Update Board
    document.querySelectorAll('.host-board-cell').forEach(cell => cell.classList.remove('called'));
    numbers.forEach(num => {
        const cell = document.getElementById(`host-board-cell-${num}`);
        if(cell) cell.classList.add('called');
    });

    // Update Last Called
    const lastCalled = numbers[numbers.length - 1];
    const lastCalledEl = document.getElementById('host-last-called-number');
    if (lastCalledEl) lastCalledEl.innerText = lastCalled || '-';
    
    // Update Winners List
    const winnersContainer = document.getElementById('host-winners-list');
    if (winnersContainer) {
        winnersContainer.innerHTML = '';
        const claimsList = ['Early 5', '4 Corners', 'Top Row', 'Middle Row', 'Bottom Row', 'Full House'];
        claimsList.forEach(claimType => {
            const row = document.createElement('div');
            row.className = 'winner-row';
            const winner = appState.room.claims[claimType] || 'Not claimed yet';
            row.innerHTML = `<span><strong>${claimType}:</strong></span> <span>${winner}</span>`;
            winnersContainer.appendChild(row);
        });
    }

    // Update Payouts
    const payoutEarly = document.getElementById('host-payout-early');
    const payoutCorners = document.getElementById('host-payout-corners');
    const payoutRow = document.getElementById('host-payout-row');
    const payoutFh = document.getElementById('host-payout-fh');
    
    if (payoutEarly) payoutEarly.innerText = Math.floor(pot * 0.10);
    if (payoutCorners) payoutCorners.innerText = Math.floor(pot * 0.10);
    if (payoutRow) payoutRow.innerText = Math.floor(pot * 0.10);
    if (payoutFh) payoutFh.innerText = Math.floor(pot * 0.50);

    // Update History
    const historyContainer = document.getElementById('host-history-list');
    if (historyContainer) {
        historyContainer.innerHTML = '';
        if (numbers.length === 0) {
            historyContainer.innerHTML = '<p style="opacity: 0.7; font-size: 0.9rem;">No numbers drawn yet.</p>';
        } else {
            numbers.forEach((num, index) => {
                const bubble = document.createElement('div');
                bubble.className = 'history-bubble';
                bubble.innerHTML = `<span>${num}</span><span class="bubble-index">#${index + 1}</span>`;
                historyContainer.appendChild(bubble);
            });
            // Auto scroll history to the bottom (deferred to allow TV browsers to render layout first)
            setTimeout(() => {
                historyContainer.scrollTop = historyContainer.scrollHeight;
            }, 50);
        }
    }

    // Call out the new number using TTS if enabled
    if (lastCalled) {
        if (appState.isFirstSync) {
            appState.lastSpokenNumber = lastCalled;
            appState.isFirstSync = false;
        } else if (lastCalled !== appState.lastSpokenNumber) {
            speakNumber(lastCalled);
            appState.lastSpokenNumber = lastCalled;
        }
    } else {
        appState.lastSpokenNumber = null;
        appState.isFirstSync = false;
    }
    
    syncAutoCallUI();
}

function toggleAutoCall(seconds) {
    if (!appState.room.isHost) return;
    
    const newActive = !appState.autoCallActive;
    
    // Set this client as the leader if starting, clear if stopping
    appState.isAutoCallLeader = newActive;
    
    if (db && roomRef) {
        update(child(roomRef, 'autoCall'), {
            active: newActive,
            seconds: seconds
        });
    } else {
        // Local mode fallback
        appState.autoCallActive = newActive;
        appState.autoCallSeconds = seconds;
        if (newActive) {
            startAutoCallTimer();
        } else {
            if (appState.autoCallIntervalId) {
                clearInterval(appState.autoCallIntervalId);
                appState.autoCallIntervalId = null;
            }
        }
        syncAutoCallUI();
    }
}

function startAutoCallTimer() {
    if (appState.autoCallIntervalId) {
        clearInterval(appState.autoCallIntervalId);
    }
    
    const intervalMs = appState.autoCallSeconds * 1000;
    appState.autoCallIntervalId = setInterval(() => {
        if (!appState.autoCallActive || !appState.isAutoCallLeader) {
            clearInterval(appState.autoCallIntervalId);
            appState.autoCallIntervalId = null;
            return;
        }
        
        handleNextNumber();
    }, intervalMs);
}

function syncAutoCallUI() {
    const active = appState.autoCallActive;
    const secs = appState.autoCallSeconds;
    
    // TV Layout elements
    const tvBtn = document.getElementById('host-auto-btn');
    const tvInput = document.getElementById('host-auto-seconds');
    const tvValSpan = document.getElementById('host-auto-seconds-val');
    
    if (tvBtn) {
        tvBtn.innerText = active ? "Stop Auto Call" : "Start Auto Call";
        tvBtn.className = active ? "danger-btn" : "primary-btn";
    }
    if (tvInput) {
        tvInput.value = secs;
        tvInput.disabled = active;
    }
    if (tvValSpan) {
        tvValSpan.innerText = secs + 's';
    }
}

// Interaction Audio Unlocker
document.addEventListener('click', () => {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            const ctx = new AudioContext();
            if (ctx.state === 'suspended') ctx.resume();
        }
    } catch (e) { console.log("Audio unlock skipped", e); }
}, { once: true });

// Start
document.addEventListener('DOMContentLoaded', init);
