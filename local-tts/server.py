from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from engines.kokoro_engine import KokoroEngine


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"

app = FastAPI(title="Yui Local TTS")
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
        output_path = kokoro_engine.synthesize(
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
    if engine_name in {"auto", "kokoro"}:
        return "kokoro"

    raise HTTPException(
        status_code=400,
        detail='Unsupported engine. Use "auto" or "kokoro".',
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="127.0.0.1", port=5005)
