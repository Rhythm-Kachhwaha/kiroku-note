# Kiroku Note PWA — Getting Started Guide

Kiroku Note Progressive Web App (PWA) brings the local-first Japanese language learning companion to mobile devices (iOS and Android) and modern browsers.

---

## 1. Installing the PWA

### iOS (Safari)
1. Open your Safari browser and navigate to your deployed worker URL:
   `https://<your-worker-subdomain>.workers.dev` (or your configured custom domain).
2. Tap the **Share** button (the rectangle with an arrow pointing upward).
3. Scroll down and select **Add to Home Screen**.
4. Confirm the name `Kiroku Note` and tap **Add**.
5. Launch the app from your home screen. It will open in full-screen standalone mode with native safe-area padding.

### Android (Chrome)
1. Open Google Chrome and navigate to your worker URL.
2. An automatic installation banner or prompt will appear at the bottom.
3. Tap **Install** or tap the three-dot menu in the upper-right corner and select **Install app**.
4. Confirm installation. The application will be installed as a first-class Android application.

---

## 2. Authentication & Sign-In

1. Upon first launching Kiroku Note, tap **Login** on the top navigation bar or settings.
2. Choose your preferred authentication provider:
   - **Google OAuth**: Fast single-click sign-in.
   - **GitHub OAuth**: Developer sign-in.
3. Once authenticated, your browser establishes an encrypted `HttpOnly; Secure; SameSite=Lax` session cookie.
4. Your mining queue and Anki mirror stats will link automatically to your learner profile.

---

## 3. Configuring Local Windows PC Worker for Anki Sync

The local Python worker drains vocabulary mining operations from the edge queue into your local Anki Desktop database via AnkiConnect.

### Prerequisites
- Anki Desktop installed and running.
- AnkiConnect add-on installed in Anki (code: `2055492159`).

### Running the Worker
1. In your Kiroku repository directory on Windows, create a `.env` file or export environment variables:
   ```powershell
   $env:TURSO_DATABASE_URL = "libsql://<your-database>.turso.io"
   $env:TURSO_AUTH_TOKEN = "<your-turso-auth-token>"
   $env:ANKI_CONNECT_URL = "http://127.0.0.1:8765"
   ```
2. Start the sync loop:
   ```powershell
   $env:PYTHONPATH = ".;backend;kiroku_cloud_queue"
   python kiroku_cloud_queue/worker.py
   ```
3. The worker will lease pending mining ops, populate your local `kiroku.db` SQLite database, push notes to AnkiConnect, and acknowledge the items in the cloud queue.
4. Check `Settings -> Sync & Analytics` in your PWA to see live updates in the Queue Inspector and Anki Mirror statistics.

---

## 4. Reading Manga Offline & On-Device OCR

1. Navigate to the **Manga** tab.
2. Tap **Upload Book / ZIP** and select a CBZ, ZIP, or PDF file.
3. The file is streamed into the browser's high-speed Origin Private File System (OPFS) for instant zero-copy paging.
4. When selecting a dialogue bubble, speech recognition runs on-device via WebGPU/WASM using MangaOCR, caching inference assets permanently in CacheStorage.
5. Create flashcards with a single tap, queuing them for instant synchronization with your desktop Anki deck.

