from pathlib import Path
from uuid import uuid4
import wave

from piper.voice import PiperVoice
from piper.config import SynthesisConfig


class PiperEngine:
    """Piper TTS engine wrapper with the same interface as KokoroEngine."""

    def __init__(self, output_dir: Path, model_path: str | None = None):
        self.output_dir = output_dir

        if model_path is None:
            models_dir = Path(__file__).resolve().parent.parent / "models" / "piper"
            model_path = str(models_dir / "id_ID-news_tts-medium.onnx")

        config_path = f"{model_path}.json"
        print(f"[Piper Engine] Loading model: {model_path}")
        self.voice = PiperVoice.load(model_path, config_path=config_path)
        self.sample_rate = self.voice.config.sample_rate
        print(f"[Piper Engine] Model loaded. Sample rate: {self.sample_rate}")

    def synthesize(self, text: str, voice: str, speed: float) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        output_path = self.output_dir / f"piper_{uuid4().hex}.wav"

        print(
            "[Piper Engine] TTS request:",
            {
                "text_length": len(text),
                "voice": voice,
                "speed": speed,
                "output": str(output_path),
            },
        )

        # Piper uses length_scale which is the inverse of speed.
        # speed=1.0 → length_scale=1.0 (normal)
        # speed=2.0 → length_scale=0.5 (faster)
        length_scale = 1.0 / max(speed, 0.1)

        syn_config = SynthesisConfig(length_scale=length_scale)

        with wave.open(str(output_path), "wb") as wav_file:
            self.voice.synthesize_wav(text, wav_file, syn_config=syn_config)

        print(f"[Piper Engine] WAV ready: {output_path}")
        return output_path
