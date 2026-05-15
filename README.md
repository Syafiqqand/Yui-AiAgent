# Yui-AiAgent

Yui-AiAgent is an Electron-based VTuber AI companion with Groq chat, optional local Kokoro TTS, text-only fallback, and smooth idle/speaking animations. It is designed as a beginner-friendly desktop companion with a clean portrait layout.

## Features

- Groq AI chat responses
- Optional Kokoro realtime text-to-speech
- Text-only mode when no local TTS server is running
- Thinking state with alternating thinking animations while responses are prepared
- Pose buttons in the top-right corner for `Pose 1`, `Pose 2`, and `Pose 3`
- Idle sound feature postponed for future curated local assets
- VTuber idle and speaking animations with smooth transitions
- Minimal portrait UI for desktop use

## Setup

### Requirements

- Node.js 18+ recommended
- Python 3.12 for optional local TTS
- A Groq API key
- Kokoro installed in `local-tts\.venv` if realtime voice is enabled

### Install

```bash
npm install
```

### Configure API keys

Copy the example file and fill in your Groq key:

```bash
copy .env.example .env
```

Then edit `.env` and set:

- `GROQ_API_KEY`

Optional realtime Kokoro TTS:

- `TTS_ENABLED`
- `KOKORO_TTS_SERVER_URL`
- `TTS_FALLBACK_TO_TEXT_ONLY`

The `.env` file is ignored by Git, so secrets will not be uploaded. You can also tweak the assistant personality in [personality.md](personality.md).

### Run

```bash
npm start
```

### Windows Launchers

Text-only mode:

- Double click `start-yui.bat`
- Starts Electron only
- Does not start Kokoro

Voice mode:

- Set `tts.enabled` to `true` in [config/app-config.json](config/app-config.json)
- Double click `start-yui-voice.bat`
- Starts Kokoro in a separate PowerShell window, waits briefly, then starts Electron

## Voice

The app starts in text-only mode by default and does not require a local TTS server. Kokoro is the only optional realtime TTS engine. Enable it in [config/app-config.json](config/app-config.json) or with `.env`, then run the local server.

While Yui prepares a response, the chat shows a temporary thinking message and alternates `thinking-1` / `thinking-2` animations. In voice mode, the final text is held until Kokoro audio is ready, then the text appears and playback starts together. If Kokoro is unavailable, Yui falls back to text-only.

Pose buttons are available in the top-right corner. `Pose 1`, `Pose 2`, and `Pose 3` play their corresponding pose animations from the `assets` folder, then return Yui to the normal idle flow.

Quick Kokoro smoke test:

```powershell
.\local-tts\.venv\Scripts\Activate.ps1
python local-tts/test_kokoro.py
```

Run Kokoro server:

```powershell
cd local-tts
.\.venv\Scripts\Activate.ps1
python server.py
```

Idle sound playback is postponed and disabled for now. The placeholder folder is `assets/voices/idle/`; future curated idle sounds can be placed there later as local static files. Idle sounds must not be generated during runtime.

F5-TTS Indo was removed from runtime and project integration after testing because it was too slow for realtime chat in the subprocess CLI setup. Edge TTS and ElevenLabs are not used.

## Technologies Used

- Electron
- JavaScript, HTML, CSS
- Groq API for chat
- Kokoro for optional local TTS

## Current Features

- Groq AI chat
- Optional Kokoro local TTS bridge with text-only fallback
- VTuber idle/speaking animations
- Electron desktop app
