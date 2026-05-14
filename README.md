# Yui-AiAgent

Yui-AiAgent is an Electron-based VTuber AI companion with Groq chat, local Kokoro TTS, and smooth idle/speaking animations. It is designed as a beginner-friendly desktop companion with a clean portrait layout.

## Features

- Groq AI chat responses
- Local Kokoro text-to-speech pipeline
- Pre-generated local idle voice assets
- VTuber idle and speaking animations with smooth transitions
- Minimal portrait UI for desktop use

## Setup

### Requirements

- Node.js 18+ recommended
- Python 3.12 for local TTS
- A Groq API key
- Kokoro installed in `local-tts\.venv`

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

Optional local TTS endpoint:

- `KOKORO_TTS_URL`

The `.env` file is ignored by Git, so secrets will not be uploaded. You can also tweak the assistant personality in [personality.md](personality.md).

### Run

```bash
npm start
```

## Local TTS

Kokoro local TTS lives under `local-tts/`. The Electron app expects a local Kokoro server endpoint that returns WAV audio bytes.

Quick Kokoro smoke test:

```powershell
.\local-tts\.venv\Scripts\Activate.ps1
python local-tts/test_kokoro.py
```

## Technologies Used

- Electron
- JavaScript, HTML, CSS
- Groq API for chat
- Kokoro for local TTS

## Current Features

- Groq AI chat
- Kokoro-oriented local TTS bridge
- VTuber idle/speaking animations
- Electron desktop app
