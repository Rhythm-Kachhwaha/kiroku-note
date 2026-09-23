# Kiroku Note 

> **A fast, local-first Japanese vocabulary & sentence mining companion.**  
> See a word → capture context & audio/screenshot → enrich with Yomitan → edit in side panel → save locally in SQLite → sync cleanly to Anki in under 10 seconds.

---

## ⚡ Quick Start & Installation Guide (Beginner-Friendly)

Even if you have never used Python, a terminal, or built an extension before, you can set up Kiroku Note in just a few minutes!

```
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│   Web Browser   │ ────> │  Kiroku Note Tray    │ ────> │      Anki       │
│ (MV3 SidePanel) │ :21828│ (Local SQLite + API) │ :8765 │  (AnkiConnect)  │
└─────────────────┘       └──────────────────────┘       └─────────────────┘
         │                           │
         v                           v
  Yomitan (:19633)          Optional OCR (:21829)
```

---

### Step 1: Download & Install Kiroku Note (Windows)

1. Go to the [**Kiroku Note Releases Page**](https://github.com/Rhythm-Kachhwaha/kiroku-note/releases).
2. Download **`Kiroku-Note-Setup-v1.0.0.exe`**.
3. Double-click the installer file to run it.
   > 💡 **Note on Windows SmartScreen:** Because this is a free, open-source application and not signed with an expensive enterprise certificate, Windows may show a blue popup saying *"Windows protected your PC"*.  
   > Simply click **"More info"** and then click **"Run anyway"**.
4. Follow the setup wizard and click **Finish**. Kiroku Note is now installed in your system!

---

### Step 2: Launch Kiroku Note

1. Open your Windows **Start Menu** and search for **Kiroku Note**.
2. Click to run it.
3. You will see a warm orange Japanese **あ** icon appear in your **Windows System Tray** (bottom-right corner near the clock).
4. **Right-click the tray icon** to see real-time service status:
   - `● Running` (Kiroku local engine is active on port `21828`)
   - `• Yomitan: Ready / Offline`
   - `• AnkiConnect: Ready / Offline`
   - `• OCR Engine: Ready / Disabled`

---

### Step 3: Add the Extension to your Browser (Chrome, Brave, Edge)

Kiroku Note works on all modern Chromium-based browsers (**Brave**, **Google Chrome**, **Microsoft Edge**, **Vivaldi**, **Opera**).

1. Download **`KirokuNote-extension-v1.0.0.zip`** from the [Releases page](https://github.com/Rhythm-Kachhwaha/kiroku-note/releases) and **Extract / Unzip** it to a permanent folder (e.g. `Documents\KirokuExtension`).  
   *(If you ran the Windows installer, the extension files are also already placed at `%LOCALAPPDATA%\Programs\Kiroku Note\extension`)*.
2. Open your browser and navigate to the Extensions management page:
   - **Brave:** `brave://extensions`
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
3. Toggle on **Developer mode** (switch located at the top-right corner).
4. Click the **Load unpacked** button in the top-left corner.
5. Select the extracted folder (the folder containing `manifest.json`).
6. Pin **Kiroku Note** to your browser toolbar for easy access!

---

### Step 4: Setup Prerequisites (Anki & Yomitan)

For the complete mining experience, make sure Anki and Yomitan are running:

#### 🅰️ Set up Anki & AnkiConnect
1. Open [Anki Desktop](https://apps.ankiweb.net/).
2. In the top menu, go to **Tools** → **Add-ons**.
3. Click **Get Add-ons...**, paste the code: `2055492159` (AnkiConnect), and click **OK**.
4. Restart Anki. Keep Anki open in the background when mining!

#### 🅱️ Set up Yomitan (Dictionary Lookup)
1. Install the [Yomitan Chrome Extension](https://chromewebstore.google.com/detail/yomitan/likgccmbimhjbgmplfdgkhclinjectip).
2. Download a Japanese dictionary (such as [Jitendex](https://jitendex.org/)) and import it into Yomitan settings.
3. In Yomitan Settings → **Developer**, ensure local dictionary connection is allowed so Kiroku Note can enrich definitions automatically.

---

### Step 5 (Optional): Install Local OCR (Manga & Image Text Mining)

Want to capture and mine Japanese text directly from manga, anime frames, or untranslatable images?

1. Download **`Kiroku-Note-OCR-Setup-v1.0.0.exe`** from the [Releases page](https://github.com/Rhythm-Kachhwaha/kiroku-note/releases).
2. Run the installer. It installs the lightweight, CPU-optimized `manga-ocr` model locally.
3. Once installed, Kiroku Note will automatically detect the OCR engine and start it in the background when you use the image capture tool!

---

## 📖 How to Mine Cards

1. Open any Japanese article, manga reader, or video (e.g., YouTube/Netflix) in your browser.
2. Click the **Kiroku Note** extension icon to open the **Side Panel**.
3. **Capture:** Select Japanese text on the page, or hover over subtitles.
4. **Enrich:** Kiroku Note instantly queries Yomitan, fills in pitch accents, JLPT levels, kanji readings, and grabs the sentence context.
5. **Review & Edit:** Review your card draft in the side panel, tweak the definition or notes.
6. **Save:** Click **Save Card**. The card is safely saved in your local SQLite database.
7. **Sync:** Click **Sync to Anki** whenever you want. Your cards appear instantly in your Anki deck with zero duplicates!

---

## 🛡️ Privacy & Local-First Philosophy

- **No Cloud Accounts / No Telemetry:** Everything runs 100% locally on your machine (`127.0.0.1`).
- **Zero Data Loss:** Cards are always stored in your local SQLite database (`%LOCALAPPDATA%\KirokuNote\data\kiroku.db`) before syncing. If Anki is closed, your cards are never lost.
- **Persistent Media:** Screenshots and audio clips are saved locally in `%LOCALAPPDATA%\KirokuNote\media\`. Updating or uninstalling the app never wipes your mined data.

---

## 🔧 Troubleshooting & FAQ

<details>
<summary><b>🔴 The tray icon says Yomitan / AnkiConnect is Offline</b></summary>

- **AnkiConnect:** Ensure Anki Desktop is running. Verify that the AnkiConnect add-on (`2055492159`) is installed under `Tools -> Add-ons`.
- **Yomitan:** Check that Yomitan extension is active in your browser.
- **Port check:**
  - Kiroku Backend: `http://127.0.0.1:21828`
  - AnkiConnect: `http://127.0.0.1:8765`
  - Yomitan Local Server: `http://127.0.0.1:19633`
  - Optional OCR Server: `http://127.0.0.1:21829`
</details>

<details>
<summary><b>⚠️ SmartScreen warning during installation</b></summary>

This is normal for open-source releases without a costly commercial code-signing certificate. Click **"More info"** → **"Run anyway"**. The application source code is completely open and auditable in this repository.
</details>

<details>
<summary><b>📂 Where are my database and cards stored?</b></summary>

Your database and media are stored in your user profile:
- Database: `%LOCALAPPDATA%\KirokuNote\data\kiroku.db`
- Mined Media: `%LOCALAPPDATA%\KirokuNote\media\`
- Logs: `%LOCALAPPDATA%\KirokuNote\logs\`
</details>

---

## 💻 Developer & Source Setup

If you are a developer and want to run Kiroku Note directly from Python source code:

### 1. Clone the repository
```bash
git clone https://github.com/Rhythm-Kachhwaha/kiroku-note.git
cd kiroku-note
```

### 2. Create Virtual Environment & Install Dependencies
```bash
python -m venv .venv
.venv\Scripts\activate       # On Windows
# source .venv/bin/activate  # On macOS/Linux

pip install -r backend/requirements.txt
```

### 3. Run Backend & System Tray
```bash
# Start backend server
python run_backend.py

# Or launch system tray with background server
python run_tray.py
```

### 4. Run Automated Tests
```bash
# Run all backend unit & integration tests (371+ tests)
python -m pytest -o pythonpath=backend backend/tests

# Run extension tests (Node.js built-in runner)
node --test extension/tests/*.test.js
```

### 5. Build Packaged Executables & Installers
```powershell
# Build backend executable & extension ZIP
.\release\build-backend.ps1 -Clean
.\release\build-extension.ps1

# Build Inno Setup installer
.\installer\build-installer.ps1
```

---

## Architecture & Design References

For architecture diagrams, design guidelines, and development documentation:
- [ARCHITECTURE.md](ARCHITECTURE.md): Architectural boundaries & data flow
- [DESIGN.md](DESIGN.md): Design system tokens, color palettes & side panel UX guidelines
- [AGENTS.md](AGENTS.md): Locked guidelines and core development principles
- [PROGRESS.md](PROGRESS.MD): Feature milestones & verification logs

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
