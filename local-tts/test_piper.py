from pathlib import Path


TEXT = "Halo, Tuan Syafiq. Yui sekarang menggunakan Piper TTS."
SPEED = 1.0

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = BASE_DIR / "test_piper_output.wav"
MODEL_PATH = BASE_DIR / "models" / "piper" / "id_ID-news_tts-medium.onnx"


def main():
    from engines.piper_engine import PiperEngine

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    engine = PiperEngine(
        output_dir=OUTPUT_PATH.parent,
        model_path=str(MODEL_PATH),
    )

    result = engine.synthesize(
        text=TEXT,
        voice="id_ID-news_tts-medium",
        speed=SPEED,
    )

    print(f"Saved WAV: {result}")


if __name__ == "__main__":
    main()
