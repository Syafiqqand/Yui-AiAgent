import os
import tempfile
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import numpy as np
import soundfile as sf

# Supertonic configuration
SUPERTONIC_MODEL = os.environ.get("SUPERTONIC_MODEL", "supertonic-3")
SUPERTONIC_VOICE = os.environ.get("SUPERTONIC_VOICE", "F1")
SUPERTONIC_LANG = os.environ.get("SUPERTONIC_LANG", "id")
SUPERTONIC_STEPS = int(os.environ.get("SUPERTONIC_STEPS", "8"))
SUPERTONIC_SPEED = float(os.environ.get("SUPERTONIC_SPEED", "1.05"))

# Output directory for temporary audio files
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Global TTS engine
_tts_engine = None
_voice_style = None

app = FastAPI(title="Yui Supertonic TTS")


def _get_tts_engine():
    """Lazy-load the Supertonic TTS engine."""
    global _tts_engine, _voice_style
    if _tts_engine is not None:
        return _tts_engine, _voice_style

    print(f"[Supertonic] Loading model: {SUPERTONIC_MODEL}...")
    from supertonic import TTS
    _tts_engine = TTS(model=SUPERTONIC_MODEL, auto_download=True)
    print(f"[Supertonic] Model loaded. Available voices: {_tts_engine.voice_style_names}")
    print(f"[Supertonic] Sample rate: {_tts_engine.sample_rate} Hz")
    print(f"[Supertonic] Multilingual: {_tts_engine.is_multilingual}")

    print(f"[Supertonic] Loading voice style: {SUPERTONIC_VOICE}...")
    _voice_style = _tts_engine.get_voice_style(SUPERTONIC_VOICE)
    print(f"[Supertonic] Voice style loaded: {SUPERTONIC_VOICE}")

    return _tts_engine, _voice_style


class TtsRequest(BaseModel):
    text: str
    voice: str = Field(default="F1", description="Voice style name (F1-F5, M1-M5)")
    lang: str = Field(default="id", description="Language code")
    steps: int = Field(default=8, ge=1, le=50, description="Number of synthesis steps")
    speed: float = Field(default=1.05, gt=0, le=3.0, description="Speech speed multiplier")


class TtsResponse(BaseModel):
    status: str
    duration_ms: int
    text_length: int
    voice: str
    lang: str


@app.get("/health")
def health():
    return {"status": "ok", "model": SUPERTONIC_MODEL, "voice": SUPERTONIC_VOICE, "lang": SUPERTONIC_LANG}


@app.post("/v1/tts")
def synthesize_tts(request: TtsRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")

    voice_name = request.voice.strip() or SUPERTONIC_VOICE
    lang = request.lang.strip().lower() or SUPERTONIC_LANG
    steps = request.steps
    speed = request.speed

    print(
        "[Supertonic] TTS request:",
        {
            "text_length": len(text),
            "voice": voice_name,
            "lang": lang,
            "steps": steps,
            "speed": speed,
        },
    )

    try:
        tts_engine, default_voice_style = _get_tts_engine()

        # Use requested voice style if different from default
        if voice_name != SUPERTONIC_VOICE:
            voice_style = tts_engine.get_voice_style(voice_name)
        else:
            voice_style = default_voice_style

        started_at = perf_counter()

        # Synthesize speech
        wav, duration = tts_engine.synthesize(
            text=text,
            voice_style=voice_style,
            total_steps=steps,
            speed=speed,
            lang=lang,
        )

        # wav shape is (1, num_samples), convert to (num_samples,) for saving
        wav = wav.squeeze(0)
        duration_sec = duration[0] if hasattr(duration, "__len__") else duration

        # Generate unique filename
        import uuid
        filename = f"tts-{int(perf_counter() * 1000)}-{uuid.uuid4().hex[:8]}.wav"
        output_path = OUTPUT_DIR / filename

        # Save audio
        sf.write(output_path, wav, tts_engine.sample_rate, subtype="PCM_16")

        duration_ms = round((perf_counter() - started_at) * 1000)
        print(
            "[Supertonic] TTS generated:",
            {
                "duration_ms": duration_ms,
                "text_length": len(text),
                "output_file": filename,
                "audio_duration_sec": round(duration_sec, 2),
            },
        )

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=filename,
            headers={
                "X-Yui-TTS-Output-File": filename,
                "X-Yui-TTS-Duration-Ms": str(duration_ms),
            },
        )
    except HTTPException:
        raise
    except Exception as error:
        duration_ms = round((perf_counter() - started_at) * 1000)
        print(
            "[Supertonic] Generate failed:",
            {
                "duration_ms": duration_ms,
                "text_length": len(text),
                "error": str(error),
            },
        )
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.get("/v1/styles")
def list_styles():
    """List available voice styles."""
    tts_engine, _ = _get_tts_engine()
    return {"styles": tts_engine.voice_style_names}


@app.get("/v1/languages")
def list_languages():
    """List supported languages."""
    import supertonic
    return {
        "supported_languages": supertonic.SUPPORTED_LANGUAGES,
        "available_languages": supertonic.AVAILABLE_LANGUAGES,
        "default_language": supertonic.DEFAULT_LANGUAGE,
    }


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("SUPERTONIC_HOST", "127.0.0.1")
    port = int(os.environ.get("SUPERTONIC_PORT", "7788"))
    print(f"[Supertonic] Starting server on {host}:{port}")
    uvicorn.run("supertonic_server:app", host=host, port=port, log_level="info")