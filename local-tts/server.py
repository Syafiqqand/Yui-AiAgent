from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from engines.f5_indo_engine import F5IndoEngine
from engines.kokoro_engine import KokoroEngine


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"

app = FastAPI(title="Yui Local TTS")
f5_indo_engine = F5IndoEngine(BASE_DIR)
kokoro_engine = KokoroEngine(OUTPUT_DIR)


class TtsRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = Field(default=1.0, gt=0)
    language: str = "id"
    engine: str = "auto"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tts")
def synthesize_tts(request: TtsRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")

    engine_name = request.engine.strip().lower()
    language = request.language.strip().lower()
    selected_engine = _select_engine(engine_name, language)

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
        if selected_engine == "f5-id":
            output_path = f5_indo_engine.synthesize(text=text, speed=request.speed)
        else:
            output_path = kokoro_engine.synthesize(
                text=text,
                voice=request.voice,
                speed=request.speed,
            )

        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=output_path.name,
        )
    except HTTPException:
        raise
    except Exception as error:
        print(f"[Yui TTS Server] Generate failed: {error}")
        raise HTTPException(status_code=500, detail=str(error)) from error


def _select_engine(engine_name: str, language: str) -> str:
    if engine_name == "f5-id":
        return "f5-id"

    if engine_name == "kokoro":
        return "kokoro"

    if engine_name != "auto":
        raise HTTPException(
            status_code=400,
            detail='Unsupported engine. Use "auto", "f5-id", or "kokoro".',
        )

    if language == "id":
        return "f5-id"

    return "kokoro"
