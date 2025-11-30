const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard, Tray, Menu } = require('electron');
const { spawn } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const path = require('path');


// ========================================
// DEV MODE - FRESH START HANYA UNTUK INSTALLER
// ========================================
const isDev = process.argv.includes('--dev') || !app.isPackaged;
const isInstallerMode = process.argv.includes('--installer');

if (isInstallerMode) {
  const tempDir = path.join(app.getPath('temp'), 'pingoai-dev-' + Date.now());
  app.setPath('userData', tempDir);
  console.log('🧪 Installer mode - Fresh userData:', tempDir);
}

// ========================================


const Store = require('electron-store').default;
const store = new Store();
const isWindows = process.platform === 'win32';

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Jika sudah ada instance lain yang berjalan, quit aplikasi ini
  console.log('Another instance is already running. Exiting...');
  app.quit();
} else {
  // Jika ada yang coba buka instance kedua (user klik icon lagi), fokuskan window yang sesuai dengan mode
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('Second instance detected, showing appropriate window based on AI mode...');
    
    const currentMode = getCurrentAIMode();
    console.log('Current AI Mode:', currentMode);
    
    if (currentMode === 'panel') {
      // Panel mode: show chat window
      if (chatWindow) {
        if (chatWindow.isMinimized()) chatWindow.restore();
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow();
      }
    } else {
      // Glance mode: show glance-mode-hint.html
      const glanceHintSettings = store.get('glanceModeHintSettings', { showHint: true });
      if (glanceHintSettings.showHint) {
        createGlanceModeHintWindow();
      } else {
        // If hint is disabled, just show settings
        showOrCreateSettingsWindow();
      }
    }
  });
}

let chatWindow = null;
let settingsWindow = null;
let selectionBubbleWindow = null;
let glanceResponseWindow = null;
let onboardingWindow = null;
let glanceModeHintWindow = null;
let startupHintWindow = null;

let tray = null;
let selectedText = '';
let lastBubbleBounds = null;
let conversationHistory = [];

const BUBBLE_WINDOW_WIDTH = 250;
const BUBBLE_WINDOW_HEIGHT = 360;
const GLANCE_RESPONSE_WIDTH = 400;
const GLANCE_RESPONSE_MAX_HEIGHT = 500;
const MAX_HISTORY_LENGTH = 20;
const DEFAULT_TOGGLE_SHORTCUT = 'CommandOrControl+Alt+A';
const DEFAULT_SETTINGS_SHORTCUT = 'CommandOrControl+Shift+S';
const DEFAULT_BUBBLE_SHORTCUT = 'CommandOrControl+Shift+X';

// System prompts for different languages
const SYSTEM_PROMPT_EN = `You are PingoAI, an AI assistant. Follow these HIGH PRIORITY RULES:
1. Answer only what the user requests concisely (maximum 3 sentences/100 words unless more is needed)
2. For EXPLAIN action: Explain the meaning/definition of the given word or sentence clearly
3. For SUMMARIZE action: Create shorter version. If text is too short (less than 15 words), REJECT with "The text is too short, please select more text for me to summarize."
4. For FORMALIZE action: Transform text into formal, professional language. Result MUST be formal
5. For BULLET POINTS action: Create structured bullet points from the text. If text is too short (less than 15 words), REJECT with "The text is too short, please select more text for me to create bullet points."
6. For TRANSLATE action: Reply ONLY with the translated text
7. Always respond in English unless translating to another language`;

const SYSTEM_PROMPT_ID = `Kamu adalah PingoAI, asisten AI. Ikuti ATURAN PRIORITAS TINGGI ini:
1. Jawab hanya yang diminta secara singkat (maksimal 3 kalimat/100 kata kecuali perlu lebih)
2. Untuk aksi JELASKAN: Jelaskan makna/arti kata atau kalimat yang diberikan dengan jelas
3. Untuk aksi RINGKAS: Buat versi lebih pendek. Jika teks terlalu pendek (kurang dari 15 kata), TOLAK dengan "Kata-kata terlalu pendek, ambil lebih banyak kata untuk saya ringkas."
4. Untuk aksi FORMAL: Ubah teks menjadi bahasa formal dan profesional. Hasil HARUS formal
5. Untuk aksi BUAT POIN: Buat poin-poin terstruktur dari teks. Jika teks terlalu pendek (kurang dari 15 kata), TOLAK dengan "Kata-kata terlalu pendek, ambil lebih banyak kata untuk saya buat point."
6. Untuk aksi TERJEMAH: Balas HANYA dengan teks hasil terjemahan
7. Selalu gunakan Bahasa Indonesia kecuali menerjemahkan ke bahasa lain`;

const DEFAULT_LANGUAGE_SETTINGS = {
  interfaceLanguage: 'en',
  aiLanguage: 'en'
};
const CLIPBOARD_POLL_INTERVAL = 400;
const MIN_CLIPBOARD_TEXT_LENGTH = 3;
const AUTO_BUBBLE_DEBOUNCE_MS = 900;
const DUPLICATE_TEXT_COOLDOWN_MS = 500; // Cooldown untuk mencegah double trigger

let clipboardWatcherInterval = null;
let lastClipboardText = '';
let lastBubbleTimestamp = 0;
let lastProcessedText = ''; // Track last processed text for duplicate detection
const autoHideSuppressedTexts = new Set();
let isProcessingAction = false;
let clipboardCopyTriggered = false; // Flag ketika Ctrl+C terdeteksi
let lastCopyTimestamp = 0; // Timestamp terakhir Ctrl+C ditekan
let highlightWatcherProcess = null; // Process HighlightWatcher untuk keyboard hook


// AI Service State
let aiServiceEnabled = store.get('aiServiceEnabled', true);

function suppressClipboardForAutoHide() {
  try {
    // Gunakan lastClipboardText jika ada untuk memastikan kita men-suppress teks yang BENAR-BENAR memicu bubble
    // Fallback ke clipboard.readText() jika lastClipboardText kosong
    const textToSuppress = (lastClipboardText && lastClipboardText.length >= MIN_CLIPBOARD_TEXT_LENGTH)
      ? lastClipboardText
      : clipboard.readText();

    if (textToSuppress && textToSuppress.trim().length >= MIN_CLIPBOARD_TEXT_LENGTH) {
      autoHideSuppressedTexts.add(textToSuppress);
      console.log('Suppressed text for auto-hide:', textToSuppress.substring(0, 20));
    }
  } catch (error) {
    console.error('Failed to capture clipboard for auto-hide suppression:', error);
  }
}

// Server Configuration
const SERVER_URL = 'https://soulhbc.com/api_pingoai/api.php';

// Removed local free-integration loading logic as it is now on the server

// TAMBAHAN BARU: Request limit tracking functions
function getRequestLimitData() {
  const limitData = store.get('requestLimit', { count: 0, lastUpdate: '' });
  const today = new Date().toDateString();

  if (limitData.lastUpdate !== today) {
    limitData.count = 0;
    limitData.lastUpdate = today;
    store.set('requestLimit', limitData);
  }

  return limitData;
}

function incrementRequestCount() {
  const limitData = getRequestLimitData();
  limitData.count = (limitData.count || 0) + 1;
  store.set('requestLimit', limitData);
  return limitData.count;
}

function getModelForRequest() {
  const limitData = getRequestLimitData();
  if ((limitData.count || 0) >= 100) {
    return 'llama-3.1-8b-instant'; // Model fallback
  }
  return 'openai/gpt-oss-120b'; // Model premium
}
// AKHIR TAMBAHAN

function trimHistory() {
  if (conversationHistory.length > MAX_HISTORY_LENGTH) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
  }
}

function calculateBubbleBounds(cursorPoint = null) {
  const targetPoint = cursorPoint || screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(targetPoint);
  const { x: displayX, y: displayY, width: screenWidth, height: screenHeight } = currentDisplay.workArea;

  const relativeX = targetPoint.x - displayX;
  const relativeY = targetPoint.y - displayY;

  // Center bubble horizontally relative to cursor
  const posX = displayX + Math.min(
    Math.max(0, relativeX - Math.floor(BUBBLE_WINDOW_WIDTH / 2)),
    screenWidth - BUBBLE_WINDOW_WIDTH
  );

  // Position bubble above cursor with adaptive spacing
  // Use 40% of bubble height as offset for consistent positioning
  const verticalOffset = Math.floor(BUBBLE_WINDOW_HEIGHT * 0.4);
  const posY = displayY + Math.min(
    Math.max(0, relativeY - verticalOffset),
    screenHeight - BUBBLE_WINDOW_HEIGHT
  );

  return { x: posX, y: posY };
}

function revealBubbleWithText(rawText, preferredPoint = null, preferredBounds = null, options = {}) {
  if (!rawText) {
    console.log('[HW] revealBubbleWithText: no text');
    return false;
  }

  const text = rawText.trim();
  console.log('[HW] revealBubbleWithText called with text length:', text.length);
  console.log('[HW] Text preview:', text.substring(0, 100));

  if (text.length < MIN_CLIPBOARD_TEXT_LENGTH) {
    console.log('[HW] Text too short:', text.length);
    return false;
  }

  selectedText = text; // INI PENTING - simpan full text
  console.log('[HW] selectedText set to length:', selectedText.length);

  const bounds = preferredBounds || calculateBubbleBounds(preferredPoint);
  createSelectionBubble(bounds, options);
  lastBubbleBounds = bounds;
  lastBubbleTimestamp = Date.now();
  return true;
}

function toggleChatWindowVisibility() {
  if (getCurrentAIMode() !== 'panel') {
    console.log('Chat window is disabled while Glance Mode is active.');
    return;
  }

  if (chatWindow) {
    if (chatWindow.isVisible()) {
      chatWindow.hide();
    } else {
      chatWindow.show();
      chatWindow.focus();
    }
  } else {
    createChatWindow();
  }
}

function showOrCreateSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
  } else {
    createSettingsWindow();
  }
}

async function handleBubbleShortcut() {
  // Don't show bubble if onboarding is not completed
  const onboardingCompleted = store.get('onboardingCompleted', false);
  if (!onboardingCompleted) {
    console.log('Bubble shortcut disabled: onboarding not completed');
    return;
  }

  // Check if AI Service is enabled
  if (!aiServiceEnabled) {
    console.log('Bubble shortcut disabled: AI Service is OFF');
    return;
  }

  try {
    const text = clipboard.readText();
    if (revealBubbleWithText(text)) {
      lastClipboardText = text;
    }
  } catch (error) {
    console.error('Error reading clipboard:', error);
  }
}

function createShortcutRegistrar(defaultShortcut, handler, label) {
  let currentShortcut = null;
  return (requestedShortcut) => {
    const desiredShortcut = (typeof requestedShortcut === 'string' && requestedShortcut.trim().length > 0)
      ? requestedShortcut.trim()
      : defaultShortcut;
    const shortcutsToTry = desiredShortcut === defaultShortcut
      ? [defaultShortcut]
      : [desiredShortcut, defaultShortcut];
    const previousShortcut = currentShortcut;

    if (previousShortcut) {
      globalShortcut.unregister(previousShortcut);
      currentShortcut = null;
    }

    for (const shortcut of shortcutsToTry) {
      if (globalShortcut.register(shortcut, handler)) {
        currentShortcut = shortcut;
        return shortcut;
      }
      console.warn(`Failed to register ${label} ${shortcut}`);
    }

    if (previousShortcut) {
      if (globalShortcut.register(previousShortcut, handler)) {
        currentShortcut = previousShortcut;
      }
    }
    return null;
  };
}

const registerToggleShortcut = createShortcutRegistrar(
  DEFAULT_TOGGLE_SHORTCUT,
  toggleChatWindowVisibility,
  'toggle shortcut'
);
const registerSettingsShortcut = createShortcutRegistrar(
  DEFAULT_SETTINGS_SHORTCUT,
  showOrCreateSettingsWindow,
  'settings shortcut'
);
const registerBubbleShortcut = createShortcutRegistrar(
  DEFAULT_BUBBLE_SHORTCUT,
  handleBubbleShortcut,
  'bubble shortcut'
);

function getCurrentAIMode() {
  const aiModeSettings = store.get('aiModeSettings', { mode: 'glance' });
  return aiModeSettings.mode === 'panel' ? 'panel' : 'glance';
}

function updateTrayContextMenu(mode = getCurrentAIMode()) {
  if (!tray) {
    return;
  }

  const template = [];

  if (mode === 'panel') {
    template.push({
      label: 'Open',
      click: () => {
        if (chatWindow) {
          chatWindow.show();
          chatWindow.focus();
        } else {
          createChatWindow();
        }
      }
    });
  } else {
    // Glance mode specific items
    template.push(
      {
        label: `AI Service: ${aiServiceEnabled ? 'ON' : 'OFF'}`,
        click: () => {
          aiServiceEnabled = !aiServiceEnabled;
          store.set('aiServiceEnabled', aiServiceEnabled);
          console.log(`AI Service toggled to: ${aiServiceEnabled ? 'ON' : 'OFF'}`);
          updateTrayContextMenu();
        }
      },
      { type: 'separator' }
    );
  }

  template.push(
    {
      label: 'Settings',
      click: () => {
        showOrCreateSettingsWindow();
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  );

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
}

function syncChatWindowWithAIMode(mode = getCurrentAIMode()) {
  updateTrayContextMenu(mode);

  if (mode === 'panel') {
    if (chatWindow) {
      chatWindow.show();
      chatWindow.focus();
    } else {
      createChatWindow();
    }
  } else {
    if (chatWindow) {
      chatWindow.hide();
    }

    // Show glance mode hint if user hasn't disabled it
    const glanceHintSettings = store.get('glanceModeHintSettings', { showHint: true });
    if (glanceHintSettings.showHint) {
      createGlanceModeHintWindow();
    }
  }
}

function broadcastWindowSettings(windowSettings = {}) {
  if (chatWindow) {
    chatWindow.webContents.send('window-settings-updated', windowSettings);
  }
}

function broadcastLanguageSettings(languageSettings = DEFAULT_LANGUAGE_SETTINGS) {
  if (chatWindow) {
    chatWindow.webContents.send('language-settings-updated', languageSettings);
  }
}

function broadcastServiceSettings(serviceSettings = { runInBackground: true, autoStart: false }) {
  if (chatWindow) {
    chatWindow.webContents.send('service-settings-updated', serviceSettings);
  }
}

// Create chat overlay window (normal window by default, not always on top)
function createChatWindow(alwaysOnTop = false) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Load window settings from store
  const windowSettings = store.get('windowSettings', {});
  const isTransparent = windowSettings.transparent || false;
  const isAlwaysOnTop = alwaysOnTop || windowSettings.alwaysOnTop || false;
  const dockPosition = windowSettings.dockPosition || 'right';
  const dockSize = windowSettings.dockSize || 400;
  const opacity = isTransparent ? (windowSettings.opacity || 0.95) : 1.0;

  // Calculate position based on dock position
  let x, y, windowWidth, windowHeight;
  if (dockPosition === 'right') {
    x = width - dockSize;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  } else if (dockPosition === 'left') {
    x = 0;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  } else if (dockPosition === 'top') {
    x = 0;
    y = 0;
    windowWidth = width;
    windowHeight = dockSize;
  } else if (dockPosition === 'bottom') {
    x = 0;
    y = height - dockSize;
    windowWidth = width;
    windowHeight = dockSize;
  } else {
    // Default to right
    x = width - dockSize;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  }

  chatWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    frame: false,
    transparent: false,
    alwaysOnTop: isAlwaysOnTop,
    skipTaskbar: false,
    resizable: true,
    opacity: opacity,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/chat-preload.js')
    }
  });

  chatWindow.loadFile('src/renderer/chat.html');

  chatWindow.on('close', (event) => {
    // Jika app sedang quit, izinkan close
    if (app.isQuitting) {
      return;
    }

    const serviceSettings = store.get('serviceSettings', { runInBackground: true });

    // Jika run in background, hide saja
    if (serviceSettings.runInBackground) {
      event.preventDefault();
      chatWindow.hide();
      return;
    }

    // Jika tidak run in background, quit aplikasi
    event.preventDefault();
    app.isQuitting = true;
    app.quit();
  });

  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  return chatWindow;
}

// Create onboarding window
function createOnboardingWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  onboardingWindow = new BrowserWindow({
    width: 720,
    height: 600,
    x: Math.floor((width - 720) / 2),
    y: Math.floor((height - 600) / 2),
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/onboarding-preload.js')
    }
  });

  onboardingWindow.loadFile('src/renderer/onboarding.html');

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });

  return onboardingWindow;
}

// Create settings window
function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 650,
    frame: true,
    resizable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/settings-preload.js')
    }
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile('src/renderer/settings.html');

  // Open DevTools for debugging (you can remove this line in production)
  // settingsWindow.webContents.openDevTools();

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

// Create glance mode hint window
function createGlanceModeHintWindow() {
  if (glanceModeHintWindow) {
    glanceModeHintWindow.close();
  }

  glanceModeHintWindow = new BrowserWindow({
    width: 460,
    height: 420,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/glance-mode-hint-preload.js')
    }
  });

  glanceModeHintWindow.loadFile('src/renderer/glance-mode-hint.html');

  glanceModeHintWindow.on('closed', () => {
    glanceModeHintWindow = null;
  });

  return glanceModeHintWindow;
}

// Create startup hint window (shown on app startup)
function createStartupHintWindow() {
  if (startupHintWindow) {
    startupHintWindow.close();
  }

  startupHintWindow = new BrowserWindow({
    width: 460,
    height: 420,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/glance-mode-startup-preload.js')
    }
  });

  startupHintWindow.loadFile('src/renderer/glance-mode-startup.html');

  startupHintWindow.on('closed', () => {
    startupHintWindow = null;
  });

  return startupHintWindow;
}



// Create selection bubble window (appears when text is selected)
function createSelectionBubble(bounds, options = {}) {
  if (selectionBubbleWindow) {
    selectionBubbleWindow.close();
  }

  selectionBubbleWindow = new BrowserWindow({
    width: BUBBLE_WINDOW_WIDTH,
    height: BUBBLE_WINDOW_HEIGHT,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/bubble-preload.js')
    }
  });

  selectionBubbleWindow.loadFile('src/renderer/bubble.html');

  selectionBubbleWindow.webContents.once('did-finish-load', () => {
    if (options.autoOpenMenu) {
      selectionBubbleWindow.webContents.send('bubble-auto-open-menu');
    }
    if (options.disableAutoHide) {
      selectionBubbleWindow.webContents.send('bubble-disable-auto-hide');
    }

    // Send auto-hide duration settings
    const serviceSettings = store.get('serviceSettings', { runInBackground: true, autoStart: false, autoHideDuration: 4 });
    const duration = (serviceSettings.autoHideDuration || 4) * 1000; // Convert to ms
    selectionBubbleWindow.webContents.send('bubble-settings', { autoHideDuration: duration });
  });

  selectionBubbleWindow.on('blur', () => {
    suppressClipboardForAutoHide();
    if (selectionBubbleWindow) {
      selectionBubbleWindow.close();
    }
    // Reset will happen in 'closed' event
  });

  selectionBubbleWindow.on('closed', () => {
    selectionBubbleWindow = null;
    // Reset clipboard tracking so the same text can be copied again
    // BUT only if we are NOT processing an action (to avoid re-triggering bubble)
    if (!isProcessingAction) {
      lastClipboardText = '';
    }
    isProcessingAction = false;
  });

  lastBubbleBounds = bounds;
  return selectionBubbleWindow;
}

// Create glance response window (floating AI response for glance mode)
function createGlanceResponseWindow(bounds) {
  if (glanceResponseWindow) {
    glanceResponseWindow.close();
  }

  glanceResponseWindow = new BrowserWindow({
    width: GLANCE_RESPONSE_WIDTH,
    height: 200, // Start small, will auto-resize when content loads
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    icon: path.join(__dirname, 'assets', '256_icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/glance-response-preload.js')
    }
  });

  glanceResponseWindow.loadFile('src/renderer/glance-response.html');

  glanceResponseWindow.on('closed', () => {
    glanceResponseWindow = null;
  });

  glanceResponseWindow.on('blur', () => {
    if (glanceResponseWindow) {
      glanceResponseWindow.close();
    }
  });

  return glanceResponseWindow;
}

function shouldSkipAutoBubble() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) {
    return false;
  }

  return (
    (chatWindow && focusedWindow === chatWindow) ||
    (settingsWindow && focusedWindow === settingsWindow) ||
    (selectionBubbleWindow && focusedWindow === selectionBubbleWindow)
  );
}

function maybeShowBubbleFromClipboard(text, forceShow = false) {
  // Don't show bubble if onboarding is not completed
  const onboardingCompleted = store.get('onboardingCompleted', false);
  if (!onboardingCompleted) {
    return;
  }

  // Skip auto-bubble check unless forced
  if (!forceShow && shouldSkipAutoBubble()) {
    return;
  }

  // Check if AI Service is enabled
  if (!aiServiceEnabled) {
    return;
  }

  const now = Date.now();
  // Skip debounce check if forced (untuk duplicate text)
  if (!forceShow && now - lastBubbleTimestamp < AUTO_BUBBLE_DEBOUNCE_MS) {
    return;
  }

  revealBubbleWithText(text);
}

function startClipboardWatcher() {
  // Don't start clipboard watcher if onboarding is not completed
  const onboardingCompleted = store.get('onboardingCompleted', false);
  if (!onboardingCompleted) {
    console.log('Clipboard watcher disabled: onboarding not completed');
    return;
  }

  if (clipboardWatcherInterval) {
    return;
  }

  try {
    lastClipboardText = clipboard.readText() || '';
  } catch (error) {
    console.error('Failed to seed clipboard watcher:', error);
    lastClipboardText = '';
  }

  clipboardWatcherInterval = setInterval(() => {
    try {
      const currentText = clipboard.readText();
      const serviceSettings = store.get('serviceSettings', { allowDuplicateText: false });
      const allowDuplicate = serviceSettings.allowDuplicateText === true;
      const now = Date.now();
      
      // Check jika ada Ctrl+C trigger untuk duplicate text
      if (clipboardCopyTriggered && allowDuplicate) {
        clipboardCopyTriggered = false; // Reset flag
        
        // Jika teks sama dan allowDuplicateText aktif, tetap tampilkan bubble
        if (currentText === lastClipboardText && currentText && currentText.trim().length >= MIN_CLIPBOARD_TEXT_LENGTH) {
          // Cek cooldown untuk mencegah spam
          if (now - lastBubbleTimestamp > DUPLICATE_TEXT_COOLDOWN_MS) {
            console.log('[Clipboard] Duplicate text detected, showing bubble (allowDuplicateText enabled)');
            maybeShowBubbleFromClipboard(currentText);
          }
          return;
        }
      }
      
      // Logic normal: skip jika teks sama
      if (currentText === lastClipboardText) {
        return;
      }
      if (autoHideSuppressedTexts.has(currentText)) {
        lastClipboardText = currentText;
        return;
      }

      if (autoHideSuppressedTexts.size > 0) {
        autoHideSuppressedTexts.clear();
      }

      lastClipboardText = currentText;
      maybeShowBubbleFromClipboard(currentText);
    } catch (error) {
      console.error('Clipboard watcher error:', error);
    }
  }, CLIPBOARD_POLL_INTERVAL);
}

function stopClipboardWatcher() {
  if (!clipboardWatcherInterval) {
    return;
  }
  clearInterval(clipboardWatcherInterval);
  clipboardWatcherInterval = null;
}

// ========================================
// HIGHLIGHT WATCHER INTEGRATION
// Untuk mendeteksi Ctrl+C dan text selection di Windows
// ========================================
function getHighlightWatcherPath() {
  const possiblePaths = [
    path.join(__dirname, 'native', 'HighlightWatcher', 'bin', 'Publish', 'HighlightWatcher.exe'),
    path.join(__dirname, 'native', 'HighlightWatcher', 'bin', 'Release', 'net8.0', 'HighlightWatcher.exe'),
    path.join(__dirname, 'native', 'HighlightWatcher', 'bin', 'Release', 'net8.0', 'win-x64', 'HighlightWatcher.exe'),
    path.join(__dirname, 'native', 'HighlightWatcher', 'bin', 'Release', 'net8.0', 'publish', 'HighlightWatcher.exe')
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function startHighlightWatcher() {
  // Only run on Windows
  if (!isWindows) {
    console.log('[HighlightWatcher] Skipped: Not Windows');
    return false;
  }
  
  // Check if onboarding is completed
  const onboardingCompleted = store.get('onboardingCompleted', false);
  if (!onboardingCompleted) {
    console.log('[HighlightWatcher] Skipped: Onboarding not completed');
    return false;
  }
  
  // Check if AI service is enabled
  if (!aiServiceEnabled) {
    console.log('[HighlightWatcher] Skipped: AI Service is OFF');
    return false;
  }
  
  // Already running?
  if (highlightWatcherProcess) {
    console.log('[HighlightWatcher] Already running');
    return true;
  }
  
  const exePath = getHighlightWatcherPath();
  if (!exePath) {
    console.log('[HighlightWatcher] Executable not found. Run "npm run watcher:build" to build it.');
    return false;
  }
  
  console.log('[HighlightWatcher] Starting:', exePath);
  
  try {
    highlightWatcherProcess = spawn(exePath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    
    let buffer = '';
    
    highlightWatcherProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        try {
          const payload = JSON.parse(line);
          handleHighlightWatcherPayload(payload);
        } catch (err) {
          console.error('[HighlightWatcher] Parse error:', err.message);
        }
      }
    });
    
    highlightWatcherProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log('[HighlightWatcher]', msg);
      }
    });
    
    highlightWatcherProcess.on('error', (err) => {
      console.error('[HighlightWatcher] Process error:', err.message);
      highlightWatcherProcess = null;
    });
    
    highlightWatcherProcess.on('exit', (code, signal) => {
      console.log(`[HighlightWatcher] Exited with code ${code}, signal ${signal}`);
      highlightWatcherProcess = null;
    });
    
    console.log('[HighlightWatcher] Started successfully');
    return true;
  } catch (err) {
    console.error('[HighlightWatcher] Failed to start:', err.message);
    highlightWatcherProcess = null;
    return false;
  }
}

function stopHighlightWatcher() {
  if (!highlightWatcherProcess) {
    return;
  }
  
  console.log('[HighlightWatcher] Stopping...');
  try {
    highlightWatcherProcess.kill('SIGTERM');
  } catch (err) {
    console.error('[HighlightWatcher] Error stopping:', err.message);
  }
  highlightWatcherProcess = null;
}

function handleHighlightWatcherPayload(payload) {
  if (!payload) return;
  
  // Handle Ctrl+C event
  if (payload.type === 'ctrl-c') {
    console.log('[HighlightWatcher] Ctrl+C detected');
    
    // Set flag untuk clipboard watcher
    clipboardCopyTriggered = true;
    lastCopyTimestamp = Date.now();
    
    // Jika allowDuplicateText aktif, paksa tampilkan bubble
    const serviceSettings = store.get('serviceSettings', { allowDuplicateText: false });
    if (serviceSettings.allowDuplicateText) {
      // Delay sedikit untuk memastikan clipboard sudah diupdate
      setTimeout(() => {
        try {
          const currentText = clipboard.readText();
          if (currentText && currentText.trim().length >= MIN_CLIPBOARD_TEXT_LENGTH) {
            // Cek cooldown
            if (Date.now() - lastBubbleTimestamp > DUPLICATE_TEXT_COOLDOWN_MS) {
              console.log('[HighlightWatcher] Showing bubble for duplicate text');
              maybeShowBubbleFromClipboard(currentText, true); // true = force show
            }
          }
        } catch (err) {
          console.error('[HighlightWatcher] Error reading clipboard:', err);
        }
      }, 100);
    }
    return;
  }
  
  // Handle text selection event (existing behavior)
  if (payload.text) {
    const selectionSettings = store.get('selectionSettings', { autoBubbleOnHighlight: false });
    if (selectionSettings.autoBubbleOnHighlight) {
      console.log('[HighlightWatcher] Text selection:', payload.text.substring(0, 50));
      
      const bounds = payload.bounds ? {
        x: Math.round(payload.bounds.x),
        y: Math.round(payload.bounds.y)
      } : null;
      
      revealBubbleWithText(payload.text, bounds);
    }
  }
}
// ========================================

function createTray() {
  try {
    // Use logo.png from assets folder
    const iconPath = path.join(__dirname, 'assets', 'tray_icon.png');

    // Check if icon exists
    if (!fs.existsSync(iconPath)) {
      console.warn('Tray icon not found at:', iconPath);
      return;
    }

    // Destroy existing tray if it exists to prevent ghost icons
    if (tray) {
      console.log('Destroying existing tray before creating new one...');
      try {
        tray.destroy();
        tray = null;
      } catch (error) {
        console.error('Error destroying existing tray:', error);
      }
    }

    console.log('Creating new tray icon...');
    tray = new Tray(iconPath);

    tray.setToolTip('PingoAI');
    updateTrayContextMenu();

    // Double click to open window
    tray.on('double-click', () => {
      if (getCurrentAIMode() !== 'panel') {
        showOrCreateSettingsWindow();
        return;
      }

      if (chatWindow) {
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow();
      }
    });
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

// Setup auto-start dengan nama yang jelas
function setupAutoStart(enabled) {
  if (isWindows) {
    const AutoLaunch = require('auto-launch');

    const autoLauncher = new AutoLaunch({
      name: 'PingoAI',
      path: app.getPath('exe'),
      isHidden: true, // Launch hidden on startup
      args: ['--hidden'] // Add --hidden flag to detect auto-start
    });

    if (enabled) {
      autoLauncher.enable()
        .then(() => console.log('Auto-start enabled with --hidden flag'))
        .catch(err => console.error('Failed to enable auto-start:', err));
    } else {
      autoLauncher.disable()
        .then(() => console.log('Auto-start disabled'))
        .catch(err => console.error('Failed to disable auto-start:', err));
    }
  } else {
    // Untuk macOS/Linux, gunakan app.setLoginItemSettings
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true, // Launch hidden on startup
      args: ['--hidden'],
      name: 'PingoAI'
    });
  }
}

app.whenReady().then(() => {
  // Create system tray
  createTray();

  const currentAIMode = getCurrentAIMode();

  // Check if onboarding has been completed
  const onboardingCompleted = store.get('onboardingCompleted', false);

  // Get service settings
  const serviceSettings = store.get('serviceSettings', { runInBackground: true, autoStart: false });

  // Detect if this is an auto-start launch (Windows startup) or normal launch (user clicked icon)
  // Auto-start launches typically have --hidden flag or we can check wasOpenedAsHidden
  const isAutoStartLaunch = process.argv.includes('--hidden') || 
                            process.argv.includes('--autostart') ||
                            (isWindows && app.getLoginItemSettings().wasOpenedAsHidden);

  console.log('🚀 App launch mode:', isAutoStartLaunch ? 'AUTO-START (Windows Startup)' : 'NORMAL (User clicked icon)');
  console.log('🎯 Current AI Mode:', currentAIMode);

  if (!onboardingCompleted) {
    // Show onboarding window for first-time users
    createOnboardingWindow();
  } else {
    if (isAutoStartLaunch) {
      // AUTO-START LAUNCH (from Windows Startup):
      // Show glance-mode-startup.html for BOTH modes, panel chat hidden
      const startupHintSettings = store.get('startupHintSettings', { showHint: true });
      if (startupHintSettings.showHint) {
        createStartupHintWindow();
      }
      
      // For panel mode: create window but keep it hidden on startup
      if (currentAIMode === 'panel') {
        createChatWindow();
        if (chatWindow) {
          chatWindow.hide();
        }
      }
      // For glance mode: no chat window needed, just startup hint is shown (if enabled)
    } else {
      // NORMAL LAUNCH (user clicked icon in Start Menu):
      // Panel mode → show chat.html
      // Glance mode → show glance-mode-hint.html
      if (currentAIMode === 'panel') {
        createChatWindow();
        // Show the chat window immediately
        if (chatWindow) {
          chatWindow.show();
          chatWindow.focus();
        }
      } else {
        // Glance mode: show hint window
        const glanceHintSettings = store.get('glanceModeHintSettings', { showHint: true });
        if (glanceHintSettings.showHint) {
          createGlanceModeHintWindow();
        }
      }
    }
  }

  const initialWindowSettings = store.get('windowSettings', {});
  registerToggleShortcut(initialWindowSettings.toggleShortcut);
  registerSettingsShortcut(initialWindowSettings.settingsShortcut);
  registerBubbleShortcut(initialWindowSettings.bubbleShortcut);
  startClipboardWatcher();
  
  // Start HighlightWatcher for Ctrl+C detection and text selection (Windows only)
  startHighlightWatcher();

  // Setup auto-start dari saved settings
  if (typeof serviceSettings.autoStart === 'boolean') {
    setupAutoStart(serviceSettings.autoStart);
  }
});

app.on('window-all-closed', () => {
  const serviceSettings = store.get('serviceSettings', { runInBackground: true });
  const aiModeSettings = store.get('aiModeSettings', { mode: 'glance' });
  
  console.log('🔍 window-all-closed - serviceSettings:', JSON.stringify(serviceSettings));
  console.log('🔍 window-all-closed - aiModeSettings:', JSON.stringify(aiModeSettings));
  
  // Glance mode ALWAYS requires running in background
  const isGlanceMode = aiModeSettings.mode === 'glance';
  const shouldRunInBackground = serviceSettings.runInBackground || isGlanceMode;
  
  // Auto-fix: If Glance mode but runInBackground is false, fix the store
  if (isGlanceMode && !serviceSettings.runInBackground) {
    console.log('🔧 Auto-fixing: Setting runInBackground=true for Glance mode');
    store.set('serviceSettings', { ...serviceSettings, runInBackground: true });
  }
  
  if (shouldRunInBackground) {
    console.log('✅ Keeping app running in tray (runInBackground:', serviceSettings.runInBackground, ', isGlanceMode:', isGlanceMode, ')');
    // Keep running in tray
    return;
  }

  console.log('❌ Quitting app - runInBackground is false and not in Glance mode');
  app.isQuitting = true;
  app.quit();
});

// Cleanup before quit - more reliable than will-quit
app.on('before-quit', () => {
  console.log('App is quitting, cleaning up tray...');
  globalShortcut.unregisterAll();
  stopClipboardWatcher();
  stopHighlightWatcher();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('will-quit', () => {
  // Additional cleanup if before-quit didn't fire
  globalShortcut.unregisterAll();
  stopClipboardWatcher();
  stopHighlightWatcher();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Handle process termination signals to clean up tray icon
process.on('SIGINT', () => {
  console.log('Received SIGINT, cleaning up...');
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...');
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
});

// Handle uncaught exceptions to prevent ghost tray icons
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  if (tray) {
    tray.destroy();
    tray = null;
  }
  app.quit();
});

// Variables for glance mode action retry
let lastAction = null;
let lastParam = null;

// Check internet connectivity with 3-second timeout
async function checkInternetConnection() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Timeout after 3 seconds - slow connection
      resolve({ success: false, timeout: true });
    }, 3000);

    dns.lookup('google.com', (err) => {
      clearTimeout(timeout);
      if (err) {
        // DNS lookup failed - no connection
        resolve({ success: false, timeout: false });
      } else {
        // DNS lookup successful
        resolve({ success: true });
      }
    });
  });
}

// IPC Handlers
ipcMain.handle('get-settings', async () => {
  return {
    apiKey: store.get('apiKey', ''),
    apiUrl: store.get('apiUrl', 'https://api.openai.com/v1/chat/completions'),
    model: store.get('model', 'gpt-3.5-turbo'),
    darkMode: store.get('darkMode', false),
    windowSettings: store.get('windowSettings', {}),
    languageSettings: {
      ...DEFAULT_LANGUAGE_SETTINGS,
      ...(store.get('languageSettings') || {})
    },
    serviceSettings: store.get('serviceSettings', { runInBackground: true, autoStart: false }),
    aiModeSettings: store.get('aiModeSettings', { mode: 'glance' }),
    integration: store.get('integration', { type: 'custom' }),
    onboardingCompleted: store.get('onboardingCompleted', false)
  };
});

ipcMain.handle('save-settings', async (event, settings) => {
  store.set('apiKey', settings.apiKey);
  store.set('apiUrl', settings.apiUrl);
  if (settings.model) {
    store.set('model', settings.model);
  }
  if (typeof settings.darkMode === 'boolean') {
    store.set('darkMode', settings.darkMode);
  }
  if (settings.windowSettings) {
    store.set('windowSettings', settings.windowSettings);
  }
  if (settings.languageSettings) {
    const normalizedLanguage = {
      ...DEFAULT_LANGUAGE_SETTINGS,
      ...settings.languageSettings
    };
    store.set('languageSettings', normalizedLanguage);
  }
  if (settings.aiModeSettings && settings.aiModeSettings.mode) {
    const normalizedMode = settings.aiModeSettings.mode === 'panel' ? 'panel' : 'glance';
    store.set('aiModeSettings', { mode: normalizedMode });

    // Force runInBackground untuk Glance Mode
    if (normalizedMode === 'glance' && settings.serviceSettings) {
      settings.serviceSettings.runInBackground = true;
    }
  }
  if (settings.serviceSettings) {
    store.set('serviceSettings', settings.serviceSettings);

    // PERBAIKAN 2: Handle auto-start setting dengan setupAutoStart
    if (typeof settings.serviceSettings.autoStart === 'boolean') {
      setupAutoStart(settings.serviceSettings.autoStart);
    }
  }
  if (settings.integration) {
    store.set('integration', settings.integration);
  }
  return { success: true };
});

ipcMain.handle('apply-settings', async (event, settings) => {
  try {
    let appliedAIMode = null;
    // Apply dark mode
    if (typeof settings.darkMode === 'boolean') {
      store.set('darkMode', settings.darkMode);
      if (chatWindow) {
        chatWindow.webContents.send('apply-dark-mode', settings.darkMode);
      }
    }

    if (settings.aiModeSettings && settings.aiModeSettings.mode) {
      const normalizedMode = settings.aiModeSettings.mode === 'panel' ? 'panel' : 'glance';
      store.set('aiModeSettings', { mode: normalizedMode });
      appliedAIMode = normalizedMode;

      // Force runInBackground untuk Glance Mode
      if (normalizedMode === 'glance') {
        if (!settings.serviceSettings) {
          settings.serviceSettings = {};
        }
        settings.serviceSettings.runInBackground = true;
      }
    }

    if (settings.windowSettings) {
      const persistedWindowSettings = store.get('windowSettings', {});
      const ws = {
        ...persistedWindowSettings,
        ...settings.windowSettings
      };

      const handleShortcutFailure = (message) => {
        store.set('windowSettings', persistedWindowSettings);
        broadcastWindowSettings(persistedWindowSettings);
        return { success: false, error: message };
      };

      if (ws.toggleShortcut) {
        const registeredShortcut = registerToggleShortcut(ws.toggleShortcut);
        if (registeredShortcut) {
          ws.toggleShortcut = registeredShortcut;
        } else {
          return handleShortcutFailure('Failed to register toggle shortcut. Please choose another combination.');
        }
      }

      if (ws.settingsShortcut) {
        const registeredShortcut = registerSettingsShortcut(ws.settingsShortcut);
        if (registeredShortcut) {
          ws.settingsShortcut = registeredShortcut;
        } else {
          return handleShortcutFailure('Failed to register settings shortcut. Please choose another combination.');
        }
      }

      if (ws.bubbleShortcut) {
        const registeredShortcut = registerBubbleShortcut(ws.bubbleShortcut);
        if (registeredShortcut) {
          ws.bubbleShortcut = registeredShortcut;
        } else {
          return handleShortcutFailure('Failed to register bubble shortcut. Please choose another combination.');
        }
      }

      store.set('windowSettings', ws);

      if (chatWindow) {
        // Apply always on top
        if (typeof ws.alwaysOnTop === 'boolean') {
          chatWindow.setAlwaysOnTop(ws.alwaysOnTop);
        }

        // Apply transparent with custom opacity
        if (typeof ws.transparent === 'boolean') {
          const opacity = ws.transparent ? (ws.opacity || 0.95) : 1.0;
          chatWindow.setOpacity(opacity);
        }

        // Apply position and size
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        const size = ws.dockSize || 400;
        if (ws.dockPosition === 'right') {
          chatWindow.setBounds({ x: width - size, y: 0, width: size, height: height });
        } else if (ws.dockPosition === 'left') {
          chatWindow.setBounds({ x: 0, y: 0, width: size, height: height });
        } else if (ws.dockPosition === 'top') {
          chatWindow.setBounds({ x: 0, y: 0, width: width, height: size });
        } else if (ws.dockPosition === 'bottom') {
          chatWindow.setBounds({ x: 0, y: height - size, width: width, height: size });
        }
      }

      broadcastWindowSettings(ws);
    }

    if (settings.languageSettings) {
      const normalizedLanguage = {
        ...DEFAULT_LANGUAGE_SETTINGS,
        ...settings.languageSettings
      };
      store.set('languageSettings', normalizedLanguage);
      broadcastLanguageSettings(normalizedLanguage);
    }

    if (settings.serviceSettings) {
      store.set('serviceSettings', settings.serviceSettings);

      // PERBAIKAN 2: Handle auto-start setting dengan setupAutoStart
      if (typeof settings.serviceSettings.autoStart === 'boolean') {
        setupAutoStart(settings.serviceSettings.autoStart);
      }
    }

    if (appliedAIMode) {
      syncChatWindowWithAIMode(appliedAIMode);
    } else {
      updateTrayContextMenu();
    }

    return { success: true };
  } catch (error) {
    console.error('Error applying settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-ai-connection', async (event, { apiUrl, apiKey, model }) => {
  if (!apiKey || !apiUrl || !model) {
    return { success: false, error: 'Missing configuration fields' };
  }

  try {
    const axios = require('axios');
    // Test with a very simple, cheap request
    await axios.post(apiUrl, {
      model: model,
      messages: [
        { role: 'user', content: 'Hi' }
      ],
      max_tokens: 5
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    return { success: true };
  } catch (error) {
    console.error('Test connection error:', error.message);
    const errorMessage = error.response?.data?.error?.message || error.message || 'Connection failed';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('send-ai-message', async (event, { message, action, clearHistory, param }) => {
  const apiKey = store.get('apiKey');
  const apiUrl = store.get('apiUrl');
  const model = store.get('model', 'gpt-3.5-turbo');
  const languageSettings = store.get('languageSettings', DEFAULT_LANGUAGE_SETTINGS);
  const aiLanguage = languageSettings.aiLanguage || 'en';

  if (!apiKey) {
    return { error: 'API Key not configured. Please set it in settings.' };
  }

  const userInput = (message || '').toString().trim();
  if (!userInput) {
    const errorMsg = aiLanguage === 'id' ? 'Teks tidak boleh kosong.' : 'Text cannot be empty.';
    return { error: errorMsg };
  }

  // Clear history if requested (for new action-based requests)
  if (clearHistory) {
    conversationHistory = [];
  }

  // Generate action-specific prompt with HIGH PRIORITY RULES (same as glance mode)
  let processedMessage = userInput;
  
  if (action && action !== 'chat') {
    const wordCount = userInput.trim().split(/\s+/).length;
    const MIN_WORDS_FOR_SUMMARIZE = 15;
    const MIN_WORDS_FOR_BULLET_POINTS = 15;

    if (action === 'explain') {
      processedMessage = aiLanguage === 'id'
        ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah MENJELASKAN kata atau kalimat yang diberikan.
- Jelaskan makna/arti dari kata atau kalimat tersebut dengan bahasa yang jelas dan mudah dipahami
- Fokus pada pengertian inti dan makna utama
- Tambahkan konteks singkat jika diperlukan untuk pemahaman
- Jangan mengubah fakta dari teks asli
- Jawab dengan ringkas dan padat

Teks yang perlu dijelaskan:
${userInput}`
        : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to EXPLAIN the given word or sentence.
- Explain the meaning of the word or sentence in clear and easy-to-understand language
- Focus on the core definition and main meaning
- Add brief context if needed for understanding
- Do not change facts from the original text
- Answer concisely and clearly

Text to explain:
${userInput}`;
    } else if (action === 'summarize') {
      if (wordCount < MIN_WORDS_FOR_SUMMARIZE) {
        processedMessage = aiLanguage === 'id'
          ? `[INSTRUKSI WAJIB - TIDAK BOLEH DIABAIKAN]
Teks yang diberikan TERLALU PENDEK untuk diringkas (hanya ${wordCount} kata).
Kamu WAJIB menolak dan membalas HANYA dengan teks berikut, tanpa tambahan apapun:
"Kata-kata terlalu pendek, ambil lebih banyak kata untuk saya ringkas."

Teks: ${userInput}`
          : `[MANDATORY INSTRUCTION - CANNOT BE IGNORED]
The given text is TOO SHORT to summarize (only ${wordCount} words).
You MUST reject and reply ONLY with the following text, no additions:
"The text is too short, please select more text for me to summarize."

Text: ${userInput}`;
      } else {
        processedMessage = aiLanguage === 'id'
          ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah MERINGKAS teks panjang menjadi pendek dan mudah dimengerti.
- Ringkas teks ini menjadi versi yang lebih pendek tanpa menghilangkan inti informasi
- Gunakan bahasa yang mudah dipahami
- Jangan tambahkan informasi baru, hanya rangkum yang ada
- Hasil harus lebih pendek dari teks asli

Teks yang perlu diringkas:
${userInput}`
          : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to SUMMARIZE long text into a shorter, easy-to-understand version.
- Summarize this text into a shorter version without losing core information
- Use easy-to-understand language
- Do not add new information, only summarize what exists
- Result must be shorter than the original text

Text to summarize:
${userInput}`;
      }
    } else if (action === 'formalize') {
      processedMessage = aiLanguage === 'id'
        ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah membuat teks menjadi FORMAL.
- Ubah teks ini menjadi versi yang FORMAL dan profesional
- Gunakan bahasa baku dan sopan
- Perbaiki struktur kalimat agar lebih rapi
- Pilih kata-kata yang lebih formal dan profesional
- JANGAN ubah makna, hanya tingkatkan formalitas
- Hasil HARUS terdengar formal dan profesional

Teks yang perlu diformalkan:
${userInput}`
        : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to make the text FORMAL.
- Transform this text into a FORMAL and professional version
- Use proper and polite language
- Improve sentence structure to be more neat
- Choose more formal and professional words
- DO NOT change the meaning, only increase formality
- Result MUST sound formal and professional

Text to formalize:
${userInput}`;
    } else if (action === 'bullet-points') {
      if (wordCount < MIN_WORDS_FOR_BULLET_POINTS) {
        processedMessage = aiLanguage === 'id'
          ? `[INSTRUKSI WAJIB - TIDAK BOLEH DIABAIKAN]
Teks yang diberikan TERLALU PENDEK untuk dibuat poin (hanya ${wordCount} kata).
Kamu WAJIB menolak dan membalas HANYA dengan teks berikut, tanpa tambahan apapun:
"Kata-kata terlalu pendek, ambil lebih banyak kata untuk saya buat point."

Teks: ${userInput}`
          : `[MANDATORY INSTRUCTION - CANNOT BE IGNORED]
The given text is TOO SHORT to create bullet points (only ${wordCount} words).
You MUST reject and reply ONLY with the following text, no additions:
"The text is too short, please select more text for me to create bullet points."

Text: ${userInput}`;
      } else {
        processedMessage = aiLanguage === 'id'
          ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah membuat POIN-POIN dari teks.
- Ubah teks ini menjadi daftar poin yang terstruktur
- Langsung output poin per poin dari inti teks
- Pisahkan tiap ide utama menjadi bullet terpisah
- Gunakan bahasa yang padat dan ringkas
- Fokus pada informasi penting saja

Teks yang perlu dibuat poin:
${userInput}`
          : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to create BULLET POINTS from the text.
- Convert this text into a structured list of points
- Directly output point by point of the text's essence
- Separate each main idea into separate bullets
- Use concise and compact language
- Focus on important information only

Text to convert to bullet points:
${userInput}`;
      }
    } else if (action === 'translate') {
      processedMessage = aiLanguage === 'id'
        ? `Terjemahkan ke ${param || 'English'}: ${userInput}`
        : `Translate to ${param || 'English'}: ${userInput}`;
    } else if (action === 'custom') {
      processedMessage = `${param}: ${userInput}`;
    }
  }

  // Add processed message to history
  conversationHistory.push({ role: 'user', content: processedMessage });

  try {
    const axios = require('axios');
    const aiLanguage = languageSettings.aiLanguage || 'en';
    const systemPrompt = aiLanguage === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN;

    // Build messages array with system prompt and history
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory // History now includes the new user message
    ];

    let requestUrl = apiUrl;
    let requestHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    // Check integration type
    const integration = store.get('integration', { type: 'custom' }); // PINDAH KE SINI

    // TAMBAHAN BARU: Tentukan model berdasarkan limit untuk free integration
    let modelToUse = model;
    if (integration.type === 'free') {
      incrementRequestCount(); // Track request
      modelToUse = getModelForRequest(); // Dapatkan model (premium atau fallback)
      console.log(`🔢 Request count incremented. Using model: ${modelToUse}`);
    }
    // AKHIR TAMBAHAN

    let requestData = {
      model: modelToUse,
      messages: messages  // FIX: Gunakan 'messages' yang sudah di-build, bukan 'conversationHistory'
    };

    // Jika menggunakan 'free' integration (PHP Proxy)
    if (integration.type === 'free') {
      console.log('🚀 Using PHP Proxy for Free Integration');
      requestUrl = SERVER_URL;
      // Untuk PHP proxy, kita tidak butuh Bearer token di header client
      // karena token ada di server PHP.
      requestHeaders = {
        'Content-Type': 'application/json'
      };
      // Data tetap sama, server PHP yang akan meneruskan
    }

    // Call AI API
    const response = await axios.post(requestUrl, requestData, {
      headers: requestHeaders,
      timeout: 60000
    });

    // Handle response structure difference if any (PHP proxy should return same structure)
    const aiMessage = response.data.choices
      ? response.data.choices[0].message.content
      : response.data.message; // Fallback if PHP returns simplified JSON

    // Add AI response to history
    conversationHistory.push({ role: 'assistant', content: aiMessage });
    trimHistory();

    return {
      success: true,
      message: aiMessage
    };
  } catch (error) {
    console.error('AI API Error:', error);
    return {
      error: error.response?.data?.error?.message || error.message || 'Failed to connect to AI service'
    };
  }
});

ipcMain.handle('show-selection-bubble', async (event, bounds) => {
  createSelectionBubble(bounds);
  return { success: true };
});

ipcMain.handle('hide-selection-bubble', async (event, options = {}) => {
  const reason = options?.reason || 'default';

  if (reason === 'auto-hide') {
    suppressClipboardForAutoHide();
  } else {
    autoHideSuppressedTexts.clear();
  }

  if (selectionBubbleWindow) {
    selectionBubbleWindow.close();
  }

  // Jika ditutup karena memilih action, JANGAN reset lastClipboardText.
  // Ini mencegah clipboard watcher memicu bubble baru untuk teks yang sama saat glance window muncul.
  if (reason !== 'action-selected') {
    // Reset clipboard tracking so the same text can be used again (for manual close/auto-hide)
    lastClipboardText = '';
  }

  return { success: true };
});

ipcMain.handle('send-text-action', async (event, { action, param }) => {
  console.log('[IPC] send-text-action called');
  console.log('[IPC] selectedText length:', selectedText?.length);

  // Set flag to prevent clipboard watcher from re-triggering bubble
  isProcessingAction = true;

  // Check for duplicate text processing - REMOVED to allow repeated actions (e.g. translate to different languages)
  // We still track it but don't block
  const currentText = selectedText?.trim() || '';
  lastProcessedText = currentText;

  // PENTING: Hide selection bubble immediately for better UX
  if (selectionBubbleWindow) {
    console.log('[IPC] Hiding and closing bubble window...');
    selectionBubbleWindow.hide();
    selectionBubbleWindow.close(); // Close asynchronously
  }

  // Get AI mode setting
  const aiModeSettings = store.get('aiModeSettings', { mode: 'glance' });
  const aiMode = aiModeSettings.mode || 'glance';

  console.log('[IPC] AI Mode:', aiMode);

  if (aiMode === 'glance') {
    // GLANCE MODE: Show response in floating bubble

    // Calculate position for glance response (near cursor or center of selection bubble)
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { x: displayX, y: displayY, width: screenWidth, height: screenHeight } = currentDisplay.workArea;

    // Position to the right of cursor, or left if not enough space
    let responseX = cursorPoint.x + 20;
    let responseY = cursorPoint.y - 50;

    // Check if it fits on the right side
    if (responseX + GLANCE_RESPONSE_WIDTH > displayX + screenWidth) {
      responseX = cursorPoint.x - GLANCE_RESPONSE_WIDTH - 20;
    }

    // Check vertical bounds
    if (responseY < displayY) {
      responseY = displayY + 10;
    } else if (responseY + GLANCE_RESPONSE_MAX_HEIGHT > displayY + screenHeight) {
      responseY = displayY + screenHeight - GLANCE_RESPONSE_MAX_HEIGHT - 10;
    }

    console.log('[IPC] Creating glance response at:', { x: responseX, y: responseY });

    // Create glance response window
    createGlanceResponseWindow({ x: responseX, y: responseY });

    // Process AI request in background
    if (selectedText) {
      // Store last action for retry
      lastAction = action;
      lastParam = param;

      try {
        // Step 1: Check internet connectivity
        console.log('[Connectivity Check] Checking internet connection...');
        const connectivityResult = await checkInternetConnection();

        if (!connectivityResult.success) {
          console.log('[Connectivity Check] Failed:', connectivityResult.timeout ? 'timeout' : 'no connection');

          if (connectivityResult.timeout) {
            // Slow connection detected, notify frontend but continue
            if (glanceResponseWindow) {
              glanceResponseWindow.webContents.send('connectivity-slow');
            }
            console.log('[Connectivity Check] Slow connection detected, continuing with AI request...');
          } else {
            // No connection at all, stop and notify
            if (glanceResponseWindow) {
              glanceResponseWindow.webContents.send('connectivity-check-failed');
            }
            return { success: false, error: 'No internet connection' };
          }
        } else {
          console.log('[Connectivity Check] Connection OK');
        }

        // Build the AI message
        const apiKey = store.get('apiKey');
        const apiUrl = store.get('apiUrl');
        const model = store.get('model', 'gpt-3.5-turbo');
        const languageSettings = store.get('languageSettings', DEFAULT_LANGUAGE_SETTINGS);
        const aiLanguage = languageSettings.aiLanguage || 'en';

        if (!apiKey) {
          if (glanceResponseWindow) {
            glanceResponseWindow.webContents.send('glance-ai-response', {
              error: 'API Key not configured. Please set up your API key in Settings.',
              action: action
            });
          }
          return { success: false, error: 'No API key' };
        }

        // Build AI message based on action
        const axios = require('axios');
        const systemPrompt = aiLanguage === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN;

        // Generate action-specific prompt with HIGH PRIORITY RULES
        let userMessage = selectedText;

        // Check text length for actions that require longer text
        const wordCount = selectedText.trim().split(/\s+/).length;
        const MIN_WORDS_FOR_SUMMARIZE = 15;
        const MIN_WORDS_FOR_BULLET_POINTS = 15;

        if (action === 'explain') {
          // EXPLAIN: Menjelaskan kata atau kalimat yang diberikan
          userMessage = aiLanguage === 'id'
            ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah MENJELASKAN kata atau kalimat yang diberikan.
- Jelaskan makna/arti dari kata atau kalimat tersebut dengan bahasa yang jelas dan mudah dipahami
- Fokus pada pengertian inti dan makna utama
- Tambahkan konteks singkat jika diperlukan untuk pemahaman
- Jangan mengubah fakta dari teks asli
- Jawab dengan ringkas dan padat

Teks yang perlu dijelaskan:
${selectedText}`
            : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to EXPLAIN the given word or sentence.
- Explain the meaning of the word or sentence in clear and easy-to-understand language
- Focus on the core definition and main meaning
- Add brief context if needed for understanding
- Do not change facts from the original text
- Answer concisely and clearly

Text to explain:
${selectedText}`;
        } else if (action === 'summarize') {
          // SUMMARIZE: Meringkas teks panjang menjadi pendek dan mudah dimengerti
          // WAJIB TOLAK jika teks terlalu pendek
          if (wordCount < MIN_WORDS_FOR_SUMMARIZE) {
            userMessage = aiLanguage === 'id'
              ? `[INSTRUKSI WAJIB - TIDAK BOLEH DIABAIKAN]
Teks yang diberikan TERLALU PENDEK untuk diringkas (hanya ${wordCount} kata).
Kamu WAJIB menolak dan membalas HANYA dengan teks berikut, tanpa tambahan apapun:
"Kata-kata terlalu pendek, ambil lebih banyak kata untuk saya ringkas."

Teks: ${selectedText}`
              : `[MANDATORY INSTRUCTION - CANNOT BE IGNORED]
The given text is TOO SHORT to summarize (only ${wordCount} words).
You MUST reject and reply ONLY with the following text, no additions:
"The text is too short, please select more text for me to summarize."

Text: ${selectedText}`;
          } else {
            userMessage = aiLanguage === 'id'
              ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah MERINGKAS teks panjang menjadi pendek dan mudah dimengerti.
- Ringkas teks ini menjadi versi yang lebih pendek tanpa menghilangkan inti informasi
- Gunakan bahasa yang mudah dipahami
- Jangan tambahkan informasi baru, hanya rangkum yang ada
- Hasil harus lebih pendek dari teks asli

Teks yang perlu diringkas:
${selectedText}`
              : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to SUMMARIZE long text into a shorter, easy-to-understand version.
- Summarize this text into a shorter version without losing core information
- Use easy-to-understand language
- Do not add new information, only summarize what exists
- Result must be shorter than the original text

Text to summarize:
${selectedText}`;
          }
        } else if (action === 'formalize') {
          // FORMALIZE: Membuat formal kata-kata atau kalimat apapun, HARUS formal
          userMessage = aiLanguage === 'id'
            ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah membuat teks menjadi FORMAL.
- Ubah teks ini menjadi versi yang FORMAL dan profesional
- Gunakan bahasa baku dan sopan
- Perbaiki struktur kalimat agar lebih rapi
- Pilih kata-kata yang lebih formal dan profesional
- JANGAN ubah makna, hanya tingkatkan formalitas
- Hasil HARUS terdengar formal dan profesional

Teks yang perlu diformalkan:
${selectedText}`
            : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to make the text FORMAL.
- Transform this text into a FORMAL and professional version
- Use proper and polite language
- Improve sentence structure to be more neat
- Choose more formal and professional words
- DO NOT change the meaning, only increase formality
- Result MUST sound formal and professional

Text to formalize:
${selectedText}`;
        } else if (action === 'bullet-points') {
          // BULLET POINTS: Output langsung poin per poin inti dari teks
          // WAJIB TOLAK jika teks terlalu pendek
          if (wordCount < MIN_WORDS_FOR_BULLET_POINTS) {
            userMessage = aiLanguage === 'id'
              ? `[INSTRUKSI WAJIB - TIDAK BOLEH DIABAIKAN]
Teks yang diberikan TERLALU PENDEK untuk dibuat poin (hanya ${wordCount} kata).
Kamu WAJIB menolak dan membalas HANYA dengan teks berikut, tanpa tambahan apapun:
"Kata-kata terlalu pendek, ambil lebih banyak kata untuk saya buat point."

Teks: ${selectedText}`
              : `[MANDATORY INSTRUCTION - CANNOT BE IGNORED]
The given text is TOO SHORT to create bullet points (only ${wordCount} words).
You MUST reject and reply ONLY with the following text, no additions:
"The text is too short, please select more text for me to create bullet points."

Text: ${selectedText}`;
          } else {
            userMessage = aiLanguage === 'id'
              ? `[ATURAN PRIORITAS TINGGI]
Kamu adalah PingoAI. Tugasmu adalah membuat POIN-POIN dari teks.
- Ubah teks ini menjadi daftar poin yang terstruktur
- Langsung output poin per poin dari inti teks
- Pisahkan tiap ide utama menjadi bullet terpisah
- Gunakan bahasa yang padat dan ringkas
- Fokus pada informasi penting saja

Teks yang perlu dibuat poin:
${selectedText}`
              : `[HIGH PRIORITY RULES]
You are PingoAI. Your task is to create BULLET POINTS from the text.
- Convert this text into a structured list of points
- Directly output point by point of the text's essence
- Separate each main idea into separate bullets
- Use concise and compact language
- Focus on important information only

Text to convert to bullet points:
${selectedText}`;
          }
        } else if (action === 'translate') {
          userMessage = aiLanguage === 'id'
            ? `Terjemahkan ke ${param || 'English'}: ${selectedText}`
            : `Translate to ${param || 'English'}: ${selectedText}`;
        } else if (action === 'custom') {
          userMessage = `${param}: ${selectedText}`;
        }

        let requestUrl = apiUrl;
        let requestHeaders = {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        };

        // Check integration type
        const integration = store.get('integration', { type: 'custom' }); // PINDAHKAN KE SINI

        // TAMBAHAN BARU: Tentukan model berdasarkan limit untuk free integration
        let modelToUse = model;
        if (integration.type === 'free') {
          incrementRequestCount(); // Track request
          modelToUse = getModelForRequest(); // Dapatkan model (premium atau fallback)
          console.log(`🔢 Request count incremented. Using model: ${modelToUse}`);
        }
        // AKHIR TAMBAHAN

        let requestData = {
          model: modelToUse, // UBAH DARI 'model' MENJADI 'modelToUse'
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ]
        };

        // Jika menggunakan 'free' integration (PHP Proxy)
        if (integration.type === 'free') {
          console.log('🚀 Using PHP Proxy for Free Integration (Glance Mode)');
          requestUrl = SERVER_URL;
          requestHeaders = {
            'Content-Type': 'application/json'
          };
        }

        // Call AI API
        const response = await axios.post(requestUrl, requestData, {
          headers: requestHeaders,
          timeout: 60000
        });

        const aiMessage = response.data.choices[0].message.content;

        // Send response to glance window
        if (glanceResponseWindow) {
          glanceResponseWindow.webContents.send('glance-ai-response', {
            response: aiMessage,
            action: action
          });
        }

        return { success: true, mode: 'glance' };
      } catch (error) {
        console.error('AI API Error:', error);

        let errorMessage = error.response?.data?.error?.message || error.message || 'Failed to connect to AI service';
        let errorCode = 'ERR_UNKNOWN';

        // Detect network errors
        if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' || error.message.includes('Network Error')) {
          errorCode = 'ERR_NO_INTERNET';
          errorMessage = 'ERR_NO_INTERNET';
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
          // Timeout error
          errorCode = 'ERR_TIMEOUT';
          errorMessage = 'ERR_TIMEOUT';
        }

        if (glanceResponseWindow) {
          glanceResponseWindow.webContents.send('glance-ai-response', {
            error: errorMessage,
            errorCode: errorCode,
            action: action
          });
        }
        return { success: false, error: error.message };
      }
    }
  } else {
    // PANEL MODE: Open chat window (existing behavior)
    if (chatWindow) {
      chatWindow.setAlwaysOnTop(true);
      chatWindow.show();
      chatWindow.focus();
    } else {
      createChatWindow(true);
    }

    // Send the selected text with action to chat window
    if (chatWindow && selectedText) {
      console.log('[IPC] Sending to chat window, text length:', selectedText.length);
      chatWindow.webContents.send('process-selected-text', {
        text: selectedText,
        action: action,
        param: param
      });
    } else {
      console.log('[IPC] No chat window or no selected text');
    }

    return { success: true, mode: 'panel' };
  }
});

// Retry last glance action (called from glance-response.html retry button)
ipcMain.handle('retry-glance-action', async () => {
  if (!lastAction || !selectedText) {
    console.log('[IPC] retry-glance-action: No action or text to retry');
    return { success: false, error: 'No previous action to retry' };
  }

  console.log('[IPC] Retrying last glance action:', lastAction);

  // Re-trigger the connectivity check and AI processing
  // by simulating a send-text-action call
  try {
    // Check connectivity again
    console.log('[Connectivity Check] Checking internet connection...');
    const connectivityResult = await checkInternetConnection();

    if (!connectivityResult.success) {
      console.log('[Connectivity Check] Failed:', connectivityResult.timeout ? 'timeout' : 'no connection');

      if (connectivityResult.timeout) {
        // Slow connection detected, notify frontend but continue
        if (glanceResponseWindow) {
          glanceResponseWindow.webContents.send('connectivity-slow');
        }
        console.log('[Connectivity Check] Slow connection detected, continuing with AI request...');
      } else {
        // No connection at all, stop and notify
        if (glanceResponseWindow) {
          glanceResponseWindow.webContents.send('connectivity-check-failed');
        }
        return { success: false, error: 'No internet connection' };
      }
    } else {
      console.log('[Connectivity Check] Connection OK');
    }

    // Proceed with AI request (copy-paste logic from send-text-action)
    const apiKey = store.get('apiKey');
    const apiUrl = store.get('apiUrl');
    const model = store.get('model', 'gpt-3.5-turbo');
    const languageSettings = store.get('languageSettings', DEFAULT_LANGUAGE_SETTINGS);
    const aiLanguage = languageSettings.aiLanguage || 'en';

    if (!apiKey) {
      if (glanceResponseWindow) {
        glanceResponseWindow.webContents.send('glance-ai-response', {
          error: 'API Key not configured. Please set up your API key in Settings.',
          action: lastAction
        });
      }
      return { success: false, error: 'No API key' };
    }

    // Build AI message based on action
    const axios = require('axios');
    const systemPrompt = aiLanguage === 'id' ? SYSTEM_PROMPT_ID : SYSTEM_PROMPT_EN;

    // Generate action-specific prompt
    let userMessage = selectedText;

    if (lastAction === 'explain') {
      userMessage = aiLanguage === 'id'
        ? `Jelaskan isi teks ini dengan bahasa yang ringkas, jelas, dan mudah dipahami. Fokus ke makna utama, tambahkan konteks jika perlu, dan hindari mengubah fakta dari teks asli.\\n\\n${selectedText}`
        : `Explain the content of this text in concise, clear, and easy-to-understand language. Focus on the main meaning, add context if necessary, and avoid changing facts from the original text.\\n\\n${selectedText}`;
    } else if (lastAction === 'summarize') {
      userMessage = aiLanguage === 'id'
        ? `Ringkas teks ini menjadi poin-poin pentingnya tanpa menghilangkan inti informasi. Jangan tambahin info baru, cukup rangkum yang ada.\\n\\n${selectedText}`
        : `Summarize this text into key points without losing the core information. Do not add new info, just summarize what is there.\\n\\n${selectedText}`;
    } else if (lastAction === 'formalize') {
      userMessage = aiLanguage === 'id'
        ? `Ubah teks ini menjadi versi yang lebih formal, rapi, dan sesuai bahasa profesional. Jangan ubah makna, hanya tingkatkan struktur dan pilihan katanya.\\n\\n${selectedText}`
        : `Transform this text into a more formal, neat, and professional version. Do not change the meaning, only improve the structure and word choice.\\n\\n${selectedText}`;
    } else if (lastAction === 'bullet-points') {
      userMessage = aiLanguage === 'id'
        ? `Ubah teks ini menjadi daftar poin yang terstruktur. Pisahkan tiap ide utama, pakai bullet dan bahasa yang padat.\\n\\n${selectedText}`
        : `Convert this text into a structured list of points. Separate each main idea, use bullets and concise language.\\n\\n${selectedText}`;
    } else if (lastAction === 'translate') {
      userMessage = aiLanguage === 'id'
        ? `Terjemahkan ke ${lastParam || 'English'}: ${selectedText}`
        : `Translate to ${lastParam || 'English'}: ${selectedText}`;
    } else if (lastAction === 'custom') {
      userMessage = `${lastParam}: ${selectedText}`;
    }

    let requestUrl = apiUrl;
    let requestHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    let requestData = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ]
    };

    // Check integration type
    const integration = store.get('integration', { type: 'custom' });

    // Jika menggunakan 'free' integration (PHP Proxy)
    if (integration.type === 'free') {
      console.log('🚀 Using PHP Proxy for Free Integration (Glance Mode - Retry)');
      requestUrl = SERVER_URL;
      requestHeaders = {
        'Content-Type': 'application/json'
      };
    }

    // Call AI API
    const response = await axios.post(requestUrl, requestData, {
      headers: requestHeaders,
      timeout: 60000
    });

    const aiMessage = response.data.choices[0].message.content;

    // Send response to glance window
    if (glanceResponseWindow) {
      glanceResponseWindow.webContents.send('glance-ai-response', {
        response: aiMessage,
        action: lastAction
      });
    }

    return { success: true, mode: 'glance' };
  } catch (error) {
    console.error('AI API Error (Retry):', error);

    let errorMessage = error.response?.data?.error?.message || error.message || 'Failed to connect to AI service';
    let errorCode = 'ERR_UNKNOWN';

    // Detect network errors
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' || error.message.includes('Network Error')) {
      errorCode = 'ERR_NO_INTERNET';
      errorMessage = 'ERR_NO_INTERNET'; // Send code to frontend for localization
    }

    if (glanceResponseWindow) {
      glanceResponseWindow.webContents.send('glance-ai-response', {
        error: errorMessage,
        errorCode: errorCode,
        action: lastAction
      });
    }
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('open-settings', async () => {
  showOrCreateSettingsWindow();
  return { success: true };
});

ipcMain.handle('clear-conversation', async () => {
  conversationHistory = [];
  return { success: true };
});

ipcMain.handle('is-window-pinned', async () => {
  if (!chatWindow) {
    return { success: true, isPinned: false };
  }
  return { success: true, isPinned: chatWindow.isAlwaysOnTop() };
});

ipcMain.handle('get-window-state', async () => {
  const windowSettings = store.get('windowSettings', {});
  return {
    success: true,
    transparent: windowSettings.transparent || false,
    alwaysOnTop: chatWindow ? chatWindow.isAlwaysOnTop() : (windowSettings.alwaysOnTop || false),
    darkMode: store.get('darkMode', false),
    toggleShortcut: windowSettings.toggleShortcut || DEFAULT_TOGGLE_SHORTCUT,
    settingsShortcut: windowSettings.settingsShortcut || DEFAULT_SETTINGS_SHORTCUT,
    bubbleShortcut: windowSettings.bubbleShortcut || DEFAULT_BUBBLE_SHORTCUT
  };
});

ipcMain.handle('set-dark-mode', async (event, isDark) => {
  store.set('darkMode', isDark);
  return { success: true };
});

ipcMain.handle('toggle-transparent', async () => {
  if (!chatWindow) {
    return { success: false };
  }
  const windowSettings = store.get('windowSettings', {});
  const newTransparent = !windowSettings.transparent;
  windowSettings.transparent = newTransparent;
  store.set('windowSettings', windowSettings);
  const opacity = newTransparent ? (windowSettings.opacity || 0.95) : 1.0;
  chatWindow.setOpacity(opacity);
  return { success: true, transparent: newTransparent };
});

ipcMain.handle('show-chat-window', async (event, options = {}) => {
  if (getCurrentAIMode() !== 'panel') {
    return { success: false, error: 'Chat window is disabled in Glance Mode.' };
  }

  const alwaysOnTop = options.alwaysOnTop || false;

  if (chatWindow) {
    if (alwaysOnTop) {
      chatWindow.setAlwaysOnTop(true);
    }
    chatWindow.show();
    chatWindow.focus();
  } else {
    createChatWindow(alwaysOnTop);
  }
  return { success: true };
});

ipcMain.handle('hide-chat-window', async () => {
  if (chatWindow) {
    chatWindow.hide();
  }
  return { success: true };
});

ipcMain.handle('close-chat-window', async () => {
  const serviceSettings = store.get('serviceSettings', { runInBackground: true, autoStart: false });
  if (serviceSettings.runInBackground) {
    if (chatWindow) {
      chatWindow.hide();
    }
    return { success: true, action: 'hide' };
  }

  app.isQuitting = true;
  if (chatWindow) {
    chatWindow.close();
  } else {
    app.quit();
  }
  return { success: true, action: 'quit' };
});

ipcMain.handle('minimize-chat-window', async () => {
  if (chatWindow) {
    chatWindow.minimize();
  }
  return { success: true };
});

ipcMain.handle('close-settings-window', async () => {
  if (settingsWindow) {
    settingsWindow.close();
    return { success: true };
  }
  return { success: false, error: 'Settings window not open' };
});

// Close glance mode hint window
ipcMain.handle('close-glance-hint', async () => {
  if (glanceModeHintWindow) {
    glanceModeHintWindow.close();
    return { success: true };
  }
  return { success: false };
});

// Save glance hint preference
ipcMain.handle('save-glance-hint-preference', async (event, showHint) => {
  try {
    store.set('glanceModeHintSettings.showHint', showHint);
    return { success: true };
  } catch (error) {
    console.error('Error saving glance hint preference:', error);
    return { success: false, error: error.message };
  }
});

// Close startup hint window
ipcMain.handle('close-startup-hint', async () => {
  if (startupHintWindow) {
    startupHintWindow.close();
    return { success: true };
  }
  return { success: false };
});

// Save startup hint preference
ipcMain.handle('save-startup-hint-preference', async (event, showHint) => {
  try {
    store.set('startupHintSettings.showHint', showHint);
    return { success: true };
  } catch (error) {
    console.error('Error saving startup hint preference:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('toggle-pin-window', async () => {
  if (chatWindow) {
    const isPinned = chatWindow.isAlwaysOnTop();
    chatWindow.setAlwaysOnTop(!isPinned);
    const windowSettings = store.get('windowSettings', {});
    windowSettings.alwaysOnTop = !isPinned;
    store.set('windowSettings', windowSettings);
    broadcastWindowSettings(windowSettings);
    return { success: true, isPinned: !isPinned };
  }
  return { success: false, isPinned: false };
});

ipcMain.handle('get-selected-text', async () => {
  // This will be called from bubble window
  return { text: '' };
});

ipcMain.handle('set-window-opacity', async (event, opacity) => {
  // Get the window that sent the request
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    const validOpacity = Math.min(1.0, Math.max(0.3, opacity));
    senderWindow.setOpacity(validOpacity);
    return { success: true, opacity: validOpacity };
  }
  return { success: false, error: 'Window not found' };
});

ipcMain.handle('get-free-integration-defaults', async () => {
  return {
    success: true,
    defaults: {
      apiKey: 'free-tier', // Dummy value
      apiUrl: SERVER_URL,
      model: 'openai/gpt-oss-120b' // Default Groq model
    }
  };
});

// Request limit stats handler
ipcMain.handle('get-request-stats', async () => {
  const limitData = getRequestLimitData();
  const used = limitData.count || 0;
  const remaining = Math.max(0, 100 - used);
  const isPremium = used < 100;
  const currentModel = isPremium ? 'openai/gpt-oss-120b' : 'llama-3.1-8b-instant';
  
  return {
    success: true,
    used: used,
    remaining: remaining,
    total: 100,
    isPremium: isPremium,
    currentModel: currentModel,
    lastUpdate: limitData.lastUpdate
  };
});

// Onboarding IPC Handlers
ipcMain.handle('complete-onboarding', async (event, config) => {
  try {
    // const freeDefaults = loadFreeIntegrationDefaults(); // REMOVED

    // Persist onboarding settings
    const settings = {};

    // Language settings
    settings.languageSettings = {
      interfaceLanguage: config.language || 'en',
      aiLanguage: config.language || 'en'
    };

    // Theme settings
    if (config.theme === 'dark') {
      settings.darkMode = true;
    } else if (config.theme === 'light') {
      settings.darkMode = false;
    }
    // system theme: don't set darkMode, let it be handled by OS

    // Integration settings
    if (config.integration === 'free') {
      settings.apiUrl = SERVER_URL;
      settings.apiKey = 'free-tier';
      settings.model = 'openai/gpt-oss-120b'; // Default Groq model
      store.set('integration', { type: 'free' });
    } else if (config.integration === 'custom' && config.customApi) {
      // Custom: save user's custom API settings
      settings.apiUrl = config.customApi.url;
      settings.apiKey = config.customApi.key;
      settings.model = config.customApi.model;
      store.set('integration', {
        type: 'custom',
        url: config.customApi.url,
        model: config.customApi.model
      });
    } else {
      // Custom without data: user will fill in settings later
      store.set('integration', { type: 'custom' });
    }

    // AI Mode settings (Default: panel)
    if (config.aiMode) {
      store.set('aiModeSettings', { mode: config.aiMode });
    }

    // Service settings - TAMBAHAN: Selalu set default run in background
    const currentServiceSettings = store.get('serviceSettings', { runInBackground: true, autoStart: false });
    if (config.aiMode === 'glance') {
      // Force runInBackground untuk Glance Mode
      store.set('serviceSettings', { ...currentServiceSettings, runInBackground: true, autoStart: false });
    } else if (config.runInBackground !== undefined) {
      store.set('serviceSettings', { ...currentServiceSettings, runInBackground: config.runInBackground });
    } else {
      // Set default jika tidak ada config
      store.set('serviceSettings', { runInBackground: true, autoStart: false });
    }

    // Save all settings
    store.set('languageSettings', settings.languageSettings);
    if (typeof settings.darkMode === 'boolean') {
      store.set('darkMode', settings.darkMode);
    }
    if (settings.apiUrl) store.set('apiUrl', settings.apiUrl);
    if (settings.apiKey) store.set('apiKey', settings.apiKey);
    if (settings.model) store.set('model', settings.model);

    // Mark onboarding as completed
    store.set('onboardingCompleted', true);

    // Close onboarding window
    if (onboardingWindow) {
      onboardingWindow.close();
      onboardingWindow = null;
    }

    // Ensure UI matches latest AI mode preference
    syncChatWindowWithAIMode();

    // Now enable clipboard watcher and bubble features
    const initialWindowSettings = store.get('windowSettings', {});
    registerBubbleShortcut(initialWindowSettings.bubbleShortcut);
    startClipboardWatcher();
    startHighlightWatcher();
    console.log('✅ Onboarding completed - Bubble AI features enabled');

    return { success: true };
  } catch (error) {
    console.error('Error completing onboarding:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('cancel-onboarding', () => {
  if (onboardingWindow) {
    onboardingWindow.close();
    onboardingWindow = null;
  }
  // Quit app if onboarding is cancelled
  app.quit();
});

ipcMain.on('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.minimize();
  }
});

ipcMain.handle('close-glance-response', async () => {
  if (glanceResponseWindow) {
    glanceResponseWindow.close();
  }
  return { success: true };
});

ipcMain.handle('glance-response-back', async () => {
  // Close glance response window
  if (glanceResponseWindow) {
    glanceResponseWindow.close();
  }

  // PENTING: Close selection bubble juga
  if (selectionBubbleWindow) {
    selectionBubbleWindow.close();
  }

  let reusableText = selectedText;
  if (!reusableText || reusableText.trim().length < MIN_CLIPBOARD_TEXT_LENGTH) {
    try {
      reusableText = clipboard.readText();
    } catch (error) {
      console.error('Failed to read clipboard for glance-response-back:', error);
      reusableText = '';
    }
  }

  if (reusableText && reusableText.trim().length >= MIN_CLIPBOARD_TEXT_LENGTH) {
    // Delay pembukaan bubble agar window sebelumnya sudah fully closed
    setTimeout(() => {
      revealBubbleWithText(reusableText, null, lastBubbleBounds, { autoOpenMenu: true, disableAutoHide: true });
    }, 100);
    return { success: true, reopened: true };
  }

  return { success: true, reopened: false };
});

ipcMain.handle('resize-glance-response', async (event, height) => {
  if (!glanceResponseWindow) return;

  const bounds = glanceResponseWindow.getBounds();
  // Ensure height is a valid number and at least 100px (header + some content)
  const safeHeight = Number.isFinite(height) ? Math.max(100, height) : 100;
  const newHeight = Math.min(safeHeight, GLANCE_RESPONSE_MAX_HEIGHT);

  // Only resize if height changed significantly to avoid jitter
  if (Math.abs(bounds.height - newHeight) > 2) {
    glanceResponseWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: newHeight
    });
  }
});

ipcMain.handle('preview-panel-size', async (event, { size, position }) => {
  if (!chatWindow) {
    return { success: false, error: 'Chat window not found' };
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const dockSize = Math.min(600, Math.max(300, size));
  const dockPosition = position || 'right';

  let x, y, windowWidth, windowHeight;
  if (dockPosition === 'right') {
    x = width - dockSize;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  } else if (dockPosition === 'left') {
    x = 0;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  } else if (dockPosition === 'top') {
    x = 0;
    y = 0;
    windowWidth = width;
    windowHeight = dockSize;
  } else if (dockPosition === 'bottom') {
    x = 0;
    y = height - dockSize;
    windowWidth = width;
    windowHeight = dockSize;
  }

  chatWindow.setBounds({ x, y, width: windowWidth, height: windowHeight }, true);
  return { success: true };
});

ipcMain.handle('restore-panel-size', async () => {
  if (!chatWindow) {
    return { success: false, error: 'Chat window not found' };
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowSettings = store.get('windowSettings', {});
  const dockPosition = windowSettings.dockPosition || 'right';
  const dockSize = windowSettings.dockSize || 400;

  let x, y, windowWidth, windowHeight;
  if (dockPosition === 'right') {
    x = width - dockSize;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  } else if (dockPosition === 'left') {
    x = 0;
    y = 0;
    windowWidth = dockSize;
    windowHeight = height;
  } else if (dockPosition === 'top') {
    x = 0;
    y = 0;
    windowWidth = width;
    windowHeight = dockSize;
  } else if (dockPosition === 'bottom') {
    x = 0;
    y = height - dockSize;
    windowWidth = width;
    windowHeight = dockSize;
  }

  chatWindow.setBounds({ x, y, width: windowWidth, height: windowHeight }, true);
  return { success: true };
});

ipcMain.handle('set-window-blur', async (event, { enabled, intensity }) => {
  // Get the window that sent the request
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow) {
    try {
      if (enabled) {
        // For preview on settings window, we need transparent background
        // Note: Full blur effect requires window recreation
        if (process.platform === 'win32') {
          try {
            senderWindow.setBackgroundMaterial('acrylic');
          } catch (e) {
            console.log('Acrylic not supported, using mica');
            senderWindow.setBackgroundMaterial('mica');
          }
        } else if (process.platform === 'darwin') {
          senderWindow.setVibrancy('under-window');
        }
      } else {
        if (process.platform === 'win32') {
          senderWindow.setBackgroundMaterial('none');
        } else if (process.platform === 'darwin') {
          senderWindow.setVibrancy(null);
        }
      }
      return { success: true, enabled, intensity };
    } catch (error) {
      console.error('Error setting blur:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, error: 'Window not found' };
});
