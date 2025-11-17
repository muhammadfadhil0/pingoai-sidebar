# PingoAI - AI Assistant for Windows

AI Integration untuk Desktop yang terinspirasi dari fitur AI di Deepin OS. PingoAI menyediakan akses mudah ke AI assistant langsung dari desktop Windows Anda.

## ✨ Fitur

- 🤖 **Chat AI Always-on-Top** - Jendela chat yang selalu di atas dengan posisi di sisi kanan layar
- 🪟 **Window Management Fleksibel** - Docked/Floating mode, auto-hide, serta panel width & position yang bisa diatur
- 🔍 **Text Selection Bubble** - Bubble AI muncul otomatis setelah Anda highlight & copy text
- 📝 **Quick Actions** - Ringkaskan, Buat Formal, dan Buat Point untuk text yang di-highlight
- 💬 **Conversation Memory** - AI mengingat percakapan sebelumnya untuk konteks yang lebih baik
- 🎨 **Markdown Support** - Respons AI ditampilkan dengan format yang rapi (bold, list, code, dll)
- ⚙️ **Konfigurasi Fleksibel** - Gunakan API key dan URL Anda sendiri
- ⌨️ **Keyboard Shortcuts** - Akses cepat dengan shortcut
- 💾 **Secure Storage** - API key tersimpan aman di komputer Anda

## 🚀 Cara Menjalankan

### Development Mode

```bash
npm start
```

atau

```bash
npm run dev
```

### Build untuk Production

```bash
npm run build
```

Hasil build akan tersedia di folder `dist/`.

## ⌨️ Keyboard Shortcuts

- `Ctrl+Alt+A` (default, bisa diganti) - Toggle chat window (show/hide)
- `Ctrl+Shift+S` - Buka settings
- `Ctrl+Shift+X` - (Opsional) munculkan bubble icon secara manual

## 📖 Cara Menggunakan Text Selection

1. **Highlight text** di aplikasi apapun (browser, Word, PDF, Notepad, dll)
2. **Copy text** dengan `Ctrl+C` atau klik kanan → Copy
3. Bubble icon AI akan muncul otomatis di dekat kursor (atau tekan **`Ctrl+Shift+X`** jika ingin memunculkannya secara manual)
4. **Klik bubble icon** untuk melihat menu pilihan:
   - 🔍 **Ringkaskan** - Meringkas text yang dipilih
   - 📝 **Buat Formal** - Mengubah text menjadi bahasa formal/profesional
   - 📋 **Buat Point** - Mengubah text menjadi poin-poin ringkas
5. Pilih salah satu opsi, dan **chat window akan muncul di sebelah kanan** dengan hasil pemrosesan AI

> Jika toggle highlight-only aktif di Settings, langkah copy (`Ctrl+C`) bisa dilewati—bubble langsung muncul begitu teks di-highlight.

## 🛠️ Setup

### 1. Install Dependencies

Sudah terinstall:
- electron
- electron-builder
- axios
- electron-store
- (Opsional) .NET 8 SDK — dibutuhkan bila ingin bubble muncul hanya dengan highlight tanpa copy

### 2. Konfigurasi API

1. Tekan `Ctrl+Shift+S` atau klik ikon settings di chat window
2. Masukkan API URL dan API Key Anda
3. Pilih preset untuk:
   - **OpenAI** - `https://api.openai.com/v1/chat/completions`
   - **Anthropic** - `https://api.anthropic.com/v1/messages`
   - **Ollama** (Local) - `http://localhost:11434/api/chat`
4. Klik "Test Connection" untuk memastikan konfigurasi benar
5. Klik "Save Settings"

### 3. Cara Menggunakan

#### Chat Window
- Chat window muncul otomatis saat aplikasi dijalankan
- Pilih Docked Mode (panel nempel di sisi layar) atau Floating Mode (bebas digeser, semi-transparan) dari Settings → bagian Window Management
- Ketik pesan Anda dan tekan Enter atau klik Send
- Gunakan shortcut toggle (default `Ctrl+Alt+A`, bisa diubah di Settings) untuk show/hide

#### Text Selection Bubble
Gunakan fitur ini untuk memproses text yang baru saja Anda copy:
1. Highlight text di aplikasi manapun
2. Salin dengan `Ctrl+C`
3. Bubble AI akan muncul otomatis di dekat kursor
4. Hover/klik untuk memilih aksi: Summarize, Translate, Chat

### 4. Highlight tanpa copy (opsional)
Bila Anda ingin bubble muncul hanya dengan highlight (tanpa `Ctrl+C`):
1. Pastikan menggunakan Windows dan sudah memasang .NET 8 SDK.
2. Build watcher native:

```bash
npm run watcher:build
```

3. Buka Settings → bagian **Text Selection Bubble** lalu aktifkan toggle "Munculkan bubble otomatis saat teks di-highlight".
4. Restart aplikasi bila diminta. Mulai sekarang bubble akan muncul ketika Anda highlight teks, dan shortcut `Ctrl+Shift+X` tetap tersedia sebagai fallback.

## 📁 Struktur Project

```
pingoai/
├── main.js                      # Main process Electron
├── package.json
├── assets/                      # Icon dan assets
├── src/
│   ├── preload/
│   │   ├── chat-preload.js      # Preload untuk chat window
│   │   ├── settings-preload.js  # Preload untuk settings
│   │   └── bubble-preload.js    # Preload untuk bubble
│   └── renderer/
│       ├── chat.html            # UI Chat window
│       ├── settings.html        # UI Settings
│       └── bubble.html          # UI Bubble AI
└── dist/                        # Build output (setelah build)
```

## 🔧 Teknologi

- **Electron** - Framework untuk desktop app
- **Axios** - HTTP client untuk API calls
- **Electron Store** - Penyimpanan lokal yang aman
- **Electron Builder** - Build dan packaging

## 📝 API yang Didukung

PingoAI mendukung berbagai AI API yang kompatibel dengan format OpenAI:

- ✅ OpenAI (GPT-3.5, GPT-4)
- ✅ Anthropic Claude
- ✅ Ollama (Local LLM)
- ✅ API lain yang kompatibel dengan OpenAI format

## 🎨 Customization

### Window Management

Kelola perilaku panel langsung dari Settings → **Window Management**:

1. Tekan `Ctrl+Shift+S` atau klik ikon roda gigi.
2. Pilih mode:
    - **Docked Mode** – Panel menempel pada sisi layar (Left/Right/Top/Bottom) dan lebar/tingginya diatur oleh slider 300-600px.
    - **Floating Mode** – Jendela bisa digeser bebas, semi-transparan, dan selalu on top.
3. Aktifkan **Auto-hide** bila ingin panel otomatis bersembunyi ketika tidak fokus.
4. Atur **Panel Position** serta **Panel Size** sesuai kebutuhan.
5. Klik **Change** pada bagian **Keyboard Shortcut** untuk merekam kombinasi baru (misal `Ctrl+Alt+Space`) guna toggle panel.

### Mengubah Tema

Edit CSS di file HTML di folder `src/renderer/`.

## 🐛 Troubleshooting

### Chat tidak merespon?
- Pastikan API key sudah diset di settings
- Cek API URL sudah benar
- Gunakan "Test Connection" di settings

### Bubble tidak muncul?
- Pastikan teks sudah disalin (Ctrl+C) dan memiliki minimal beberapa karakter
- Bubble otomatis tidak tampil saat jendela PingoAI sedang fokus; gunakan `Ctrl+Shift+X` bila perlu
- Cek apakah antivirus/permission membatasi akses clipboard

### Error saat build?
- Pastikan semua dependencies terinstall: `npm install`
- Cek Node.js version (recommended: v18+)

## 📄 License

ISC

## 👤 Author

Muhammad Fadhil

---

**Note:** Project ini masih dalam tahap development. Integrasi highlight tanpa proses copy dan hook global tingkat OS masih dalam eksplorasi.
