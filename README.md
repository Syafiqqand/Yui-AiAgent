# Yui-AiAgent

Yui-AiAgent is an Electron-based VTuber AI assistant with Groq AI chat (LLaMA 3.3), ElevenLabs TTS, and smooth idle/speaking animations. It is designed as a beginner-friendly desktop companion with a clean portrait layout.

## Features

- Groq AI chat responses (LLaMA 3.3 70B)
- ElevenLabs text-to-speech playback
- VTuber idle and speaking animations with smooth transitions
- Minimal portrait UI for desktop use

## Screenshots

Add screenshots here.

## Setup

### Requirements

- Node.js 18+ recommended
- An ElevenLabs API key and Voice ID
- A Groq API key

### Install

```bash
npm install
```

### Configure API keys

Copy the example file and fill in your keys:

```bash
copy .env.example .env
```

Then edit .env and set:

- `GROQ_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

The .env file is ignored by Git, so secrets will not be uploaded.
You can also tweak the assistant personality in [personality.md](personality.md).

### Run

```bash
npm start
```

## Technologies Used

- Electron
- JavaScript, HTML, CSS
- ElevenLabs API (TTS)
- Groq API with LLaMA 3.3 (chat)
- Axios

## Current Features

- Groq AI chat
- ElevenLabs TTS
- VTuber idle/speaking animations
- Electron desktop app

## Future Roadmap

- Settings screen for API keys and voice selection
- Optional memory and conversation history controls
- More animation states and expressions
- Microphone input and voice activation
