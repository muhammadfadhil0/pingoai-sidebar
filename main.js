const { app, BrowserWindow, ipcMain, globalShortcut, screen, clipboard } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store').default;

const store = new Store();
const isWindows = process.platform === 'win32';

let chatWindow = null;
let settingsWindow = null;
let selectionBubbleWindow = null;
let selectedText = '';
let conversationHistory = [];

const BUBBLE_WINDOW_WIDTH = 250;
const BUBBLE_WINDOW_HEIGHT = 360;
const MAX_HISTORY_LENGTH = 20;
const DEFAULT_TOGGLE_SHORTCUT = 'CommandOrControl+Alt+A';
const DEFAULT_SETTINGS_SHORTCUT = 'CommandOrControl+Shift+S';
const DEFAULT_BUBBLE_SHORTCUT = 'CommandOrControl+Shift+X';
const SYSTEM_PROMPT = `You are PingoAI. Jawab hanya hal yang diminta pengguna secara singkat (maksimal tiga kalimat/100 kata) dan jangan melebar. Definisi cukup berupa pengertian inti, tanpa daftar gejala atau fakta tambahan kecuali diminta. Gunakan Bahasa Indonesia secara default, kecuali saat pengguna jelas meminta bahasa lain atau memilih aksi terjemahan. Untuk perintah terjemahan, balas hanya dengan teks hasil terjemahan.`;
const DEFAULT_LANGUAGE_SETTINGS = {
  interfaceLanguage: 'en',
  aiLanguage: 'en'
};
const CLIPBOARD_POLL_INTERVAL = 400;
const MIN_CLIPBOARD_TEXT_LENGTH = 3;
const AUTO_BUBBLE_DEBOUNCE_MS = 900;

let clipboardWatcherInterval = null;
let lastClipboardText = '';
let lastBubbleTimestamp = 0;

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

  const posX = displayX + Math.min(
    Math.max(0, relativeX - Math.floor(BUBBLE_WINDOW_WIDTH / 2)),
    screenWidth - BUBBLE_WINDOW_WIDTH
  );
  const posY = displayY + Math.min(
    Math.max(0, relativeY - 80),
    screenHeight - BUBBLE_WINDOW_HEIGHT
  );

  return { x: posX, y: posY };
}

function revealBubbleWithText(rawText, preferredPoint = null) {
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
  
  const bounds = calculateBubbleBounds(preferredPoint);
  createSelectionBubble(bounds);
  lastBubbleTimestamp = Date.now();
  return true;
}

function toggleChatWindowVisibility() {
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
  try {
    const text = clipboard.readText();
    revealBubbleWithText(text);
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/chat-preload.js')
    }
  });

  chatWindow.loadFile('src/renderer/chat.html');
  
  chatWindow.on('closed', () => {
    chatWindow = null;
  });

  return chatWindow;
}

// Create settings window
function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 650,
    frame: true,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/settings-preload.js')
    }
  });

  settingsWindow.setMenu(null);
  settingsWindow.loadFile('src/renderer/settings.html');
  
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  return settingsWindow;
}

// Create selection bubble window (appears when text is selected)
function createSelectionBubble(bounds) {
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/preload/bubble-preload.js')
    }
  });

  selectionBubbleWindow.loadFile('src/renderer/bubble.html');
  
  selectionBubbleWindow.on('blur', () => {
    if (selectionBubbleWindow) {
      selectionBubbleWindow.close();
    }
  });

  selectionBubbleWindow.on('closed', () => {
    selectionBubbleWindow = null;
  });

  return selectionBubbleWindow;
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

function maybeShowBubbleFromClipboard(text) {
  if (shouldSkipAutoBubble()) {
    return;
  }

  const now = Date.now();
  if (now - lastBubbleTimestamp < AUTO_BUBBLE_DEBOUNCE_MS) {
    return;
  }

  revealBubbleWithText(text);
}

function startClipboardWatcher() {
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
      if (currentText === lastClipboardText) {
        return;
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

app.whenReady().then(() => {
  // Create chat window on startup
  createChatWindow();

  const initialWindowSettings = store.get('windowSettings', {});
  registerToggleShortcut(initialWindowSettings.toggleShortcut);
  registerSettingsShortcut(initialWindowSettings.settingsShortcut);
  registerBubbleShortcut(initialWindowSettings.bubbleShortcut);
  startClipboardWatcher();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopClipboardWatcher();
});

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
    }
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
  return { success: true };
});

ipcMain.handle('apply-settings', async (event, settings) => {
  try {
    // Apply dark mode
    if (typeof settings.darkMode === 'boolean') {
      store.set('darkMode', settings.darkMode);
      if (chatWindow) {
        chatWindow.webContents.send('apply-dark-mode', settings.darkMode);
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

    return { success: true };
  } catch (error) {
    console.error('Error applying settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('send-ai-message', async (event, { message, action, clearHistory, param }) => {
  const apiKey = store.get('apiKey');
  const apiUrl = store.get('apiUrl');
  const model = store.get('model', 'gpt-3.5-turbo');

  if (!apiKey) {
    return { error: 'API Key not configured. Please set it in settings.' };
  }

  const userInput = (message || '').toString().trim();
  if (!userInput) {
    return { error: 'Teks tidak boleh kosong.' };
  }

  // Clear history if requested (for new action-based requests)
  if (clearHistory) {
    conversationHistory = [];
  }

  try {
    const axios = require('axios');
    
    let prompt = userInput;
    let shouldClearHistory = false;
    
    if (action === 'explain') {
      prompt = `Berikan definisi singkat (maksimal dua kalimat) untuk istilah berikut tanpa menjabarkan gejala atau informasi tambahan:\n\n${userInput}`;
      shouldClearHistory = true;
      
      // When triggered from text selection, show chat window on top
      if (chatWindow) {
        chatWindow.setAlwaysOnTop(true);
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow(true);
      }
    } else if (action === 'summarize') {
      prompt = `Ringkas teks berikut menjadi paling banyak empat kalimat atau lima bullet point yang langsung ke inti:\n\n${userInput}`;
      shouldClearHistory = true;
      
      // When triggered from text selection, show chat window on top
      if (chatWindow) {
        chatWindow.setAlwaysOnTop(true);
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow(true);
      }
    } else if (action === 'formalize') {
      prompt = `Ubah teks berikut menjadi Bahasa Indonesia formal yang ringkas dan profesional:\n\n${userInput}`;
      shouldClearHistory = true;
      
      // When triggered from text selection, show chat window on top
      if (chatWindow) {
        chatWindow.setAlwaysOnTop(true);
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow(true);
      }
    } else if (action === 'bullet-points') {
      prompt = `Ubah teks berikut menjadi bullet point singkat (maksimal enam poin) dengan kalimat tidak lebih dari 20 kata:\n\n${userInput}`;
      shouldClearHistory = true;
      
      // When triggered from text selection, show chat window on top
      if (chatWindow) {
        chatWindow.setAlwaysOnTop(true);
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow(true);
      }
    } else if (action === 'translate') {
      const targetLang = param || 'English';
      prompt = `Translate the following text to ${targetLang}. Respond with the translation only, without explanations, the original text, or quotes:\n\n${userInput}`;
      shouldClearHistory = true;
      
      // When triggered from text selection, show chat window on top
      if (chatWindow) {
        chatWindow.setAlwaysOnTop(true);
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow(true);
      }
    } else if (action === 'custom') {
      const customPrompt = param || 'Process this text concisely';
      prompt = `${customPrompt}:\n\n${userInput}`;
      shouldClearHistory = true;
      
      // When triggered from text selection, show chat window on top
      if (chatWindow) {
        chatWindow.setAlwaysOnTop(true);
        chatWindow.show();
        chatWindow.focus();
      } else {
        createChatWindow(true);
      }
    }

    // Clear history for action-based requests
    if (shouldClearHistory) {
      conversationHistory = [];
    }

    // Add user message to history
    conversationHistory.push({ role: 'user', content: prompt });
    trimHistory();

    const response = await axios.post(apiUrl, {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversationHistory
      ],
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const aiMessage = response.data.choices[0].message.content;
    
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

ipcMain.handle('hide-selection-bubble', async () => {
  if (selectionBubbleWindow) {
    selectionBubbleWindow.close();
  }
  return { success: true };
});

ipcMain.handle('send-text-action', async (event, { action, param }) => {
  console.log('[IPC] send-text-action called');
  console.log('[IPC] selectedText length:', selectedText?.length);
  console.log('[IPC] selectedText preview:', selectedText?.substring(0, 100));
  
  // Show chat window
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
      text: selectedText,  // PASTIKAN INI KIRIM FULL TEXT
      action: action,
      param: param
    });
  } else {
    console.log('[IPC] No chat window or no selected text');
  }
  
  return { success: true };
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

ipcMain.handle('minimize-chat-window', async () => {
  if (chatWindow) {
    chatWindow.minimize();
  }
  return { success: true };
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
