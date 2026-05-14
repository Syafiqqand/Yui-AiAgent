# AGENTS.md

Panduan kerja untuk agen/coding assistant yang membantu di project ini.

## Project Overview

Project ini adalah Electron AI VTuber / AI Companion bernama **Yui**.

Stack dan fitur utama:

- Electron app untuk desktop Windows.
- Live2D untuk avatar.
- TTS lokal/online untuk suara.
- Kokoro TTS adalah TTS utama.
- Provider TTS lama sudah tidak dipakai.
- Idle voice wajib memakai audio lokal/pre-generated, bukan realtime TTS di setiap idle loop.

## Environment

- OS target: Windows.
- Project root: `C:\Project Gabut\AI Agent Live2D`.
- Python local TTS venv: `local-tts\.venv`.
- Python version: 3.12.
- Kokoro sudah terinstall di venv.
- Node/Electron project sudah ada.

Gunakan path relatif dari project root untuk kode dan dokumentasi. Hindari hardcode path absolut kecuali benar-benar diperlukan untuk instruksi lokal.

## Architecture Direction

Struktur yang dituju:

- `local-tts/`
  - Python server untuk local TTS.
  - Script generator audio.
  - Test/utilitas Kokoro.
- `src/main/voice/`
  - Wrapper JavaScript untuk TTS pipeline.
  - Orkestrasi Kokoro local TTS dan audio idle lokal.
- `assets/voices/idle/`
  - Audio idle lokal/pre-generated.
  - Jangan generate idle voice secara realtime di idle loop.

Prioritas pipeline suara:

1. Kokoro local TTS.
2. Idle voice dari file audio lokal yang sudah dibuat sebelumnya.

## Coding Rules

- Buat perubahan kecil, modular, dan mudah di-debug.
- Tambahkan error handling pada boundary I/O, process spawning, IPC, file access, dan request jaringan.
- Jangan hapus atau refactor besar file existing tanpa izin eksplisit.
- Jangan sentuh file Live2D model/assets kecuali diminta.
- Jangan hardcode path absolut di kode runtime.
- Gunakan path relatif dari project root.
- Untuk Python, gunakan `pathlib`.
- Untuk JavaScript, ikuti style project existing:
  - Saat ini main process memakai CommonJS (`require` / `module.exports`).
  - Gunakan CommonJS untuk file JS baru kecuali project sudah berpindah ke ES module.
- Jaga file baru tetap fokus pada satu tanggung jawab.
- Hindari perubahan besar pada perilaku UI, model Live2D, atau asset tanpa permintaan spesifik.

## Local TTS Rules

- Jalankan Kokoro melalui venv di `local-tts\.venv`.
- Script Python harus portable dari project root.
- Generator audio idle harus menulis output ke folder asset lokal, misalnya `assets/voices/idle/`.
- Idle voice tidak boleh memanggil Kokoro berulang dalam loop idle.
- Jika Kokoro gagal, laporkan error yang jelas dan fallback hanya pada jalur yang memang tersedia.

## Important Commands

Aktifkan venv PowerShell:

```powershell
.\local-tts\.venv\Scripts\Activate.ps1
```

Cek Python:

```powershell
python --version
```

Test Kokoro:

```powershell
python local-tts/test_kokoro.py
```

Install/run Electron sesuai script di `package.json`. Jangan mengubah dependency atau lockfile kecuali tugas memang membutuhkan itu.

## Testing Expectations

Setelah mengubah Python local TTS:

```powershell
.\local-tts\.venv\Scripts\Activate.ps1
python --version
python local-tts/test_kokoro.py
```

Setelah mengubah Electron/JS:

- Cek script di `package.json`.
- Jalankan test/lint/start command yang tersedia.
- Pastikan app masih bisa dibuka dan IPC utama tidak rusak.

Setelah mengubah idle voice:

- Pastikan file audio berada di `assets/voices/idle/`.
- Pastikan runtime mengambil file lokal, bukan memanggil realtime TTS setiap idle event.

## Guardrails

- Jangan menghapus `.env`, asset Live2D, model file, atau audio asset tanpa izin.
- Jangan commit secret/API key.
- Jangan membuat perubahan lintas arsitektur besar tanpa menjelaskan rencana dan mendapat persetujuan.
- Jika menemukan file yang sudah berubah di working tree, anggap itu perubahan user dan jangan revert.
- Saat ragu, pilih perubahan kecil yang menjaga Yui tetap berjalan.
