import os
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"

# Determine which TTS engine to load based on environment variable.
# Default changed to "piper" to temporarily disable Kokoro.
TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "piper").strip().lower()

app = FastAPI(title="Yui Local TTS")

# Lazy-loaded engine instance — only the active provider is loaded.
_engine = None


def _get_engine():
    global _engine

    if _engine is not None:
        return _engine

    if TTS_PROVIDER == "piper":
        from engines.piper_engine import PiperEngine

        print(f"[Yui TTS Server] Loading Piper engine...")
        _engine = PiperEngine(OUTPUT_DIR)
    else:
        # Temporarily disable Kokoro as requested
        raise RuntimeError(
            "[Yui TTS Server] Kokoro engine is temporarily disabled. "
            "Please configure the system to use Piper."
        )

    print(f"[Yui TTS Server] Engine ready: {TTS_PROVIDER}")
    return _engine


class TtsRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = Field(default=1.0, gt=0)
    language: str = "id"
    engine: str = "auto"


@app.get("/health")
def health():
    return {"status": "ok", "provider": TTS_PROVIDER}


@app.post("/tts")
def synthesize_tts(request: TtsRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")

    engine_name = request.engine.strip().lower()
    language = request.language.strip().lower()
    selected_engine = _select_engine(engine_name, language)
    started_at = perf_counter()

    print(
        "[Yui TTS Server] TTS request:",
        {
            "text_length": len(text),
            "voice": request.voice,
            "speed": request.speed,
            "language": language,
            "engine": engine_name,
            "selected_engine": selected_engine,
        },
    )

    try:
        active_engine = _get_engine()
        output_path = active_engine.synthesize(
            text=text,
            voice=request.voice,
            speed=request.speed,
        )

        duration_ms = round((perf_counter() - started_at) * 1000)
        print(
            "[Yui TTS Server] TTS generated:",
            {
                "selected_engine": selected_engine,
                "duration_ms": duration_ms,
                "text_length": len(text),
            },
        )

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=output_path.name,
            headers={"X-Yui-TTS-Output-File": output_path.name},
        )
    except HTTPException:
        raise
    except Exception as error:
        duration_ms = round((perf_counter() - started_at) * 1000)
        print(
            "[Yui TTS Server] Generate failed:",
            {
                "selected_engine": selected_engine,
                "duration_ms": duration_ms,
                "text_length": len(text),
                "error": str(error),
            },
        )
        raise HTTPException(status_code=500, detail=str(error)) from error


def _select_engine(engine_name: str, language: str) -> str:
    # If client requests kokoro, explicitly fail with a debug error
    if engine_name == "kokoro":
        raise HTTPException(
            status_code=400,
            detail="Kokoro engine is temporarily disabled. Please use Piper."
        )

    # Accept "auto" or "piper" — always route to the active provider (which is now piper by default).
    if engine_name in {"auto", "piper"}:
        if TTS_PROVIDER == "kokoro":
            raise HTTPException(
                status_code=400,
                detail="Kokoro engine is temporarily disabled. Please use Piper."
            )
        return TTS_PROVIDER

    raise HTTPException(
        status_code=400,
        detail='Unsupported engine. Use "auto" or "piper".',
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=5005)
