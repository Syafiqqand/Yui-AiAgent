from pathlib import Path
from uuid import uuid4

import numpy as np
import soundfile as sf
from kokoro import KPipeline


SAMPLE_RATE = 24000


class KokoroEngine:
    def __init__(self, output_dir: Path, lang_code: str = "a"):
        self.output_dir = output_dir
        self.pipeline = KPipeline(lang_code=lang_code)

    def synthesize(self, text: str, voice: str, speed: float) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / f"kokoro_{uuid4().hex}.wav"

        print(
            "[Kokoro Engine] TTS request:",
            {
                "text_length": len(text),
                "voice": voice,
                "speed": speed,
                "output": str(output_path),
            },
        )

        generator = self.pipeline(text, voice=voice, speed=speed)
        chunks = []

        for index, (graphemes, phonemes, audio) in enumerate(generator):
            print(f"[Kokoro Engine] Chunk {index}")
            print(f"[Kokoro Engine] Graphemes: {graphemes}")
            print(f"[Kokoro Engine] Phonemes: {phonemes}")
            chunks.append(np.asarray(audio, dtype=np.float32))

        if not chunks:
            raise RuntimeError("Kokoro returned no audio chunks.")

        audio_data = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
        sf.write(output_path, audio_data, SAMPLE_RATE)

        print(f"[Kokoro Engine] WAV ready: {output_path}")
        return output_path
