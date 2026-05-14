from pathlib import Path

import soundfile as sf
from kokoro import KPipeline


TEXT = "Hello, Tuan Syafiq. Yui is now running locally."
VOICE = "af_heart"
SPEED = 1.0

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = BASE_DIR / "test_output_0.wav"


def main():
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    pipeline = KPipeline(lang_code="a")
    generator = pipeline(TEXT, voice=VOICE, speed=SPEED)

    for index, (graphemes, phonemes, audio) in enumerate(generator):
        print(f"Chunk {index}")
        print(f"Graphemes: {graphemes}")
        print(f"Phonemes: {phonemes}")

        if index == 0:
            sf.write(OUTPUT_PATH, audio, 24000)
            print(f"Saved WAV: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
