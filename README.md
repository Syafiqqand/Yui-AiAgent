# Yui-AiAgent

Yui-AiAgent is an Electron-based VTuber AI companion powered by B.AI (MiMo-V2.5), with local Supertonic 3 TTS (voice F1, Indonesian), and smooth idle/thinking/talking animations. It is designed as a beginner-friendly desktop companion with a clean portrait layout.

## Features

- B.AI chat responses (MiMo-V2.5 model)
- Local Supertonic 3 TTS (F1 voice, Indonesian language)
- Automatic Supertonic server startup managed by Electron
- Thinking / Talking / Idle avatar states with smooth transitions
- Live2D Haru avatar with mouth lip-sync during talking
- YouTube Music integration via Playwright
- Weather and public-holiday context injection

## Setup

### Requirements

- Node.js 18+ recommended
- Python 3.12
- A B.AI API key
- Supertonic 3 installed in `.venv` (auto-downloaded on first use)

### Install

```bash
npm install
pip install "supertonic[serve]"
```

### Configure API keys

Copy the example file and fill in your B.AI key:

```bash
copy .env.example .env
```

Then edit `.env` and set:

- `BAI_API_KEY`
- `BAI_BASE_URL` (default: `https://api.b.ai/v1`)
- `BAI_MODEL` (default: `mimo-v2.5`)

Supertonic TTS configuration (with defaults):

- `TTS_ENABLED` (default: `true`)
- `SUPERTONIC_HOST` (default: `127.0.0.1`)
- `SUPERTONIC_PORT` (default: `7788`)
- `SUPERTONIC_VOICE` (default: `F1`)
- `SUPERTONIC_LANG` (default: `id`)
- `SUPERTONIC_STEPS` (default: `8`)
- `SUPERTONIC_SPEED` (default: `1.05`)

The `.env` file is ignored by Git, so secrets will not be uploaded. You can also tweak the assistant personality in [personality.md](personality.md).

### Run

```bash
npm start
```

The Electron app will automatically:
1. Check if a Supertonic server is running on `http://127.0.0.1:7788`
2. If not, spawn the Supertonic server from `.venv\Scripts\python.exe local-tts\supertonic_server.py`
3. Wait until the server is ready
4. Start the Electron window

## Voice

Supertonic 3 is the only TTS engine. It runs locally with no cloud dependencies. On first use, the model files are auto-downloaded and cached.

The Electron app manages the Supertonic server lifecycle:
- Auto-spawns on startup if not already running
- Reuses existing server if one is detected
- Cleans up child process on app exit
- TTS requests include voice F1 and Indonesian language by default

While Yui prepares a response, the chat shows a temporary thinking message and the avatar enters the Thinking state. When the B.AI response arrives, the avatar switches to Talking and Supertonic generates audio, which is then played. When playback ends, the temporary WAV is automatically deleted and the avatar returns to Idle.

Quick Supertonic smoke test:

```powershell
.\.venv\Scripts\Activate.ps1
python local-tts/test_tts_complete.py
```

Run Supertonic server manually (optional):

```powershell
cd local-tts
..\.venv\Scripts\Activate.ps1
python supertonic_server.py
```

Idle sound playback is postponed and disabled for now. The placeholder folder is `assets/voices/idle/`; future curated idle sounds can be placed there later as local static files. Idle sounds must not be generated during runtime.

## Technologies Used

- Electron
- JavaScript, HTML, CSS
- B.AI (MiMo-V2.5) for chat
- Supertonic 3 for local TTS (F1 voice, Indonesian)
- Live2D Cubism + pixi-live2d-display for the Haru avatar

## Current Features

- B.AI (MiMo-V2.5) chat
- Local Supertonic 3 TTS (F1, Indonesian) with auto-server management
- Live2D Haru avatar with Idle / Thinking / Talking states
- Lip-sync driven by audio amplitude
- Electron desktop app