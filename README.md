# ⚡ Tutor — Multiplication Gauntlet

A mobile-first Progressive Web App (PWA) designed to drill multiplication tables (`1 × 1` through `12 × 12` — all 144 facts) using a strict countdown timer, hands-free voice recognition, 3D flashcard flips, and audio reprimands.

## Live URL (GitHub Pages)
👉 **`https://lodebek.github.io/Tutor/`**

## Core Mechanics
- **144 Multiplication Facts (`1 × 1` to `12 × 12`)**: Filter by All (1–12), Core (3–12), Hard (6–12), Needs Work, or custom individual tables.
- **Auto-Engaged Voice Input**: Uses the browser's built-in `SpeechRecognition` API (no external AI or API keys required). Ignores non-numeric speech until a number is spoken or the 20-second timer expires.
- **Optional On-Screen Keypad**: Tap digits directly or use hardware keys anytime.
- **3D Card Flip + Audio Reprimand**: Wrong answers or timeouts flash the screen red (`#ff0000`), flip the card to reveal the full equation (`7 × 8 = 56`), read it aloud via `window.speechSynthesis`, and re-queue the card into the current round pile until mastered.
- **12 × 12 Mastery Grid**: Tracks hits, misses, and streaks in `localStorage`.
