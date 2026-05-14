# Idle Ambience Audio Files

Place your idle sound files here. The system expects these filenames:

## Required Files

| File | Vibe |
|---|---|
| `breathe-1.mp3` | Soft neutral breathing / calm inhale-exhale |
| `breathe-2.mp3` | Relaxed exhale / quiet breath |
| `hum-1.mp3` | Tiny "hm?" / soft curious hum |
| `hum-2.mp3` | Subtle "mm..." / calm ambient hum |

## Guidelines

- Keep files SHORT: 1–3 seconds max
- Keep volume natural (the system applies its own low volume at 0.15)
- Avoid anything loud, dramatic, or speech-like
- Formats accepted: MP3 (recommended), WAV, OGG

## Vibe Reference Per State

| Idle State | Preferred Sounds | Feeling |
|---|---|---|
| `idle-main` | breathe-1, breathe-2 | Neutral, calm standby |
| `idle-1` | hum-1, breathe-1 | Slightly aware, curious |
| `idle-2` | breathe-2, hum-2 | Relaxed, quiet |
| `idle-3` | breathe-1, breathe-2 | Deeper idle, sleepy calm |

## Notes

- Missing files are ignored silently — the system won't crash
- The system plays sounds every 15–40 seconds randomly
- Sounds stop instantly when Yui starts speaking
- Sounds resume automatically after speaking ends
