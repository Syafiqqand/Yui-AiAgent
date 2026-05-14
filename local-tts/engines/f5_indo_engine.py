import subprocess
from pathlib import Path
from uuid import uuid4


F5_MODEL_NAME = "F5TTS_v1_Base"
F5_REF_TEXT = (
    "dikatakan ternyata cek 3 miliar yang diberikan untuk mahar pernikahan "
    "ini adalah palsu."
)


class F5IndoEngine:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.model_dir = base_dir / "models" / "f5-indo"
        self.output_dir = base_dir / "output"
        self.checkpoint = self.model_dir / "f5_tts_indo_v2.pt"
        self.vocab = self.model_dir / "vocab.txt"
        self.ref_audio = self.model_dir / "ref_reporter.wav"

    def synthesize(self, text: str, speed: float) -> Path:
        self._validate_files()
        self.output_dir.mkdir(parents=True, exist_ok=True)

        output_filename = f"f5_{uuid4().hex}.wav"
        output_path = self.output_dir / output_filename
        command = [
            "f5-tts_infer-cli",
            "-m",
            F5_MODEL_NAME,
            "-p",
            str(self.checkpoint),
            "-v",
            str(self.vocab),
            "-r",
            str(self.ref_audio),
            "-s",
            F5_REF_TEXT,
            "-t",
            text,
            "-o",
            str(self.output_dir),
            "-w",
            output_filename,
            "--speed",
            str(speed),
            "--remove_silence",
        ]

        print(
            "[F5 Indo Engine] TTS request:",
            {
                "text_length": len(text),
                "speed": speed,
                "output": str(output_path),
            },
        )

        try:
            result = subprocess.run(
                command,
                cwd=self.base_dir,
                capture_output=True,
                text=True,
                check=False,
            )
        except OSError as error:
            raise RuntimeError(f"Failed to start f5-tts_infer-cli: {error}") from error

        if result.returncode != 0:
            raise RuntimeError(
                "F5-TTS Indo command failed.\n"
                f"Exit code: {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}"
            )

        if not output_path.exists():
            raise RuntimeError(
                "F5-TTS Indo command finished but output WAV was not found: "
                f"{output_path}\n"
                f"STDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}"
            )

        print(f"[F5 Indo Engine] WAV ready: {output_path}")
        return output_path

    def _validate_files(self) -> None:
        required_files = {
            "checkpoint": self.checkpoint,
            "vocab": self.vocab,
            "reference audio": self.ref_audio,
        }
        missing = [
            f"{label}: {path}"
            for label, path in required_files.items()
            if not path.is_file()
        ]

        if missing:
            raise RuntimeError(
                "F5-TTS Indo required file(s) missing:\n" + "\n".join(missing)
            )
