// v1 RELEASE
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, remove, child, increment, onDisconnect } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-database.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app-check.js";

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
        highestCoins: 100,
        inventory: {
            themes: ['default']
        },
        equipped: {
            theme: 'default'
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
    sessionId: Math.floor(Math.random() * 1000000)
};

// Shop Items Database
const shopItems = {
    themes: [
        { id: 'default', name: 'Default', price: 0, requiredRank: 'Novice' },
        { id: 'midnight', name: 'Midnight', price: 100, requiredRank: 'Novice' },
        { id: 'translucent', name: 'Translucent', price: 500, requiredRank: 'Apprentice' },
        { id: 'gold', name: 'Gold', price: 1000, requiredRank: 'Expert' },
        { id: 'neon', name: 'Neon', price: 2000, requiredRank: 'Expert' },
        { id: 'matrix', name: 'Matrix', price: 5000, requiredRank: 'Elite' },
        { id: 'ocean', name: 'Ocean', price: 10000, requiredRank: 'Champion' },
        { id: 'classic', name: 'Classic', price: 50000, requiredRank: 'Master' },
        { id: 'forest', name: 'Forest', price: 100000, requiredRank: 'Mythic' },
        { id: 'galaxy', name: 'Galaxy', price: 1000000, requiredRank: 'Legend' }
    ]
};

// Map old theme IDs to new ones for database backwards compatibility
function normalizeThemeId(themeId) {
    if (!themeId) return 'default';
    if (themeId === 'default-dark') return 'default';
    if (themeId === 'midnight-star') return 'midnight';
    if (themeId === 'gold-plate') return 'gold';
    if (themeId === 'matrix-rain') return 'matrix';
    if (themeId === 'waves') return 'ocean';
    if (themeId === 'beach-forest') return 'forest';
    return themeId;
}

// Firebase References
let db, userRef, roomRef;
let unsubscribeRoom = null;
let unsubscribeReplies = null;
let unsubscribeAdminFeedback = null;

function getSafeDbKey(str) {
    return str ? str.replace(/[\.\$\#\[\]\/]/g, '_') : '';
}

// Initialize App
function init() {
    if (firebaseConfig.projectId === "YOUR_PROJECT_ID" || firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.warn("Dummy Firebase config detected. Running in local-only mode.");
        db = null;
    } else {
        try {
            const app = initializeApp(firebaseConfig);
            db = getDatabase(app);

            // Initialize App Check with reCAPTCHA v3 provider
            try {
                initializeAppCheck(app, {
                    provider: new ReCaptchaV3Provider('6Ld9_5cqAAAAAP8Pz9b6Z5X2GZ69vX9r-xQ2hT-d'),
                    isTokenAutoRefreshEnabled: true
                });
            } catch (appCheckErr) {
                console.warn("App Check failed to initialize, running with fallback", appCheckErr);
            }
        } catch (e) {
            console.warn("Firebase not configured correctly. Running in local-only mode.", e);
            db = null; 
        }
    }

    setupEventListeners();
    initChat();
    initMatrixCanvas();

    // Check for sharing room code in URL hash or hosttv routing
    const hashStr = window.location.hash.slice(1).trim().toUpperCase();
    const path = window.location.pathname;
    let isHostRoute = path.endsWith('/host') || path.includes('/host/') ||
                      path.endsWith('/hosttv') || path.includes('/hosttv/') ||
                      path.endsWith('/hostrt') || path.includes('/hostrt/') ||
                      hashStr.startsWith('HOSTTV');
    let isAdminRoute = path.endsWith('/admin') || path.includes('/admin/') || hashStr === 'ADMIN';
    
    let roomCode = null;
    if (hashStr) {
        if (/^[A-Z]{5}$/.test(hashStr)) {
            roomCode = hashStr;
        } else if (hashStr.startsWith('HOSTTV')) {
            isHostRoute = true;
            // Parse room code from format like HOSTTV#RUQBU, HOSTTV-RUQBU, etc.
            const match = hashStr.match(/HOSTTV[-#\/]?([A-Z]{5})/);
            if (match) {
                roomCode = match[1];
            }
        }
    }

    if (roomCode) {
        appState.pendingRoomCode = roomCode;
    }

    if (isAdminRoute) {
        appState.isAdminView = true;
        // Rewrite URL to hash-based path /#admin to prevent Vercel 404 reload errors on refreshing
        if (window.location.hash !== '#admin' || window.location.pathname !== '/') {
            window.history.replaceState(null, '', '/#admin');
        }
        switchView('admin-view');
    } else if (isHostRoute) {
        if (appState.pendingRoomCode) {
            appState.isHostView = true;
            // Rewrite URL to hash-based path /#hosttv#CODE to prevent Vercel 404 reload errors
            const targetHash = `#hosttv#${appState.pendingRoomCode}`;
            if (window.location.hash !== targetHash || window.location.pathname !== '/') {
                window.history.replaceState(null, '', '/' + targetHash);
            }
        } else {
            appState.isHostView = false;
            window.history.replaceState(null, '', '/');
        }
    }

    // Bypass auto-login redirect if we are entering the admin dashboard
    if (!isAdminRoute) {
        const savedName = localStorage.getItem('hdhousie_saved_name');
        if (savedName) {
            document.getElementById('player-name-input').value = savedName;
            handleLogin();
        }
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
            if (appState.room.code) {
                leaveGameLocally();
            } else if (db && appState.player.name) {
                remove(ref(db, `users/${appState.player.name}/activeRoom`));
            }
            localStorage.removeItem('hdhousie_saved_name');
            appState.player = {
                name: null,
                coins: 100,
                inventory: {
                    themes: ['default']
                },
                equipped: {
                    theme: 'default'
                }
            };
            appState.currentRankName = null;
            appState.rankNotificationEnabled = false;
            document.getElementById('player-name-input').value = '';
            document.getElementById('header-user-info').style.display = 'none';
            window.location.hash = ''; // Clear hash on logout
            if (unsubscribeReplies) {
                unsubscribeReplies();
                unsubscribeReplies = null;
            }
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

    // Feedback Reply & Admin Control listeners
    const clearFeedbackBtn = document.getElementById('admin-clear-feedback-btn');
    if (clearFeedbackBtn) {
        clearFeedbackBtn.addEventListener('click', handleClearAllFeedback);
    }
    const closeAdminReplyBtn = document.getElementById('close-admin-reply-btn');
    if (closeAdminReplyBtn) {
        closeAdminReplyBtn.addEventListener('click', () => {
            document.getElementById('admin-reply-modal').style.display = 'none';
        });
    }
    const submitAdminReplyBtn = document.getElementById('submit-admin-reply-btn');
    if (submitAdminReplyBtn) {
        submitAdminReplyBtn.addEventListener('click', submitAdminReply);
    }
    const closeFeedbackReplyBtn = document.getElementById('close-feedback-reply-btn');
    if (closeFeedbackReplyBtn) {
        closeFeedbackReplyBtn.addEventListener('click', closeFeedbackReply);
    }
    const closeFeedbackReplyConfirmBtn = document.getElementById('close-feedback-reply-confirm-btn');
    if (closeFeedbackReplyConfirmBtn) {
        closeFeedbackReplyConfirmBtn.addEventListener('click', closeFeedbackReply);
    }

    // Close modals on background click
    document.querySelectorAll('div[id$="-modal"]').forEach(modal => {
        if (modal.id === 'feedback-reply-modal') return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });

    const feedbackReplyModal = document.getElementById('feedback-reply-modal');
    if (feedbackReplyModal) {
        feedbackReplyModal.addEventListener('click', (e) => {
            if (e.target === feedbackReplyModal) {
                closeFeedbackReply();
            }
        });
    }

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
        if (!isGameActive && !isHostActive) return;

        // Prevent spacebar scrolling immediately on keydown
        if (e.key === ' ') {
            e.preventDefault();
        }
    });

    document.addEventListener('keyup', (e) => {
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
            
            // Update URL using hash-based routing to prevent Vercel 404 reload errors
            if (appState.isHostView) {
                const code = appState.room.code || appState.pendingRoomCode || '';
                window.history.pushState(null, '', `/#hosttv#${code}`);
            } else {
                const code = appState.room.code || appState.pendingRoomCode || '';
                window.history.pushState(null, '', `/#${code}`);
            }
            
            // Update UI
            joinGameUI();
        } else {
            // Toggle Player TV View (does NOT change URL)
            appState.isPlayerTvView = !appState.isPlayerTvView;
            
            // Update UI
            joinGameUI();
        }
    });

    // QR Code Buttons
    const qrBtn = document.getElementById('header-qrcode-btn');
    if (qrBtn) {
        qrBtn.addEventListener('click', () => {
            openQrCodeModal();
        });
    }

    const lobbyQrBtn = document.getElementById('lobby-qr-scan-btn');
    if (lobbyQrBtn) {
        lobbyQrBtn.addEventListener('click', () => {
            openQrCodeModal();
        });
    }

    const qrCloseBtn = document.getElementById('qrcode-modal-close');
    if (qrCloseBtn) {
        qrCloseBtn.addEventListener('click', () => {
            closeQrCodeModal();
        });
    }

    const qrFileInput = document.getElementById('qr-file-input');
    if (qrFileInput) {
        qrFileInput.addEventListener('change', (e) => {
            if (e.target.files.length === 0) return;
            const file = e.target.files[0];
            const statusEl = document.getElementById('qr-scanner-status');
            if (statusEl) statusEl.innerText = "Analyzing uploaded image...";
            
            const scanner = new Html5Qrcode("qr-reader");
            scanner.scanFile(file, true)
                .then((decodedText) => {
                    console.log("QR decoded from file:", decodedText);
                    let code = null;
                    const match = decodedText.match(/[#&?/]([A-Z]{5})(?:[?&]|$)/) || decodedText.match(/^[A-Z]{5}$/);
                    if (match) {
                        code = match[1] || decodedText;
                    } else {
                        const cleanText = decodedText.trim().toUpperCase();
                        if (/^[A-Z]{5}$/.test(cleanText)) {
                            code = cleanText;
                        }
                    }
                    
                    if (code) {
                        if (statusEl) statusEl.innerText = `Found code: ${code}! Joining...`;
                        closeQrCodeModal();
                        
                        const roomInput = document.getElementById('room-code-input');
                        if (roomInput) {
                            roomInput.value = code;
                        }
                        
                        if (appState.player.name) {
                            appState.pendingRoomCode = code;
                            handleJoinRoom();
                        } else {
                            appState.pendingRoomCode = code;
                            showNotification(`Scanned Room ${code}. Please enter your name to join.`);
                        }
                    } else {
                        if (statusEl) statusEl.innerText = "No valid 5-letter room code found in image.";
                    }
                })
                .catch((err) => {
                    console.error("Scan file failed:", err);
                    if (statusEl) statusEl.innerText = "Failed to find a QR code in that image.";
                });
        });
    }

    const qrModal = document.getElementById('qrcode-modal');
    if (qrModal) {
        qrModal.addEventListener('click', (e) => {
            if (e.target === qrModal) {
                closeQrCodeModal();
            }
        });
    }

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

    // Feedback Sub-system Event Listeners
    const lobbyFeedbackBtn = document.getElementById('lobby-feedback-btn');
    if (lobbyFeedbackBtn) {
        lobbyFeedbackBtn.addEventListener('click', () => {
            document.getElementById('feedback-modal').style.display = 'flex';
        });
    }

    const closeFeedbackBtn = document.getElementById('close-feedback-btn');
    if (closeFeedbackBtn) {
        closeFeedbackBtn.addEventListener('click', () => {
            document.getElementById('feedback-modal').style.display = 'none';
        });
    }

    const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
    if (submitFeedbackBtn) {
        submitFeedbackBtn.addEventListener('click', handleFeedbackSubmit);
    }

    // Admin Authenticate & Console Event Listeners
    const adminLoginBtn = document.getElementById('admin-login-btn');
    if (adminLoginBtn) {
        adminLoginBtn.addEventListener('click', handleAdminAuthenticate);
    }

    const adminPasscodeInput = document.getElementById('admin-passcode-input');
    if (adminPasscodeInput) {
        adminPasscodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAdminAuthenticate();
        });
    }

    const adminBackBtn = document.getElementById('admin-back-btn');
    if (adminBackBtn) {
        adminBackBtn.addEventListener('click', () => {
            switchView('lobby-view');
        });
    }

    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', handleAdminLogout);
    }



    // AI Bots Mode Event Listeners
    const aiModeToggleBtn = document.getElementById('ai-mode-toggle-btn');
    if (aiModeToggleBtn) {
        aiModeToggleBtn.addEventListener('click', toggleAiMode);
    }

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
    
    // Clear activeRoom state from user profile
    if (db && appState.player && appState.player.name) {
        remove(ref(db, `users/${appState.player.name}/activeRoom`));
    }
    
    // Disable AI mode and remove bots
    if (appState.aiModeEnabled) {
        removeBots();
        appState.aiModeEnabled = false;
        const btn = document.getElementById('ai-mode-toggle-btn');
        if (btn) {
            btn.innerText = "AI Bots: Off";
            btn.className = "secondary-btn";
            btn.style.background = "rgba(255,255,255,0.05)";
        }
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
    
    const headerEl = document.getElementById('main-header');
    if (headerEl) headerEl.classList.remove('tv-mode-header');
    document.getElementById('header-user-info').style.display = 'flex';
    
    // Hide and close chat
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) chatPanel.style.display = 'none';
    appState.chatHistory = [];
    appState.lastChatId = null;
    
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
    appState.currentView = viewId;
    if (viewId === 'shop-view') {
        const currentActive = document.querySelector('.view.active');
        if (currentActive && currentActive.id !== 'shop-view') {
            previousView = currentActive.id;
        }
    }
    
    // Manage admin view flag
    if (viewId === 'admin-view') {
        appState.isAdminView = true;
        if (window.location.hash !== '#admin') {
            window.location.hash = 'admin';
        }
    } else {
        if (appState.isAdminView) {
            appState.isAdminView = false;
            if (window.location.hash === '#admin') {
                window.location.hash = '';
            }
        }
    }
    
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    // Auto-update header after switching view
    updateHeader();

    // Trigger feedback reply display when returning to the lobby
    if (viewId === 'lobby-view') {
        triggerReplyDisplay();
    }
}

function updateHeader() {
    if (appState.isHostView || appState.isPlayerTvView || appState.isAdminView) {
        document.getElementById('header-user-info').style.display = 'none';
    } else {
        document.getElementById('header-user-info').style.display = 'flex';
    }
    if (!appState.player.name) return;
    
    // Ensure highestCoins is set and always >= current coins
    appState.player.highestCoins = Math.max(appState.player.highestCoins || 0, appState.player.coins || 100);

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
            
            if (appState.rankNotificationEnabled) {
                if (newIdx > oldIdx) {
                    const milestoneRewards = {
                        'Apprentice': 200,
                        'Expert': 300,
                        'Pro': 500,
                        'Elite': 1000,
                        'Champion': 2000,
                        'Master': 5000,
                        'Grandmaster': 10000,
                        'Mythic': 25000,
                        'Legend': 50000
                    };
                    const reward = milestoneRewards[rankInfo.name] || 0;
                    if (reward > 0) {
                        appState.player.coins += reward;
                        showNotification(`🎉 Rank Up! You are now ${rankInfo.name}! Milestone Reward: +${reward} 🪙!`);
                        appState.currentRankName = rankInfo.name;
                        saveUser();
                        return; // saveUser will trigger updateHeader again, return early to prevent duplicates
                    } else {
                        showNotification(`🎉 Rank Up! You are now ${rankInfo.name}!`);
                    }
                } else if (newIdx < oldIdx) {
                    showNotification(`You are now ${rankInfo.name}.`);
                }
            }
        }
        appState.currentRankName = rankInfo.name;
    }
    
    applyTheme(appState.player.equipped.theme);
}

function applyTheme(themeId) {
    document.body.className = '';
    document.body.classList.add(`theme-${themeId}`);
    
    // Add backward compatible classes for styles.css support
    if (themeId === 'midnight') document.body.classList.add('theme-midnight-star');
    if (themeId === 'gold') document.body.classList.add('theme-gold-plate');
    if (themeId === 'matrix') document.body.classList.add('theme-matrix-rain');
    if (themeId === 'ocean') document.body.classList.add('theme-waves');
    if (themeId === 'forest') document.body.classList.add('theme-beach-forest');
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
        highestCoins: 100,
        inventory: {
            themes: ['default']
        },
        equipped: {
            theme: 'default'
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
                appState.player.highestCoins = data.highestCoins || data.coins || 100;
                appState.player.inventory = {
                    themes: (data.inventory && data.inventory.themes) || ['default']
                };
                appState.player.equipped = {
                    theme: normalizeThemeId((data.equipped && data.equipped.theme) || 'default')
                };
                // Normalize loaded themes
                appState.player.inventory.themes = (appState.player.inventory.themes || ['default']).map(normalizeThemeId);
                if (!appState.player.inventory.themes.includes('default')) {
                    appState.player.inventory.themes.push('default');
                }
                // Ensure equipped theme is in inventory
                if (!appState.player.inventory.themes.includes(appState.player.equipped.theme)) {
                    appState.player.inventory.themes.push(appState.player.equipped.theme);
                }

                // Check if activeRoom exists to auto-rejoin
                if (!appState.pendingRoomCode && data.activeRoom && data.activeRoom.code) {
                    appState.pendingRoomCode = data.activeRoom.code;
                    if (data.activeRoom.isHost) {
                        appState.room.isHost = true;
                        appState.isHostView = !!data.activeRoom.isHostTv;
                        if (appState.isHostView) {
                            window.history.replaceState(null, '', `/#hosttv#${data.activeRoom.code}`);
                        } else {
                            window.history.replaceState(null, '', `/#${data.activeRoom.code}`);
                        }
                    }
                }
            } else {
                // New user
                await set(userRef, appState.player);
            }
        } else {
            // Local mode fallback
            const localData = localStorage.getItem(`user_${nameInput}`);
            if(localData) {
                appState.player = JSON.parse(localData);
                appState.player.highestCoins = appState.player.highestCoins || appState.player.coins || 100;
                appState.player.inventory.themes = (appState.player.inventory.themes || ['default']).map(normalizeThemeId);
                if (!appState.player.inventory.themes.includes('default')) {
                    appState.player.inventory.themes.push('default');
                }
                appState.player.equipped.theme = normalizeThemeId(appState.player.equipped.theme || 'default');
                // Ensure equipped theme is in inventory
                if (!appState.player.inventory.themes.includes(appState.player.equipped.theme)) {
                    appState.player.inventory.themes.push(appState.player.equipped.theme);
                }
            }
        }

        updateHeader();
        listenForAdminReplies();
        appState.rankNotificationEnabled = true;
        
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
    if (appState.player) {
        // Normalize themes
        if (appState.player.inventory && appState.player.inventory.themes) {
            appState.player.inventory.themes = appState.player.inventory.themes.map(normalizeThemeId);
            if (!appState.player.inventory.themes.includes('default')) {
                appState.player.inventory.themes.push('default');
            }
        }
        if (appState.player.equipped && appState.player.equipped.theme) {
            appState.player.equipped.theme = normalizeThemeId(appState.player.equipped.theme);
            if (appState.player.inventory && appState.player.inventory.themes && !appState.player.inventory.themes.includes(appState.player.equipped.theme)) {
                appState.player.inventory.themes.push(appState.player.equipped.theme);
            }
        }
        // Ensure highestCoins is up to date
        appState.player.highestCoins = Math.max(appState.player.highestCoins || 0, appState.player.coins || 100);
    }
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

        // Save activeRoom state in user profile
        const activeRoomRef = ref(db, `users/${appState.player.name}/activeRoom`);
        await set(activeRoomRef, {
            code: code,
            isHost: true,
            isHostTv: !!appState.isHostView
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

        // Save activeRoom state in user profile
        const activeRoomRef = ref(db, `users/${appState.player.name}/activeRoom`);
        await set(activeRoomRef, {
            code: code,
            isHost: appState.room.isHost,
            isHostTv: appState.room.isHost ? !!appState.isHostView : false
        });

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
        // Hide user info header in TV mode
        const headerEl = document.getElementById('main-header');
        if (headerEl) headerEl.classList.add('tv-mode-header');
        
        const userInfoEl = document.getElementById('header-user-info');
        if (userInfoEl) userInfoEl.style.display = 'none';

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
        // Restore Normal Mode UI
        const headerEl = document.getElementById('main-header');
        if (headerEl) headerEl.classList.remove('tv-mode-header');
        
        const userInfoEl = document.getElementById('header-user-info');
        if (userInfoEl) userInfoEl.style.display = 'flex';

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

    // Toggle header QR button visibility (only the host gets it in the top bar)
    const headerQrBtn = document.getElementById('header-qrcode-btn');
    if (headerQrBtn) {
        headerQrBtn.style.display = appState.room.isHost ? 'inline-block' : 'none';
    }
    
    // Initialize Chat for the room
    if (appState.room.code) {
        appState.joinTime = Date.now();
        appState.lastChatId = null;
        
        const saved = localStorage.getItem(`chat_${appState.room.code}`);
        appState.chatHistory = saved ? JSON.parse(saved) : [];
        renderAllChatMessages();
        
        document.querySelectorAll('.chat-unread-badge-el').forEach(badge => {
            badge.style.display = 'none';
        });
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
            const newClaimsCoins = data.claimsCoins || {};
            
            if (Object.keys(newClaims).length === 0) {
                appState.matchEarnings = 0;
            }
            
            for (const [claimType, winner] of Object.entries(newClaims)) {
                if (!oldClaims[claimType]) {
                    const winnerCoins = newClaimsCoins[claimType] || 0;
                    const winnerRankInfo = getPlayerRankInfo(winnerCoins);
                    if (winner !== appState.player.name) {
                        showNotification(`${winner} (${winnerRankInfo.name}) won ${claimType}!`);
                        playVictoryEffects(winner, winnerCoins, claimType);
                    }
                    if (claimType === 'Full House') {
                        checkAndAwardMatchMultiplier();
                    }
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
            
            // Handle chat messages
            if (data.chatSignal && data.chatSignal.id && data.chatSignal.id !== appState.lastChatId) {
                appState.lastChatId = data.chatSignal.id;
                // Only handle messages sent after the client joined the room
                if (data.chatSignal.timestamp > (appState.joinTime || 0)) {
                    receiveChatMessage(data.chatSignal);
                }
            }
            
            const playersObj = data.players || {};
            appState.room.playerCount = Object.keys(playersObj).length;

            // Handle host-propagated mute (for player devices only)
            const newTtsMuted = !!data.ttsMuted;
            if (!appState.room.isHost) {
                if (newTtsMuted && !appState.lastDbTtsMuted) {
                    appState.ttsEnabled = false;
                    updateTtsButtonUI();
                    showNotification("Host disabled game voice callouts.");
                } else if (!newTtsMuted && appState.lastDbTtsMuted) {
                    appState.ttsEnabled = true;
                    updateTtsButtonUI();
                    showNotification("Host enabled game voice callouts.");
                    speakText("voice enabled");
                }
            }
            appState.lastDbTtsMuted = newTtsMuted;

            // Handle auto call state sync
            const autoCallData = data.autoCall || { active: false, seconds: 5 };
            let active = !!autoCallData.active;
            
            // If Full House has been claimed, force active to false on host client
            if (newClaims['Full House'] && active && appState.room.isHost) {
                active = false;
                stopAutoCall();
            }
            
            let leaderSessionId = autoCallData.leaderSessionId;

            appState.autoCallActive = active;
            appState.autoCallSeconds = parseInt(autoCallData.seconds) || 5;

            if (!appState.autoCallActive) {
                appState.isAutoCallLeader = false;
                if (appState.autoCallIntervalId) {
                    clearInterval(appState.autoCallIntervalId);
                    appState.autoCallIntervalId = null;
                }
            } else {
                if (appState.room.isHost) {
                    // Elect leader if none exists
                    if (active && !leaderSessionId) {
                        leaderSessionId = appState.sessionId;
                        update(child(roomRef, 'autoCall'), { leaderSessionId: appState.sessionId });
                    }
                    appState.isAutoCallLeader = (leaderSessionId === appState.sessionId);
                } else {
                    appState.isAutoCallLeader = false;
                }
                
                if (appState.isAutoCallLeader && !appState.autoCallIntervalId) {
                    startAutoCallTimer();
                } else if (!appState.isAutoCallLeader && appState.autoCallIntervalId) {
                    // Stop timer if we are no longer the leader
                    clearInterval(appState.autoCallIntervalId);
                    appState.autoCallIntervalId = null;
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

    // Auto-spawn bots when joining room as Host if AI Bots are toggled on in the lobby
    if (appState.room.isHost && appState.aiModeEnabled) {
        setTimeout(spawnBots, 1000);
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

    // Clear old markers for this room from local cache so new tickets aren't pre-stamped
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith(`mark_${appState.room.code}`)) {
            localStorage.removeItem(key);
        }
    });

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
        tDiv.className = 'ticket';
        
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
                            marker.className = 'marker';
                            cell.appendChild(marker);
                            localStorage.setItem(markerKey, '1');
                        }
                    });

                    // Restore marker
                    const markerKey = `mark_${appState.room.code}_${tIdx}_${r}_${c}`;
                    if (localStorage.getItem(markerKey)) {
                        const marker = document.createElement('div');
                        marker.className = 'marker';
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
            await update(child(roomRef, 'autoCall'), { active: false, leaderSessionId: null });
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

    // Run AI bot logic if enabled
    if (appState.aiModeEnabled && appState.bots && appState.bots.length > 0) {
        appState.bots.forEach(bot => {
            const claims = checkBotClaims(bot, newNumbers);
            claims.forEach(claimType => {
                botSubmitClaim(bot.name, claimType);
            });
            
            // 5% chance of chat messages from bot
            if (Math.random() < 0.05) {
                const botChatMessages = [
                    "Check your tickets! 🔍",
                    "A close one! 🤏",
                    "I only need one more number! 🤩",
                    "Good luck everyone!",
                    "Housie is getting exciting! 🎉",
                    "Are you guys ready for the next one?",
                    "What a game!"
                ];
                const msg = botChatMessages[Math.floor(Math.random() * botChatMessages.length)];
                setTimeout(() => triggerBotChat(bot.name, msg), 500 + Math.random() * 1000);
            }
        });
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
            
            // Re-spawn bots to recreate their tickets and add bets to pot
            if (appState.aiModeEnabled) {
                setTimeout(spawnBots, 1000);
            }
        } else {
            // Local mode fallback
            appState.room.numbers = [];
            appState.room.claims = {};
            appState.room.claimsCoins = {};
            appState.matchEarnings = 0;
            appState.room.pot = 0;
            appState.room.status = 'waiting';
            appState.autoCallActive = false;
            appState.isAutoCallLeader = false;
            if (appState.autoCallIntervalId) {
                clearInterval(appState.autoCallIntervalId);
                appState.autoCallIntervalId = null;
            }
            
            // Clear local tickets and stamps
            appState.myTickets = [];
            localStorage.removeItem(`tickets_${appState.room.code}_${appState.player.name}`);
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith(`mark_${appState.room.code}`)) {
                    localStorage.removeItem(key);
                }
            });
            const tContainer = document.getElementById('tickets-container');
            if (tContainer) tContainer.innerHTML = '';
            const tSetup = document.getElementById('ticket-setup');
            if (tSetup) tSetup.style.display = 'block';
            const cArea = document.getElementById('claims-area');
            if (cArea) cArea.style.display = 'none';
            
            // Spawn local mock bots if enabled
            if (appState.aiModeEnabled) {
                setTimeout(spawnBots, 1000);
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
        
        const claimsCoinsUpdate = { ...appState.room.claimsCoins };
        claimsCoinsUpdate[claimType] = appState.player.coins;
        
        update(roomRef, { 
            claims: claimsUpdate,
            claimsCoins: claimsCoinsUpdate
        });
        
        appState.player.coins += winnings;
        appState.matchEarnings += winnings;
        saveUser();
        showNotification(`You won ${claimType}! +${winnings} coins.`);
        
        playVictoryEffects(appState.player.name, appState.player.coins, claimType);
        
        if (claimType === 'Full House') {
            checkAndAwardMatchMultiplier();
        }
    } else {
        // Local mode fallback
        appState.room.claims = appState.room.claims || {};
        appState.room.claims[claimType] = appState.player.name;
        
        appState.room.claimsCoins = appState.room.claimsCoins || {};
        appState.room.claimsCoins[claimType] = appState.player.coins;
        
        appState.player.coins += winnings;
        appState.matchEarnings += winnings;
        saveUser();
        showNotification(`You won ${claimType}! +${winnings} coins.`);
        
        playVictoryEffects(appState.player.name, appState.player.coins, claimType);
        
        if (claimType === 'Full House') {
            checkAndAwardMatchMultiplier();
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
    const category = 'themes';
    const container = document.getElementById(`shop-${category}`);
    if (!container) return;
    container.innerHTML = '';
    
    const ranksOrder = ['Novice', 'Apprentice', 'Expert', 'Pro', 'Elite', 'Champion', 'Master', 'Grandmaster', 'Mythic', 'Legend'];
    const playerHighestCoins = appState.player.highestCoins || appState.player.coins || 100;
    const playerHighestRankInfo = getPlayerRankInfo(playerHighestCoins);
    const playerRankIndex = ranksOrder.indexOf(playerHighestRankInfo.name);

    shopItems[category].forEach(item => {
        const isOwned = appState.player.inventory[category].includes(item.id);
        const isEquipped = appState.player.equipped[category.slice(0,-1)] === item.id;
        
        // Check if unlocked (either owned, or player rank index >= required rank index)
        const reqRankIndex = ranksOrder.indexOf(item.requiredRank);
        const isUnlocked = isOwned || (playerRankIndex >= reqRankIndex);

        const div = document.createElement('div');
        div.className = `shop-item ${isOwned ? 'owned' : ''} ${isEquipped ? 'equipped' : ''} ${!isUnlocked ? 'locked' : ''}`;
        
        if (!isUnlocked) {
            div.innerHTML = `
                <div class="item-name">${item.name} <span class="lock-icon">🔒</span></div>
                <div class="item-rank-req">Unlocks at ${item.requiredRank}</div>
                <div class="item-price">🪙 ${item.price}</div>
                <button class="item-action secondary-btn" disabled>Locked</button>
            `;
        } else {
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
                        applyTheme(item.id);
                        renderTickets();
                    } else {
                        showNotification("Not enough coins!");
                    }
                } else {
                    appState.player.equipped[category.slice(0,-1)] = item.id;
                    saveUser();
                    renderShop();
                    applyTheme(item.id);
                    renderTickets();
                }
            });
        }

        container.appendChild(div);
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
        if (!document.body.classList.contains('theme-matrix')) return;
        
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
    if (appState.isHostView) {
        const code = appState.room.code || appState.pendingRoomCode || '';
        const targetHash = `#hosttv#${code}`;
        if (window.location.hash !== targetHash || window.location.pathname !== '/') {
            window.history.replaceState(null, '', '/' + targetHash);
        }
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
    
    // Cannot start Auto Call if Full House is claimed
    if (!appState.autoCallActive && appState.room.claims && appState.room.claims['Full House']) {
        showNotification("Auto Call is disabled until the game is reset.");
        return;
    }
    
    const newActive = !appState.autoCallActive;
    
    // Set this client as the leader if starting, clear if stopping
    appState.isAutoCallLeader = newActive;
    
    if (db && roomRef) {
        update(child(roomRef, 'autoCall'), {
            active: newActive,
            seconds: seconds,
            leaderSessionId: newActive ? appState.sessionId : null
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
    const isFullHouseClaimed = !!(appState.room.claims && appState.room.claims['Full House']);
    
    // TV Layout elements
    const tvBtn = document.getElementById('host-auto-btn');
    const tvInput = document.getElementById('host-auto-seconds');
    const tvValSpan = document.getElementById('host-auto-seconds-val');
    
    if (tvBtn) {
        if (isFullHouseClaimed) {
            tvBtn.innerText = "Auto Call Disabled";
            tvBtn.className = "danger-btn disabled";
            tvBtn.style.opacity = "0.6";
            tvBtn.style.cursor = "not-allowed";
            tvBtn.disabled = true;
        } else {
            tvBtn.innerText = active ? "Stop Auto Call" : "Start Auto Call";
            tvBtn.className = active ? "danger-btn" : "primary-btn";
            tvBtn.style.opacity = "";
            tvBtn.style.cursor = "";
            tvBtn.disabled = false;
        }
    }
    if (tvInput) {
        tvInput.value = secs;
        tvInput.disabled = active || isFullHouseClaimed;
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

// ==========================================
// CHAT FUNCTIONALITY
// ==========================================

window.toggleChatWindow = function(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    const panel = document.getElementById('chat-panel');
    if (!panel) return;
    const isHidden = window.getComputedStyle(panel).display === 'none';
    panel.style.display = isHidden ? 'flex' : 'none';
    if (isHidden) {
        // Clear unread badges
        document.querySelectorAll('.chat-unread-badge-el').forEach(badge => {
            badge.style.display = 'none';
        });
        
        // Scroll to bottom
        const msgContainer = document.getElementById('chat-messages');
        if (msgContainer) {
            setTimeout(() => {
                msgContainer.scrollTop = msgContainer.scrollHeight;
            }, 50);
        }
        
        // Recheck mini classes
        const rect = panel.getBoundingClientRect();
        panel.classList.toggle('chat-mini', rect.width < 250);
        panel.classList.toggle('chat-mini-height', rect.height < 320);
    }
};

function makeChatDraggableAndResizable() {
    const panel = document.getElementById('chat-panel');
    const handle = document.getElementById('chat-header-drag-handle');
    const resizer = document.getElementById('chat-resizer');
    if (!panel || !handle || !resizer) return;

    let isDragging = false;
    let isResizing = false;
    let startX, startY;
    let startLeft, startTop;
    let startWidth, startHeight;

    // Helper to switch position from right/bottom to top/left before first move
    function initPosition() {
        const rect = panel.getBoundingClientRect();
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    // Drag handling
    handle.addEventListener('pointerdown', (e) => {
        // Only drag with left click or touch
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        
        // Prevent drag on close button
        if (e.target.closest('#chat-close-btn')) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        initPosition();
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // Clamp inside window bounds
        const rect = panel.getBoundingClientRect();
        newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - rect.width));
        newTop = Math.max(0, Math.min(newTop, window.innerHeight - rect.height));

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    });

    handle.addEventListener('pointerup', (e) => {
        if (isDragging) {
            isDragging = false;
            handle.releasePointerCapture(e.pointerId);
        }
    });
    handle.addEventListener('pointercancel', (e) => {
        if (isDragging) {
            isDragging = false;
            handle.releasePointerCapture(e.pointerId);
        }
    });

    // Resize handling
    resizer.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;

        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;

        initPosition();
        resizer.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
    });

    resizer.addEventListener('pointermove', (e) => {
        if (!isResizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newWidth = startWidth + dx;
        let newHeight = startHeight + dy;

        // Clamp min size and window boundaries
        const rect = panel.getBoundingClientRect();
        newWidth = Math.max(140, Math.min(newWidth, window.innerWidth - rect.left - 10));
        newHeight = Math.max(180, Math.min(newHeight, window.innerHeight - rect.top - 10));

        panel.style.width = newWidth + 'px';
        panel.style.height = newHeight + 'px';

        // Toggle mini classes for shrunk state styling
        const isMini = newWidth < 250;
        const isMiniHeight = newHeight < 320;
        panel.classList.toggle('chat-mini', isMini);
        panel.classList.toggle('chat-mini-height', isMiniHeight);
    });

    resizer.addEventListener('pointerup', (e) => {
        if (isResizing) {
            isResizing = false;
            resizer.releasePointerCapture(e.pointerId);
        }
    });
    resizer.addEventListener('pointercancel', (e) => {
        if (isResizing) {
            isResizing = false;
            resizer.releasePointerCapture(e.pointerId);
        }
    });
}

function initChat() {
    const panel = document.getElementById('chat-panel');
    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');
    
    // Note: Toggle and close buttons are handled via inline onclick attributes in HTML
    // to avoid the double-toggle bug caused by mixing event listeners and inline onclick.
    
    if (panel) {
        ['click', 'mousedown', 'touchstart'].forEach(evtName => {
            panel.addEventListener(evtName, (e) => {
                e.stopPropagation();
            });
        });
    }
    
    const sendFn = () => {
        const text = input.value.trim();
        if (!text) return;
        
        sendChatMessage(text, false);
        input.value = '';
    };
    
    if (sendBtn) {
        sendBtn.addEventListener('click', sendFn);
    }
    
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendFn();
            }
        });
    }
    
    // Quick emoji buttons
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.dataset.emoji;
            if (emoji) {
                sendChatMessage(emoji, true);
            }
        });
    });
    
    // Quick select messages
    document.querySelectorAll('.quick-msg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.innerText;
            if (text) {
                sendChatMessage(text, false);
            }
        });
    });

    makeChatDraggableAndResizable();
}

function sendChatMessage(text, isEmoji) {
    if (!appState.room.code) return;
    
    const payload = {
        sender: appState.player.name || "Guest",
        text: text,
        isEmoji: !!isEmoji,
        timestamp: Date.now(),
        id: Math.random().toString(36).substr(2, 9),
        senderCoins: appState.player.coins
    };
    
    if (db && roomRef) {
        update(roomRef, {
            chatSignal: payload
        });
    } else {
        // Local mode fallback
        receiveChatMessage(payload);
    }
}

function receiveChatMessage(msg) {
    // Avoid duplicates
    if (appState.chatHistory.some(m => m.id === msg.id)) return;
    
    appState.chatHistory.push(msg);
    if (appState.chatHistory.length > 50) {
        appState.chatHistory.shift();
    }
    
    if (appState.room.code) {
        localStorage.setItem(`chat_${appState.room.code}`, JSON.stringify(appState.chatHistory));
    }
    
    renderAllChatMessages();
    
    // Show notification badge if closed
    const panel = document.getElementById('chat-panel');
    if (panel && (panel.style.display === 'none' || panel.style.display === '')) {
        document.querySelectorAll('.chat-unread-badge-el').forEach(badge => {
            badge.style.display = 'block';
        });
    }
    
    // Check for emoji animation
    const emoji = msg.isEmoji ? msg.text : extractEmojis(msg.text);
    if (emoji) {
        triggerEmojiAnimation(emoji);
    }
}

function extractEmojis(text) {
    const match = text.match(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
    return match ? match[0] : null;
}

function triggerEmojiAnimation(emoji) {
    const container = document.body;
    const amount = 8; // Number of floating emojis
    for (let i = 0; i < amount; i++) {
        const el = document.createElement('div');
        el.innerText = emoji;
        el.style.position = 'fixed';
        el.style.bottom = '-50px';
        // Random horizontal start position
        el.style.left = Math.random() * 80 + 10 + 'vw';
        el.style.fontSize = Math.random() * 20 + 24 + 'px';
        el.style.zIndex = '9999';
        el.style.pointerEvents = 'none';
        el.style.transition = 'all 3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        
        // Random rotation
        const rot = Math.random() * 60 - 30;
        el.style.transform = `rotate(${rot}deg)`;
        
        container.appendChild(el);
        
        // Animate floating up and drifting horizontally
        setTimeout(() => {
            el.style.bottom = '105vh';
            const drift = Math.random() * 100 - 50;
            el.style.transform = `rotate(${rot + Math.random() * 90 - 45}deg) translateX(${drift}px)`;
            el.style.opacity = '0';
        }, 50);
        
        // Cleanup
        setTimeout(() => {
            el.remove();
        }, 3100);
    }
}

function renderAllChatMessages() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = '';
    
    appState.chatHistory.forEach(msg => {
        const isMine = msg.sender === appState.player.name;
        const rankInfo = getPlayerRankInfo(msg.senderCoins || 0);
        const rankName = rankInfo.name;
        const isHighRank = ['Elite', 'Champion', 'Master', 'Grandmaster', 'Mythic', 'Legend'].includes(rankName);
        
        // Sender element
        const senderEl = document.createElement('div');
        senderEl.className = `chat-message-sender ${isMine ? 'mine' : 'other'}`;
        senderEl.style.display = 'flex';
        senderEl.style.alignItems = 'center';
        senderEl.style.gap = '6px';
        
        const badgeSpan = document.createElement('span');
        badgeSpan.className = `badge ${rankInfo.className} chat-badge`;
        badgeSpan.innerText = rankName;
        badgeSpan.style.fontSize = '0.6rem';
        badgeSpan.style.padding = '1px 5px';
        badgeSpan.style.borderRadius = '8px';
        badgeSpan.style.textTransform = 'uppercase';
        badgeSpan.style.fontWeight = '700';
        badgeSpan.style.boxShadow = 'none';
        
        const nameSpan = document.createElement('span');
        nameSpan.innerText = msg.sender;
        nameSpan.className = 'chat-sender-name';
        if (isHighRank) {
            nameSpan.classList.add(`chat-glow-name-${rankName.toLowerCase()}`);
        }
        
        if (isMine) {
            senderEl.appendChild(badgeSpan);
            senderEl.appendChild(nameSpan);
        } else {
            senderEl.appendChild(nameSpan);
            senderEl.appendChild(badgeSpan);
        }
        
        container.appendChild(senderEl);
        
        // Bubble element
        const bubble = document.createElement('div');
        bubble.className = `chat-message-bubble ${isMine ? 'mine' : 'other'}`;
        bubble.innerText = msg.text;
        if (isHighRank) {
            bubble.classList.add(`chat-glow-bubble-${rankName.toLowerCase()}`);
        }
        
        // If single emoji, render larger and transparent
        const trimmed = msg.text.trim();
        const isSingleEmoji = msg.isEmoji || (trimmed.length <= 4 && /[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(trimmed));
        if (isSingleEmoji) {
            bubble.style.background = 'transparent';
            bubble.style.border = 'none';
            bubble.style.fontSize = '2.5rem';
            bubble.style.padding = '0';
            bubble.style.boxShadow = 'none';
        }
        
        container.appendChild(bubble);
    });
    
    container.scrollTop = container.scrollHeight;
}

function playVictorySound(isGrander = false) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const notes = isGrander 
            ? [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50] 
            : [261.63, 329.63, 392.00, 523.25];
        const tempo = isGrander ? 100 : 120;
        notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0, ctx.currentTime + (index * tempo / 1000));
            gain.gain.linearRampToValueAtTime(isGrander ? 0.35 : 0.25, ctx.currentTime + (index * tempo / 1000) + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (index * tempo / 1000) + 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + (index * tempo / 1000));
            osc.stop(ctx.currentTime + (index * tempo / 1000) + 0.6);
        });
    } catch (e) {
        console.error("Victory audio failed:", e);
    }
}

function triggerGranderConfetti(rankName) {
    if (typeof confetti === 'undefined') return;
    let colors = ['#bb0000', '#ffffff'];
    if (rankName === 'Elite') colors = ['#3498db', '#9b59b6', '#ffffff'];
    else if (rankName === 'Champion') colors = ['#e74c3c', '#c0392b', '#ffffff'];
    else if (rankName === 'Master') colors = ['#8e44ad', '#2980b9', '#f1c40f'];
    else if (rankName === 'Grandmaster') colors = ['#e67e22', '#d35400', '#ffffff'];
    else if (rankName === 'Mythic') colors = ['#1abc9c', '#9b59b6', '#e74c3c', '#ffffff'];
    else if (rankName === 'Legend') colors = ['#f1c40f', '#ffffff', '#f39c12', '#ffffff'];

    const duration = 5 * 1000;
    const animationEnd = Date.now() + duration;

    const intervalLeft = setInterval(function() {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return clearInterval(intervalLeft);
        confetti({
            particleCount: 8,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.8 },
            colors: colors,
            zIndex: 3000
        });
    }, 150);

    const intervalRight = setInterval(function() {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return clearInterval(intervalRight);
        confetti({
            particleCount: 8,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.8 },
            colors: colors,
            zIndex: 3000
        });
    }, 150);

    confetti({
        particleCount: 150,
        spread: 100,
        origin: { x: 0.5, y: 0.5 },
        colors: colors,
        zIndex: 3000
    });
}

function playVictoryEffects(winner, winnerCoins, claimType) {
    const rankInfo = getPlayerRankInfo(winnerCoins);
    const isHighRank = ['Elite', 'Champion', 'Master', 'Grandmaster', 'Mythic', 'Legend'].includes(rankInfo.name);
    
    // Play sound/visuals only if in TV mode (Host or Player TV mode) OR if I am the winner who claimed.
    const isTvMode = !!(appState.isHostView || appState.isPlayerTvView);
    const isMe = (winner === appState.player.name);
    
    if (isTvMode || isMe) {
        if (claimType === 'Full House') {
            if (isHighRank) {
                triggerGranderConfetti(rankInfo.name);
                playVictorySound(true);
            } else {
                triggerConfetti();
                playVictorySound(false);
            }
        } else {
            playVictorySound(false);
        }
    }
}

function getPlayerRankMultiplier(rankName) {
    const multipliers = {
        'Novice': 0.00,
        'Apprentice': 0.01,
        'Expert': 0.03,
        'Pro': 0.05,
        'Elite': 0.07,
        'Champion': 0.09,
        'Master': 0.11,
        'Grandmaster': 0.13,
        'Mythic': 0.14,
        'Legend': 0.15
    };
    return multipliers[rankName] || 0.00;
}

function checkAndAwardMatchMultiplier() {
    if (appState.matchEarnings > 0) {
        const rankInfo = getPlayerRankInfo(appState.player.coins);
        const multiplier = getPlayerRankMultiplier(rankInfo.name);
        if (multiplier > 0) {
            const bonus = Math.floor(appState.matchEarnings * multiplier);
            if (bonus > 0) {
                appState.player.coins += bonus;
                saveUser();
                showNotification(`🏆 Match Complete! Rank Bonus (${rankInfo.name} +${Math.round(multiplier * 100)}%): +${bonus} 🪙!`);
            }
        }
        appState.matchEarnings = 0;
    }
}

// ==========================================
// FEEDBACK, ADMIN CONSOLE & AI BOTS MODE
// ==========================================

// Submit Feedback
async function handleFeedbackSubmit() {
    const category = document.getElementById('feedback-category').value;
    const rating = parseInt(document.getElementById('feedback-rating').value, 10);
    const text = document.getElementById('feedback-text').value.trim();
    
    if (!text) {
        return showNotification("Please enter some comments before submitting.");
    }
    if (text.length > 500) {
        return showNotification("Feedback must be 500 characters or less.");
    }

    // Cooldown check (5 minutes = 300,000 ms)
    const cooldownPeriod = 300000;
    const safeName = getSafeDbKey(appState.player.name || "Anonymous");
    const lastFeedbackTime = localStorage.getItem('last_feedback_timestamp_' + safeName);
    if (lastFeedbackTime && (Date.now() - parseInt(lastFeedbackTime, 10)) < cooldownPeriod) {
        const remainingSec = Math.ceil((cooldownPeriod - (Date.now() - parseInt(lastFeedbackTime, 10))) / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);
        return showNotification(`Please wait ${remainingMin} minute(s) before submitting feedback again.`);
    }
    
    const userId = appState.player.name || "Anonymous";
    const timestamp = Date.now();
    const clientUserAgent = navigator.userAgent;
    
    const feedbackObj = {
        userId,
        timestamp,
        clientUserAgent,
        rating,
        category,
        text
    };
    
    const submitBtn = document.getElementById('submit-feedback-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "Submitting...";
    
    try {
        if (db) {
            const newFeedbackRef = ref(db, `feedback/entries/${timestamp}_${Math.floor(Math.random() * 1000)}`);
            await set(newFeedbackRef, feedbackObj);
        } else {
            const localFeedback = JSON.parse(localStorage.getItem('hdhousie_local_feedback') || '[]');
            localFeedback.push(feedbackObj);
            localStorage.setItem('hdhousie_local_feedback', JSON.stringify(localFeedback));
        }
        
        // Save cooldown timestamp scoped to username
        localStorage.setItem('last_feedback_timestamp_' + safeName, timestamp.toString());
        
        showNotification("Thank you! Your feedback has been submitted.");
        document.getElementById('feedback-text').value = '';
        document.getElementById('feedback-modal').style.display = 'none';
    } catch (e) {
        console.error("Error submitting feedback:", e);
        showNotification("Failed to submit feedback. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Submit Feedback";
    }
}

// Admin Authentication
async function handleAdminAuthenticate() {
    const passcode = document.getElementById('admin-passcode-input').value;
    if (!passcode) return showNotification("Please enter the passcode.");
    
    const msgBuffer = new TextEncoder().encode(passcode);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const submitBtn = document.getElementById('admin-login-btn');
    const originalText = submitBtn ? submitBtn.innerText : "Sign In";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Authenticating...";
    }
    
    try {
        let authorized = false;
        if (db) {
            const tokenRef = ref(db, `users/admin_tokens/${hashHex}`);
            const snapshot = await get(tokenRef);
            authorized = snapshot.exists() && snapshot.val() === true;
        } else {
            // Local mode fallback
            authorized = (hashHex === "8c8f6b4381421dac2b8d6216cff7cb26161a13adf7239b703489841da47ff34b");
        }
        
        if (authorized) {
            showNotification("Access Granted.");
            document.getElementById('admin-auth-panel').style.display = 'none';
            document.getElementById('admin-dashboard-panel').style.display = 'block';
            document.getElementById('admin-passcode-input').value = '';
            loadFeedbackData();
        } else {
            showNotification("Invalid Passcode. Access Denied.");
            document.getElementById('admin-passcode-input').value = '';
        }
    } catch (e) {
        console.error("Error authenticating admin:", e);
        showNotification("Failed to authenticate. Please try again.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Load Feedback
async function loadFeedbackData() {
    listenForAdminFeedback();
}

// Automatic Live Feedback Listener
function listenForAdminFeedback() {
    if (unsubscribeAdminFeedback) {
        unsubscribeAdminFeedback();
        unsubscribeAdminFeedback = null;
    }
    const tbody = document.getElementById('admin-feedback-tbody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 15px; opacity: 0.7;">Loading feedback...</td></tr>';
    
    if (!db) {
        // Local mode fallback
        let feedbackList = [];
        const localFeedback = JSON.parse(localStorage.getItem('hdhousie_local_feedback') || '[]');
        feedbackList = localFeedback.map((fb, index) => ({ key: `local_${index}`, ...fb }));
        renderFeedbackList(feedbackList);
        return;
    }
    
    const feedbackRef = ref(db, 'feedback/entries');
    unsubscribeAdminFeedback = onValue(feedbackRef, (snapshot) => {
        let feedbackList = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            feedbackList = Object.keys(data).map(key => ({ key, ...data[key] }));
        }
        renderFeedbackList(feedbackList);
    }, (err) => {
        console.error("Error listening to feedback:", err);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 15px; color: #ff3333;">Failed to load feedback.</td></tr>';
    });
}

// Render feedback list to table
function renderFeedbackList(feedbackList) {
    const tbody = document.getElementById('admin-feedback-tbody');
    tbody.innerHTML = '';
    
    feedbackList.sort((a, b) => b.timestamp - a.timestamp);
    
    if (feedbackList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 15px; opacity: 0.7;">No feedback found.</td></tr>';
        return;
    }
    
    feedbackList.forEach(fb => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--glass-border)';
        
        const dateStr = new Date(fb.timestamp).toLocaleString();
        const safeUser = escapeHtml(fb.userId || 'Anonymous');
        const safeCategory = escapeHtml(fb.category || 'N/A');
        const safeRating = '⭐'.repeat(fb.rating || 5);
        const safeText = escapeHtml(fb.text || '');
        
        // Actions cell
        const actionsTd = document.createElement('td');
        actionsTd.style.padding = '10px';
        actionsTd.style.display = 'flex';
        actionsTd.style.gap = '8px';
        
        // Reply Button
        const replyBtn = document.createElement('button');
        replyBtn.innerText = '✉️ Reply';
        replyBtn.className = 'primary-btn';
        replyBtn.style.cssText = 'width: auto !important; min-height: 28px !important; margin: 0 !important; padding: 2px 8px !important; font-size: 0.8rem !important; box-shadow: none !important;';
        replyBtn.addEventListener('click', () => openAdminReplyModal(fb.userId, fb.text));
        
        // Delete Button
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.className = 'danger-btn';
        deleteBtn.style.cssText = 'width: auto !important; min-height: 28px !important; margin: 0 !important; padding: 2px 8px !important; font-size: 0.8rem !important;';
        deleteBtn.addEventListener('click', () => handleDeleteFeedback(fb.key));
        
        actionsTd.appendChild(replyBtn);
        actionsTd.appendChild(deleteBtn);
        
        tr.innerHTML = `
            <td style="padding: 10px; font-weight: bold; color: var(--primary-color);">${safeUser}</td>
            <td style="padding: 10px;">${safeCategory}</td>
            <td style="padding: 10px; white-space: nowrap;">${safeRating}</td>
            <td style="padding: 10px; max-width: 250px; word-break: break-word;">${safeText}</td>
            <td style="padding: 10px; opacity: 0.8; font-size: 0.85rem;">${dateStr}</td>
        `;
        tr.appendChild(actionsTd);
        tbody.appendChild(tr);
    });
}

// Delete feedback entry
async function handleDeleteFeedback(key) {
    showConfirm("Delete Feedback", "Are you sure you want to delete this feedback entry?", async () => {
        try {
            if (db && !key.startsWith('local_')) {
                const feedbackEntryRef = ref(db, `feedback/entries/${key}`);
                await remove(feedbackEntryRef);
            } else {
                // Local mode fallback
                const index = parseInt(key.replace('local_', ''), 10);
                const localFeedback = JSON.parse(localStorage.getItem('hdhousie_local_feedback') || '[]');
                localFeedback.splice(index, 1);
                localStorage.setItem('hdhousie_local_feedback', JSON.stringify(localFeedback));
                loadFeedbackData();
            }
            showNotification("Feedback deleted.");
        } catch (e) {
            console.error("Error deleting feedback:", e);
            showNotification("Failed to delete feedback.");
        }
    });
}

// Clear all feedback
async function handleClearAllFeedback() {
    showConfirm("Clear All Feedback", "Are you sure you want to delete ALL feedback entries?", async () => {
        try {
            if (db) {
                const feedbackRef = ref(db, 'feedback/entries');
                await remove(feedbackRef);
            } else {
                localStorage.removeItem('hdhousie_local_feedback');
                loadFeedbackData();
            }
            showNotification("All feedback entries cleared.");
        } catch (e) {
            console.error("Error clearing feedback:", e);
            showNotification("Failed to clear feedback.");
        }
    });
}

// Admin Reply dialog state
let adminReplyTargetUser = '';
function openAdminReplyModal(userId, commentText) {
    adminReplyTargetUser = userId || 'Anonymous';
    document.getElementById('admin-reply-target-user').innerText = adminReplyTargetUser;
    document.getElementById('admin-reply-user-comment').innerText = commentText || '';
    document.getElementById('admin-reply-text').value = '';
    document.getElementById('admin-reply-modal').style.display = 'flex';
}

// Submit Admin Reply
async function submitAdminReply() {
    const text = document.getElementById('admin-reply-text').value.trim();
    if (!text) {
        return showNotification("Please type a reply message.");
    }
    if (!db) {
        showNotification("Local Mode: Simulating reply to " + adminReplyTargetUser);
        document.getElementById('admin-reply-modal').style.display = 'none';
        return;
    }
    
    const submitBtn = document.getElementById('submit-admin-reply-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "Sending...";
    
    try {
        const safeName = getSafeDbKey(adminReplyTargetUser);
        if (!safeName || safeName === 'anonymous') {
            return showNotification("Cannot reply to anonymous or empty user.");
        }
        
        const replyRef = ref(db, `feedback/replies/${safeName}`);
        
        await set(replyRef, {
            sender: "Admin",
            message: text,
            timestamp: Date.now()
        });
        
        showNotification("Reply sent successfully.");
        document.getElementById('admin-reply-modal').style.display = 'none';
    } catch (e) {
        console.error("Error sending reply:", e);
        showNotification("Failed to send reply. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Send Reply";
    }
}

// Player Side: Listen for Admin replies
function listenForAdminReplies() {
    if (unsubscribeReplies) {
        unsubscribeReplies();
        unsubscribeReplies = null;
    }
    if (!db || !appState.player.name || appState.player.name === 'Anonymous') return;
    
    const safeName = getSafeDbKey(appState.player.name);
    if (!safeName) return; // Do not listen to root replies path
    
    const replyRef = ref(db, `feedback/replies/${safeName}`);
    
    unsubscribeReplies = onValue(replyRef, (snapshot) => {
        if (!snapshot.exists()) {
            appState.pendingReply = null;
            return;
        }
        const replyData = snapshot.val();
        if (!replyData || !replyData.message) {
            appState.pendingReply = null;
            return;
        }
        
        appState.pendingReply = replyData;
        appState.replyNotified = appState.replyNotified || false;
        
        triggerReplyDisplay();
    });
}

// Trigger display of pending reply
function triggerReplyDisplay() {
    if (!appState.pendingReply) return;
    
    const currentView = appState.currentView || 'lobby-view';
    const isGameActive = appState.room.code && (currentView === 'game-view' || currentView === 'host-display-view');
    
    if (isGameActive) {
        if (!appState.replyNotified) {
            showNotification(`feedback reply: ${appState.pendingReply.message.slice(0, 40)}...`);
            appState.replyNotified = true;
        }
    } else if (currentView === 'lobby-view') {
        showReplyModal(appState.pendingReply);
    }
}

// Display Reply Modal window (pop-up)
function showReplyModal(replyData) {
    const modal = document.getElementById('feedback-reply-modal');
    if (!modal) return;
    
    const contentEl = document.getElementById('feedback-reply-message-content');
    if (contentEl) {
        contentEl.innerText = replyData.message || '';
    }
    modal.style.display = 'flex';
}

// Close and delete reply from Firebase
async function closeFeedbackReply() {
    document.getElementById('feedback-reply-modal').style.display = 'none';
    appState.pendingReply = null;
    appState.replyNotified = false;
    
    if (db && appState.player.name && appState.player.name !== 'Anonymous') {
        try {
            const safeName = getSafeDbKey(appState.player.name);
            if (safeName) {
                const replyRef = ref(db, `feedback/replies/${safeName}`);
                await remove(replyRef);
            }
        } catch (e) {
            console.error("Error clearing reply from DB:", e);
        }
    }
}

function handleAdminLogout() {
    if (unsubscribeAdminFeedback) {
        unsubscribeAdminFeedback();
        unsubscribeAdminFeedback = null;
    }
    document.getElementById('admin-auth-panel').style.display = 'block';
    document.getElementById('admin-dashboard-panel').style.display = 'none';
    document.getElementById('admin-feedback-tbody').innerHTML = '';
    switchView('auth-view');
}

// AI Bots Mode
const botNameBank = [
    "AlphaBot", "MegaBingo", "LuckyHousie", "CyberPlayer", "HousiePro",
    "GigaWin", "ByteMaster", "RetroGamer", "MatrixNeo", "GoldenStar",
    "ForestCmp", "OceanWave", "NeonRider", "TranslucentGlass", "MidnightSky"
];

function toggleAiMode() {
    appState.aiModeEnabled = !appState.aiModeEnabled;
    const btn = document.getElementById('ai-mode-toggle-btn');
    if (btn) {
        btn.innerText = appState.aiModeEnabled ? "AI Bots: On" : "AI Bots: Off";
        btn.className = appState.aiModeEnabled ? "primary-btn" : "secondary-btn";
        if (appState.aiModeEnabled) {
            btn.style.background = "linear-gradient(135deg, #a855f7, #6b21a8)";
        } else {
            btn.style.background = "rgba(255,255,255,0.05)";
        }
    }

    if (appState.aiModeEnabled) {
        spawnBots();
    } else {
        removeBots();
    }
}

async function spawnBots() {
    if (!appState.room.code) return;
    
    const shuffled = [...botNameBank].sort(() => Math.random() - 0.5);
    const numBots = 3 + Math.floor(Math.random() * 3);
    const selectedBots = shuffled.slice(0, numBots);
    
    appState.bots = [];
    
    for (const botName of selectedBots) {
        const randomTheme = shopItems.themes[Math.floor(Math.random() * shopItems.themes.length)].id;
        const botTickets = generateTickets(Math.floor(Math.random() * 2) + 1);
        
        const botProfile = {
            name: botName,
            tickets: botTickets,
            theme: randomTheme,
            ready: true
        };
        
        appState.bots.push(botProfile);
        
        if (db && roomRef) {
            await set(child(roomRef, `players/${botName}`), true);
            await set(child(roomRef, `tickets/${botName}`), botTickets);
            
            const betPerTicket = Math.max(0, parseInt(document.getElementById('bet-amount').value) || 10);
            const totalBet = botTickets.length * betPerTicket;
            if (totalBet > 0) {
                await update(roomRef, {
                    pot: increment ? increment(totalBet) : appState.room.pot + totalBet
                });
            }
        } else {
            // Local mode fallback
            const betPerTicket = Math.max(0, parseInt(document.getElementById('bet-amount').value) || 10);
            const totalBet = botTickets.length * betPerTicket;
            appState.room.pot = (appState.room.pot || 0) + totalBet;
            appState.room.playerCount = (appState.room.playerCount || 1) + 1;
        }
    }
    
    if (!db || !roomRef) {
        syncGameState();
    }
    showNotification(`Spawned ${numBots} AI bot players in the lobby!`);
}

async function removeBots() {
    if (appState.bots && appState.bots.length > 0) {
        for (const bot of appState.bots) {
            if (db && roomRef) {
                await remove(child(roomRef, `players/${bot.name}`));
                await remove(child(roomRef, `tickets/${bot.name}`));
            } else {
                // Local mode fallback
                appState.room.playerCount = Math.max(1, (appState.room.playerCount || 1) - 1);
            }
        }
    }
    appState.bots = [];
    if (!db || !roomRef) {
        syncGameState();
    }
    showNotification("AI bots removed from the room.");
}

function checkBotClaims(bot, drawnNumbers = appState.room.numbers) {
    const claims = appState.room.claims || {};
    const newClaimsToMake = [];

    bot.tickets.forEach((ticket) => {
        const ticketNumbers = ticket.flat().filter(num => num > 0);
        const markedNumbers = ticketNumbers.filter(num => drawnNumbers.includes(num));
        
        if (!claims['Early 5'] && markedNumbers.length >= 5) {
            newClaimsToMake.push('Early 5');
        }
        
        const topRow = ticket[0].filter(n => n > 0);
        const bottomRow = ticket[2].filter(n => n > 0);
        if (topRow.length >= 2 && bottomRow.length >= 2) {
            const corners = [topRow[0], topRow[topRow.length - 1], bottomRow[0], bottomRow[bottomRow.length - 1]];
            const cornersMarked = corners.every(c => drawnNumbers.includes(c));
            if (!claims['4 Corners'] && cornersMarked) {
                newClaimsToMake.push('4 Corners');
            }
        }
        
        const topRowAll = ticket[0].filter(n => n > 0);
        const midRowAll = ticket[1].filter(n => n > 0);
        const botRowAll = ticket[2].filter(n => n > 0);
        
        if (!claims['Top Row'] && topRowAll.every(n => drawnNumbers.includes(n))) {
            newClaimsToMake.push('Top Row');
        }
        if (!claims['Middle Row'] && midRowAll.every(n => drawnNumbers.includes(n))) {
            newClaimsToMake.push('Middle Row');
        }
        if (!claims['Bottom Row'] && botRowAll.every(n => drawnNumbers.includes(n))) {
            newClaimsToMake.push('Bottom Row');
        }
        
        if (!claims['Full House'] && ticketNumbers.every(n => drawnNumbers.includes(n))) {
            newClaimsToMake.push('Full House');
        }
    });

    return newClaimsToMake;
}

function botSubmitClaim(botName, claimType) {
    const delay = 1000 + Math.random() * 2500;
    
    setTimeout(async () => {
        try {
            if (db && roomRef) {
                const snap = await get(roomRef);
                if (!snap.exists()) return;
                const data = snap.val();
                const currentClaims = data.claims || {};
                
                if (!currentClaims[claimType]) {
                    const pot = data.pot || 0;
                    let claimPercentage = 0.10;
                    if (claimType === 'Full House') claimPercentage = 0.50;
                    const winAmount = Math.floor(pot * claimPercentage);
                    
                    const updates = {};
                    updates[`claims/${claimType}`] = botName;
                    updates[`claimsCoins/${claimType}`] = winAmount;
                    await update(roomRef, updates);
                    
                    const chatRef = child(roomRef, 'chatSignal');
                    const chatMsg = {
                        id: `bot_claim_${Date.now()}`,
                        sender: botName,
                        text: `I claim ${claimType}! 🎉`,
                        timestamp: Date.now()
                    };
                    await set(chatRef, chatMsg);
                }
            } else {
                const currentClaims = appState.room.claims || {};
                if (!currentClaims[claimType]) {
                    const pot = appState.room.pot || 0;
                    let claimPercentage = 0.10;
                    if (claimType === 'Full House') claimPercentage = 0.50;
                    const winAmount = Math.floor(pot * claimPercentage);
                    
                    appState.room.claims[claimType] = botName;
                    if (!appState.room.claimsCoins) appState.room.claimsCoins = {};
                    appState.room.claimsCoins[claimType] = winAmount;
                    
                    showNotification(`${botName} won ${claimType}!`);
                    playVictoryEffects(botName, winAmount, claimType);
                    
                    const localChatMsg = {
                        id: `bot_claim_local_${Date.now()}`,
                        sender: botName,
                        text: `I claim ${claimType}! 🎉`,
                        timestamp: Date.now()
                    };
                    receiveChatMessage(localChatMsg);
                    
                    syncGameState();
                }
            }
        } catch (e) {
            console.error("Bot claim failed:", e);
        }
    }, delay);
}

async function triggerBotChat(botName, text) {
    try {
        if (db && roomRef) {
            const chatRef = child(roomRef, 'chatSignal');
            const chatMsg = {
                id: `bot_chat_${Date.now()}`,
                sender: botName,
                text: text,
                timestamp: Date.now()
            };
            await set(chatRef, chatMsg);
        } else {
            const localChatMsg = {
                id: `bot_chat_local_${Date.now()}`,
                sender: botName,
                text: text,
                timestamp: Date.now()
            };
            receiveChatMessage(localChatMsg);
        }
    } catch (e) {
        console.error("Bot chat failed:", e);
    }
}

let html5QrCode = null;

async function openQrCodeModal() {
    const modal = document.getElementById('qrcode-modal');
    const title = document.getElementById('qrcode-modal-title');
    const genArea = document.getElementById('qrcode-generator-area');
    const scanArea = document.getElementById('qrcode-scanner-area');
    
    if (!modal) return;
    
    modal.style.display = 'flex';
    
    const isHost = appState.room.code && appState.room.isHost;
    
    if (isHost) {
        title.innerText = "Room QR Code";
        genArea.style.display = 'block';
        scanArea.style.display = 'none';
        
        const joinLink = `${window.location.origin}/#${appState.room.code}`;
        const qrImg = document.getElementById('qrcode-image');
        if (qrImg) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinLink)}`;
        }
        const roomCodeDisp = document.getElementById('qrcode-room-code-display');
        if (roomCodeDisp) {
            roomCodeDisp.innerText = `ROOM: ${appState.room.code}`;
        }
        
        const copyBtn = document.getElementById('qrcode-copy-link-btn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(joinLink).then(() => {
                    showNotification("Join link copied to clipboard!");
                });
            };
        }
    } else {
        title.innerText = "Scan QR Code";
        genArea.style.display = 'none';
        scanArea.style.display = 'block';
        
        // Start scanner
        startQrScanner();
    }
}

function startQrScanner() {
    initQrScanner();
}

async function initQrScanner() {
    const statusEl = document.getElementById('qr-scanner-status');
    
    if (html5QrCode) {
        try {
            await html5QrCode.stop();
        } catch (err) {
            console.error("Stop failed:", err);
        }
        html5QrCode = null;
    }
    
    html5QrCode = new Html5Qrcode("qr-reader");
    
    // Optimized scanner configuration (15 FPS & responsive dynamic scan area)
    const config = { 
        fps: 15,
        qrbox: (width, height) => {
            const size = Math.min(width, height) * 0.70;
            return { width: size, height: size };
        }
    };

    // iOS/Safari Autoplay & black-screen bypass + pinch-zoom handler
    const qrReaderContainer = document.getElementById('qr-reader');
    if (qrReaderContainer) {
        // Allow touch events to pass through for pinch zoom
        qrReaderContainer.style.touchAction = 'pinch-zoom';

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    const videoEl = (node.tagName === 'VIDEO') ? node : (node.querySelector && node.querySelector('video'));
                    if (videoEl) {
                        videoEl.setAttribute('playsinline', 'true');
                        videoEl.setAttribute('webkit-playsinline', 'true');
                        videoEl.setAttribute('autoplay', 'true');
                        videoEl.setAttribute('muted', 'true');
                        videoEl.style.width = '100%';
                        videoEl.style.height = '100%';
                        videoEl.style.objectFit = 'cover';
                        videoEl.style.transformOrigin = 'center center';
                        videoEl.style.touchAction = 'none'; // we handle touch ourselves
                        videoEl.play().catch(e => console.log("Safari auto-play forced start:", e));

                        // --- Pinch-zoom implementation ---
                        let currentScale = 1;
                        let startDist = 0;
                        let startScale = 1;

                        const getDist = (t) => {
                            const dx = t[0].clientX - t[1].clientX;
                            const dy = t[0].clientY - t[1].clientY;
                            return Math.hypot(dx, dy);
                        };

                        videoEl.addEventListener('touchstart', (e) => {
                            if (e.touches.length === 2) {
                                e.preventDefault();
                                startDist = getDist(e.touches);
                                startScale = currentScale;
                            }
                        }, { passive: false });

                        videoEl.addEventListener('touchmove', (e) => {
                            if (e.touches.length === 2) {
                                e.preventDefault();
                                const newDist = getDist(e.touches);
                                const ratio = newDist / startDist;
                                currentScale = Math.min(Math.max(startScale * ratio, 1), 4); // clamp 1x–4x
                                videoEl.style.transform = `scale(${currentScale})`;
                            }
                        }, { passive: false });

                        videoEl.addEventListener('touchend', (e) => {
                            if (e.touches.length < 2 && currentScale < 1.05) {
                                currentScale = 1;
                                videoEl.style.transform = 'scale(1)';
                            }
                        }, { passive: true });
                    }
                });
            });
        });
        observer.observe(qrReaderContainer, { childList: true, subtree: true });
    }
    
    const qrSuccessCallback = (decodedText) => {
        console.log("QR Decoded text:", decodedText);
        let code = null;
        const match = decodedText.match(/[#&?/]([A-Z]{5})(?:[?&]|$)/) || decodedText.match(/^[A-Z]{5}$/);
        if (match) {
            code = match[1] || decodedText;
        } else {
            const cleanText = decodedText.trim().toUpperCase();
            if (/^[A-Z]{5}$/.test(cleanText)) {
                code = cleanText;
            }
        }
        
        if (code) {
            if (statusEl) statusEl.innerText = `Found room code: ${code}! Joining...`;
            closeQrCodeModal();
            
            const roomInput = document.getElementById('room-code-input');
            if (roomInput) {
                roomInput.value = code;
            }
            
            if (appState.player.name) {
                appState.pendingRoomCode = code;
                handleJoinRoom();
            } else {
                appState.pendingRoomCode = code;
                showNotification(`Scanned Room ${code}. Please enter your name to join.`);
            }
        } else {
            if (statusEl) statusEl.innerText = "Scanned, but no valid room code found.";
        }
    };
    
    const qrErrorCallback = (errorMessage) => {
        // ignore parse errors
    };

    const startWithFacingMode = () => {
        html5QrCode.start(
            { facingMode: "environment" },
            config,
            qrSuccessCallback,
            qrErrorCallback
        ).then(() => {
            if (statusEl) statusEl.innerText = "Scanning... Align QR Code in frame.";
        }).catch(err => {
            console.error("All camera start methods failed:", err);
            if (statusEl) statusEl.innerText = "Camera access denied or no camera found.";
        });
    };

    // iOS Safari cannot open the camera twice in quick succession — a pre-warm
    // getUserMedia followed immediately by html5-qrcode's own open causes a black
    // screen. On iOS we skip straight to facingMode which the OS resolves natively.
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isIOS) {
        // iOS: use facingMode directly, no pre-warm, no enumeration.
        startWithFacingMode();
        return;
    }

    // Non-iOS: pre-warm so that device labels are populated before getCameras().
    // Firefox Android & older Chrome return empty labels until a getUserMedia grant
    // has already been issued in this session.
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        stream.getTracks().forEach(t => t.stop()); // release immediately; we only needed the grant
    } catch (e) {
        console.warn("Pre-warm getUserMedia failed (permission denied or no camera):", e);
        if (statusEl) statusEl.innerText = "Camera access denied or no camera found.";
        return;
    }

    let cameraConfig = { facingMode: "environment" };
    try {
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
            let cameraId = devices[0].id;
            const backCamera = devices.find(d => 
                d.label.toLowerCase().includes('back') || 
                d.label.toLowerCase().includes('environment') || 
                d.label.toLowerCase().includes('rear') ||
                d.label.toLowerCase().includes('facing 1')
            );
            if (backCamera) cameraId = backCamera.id;
            cameraConfig = cameraId;
        }
    } catch (e) {
        console.warn("getCameras() failed, falling back to facingMode constraint", e);
    }

    try {
        await html5QrCode.start(
            cameraConfig,
            config,
            qrSuccessCallback,
            qrErrorCallback
        );
        if (statusEl) statusEl.innerText = "Scanning... Align QR Code in frame.";
    } catch (err) {
        console.warn("Camera start with ID failed, trying facingMode fallback...", err);
        startWithFacingMode();
    }
}

function closeQrCodeModal() {
    const modal = document.getElementById('qrcode-modal');
    if (modal) modal.style.display = 'none';
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode = null;
        }).catch(err => {
            console.error(err);
            html5QrCode = null;
        });
    }
}

window.openQrCodeModal = openQrCodeModal;
window.closeQrCodeModal = closeQrCodeModal;
