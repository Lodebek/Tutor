# ⚡ Tutor — Multiplication Gauntlet (PWA)

[![Live Demo](https://img.shields.io/badge/Live_App-GitHub_Pages-38bdf8?style=for-the-badge&logo=github)](https://lodebek.github.io/Tutor/)
[![Tech Stack](https://img.shields.io/badge/Stack-HTML5_%7C_CSS3_%7C_Vanilla_JS-818cf8?style=for-the-badge)](#architecture--tech-stack)
[![Voice API](https://img.shields.io/badge/Voice-Web_Speech_API_(Zero_AI_Keys)-22c55e?style=for-the-badge)](#hands-free-voice-engine-zero-ai--zero-api-keys)

**Tutor** is a mobile-first Progressive Web App (PWA) built for rapid, high-retention skill mastery on a phone. Its flagship module, **Multiplication Gauntlet**, drills all **144 multiplication facts (`1 × 1` through `12 × 12`)** using hands-free voice recognition, strict countdown timers, 3D flashcard flips, stepping-stone mental math tricks, and research-backed active retrieval.

👉 **Launch Live on Mobile or Desktop:** **[https://lodebek.github.io/Tutor/](https://lodebek.github.io/Tutor/)**

![Multiplication Gauntlet Mobile Preview](assets/app-preview.svg)

---

## 🎯 Project Goals

Traditional flashcards fail because kids either guess wildly, stare passively at the answer, or mash "Next" without encoding the fact. **Multiplication Gauntlet** was designed and iteratively refined around five goals:

1. **Zero-Friction Mobile Delivery**: Instant access via GitHub Pages with a Network-First Service Worker so code updates go live on a phone with a single refresh (or tap on the version badge).
2. **Hands-Free Voice + Tactile Keypad Input**: Let students answer naturally out loud—ignoring background chatter or *"umm..."* filler words until an actual number is spoken—while keeping an optional thumb-friendly keypad on screen.
3. **Eliminate Passive Skipping ("Locked Active Echo")**: Remove the "Next Card" skip button on missed cards. Lock the UI while the app speaks the correction, then require the student to **say or type the correct answer while looking at the full equation** before the next card unlocks.
4. **Replace Brute-Force Memorization with Number Sense**: Pair missed facts with **Stepping-Stone Mental Math Tricks**, **Commutative Twin badges** (`7 × 8 = 8 × 7`), and **Fact Family missing-factor questions** (`7 × ? = 56`).
5. **Extensible Foundation**: Built as the first module in the **Tutor** platform so additional study decks and subjects can plug into the same voice + spaced-repetition engine.

---

## 🧠 Research-Backed Learning Mechanics

### 1. Locked Failure Readout & Mandatory Active Echo
When an answer is wrong or the countdown timer expires:
- The screen flashes red (`#ff0000`) and flips the 3D flashcard to reveal the full equation (`7 × 8 = 56`).
- **UI Lock**: The keypad and microphone lock while `window.speechSynthesis` speaks the feedback and equation aloud so the student cannot skip past the correction.
- **Active Echo to Unlock**: Once the voice finishes, the microphone and keypad unlock. There is **no "Next Card" button**—the student must **say `"56"` out loud or type `56`** while viewing the equation to advance.

### 2. 3-Tier Proximity Coaching (Distance-Aware Feedback)
Instead of generic "Wrong!" messages, the engine measures how close a wrong answer is relative to the larger factor of the equation (`factorStep = Math.max(a, b)`):
- **Tier 1 — Within $\le 1\times$ Factor (e.g., off by $\le 9$ on $3 \times 9 = 27$)**:
  - **Banner**: `🔥 SO CLOSE! (You said 24 — only 3 off!)`
  - **Voice**: Supportive encouragement (*"Ooh, you're so close! Nice try!"*, *"Almost had it!"*).
- **Tier 2 — Between $1\times$ and $2\times$ Factor (e.g., off by $10\text{–}18$ on $3 \times 9 = 27$)**:
  - **Banner**: `⚡ COME ON, YOU CAN DO BETTER!`
  - **Voice**: Challenging nudge (*"Come on, you can do better than that!"*, *"You're a couple groups off—focus up!"*).
- **Tier 3 — Over $2\times$ Factor Off (e.g., off by $> 18$)**:
  - **Banner**: `🎯 WAY OFF — WE CAN DO BETTER!`
  - **Voice**: Reset coaching (*"Whoa, way off! Let's try again, we can do better!"*).

### 3. Stepping-Stone Mental Math Tricks (`💡`)
Every flipped card (and the front-side `💡 Hint` button) displays a 1-line **Derived Fact Strategy** tailored to that specific pair:
- **Square + 1 Group (Neighbors)**: For $7 \times 8 \rightarrow$ `💡 Square + 1 Group: (7 × 7 = 49) + 7 more = 56`
- **$10\times$ Step-Back (for $9\text{s}$)**: For $9 \times 7 \rightarrow$ `💡 10× Step-Back: (10 × 7 = 70) − 7 = 63 (Digits 6+3=9)`
- **$12\times$ Split ($10 + 2$)**: For $12 \times 7 \rightarrow$ `💡 12s Split (10 + 2): (10 × 7 = 70) + (2 × 7 = 14) = 84`
- **$5\times$ Stepping Stone (for $6\text{s}$)**: For $6 \times 8 \rightarrow$ `💡 5× Stepping Stone: (5 × 8 = 40) + 8 more = 48`
- **Doubling Ladders ($2\times, 4\times, 8\times$)**: Double once, twice, or three times.

### 4. Commutative Compression ("True 36 Pairs" & "🔥 Boss 15")
- **Commutative Twin Badge**: Displays `⇄ Same as 8 × 7` on the front and the inverse division fact (`56 ÷ 7 = 8`) on the back.
- **Deck Presets**:
  - **All (1–12)**: Full 144-card grid.
  - **True 36 Pairs**: Deduplicated commutative pairs across core factors ($3\text{–}9, 12$).
  - **🔥 Boss 15**: The 15 hardest 4th-grade facts ($6\times6, 6\times7, 6\times8, 6\times9, 6\times12, 7\times7, 7\times8, 7\times9, 7\times12, 8\times8, 8\times9, 8\times12, 9\times12, 11\times12, 12\times12$) responsible for ~80% of student errors.
  - **Core (3–12)**, **Hard (6–12)**, **Needs Work** (dynamically weighted by lowest mastery), and **Custom Factor Toggles**.

### 5. Progressive `1 → 3 → 7` Expanding Retrieval Spacing
Based on Bjork & Landauer's expanding retrieval research, missed cards aren't just tossed randomly back into the deck—they enter a 3-stage spacing ladder within the round:
1. **Retry 1/3**: Re-tested **1 card later** while still fresh in short-term memory.
2. **Retry 2/3**: Re-tested **3 cards later**.
3. **Retry 3/3**: Re-tested **7 cards later** to verify consolidation.

### 6. Fact Families / Missing-Factor Mode (`7 × ? = 56`)
Switch between **Standard (`7 × 8 = ?`)**, **Mixed Family**, and **Missing Factor (`7 × ? = 56`)** directly from the lobby screen to wire multiplication and division together.

---

## 🎙️ Hands-Free Voice Engine (Zero AI / Zero API Keys)

- Built on the browser's native `SpeechRecognition` / `webkitSpeechRecognition` and `window.speechSynthesis` APIs.
- **Non-Numeric Speech Filtering**: Ignores background conversation or thinking filler (*"umm, wait..."*) until an actual number is spoken or the timer expires.
- **Question-Echo Stripping**: If a student repeats the question aloud while thinking (*"seven times eight is... fifty-six"*), the parser strips the `7 times 8` prefix so they aren't penalized for thinking out loud.
- **Audio Coordination**: Automatically pauses the microphone while `speechSynthesis` speaks compliments or failure readouts so the phone never picks up its own speaker, then re-engages the microphone automatically.

---

## 🛠️ Evolution & Development Steps

1. **`v1.0` — Initial Gauntlet Prototype**:
   - Built the static HTML5/CSS3/JS PWA covering all 144 multiplication facts (`1 × 1` to `12 × 12`), 20-second countdown bar, 3D card flip, `#ff0000` penalty flash, auto-engaged microphone with non-numeric filtering, optional on-screen keypad, and `localStorage` 12 × 12 Mastery Matrix.
2. **`v1.1` — Learning Timer & Instant Mobile Cache-Busting**:
   - Added a **1-Minute (`60s`) Learning Timer** (`1m Learn`) directly on the lobby screen alongside `10s`, `15s`, `20s`, and `30s`, plus one-tap PWA cache clearing via the header version badge.
3. **`v1.2` — Extended Reveal Timing**:
   - Doubled the post-speech viewing hold on missed cards after live testing showed the default transition moved too quickly.
4. **`v1.3` — Cognitive Science & Number Sense Upgrade**:
   - Added **Active Echo**, **Stepping-Stone Mental Math Tricks (`💡`)**, **Commutative Twin badges**, **True 36 Pairs** & **🔥 Boss 15** decks, **`1 → 3 → 7` Expanding Retrieval Spacing**, and **Missing-Factor Fact Families (`7 × ? = 56`)** with full UI controls.
5. **`v1.4` — Anti-Skip UI Lock, Proximity Coaching & Varied Praise**:
   - Removed the "Next Card" skip button on flipped cards after observing the user tapping through misses.
   - Added a strict **UI & Keypad Lock** during failure audio playback, requiring the student to speak or type the correct answer afterward to advance.
   - Added **3-Tier Proximity Feedback** ($\le 1\times$ factor, $1\times\text{–}2\times$ factor, $> 2\times$ factor) and 16+ varied voice compliments + streak callouts on correct answers.

---

## 📂 Architecture & Tech Stack

- **Environment**: 100% Static HTML5 / CSS3 / Vanilla JavaScript (zero external dependencies, zero build step, zero backend).
- **Files**:
  - [`index.html`](index.html) — Mobile viewport shell, Lobby controls, 3D Flashcard stage, Keypad, 12 × 12 Mastery Grid modal, and Settings sheet.
  - [`style.css`](style.css) — Portrait-optimized dark mode UI, 3D perspective card flip (`rotateY(180deg)`), countdown animations, and locked-state styling.
  - [`app.js`](app.js) — Game state machine, spoken number parser, Web Speech API coordinator, mental math trick generator, 3-tier proximity evaluator, and `1 → 3 → 7` spacing queue.
  - [`sw.js`](sw.js) & [`manifest.json`](manifest.json) — Installable PWA configuration with Network-First fetching.
  - [`assets/app-preview.svg`](assets/app-preview.svg) — Dual-phone vector preview of Question and Flipped Active Echo states.

## 🚀 Running Locally or Deploying

No build tools required. Serve the root folder with any static server or push to the `main` branch with GitHub Pages enabled:

```powershell
git add .
git commit -m "Update Tutor"
git push
```
