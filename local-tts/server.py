from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from kokoro import KPipeline
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "output"
SAMPLE_RATE = 24000

app = FastAPI(title="Yui Kokoro Local TTS")
pipeline = KPipeline(lang_code="a")


class TtsRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = Field(default=1.0, gt=0)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tts")
def synthesize_tts(request: TtsRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / f"tts_{uuid4().hex}.wav"

    print(
        "[Kokoro Server] TTS request:",
        {
            "text_length": len(text),
            "voice": request.voice,
            "speed": request.speed,
            "output": str(output_path),
        },
    )

    try:
        generator = pipeline(text, voice=request.voice, speed=request.speed)
        chunks = []

        for index, (graphemes, phonemes, audio) in enumerate(generator):
            print(f"[Kokoro Server] Chunk {index}")
            print(f"[Kokoro Server] Graphemes: {graphemes}")
            print(f"[Kokoro Server] Phonemes: {phonemes}")
            chunks.append(np.asarray(audio, dtype=np.float32))

        if not chunks:
            raise RuntimeError("Kokoro returned no audio chunks.")

        audio_data = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
        sf.write(output_path, audio_data, SAMPLE_RATE)

        print(f"[Kokoro Server] WAV ready: {output_path}")
        return FileResponse(
            path=output_path,
            media_type="audio/wav",
            filename=output_path.name,
        )
    except HTTPException:
        raise
    except Exception as error:
        print(f"[Kokoro Server] Generate failed: {error}")
        raise HTTPException(status_code=500, detail="TTS generation failed.") from error
