/**
 * Multiplication Gauntlet — Core Engine
 * Covers 1×1 through 12×12 (144 cards), 20s strict timer, auto-engaged SpeechRecognition
 * (ignoring non-numeric speech), 3D card flip reveal, SpeechSynthesis reprimands, and local mastery tracking.
 */

const STORAGE_KEY_STATS = 'gauntlet_144_stats_v1';
const STORAGE_KEY_SETTINGS = 'gauntlet_settings_v1';

const TIMEOUT_REPRIMANDS = [
  "Too slow! Pay attention!",
  "Time is up! Faster!",
  "Wake up! You ran out of time!",
  "Way too slow! Stay sharp!",
  "Clock hit zero! Memorize this!"
];

const WRONG_REPRIMANDS = [
  "Wrong! Pay attention!",
  "Nope! Focus!",
  "Incorrect! Lock this in!",
  "Not quite! Memorize it!"
];

// Default settings
const defaultSettings = {
  roundSize: 15,
  timerSeconds: 20,
  autoMic: true,
  speakQuestion: false,
  autoKeypad: true,
  keypadVisible: true,
  preset: 'all', // 'all' | 'core' | 'hard' | 'weak' | 'custom'
  activeFactors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
};

let settings = loadSettings();
let stats144 = loadStats();

// Runtime Game State
const state = {
  phase: 'LOBBY', // 'LOBBY' | 'QUESTION' | 'REVEAL' | 'VICTORY'
  queue: [],
  currentCard: null,
  typedInput: '',
  targetCount: 15,
  clearedCount: 0,
  streak: 0,
  retriesCount: 0,
  roundMissedCards: new Set(),
  roundTimesMs: [],
  cardStartTimeMs: 0,
  timerRemainingMs: 20000,
  timerIntervalId: null,
  revealAutoAdvanceId: null,
  pendingWrongNumberTimerId: null,
  cardResultCounter: 0 // prevents stale callbacks across cards
};

// Speech Recognition State
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecognitionActive = false;
let isSpeakingTTS = false;
let micPermissionDenied = false;

// DOM References
const dom = {
  screenStart: document.getElementById('screen-start'),
  screenGame: document.getElementById('screen-game'),
  screenVictory: document.getElementById('screen-victory'),
  hudStats: document.getElementById('hud-stats'),
  statScore: document.getElementById('stat-score'),
  statRemaining: document.getElementById('stat-remaining'),
  statStreak: document.getElementById('stat-streak'),
  masteryPct: document.getElementById('mastery-pct'),
  lobbyMasteryCount: document.getElementById('lobby-mastery-count'),
  lobbyMasteryFill: document.getElementById('lobby-mastery-fill'),
  activeTablesLabel: document.getElementById('active-tables-label'),
  timerStatusText: document.getElementById('timer-status-text'),
  timerSeconds: document.getElementById('timer-seconds'),
  timerBarFill: document.getElementById('timer-bar-fill'),
  flashcard: document.getElementById('flashcard'),
  cardTag: document.getElementById('card-tag'),
  factorA: document.getElementById('factor-a'),
  factorB: document.getElementById('factor-b'),
  answerSlot: document.getElementById('answer-slot'),
  voiceBar: document.getElementById('voice-bar'),
  micStatusLabel: document.getElementById('mic-status-label'),
  voiceTranscript: document.getElementById('voice-transcript'),
  revealBanner: document.getElementById('reveal-banner'),
  revealEquation: document.getElementById('reveal-equation'),
  revealDetail: document.getElementById('reveal-detail'),
  keypadGrid: document.getElementById('keypad-grid'),
  keypadToggleLabel: document.getElementById('keypad-toggle-label'),
  modalGrid: document.getElementById('modal-grid'),
  matrixContainer: document.getElementById('matrix-container'),
  modalSettings: document.getElementById('modal-settings'),
  settingTimer: document.getElementById('setting-timer'),
  settingMic: document.getElementById('setting-mic'),
  settingSpeakQuestion: document.getElementById('setting-speak-question'),
  settingAutoKeypad: document.getElementById('setting-auto-keypad'),
  customFactorToggles: document.getElementById('custom-factor-toggles'),
  vCleared: document.getElementById('v-cleared'),
  vFirstTry: document.getElementById('v-first-try'),
  vAvgTime: document.getElementById('v-avg-time'),
  vRetries: document.getElementById('v-retries'),
  missedReviewBox: document.getElementById('missed-review-box'),
  missedChips: document.getElementById('missed-chips')
};

/* ==========================================================================
   INITIALIZATION & STORAGE
   ========================================================================== */

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch {
    // Ignore storage quota issues
  }
}

function loadStats() {
  const initial = {};
  for (let a = 1; a <= 12; a++) {
    for (let b = 1; b <= 12; b++) {
      const id = `${a}x${b}`;
      initial[id] = { a, b, product: a * b, hits: 0, misses: 0, streak: 0, lastMs: null };
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATS);
    if (!raw) return initial;
    const saved = JSON.parse(raw);
    for (const key of Object.keys(initial)) {
      if (saved[key]) {
        initial[key] = { ...initial[key], ...saved[key] };
      }
    }
    return initial;
  } catch {
    return initial;
  }
}

function saveStats() {
  try {
    localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats144));
  } catch {
    // Ignore storage errors
  }
  updateMasteryUI();
}

function getCardStatus(stat) {
  if (!stat || (stat.hits === 0 && stat.misses === 0)) return 'unseen';
  if (stat.streak >= 2 || (stat.hits >= 2 && stat.misses === 0)) return 'mastered';
  if (stat.misses > stat.hits || stat.streak === 0) return 'struggling';
  return 'learning';
}

function updateMasteryUI() {
  const all = Object.values(stats144);
  const mastered = all.filter(s => getCardStatus(s) === 'mastered').length;
  const pct = Math.round((mastered / 144) * 100);
  dom.masteryPct.textContent = `${pct}%`;
  dom.lobbyMasteryCount.textContent = `${mastered} / 144 Mastered (${pct}%)`;
  dom.lobbyMasteryFill.style.width = `${pct}%`;
}

/* ==========================================================================
   DECK BUILDER (1x1 to 12x12 = 144 CARDS)
   ========================================================================== */

function getEligibleCards() {
  const allCards = Object.values(stats144);
  if (settings.preset === 'weak') {
    const weakOnes = allCards.filter(c => {
      const st = getCardStatus(c);
      return st === 'struggling' || st === 'unseen' || st === 'learning';
    });
    return weakOnes.length >= 5 ? weakOnes : allCards;
  }

  const activeSet = new Set(settings.activeFactors);
  const filtered = allCards.filter(c => activeSet.has(c.a) || activeSet.has(c.b));
  return filtered.length > 0 ? filtered : allCards;
}

function buildRoundQueue() {
  const pool = getEligibleCards();
  const count = Math.min(settings.roundSize, pool.length);

  // Weight cards so missed/struggling & unseen cards appear more often
  const weighted = pool.map(card => {
    const st = getCardStatus(card);
    let weight = 1 + Math.random() * 0.6;
    if (st === 'struggling') weight += 3.0;
    else if (st === 'unseen') weight += 1.5;
    else if (st === 'learning') weight += 0.8;
    return { card, weight };
  });

  weighted.sort((x, y) => y.weight - x.weight);
  const selected = weighted.slice(0, count).map(item => ({
    a: item.card.a,
    b: item.card.b,
    product: item.card.product,
    id: `${item.card.a}x${item.card.b}`,
    isRetry: false
  }));

  // Shuffle selected cards for the round
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  return selected;
}

/* ==========================================================================
   SPOKEN NUMBER PARSER (IGNORES NON-NUMERIC SPEECH)
   ========================================================================== */

const WORD_TO_NUM = {
  zero: 0, oh: 0,
  one: 1, won: 1,
  two: 2, to: 2, too: 2, tu: 2,
  three: 3, free: 3,
  four: 4, for: 4, fore: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8, ate: 8, ait: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40, fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};

/**
 * Extracts spoken numbers from a speech transcript.
 * Returns an array of integers (0..200). If only non-numeric words were spoken, returns [].
 * Also strips out the question phrase if the user repeats "7 times 8" out loud.
 */
function extractSpokenNumbers(rawTranscript, currentCard) {
  if (!rawTranscript) return [];
  let text = rawTranscript.toLowerCase().trim();

  // If the kid repeats the question aloud (e.g. "7 times 8 is 56" or "7 * 8"), strip the question prefix
  if (currentCard) {
    const { a, b } = currentCard;
    const questionRegex = new RegExp(`\\b${a}\\s*(?:times|x|\\*|by|multiplied by)\\s*${b}\\b`, 'gi');
    text = text.replace(questionRegex, ' ');
  }

  // Normalize hyphens and punctuation
  text = text.replace(/[-]/g, ' ').replace(/[^a-z0-9\s]/g, ' ');
  const tokens = text.split(/\s+/).filter(Boolean);

  const numbers = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // Direct digit token (e.g., "56", "144")
    if (/^\d+$/.test(tok)) {
      const val = parseInt(tok, 10);
      if (val >= 0 && val <= 999) {
        numbers.push(val);
      }
      i++;
      continue;
    }

    // "one hundred [and] [forty] [four]" or "a hundred [and] ..."
    if ((tok === 'one' || tok === 'a') && tokens[i + 1] === 'hundred') {
      let total = 100;
      i += 2;
      if (tokens[i] === 'and') i++;
      if (i < tokens.length && WORD_TO_NUM[tokens[i]] !== undefined) {
        const nextVal = WORD_TO_NUM[tokens[i]];
        if (nextVal >= 20 && nextVal <= 90) {
          total += nextVal;
          i++;
          if (i < tokens.length && WORD_TO_NUM[tokens[i]] !== undefined && WORD_TO_NUM[tokens[i]] < 10) {
            total += WORD_TO_NUM[tokens[i]];
            i++;
          }
        } else if (nextVal < 20) {
          total += nextVal;
          i++;
        }
      }
      numbers.push(total);
      continue;
    }

    // Compound tens + ones (e.g., "fifty six" -> 56)
    if (WORD_TO_NUM[tok] !== undefined) {
      const val = WORD_TO_NUM[tok];
      if (val >= 20 && val <= 90) {
        let total = val;
        if (
          i + 1 < tokens.length &&
          WORD_TO_NUM[tokens[i + 1]] !== undefined &&
          WORD_TO_NUM[tokens[i + 1]] >= 1 &&
          WORD_TO_NUM[tokens[i + 1]] <= 9
        ) {
          total += WORD_TO_NUM[tokens[i + 1]];
          i += 2;
        } else {
          i++;
        }
        numbers.push(total);
        continue;
      } else {
        numbers.push(val);
        i++;
        continue;
      }
    }

    // Non-numeric word — ignore and continue scanning
    i++;
  }

  return numbers;
}

/* ==========================================================================
   WEB SPEECH API: SPEECH RECOGNITION & SPEECH SYNTHESIS
   ========================================================================== */

function initSpeechRecognition() {
  if (!SpeechRecognitionAPI) {
    dom.micStatusLabel.textContent = 'Voice unavailable on this browser';
    dom.voiceTranscript.textContent = 'Use keypad below to answer';
    return;
  }

  recognition = new SpeechRecognitionAPI();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    isRecognitionActive = true;
    updateVoiceBarUI(true, 'Listening for number...');
  };

  recognition.onresult = (event) => {
    if (state.phase !== 'QUESTION' || !state.currentCard || isSpeakingTTS) return;

    const cardToken = state.cardResultCounter;
    let latestTranscript = '';
    let isFinalResult = false;
    const allCandidates = [];

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) isFinalResult = true;
      for (let altIdx = 0; altIdx < res.length; altIdx++) {
        const transcript = res[altIdx].transcript.trim();
        if (altIdx === 0) latestTranscript = transcript;
        const extracted = extractSpokenNumbers(transcript, state.currentCard);
        for (const num of extracted) {
          allCandidates.push(num);
        }
      }
    }

    if (allCandidates.length === 0) {
      // Only non-numeric text was spoken — ignore it and keep listening!
      if (latestTranscript) {
        dom.voiceTranscript.textContent = `Heard "${latestTranscript}" (waiting for a number...)`;
      }
      return;
    }

    const target = state.currentCard.product;

    // 1. If any candidate matches the exact right answer, accept immediately!
    if (allCandidates.includes(target)) {
      clearTimeout(state.pendingWrongNumberTimerId);
      dom.answerSlot.textContent = String(target);
      dom.answerSlot.classList.add('filled');
      dom.voiceTranscript.textContent = `🎙️ Heard: ${target} ✓`;
      handleCorrectAnswer();
      return;
    }

    // 2. A number was spoken, but it doesn't match target yet.
    // Could be mid-utterance (e.g. "fifty..." on the way to "fifty six" or "100..." on the way to "144").
    const spokenNum = allCandidates[allCandidates.length - 1];
    dom.answerSlot.textContent = String(spokenNum);
    dom.answerSlot.classList.add('filled');
    dom.voiceTranscript.textContent = `🎙️ Heard number: ${spokenNum}`;

    clearTimeout(state.pendingWrongNumberTimerId);
    const delayMs = isFinalResult ? 350 : 750;
    state.pendingWrongNumberTimerId = setTimeout(() => {
      if (state.phase === 'QUESTION' && state.cardResultCounter === cardToken) {
        handleWrongAnswer(spokenNum, 'voice');
      }
    }, delayMs);
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      micPermissionDenied = true;
      updateVoiceBarUI(false, 'Mic permission blocked — tap to retry or use keypad');
    } else if (event.error === 'no-speech') {
      // Normal when quiet; onend will auto-restart while timer is running
    }
  };

  recognition.onend = () => {
    isRecognitionActive = false;
    // Automatically keep microphone engaged while question is active and 20s timer is running
    if (
      state.phase === 'QUESTION' &&
      settings.autoMic &&
      !micPermissionDenied &&
      !isSpeakingTTS
    ) {
      setTimeout(() => {
        if (state.phase === 'QUESTION' && settings.autoMic && !isRecognitionActive && !isSpeakingTTS) {
          startListeningSafely();
        }
      }, 120);
    } else {
      updateVoiceBarUI(false, settings.autoMic ? 'Mic paused' : 'Mic off (tap to enable)');
    }
  };
}

function startListeningSafely() {
  if (!recognition || micPermissionDenied || !settings.autoMic || isSpeakingTTS) {
    updateVoiceBarUI(false, settings.autoMic ? 'Voice paused' : 'Mic off (tap to enable)');
    return;
  }
  if (isRecognitionActive) return;
  try {
    recognition.start();
  } catch {
    // Already started or transitioning
  }
}

function stopListeningSafely() {
  if (!recognition) return;
  try {
    recognition.abort();
  } catch {
    // Ignore
  }
  isRecognitionActive = false;
}

function updateVoiceBarUI(listening, labelText) {
  dom.voiceBar.classList.toggle('listening', listening);
  dom.micStatusLabel.textContent = labelText;
}

/**
 * Speaks a phrase using window.speechSynthesis while pausing SpeechRecognition
 * so the microphone does not pick up the phone's own speaker.
 */
function speakText(text, onDone) {
  if (!('speechSynthesis' in window)) {
    if (onDone) onDone();
    return;
  }

  isSpeakingTTS = true;
  stopListeningSafely();

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.08;
    utterance.pitch = 1.0;
    utterance.lang = 'en-US';

    let finished = false;
    const finishOnce = () => {
      if (finished) return;
      finished = true;
      isSpeakingTTS = false;
      if (onDone) onDone();
    };

    utterance.onend = finishOnce;
    utterance.onerror = finishOnce;

    // Fallback safety timer in case mobile browser never fires onend
    const safetyMs = Math.max(2200, text.length * 95);
    setTimeout(finishOnce, safetyMs);

    window.speechSynthesis.speak(utterance);
  } catch {
    isSpeakingTTS = false;
    if (onDone) onDone();
  }
}

/* ==========================================================================
   CORE GAME LOOP & 20-SECOND TIMER
   ========================================================================== */

function startGauntletRound() {
  clearAllTimers();
  state.queue = buildRoundQueue();
  state.targetCount = state.queue.length;
  state.clearedCount = 0;
  state.streak = 0;
  state.retriesCount = 0;
  state.roundMissedCards.clear();
  state.roundTimesMs = [];

  showScreen('GAME');
  dom.hudStats.classList.remove('hidden');
  updateHudStats();

  // Warm up speechSynthesis on user tap gesture (required by mobile browsers)
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
  }

  loadNextCard();
}

function loadNextCard() {
  clearAllTimers();
  state.cardResultCounter++;

  if (state.queue.length === 0) {
    finishRoundVictory();
    return;
  }

  state.phase = 'QUESTION';
  state.currentCard = state.queue.shift();
  state.typedInput = '';

  // Ensure card is flipped to Front
  dom.flashcard.classList.remove('flipped');

  // Render card front
  dom.factorA.textContent = state.currentCard.a;
  dom.factorB.textContent = state.currentCard.b;
  dom.answerSlot.textContent = '?';
  dom.answerSlot.classList.remove('filled');

  if (state.currentCard.isRetry) {
    dom.cardTag.textContent = '🔁 RETRY CARD — MUST CLEAR';
    dom.cardTag.classList.add('retry');
  } else {
    dom.cardTag.textContent = `CARD ${state.clearedCount + 1} OF ${state.targetCount}`;
    dom.cardTag.classList.remove('retry');
  }

  dom.voiceTranscript.textContent = settings.autoMic
    ? 'Say the number out loud (or use keypad)'
    : 'Type the answer on the keypad';

  updateHudStats();

  // Reset countdown bar to 100%
  const totalMs = settings.timerSeconds * 1000;
  state.timerRemainingMs = totalMs;
  renderTimerUI(totalMs, totalMs);

  const beginCountdownAndMic = () => {
    if (state.phase !== 'QUESTION') return;
    state.cardStartTimeMs = performance.now();
    startCountdownLoop();
    if (settings.autoMic) {
      startListeningSafely();
    }
  };

  if (settings.speakQuestion) {
    speakText(`${state.currentCard.a} times ${state.currentCard.b}`, beginCountdownAndMic);
  } else {
    beginCountdownAndMic();
  }
}

function startCountdownLoop() {
  clearInterval(state.timerIntervalId);
  const totalMs = settings.timerSeconds * 1000;
  const tickRateMs = 100;

  state.timerIntervalId = setInterval(() => {
    if (state.phase !== 'QUESTION') {
      clearInterval(state.timerIntervalId);
      return;
    }

    state.timerRemainingMs = Math.max(0, totalMs - (performance.now() - state.cardStartTimeMs));
    renderTimerUI(state.timerRemainingMs, totalMs);

    if (state.timerRemainingMs <= 0) {
      clearInterval(state.timerIntervalId);
      handleTimeoutPenalty();
    }
  }, tickRateMs);
}

function renderTimerUI(remainingMs, totalMs) {
  const sec = (remainingMs / 1000).toFixed(1);
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));

  dom.timerSeconds.textContent = `${sec}s`;
  dom.timerBarFill.style.width = `${pct}%`;

  const isDanger = remainingMs <= 5000;
  const isWarn = !isDanger && remainingMs <= 10000;

  dom.timerSeconds.classList.toggle('warn', isWarn);
  dom.timerSeconds.classList.toggle('danger', isDanger);
  dom.timerBarFill.classList.toggle('warn', isWarn);
  dom.timerBarFill.classList.toggle('danger', isDanger);
}

/* ==========================================================================
   ANSWER VALIDATION, CARD FLIP & PENALTY SYSTEM
   ========================================================================== */

function handleCorrectAnswer() {
  if (state.phase !== 'QUESTION' || !state.currentCard) return;
  clearAllTimers();
  state.cardResultCounter++;

  const elapsedMs = Math.max(200, performance.now() - state.cardStartTimeMs);
  state.roundTimesMs.push(elapsedMs);
  state.clearedCount++;
  state.streak++;

  // Update 144 mastery stats
  const stat = stats144[state.currentCard.id];
  if (stat) {
    stat.hits++;
    stat.streak++;
    stat.lastMs = Math.round(elapsedMs);
    saveStats();
  }

  // Brief green flash
  document.body.classList.add('success-flash');
  setTimeout(() => document.body.classList.remove('success-flash'), 260);

  updateHudStats();

  // Short transition to next card
  setTimeout(() => {
    loadNextCard();
  }, 240);
}

function handleTimeoutPenalty() {
  if (state.phase !== 'QUESTION' || !state.currentCard) return;
  const phrase = TIMEOUT_REPRIMANDS[Math.floor(Math.random() * TIMEOUT_REPRIMANDS.length)];
  triggerCardFlipAndRequeue({
    bannerText: `⏰ TIME'S UP! (${settings.timerSeconds}s EXPIRED)`,
    reprimandSpeech: phrase
  });
}

function handleWrongAnswer(wrongVal, source = 'keypad') {
  if (state.phase !== 'QUESTION' || !state.currentCard) return;
  const phrase = WRONG_REPRIMANDS[Math.floor(Math.random() * WRONG_REPRIMANDS.length)];
  const label = wrongVal !== undefined && wrongVal !== ''
    ? `❌ NOPE! YOU ${source === 'voice' ? 'SAID' : 'ENTERED'} ${wrongVal}`
    : `🔄 CARD FLIPPED`;

  triggerCardFlipAndRequeue({
    bannerText: label,
    reprimandSpeech: phrase
  });
}

function triggerCardFlipAndRequeue({ bannerText, reprimandSpeech }) {
  clearAllTimers();
  state.cardResultCounter++;
  state.phase = 'REVEAL';

  const card = state.currentCard;
  state.streak = 0;
  state.retriesCount++;
  state.roundMissedCards.add(`${card.a} × ${card.b} = ${card.product}`);

  // Update 144 stats
  const stat = stats144[card.id];
  if (stat) {
    stat.misses++;
    stat.streak = 0;
    saveStats();
  }

  // Re-queue this card so they MUST get it right later in the round (insert 2..4 spots back)
  const retryCard = { ...card, isRetry: true };
  const insertIndex = Math.min(state.queue.length, Math.max(1, Math.floor(Math.random() * 3) + 2));
  state.queue.splice(insertIndex, 0, retryCard);

  updateHudStats();

  // 1. Flash <body> background color to #ff0000 (red) for 500ms
  document.body.classList.add('penalty-flash');
  setTimeout(() => {
    document.body.classList.remove('penalty-flash');
  }, 500);

  // 2. Populate & Flip the 3D Flashcard to show the full equation
  dom.revealBanner.textContent = bannerText;
  dom.revealEquation.textContent = `${card.a} × ${card.b} = ${card.product}`;
  dom.revealDetail.textContent = `Re-queued! (${state.queue.length} left in pile)`;
  dom.flashcard.classList.add('flipped');

  // 3. Speak the reprimand + the full equation out loud so they memorize it
  const fullSpeech = `${reprimandSpeech} ${card.a} times ${card.b} is ${card.product}!`;
  const revealCardToken = state.cardResultCounter;

  speakText(fullSpeech, () => {
    if (state.phase !== 'REVEAL' || state.cardResultCounter !== revealCardToken) return;
    // Give them 1.6s after speech ends to absorb the visual equation, then advance automatically
    state.revealAutoAdvanceId = setTimeout(() => {
      if (state.phase === 'REVEAL' && state.cardResultCounter === revealCardToken) {
        loadNextCard();
      }
    }, 1600);
  });
}

/* ==========================================================================
   KEYPAD & KEYBOARD INPUT
   ========================================================================== */

function handleKeypadInput(key) {
  if (state.phase === 'REVEAL') {
    if (key === 'enter') {
      loadNextCard();
    }
    return;
  }

  if (state.phase !== 'QUESTION' || !state.currentCard) return;

  if (key === 'clear') {
    state.typedInput = state.typedInput.slice(0, -1);
    dom.answerSlot.textContent = state.typedInput || '?';
    dom.answerSlot.classList.toggle('filled', state.typedInput.length > 0);
    return;
  }

  if (key === 'enter') {
    if (!state.typedInput) return;
    const val = parseInt(state.typedInput, 10);
    if (val === state.currentCard.product) {
      handleCorrectAnswer();
    } else {
      handleWrongAnswer(val, 'keypad');
    }
    return;
  }

  // Digit 0-9
  if (/^\d$/.test(key) && state.typedInput.length < 3) {
    state.typedInput += key;
    dom.answerSlot.textContent = state.typedInput;
    dom.answerSlot.classList.add('filled');

    const val = parseInt(state.typedInput, 10);
    const targetStr = String(state.currentCard.product);

    if (settings.autoKeypad && val === state.currentCard.product) {
      handleCorrectAnswer();
    } else if (state.typedInput.length >= targetStr.length && val !== state.currentCard.product) {
      // Typed full digit length and it's wrong
      setTimeout(() => {
        if (state.phase === 'QUESTION' && state.typedInput === String(val)) {
          handleWrongAnswer(val, 'keypad');
        }
      }, 180);
    }
  }
}

/* ==========================================================================
   HUD, VICTORY & MODALS
   ========================================================================== */

function updateHudStats() {
  dom.statScore.textContent = `${state.clearedCount} / ${state.targetCount}`;
  const remaining = state.queue.length + (state.phase === 'QUESTION' || state.phase === 'REVEAL' ? 1 : 0);
  dom.statRemaining.textContent = String(remaining);
  dom.statStreak.textContent = `🔥 ${state.streak}`;
}

function finishRoundVictory() {
  clearAllTimers();
  stopListeningSafely();
  state.phase = 'VICTORY';

  showScreen('VICTORY');

  const firstTryHits = Math.max(0, state.targetCount - state.roundMissedCards.size);
  const firstTryPct = state.targetCount > 0 ? Math.round((firstTryHits / state.targetCount) * 100) : 100;
  const avgMs = state.roundTimesMs.length > 0
    ? state.roundTimesMs.reduce((a, b) => a + b, 0) / state.roundTimesMs.length
    : 0;

  dom.vCleared.textContent = String(state.targetCount);
  dom.vFirstTry.textContent = `${firstTryPct}%`;
  dom.vAvgTime.textContent = `${(avgMs / 1000).toFixed(1)}s`;
  dom.vRetries.textContent = String(state.retriesCount);

  if (state.roundMissedCards.size > 0) {
    dom.missedReviewBox.classList.remove('hidden');
    dom.missedChips.innerHTML = '';
    for (const eq of state.roundMissedCards) {
      const span = document.createElement('span');
      span.className = 'missed-chip';
      span.textContent = eq;
      dom.missedChips.appendChild(span);
    }
  } else {
    dom.missedReviewBox.classList.add('hidden');
  }

  speakText(`Gauntlet complete! You cleared ${state.targetCount} cards with ${firstTryPct} percent first try accuracy!`);
}

function showScreen(name) {
  dom.screenStart.classList.toggle('active', name === 'LOBBY');
  dom.screenGame.classList.toggle('active', name === 'GAME');
  dom.screenVictory.classList.toggle('active', name === 'VICTORY');
  if (name === 'LOBBY') {
    dom.hudStats.classList.add('hidden');
    updateMasteryUI();
  }
}

function clearAllTimers() {
  clearInterval(state.timerIntervalId);
  clearTimeout(state.revealAutoAdvanceId);
  clearTimeout(state.pendingWrongNumberTimerId);
}

function renderMasteryMatrix() {
  dom.matrixContainer.innerHTML = '';

  // Top-left corner
  const corner = document.createElement('div');
  corner.className = 'matrix-cell matrix-header';
  corner.textContent = '×';
  dom.matrixContainer.appendChild(corner);

  // Column headers 1..12
  for (let col = 1; col <= 12; col++) {
    const ch = document.createElement('div');
    ch.className = 'matrix-cell matrix-header';
    ch.textContent = String(col);
    dom.matrixContainer.appendChild(ch);
  }

  // Rows 1..12
  for (let r = 1; r <= 12; r++) {
    const rh = document.createElement('div');
    rh.className = 'matrix-cell matrix-header';
    rh.textContent = String(r);
    dom.matrixContainer.appendChild(rh);

    for (let c = 1; c <= 12; c++) {
      const id = `${r}x${c}`;
      const stat = stats144[id];
      const status = getCardStatus(stat);
      const cell = document.createElement('div');
      cell.className = `matrix-cell cell-${status}`;
      cell.textContent = String(r * c);
      cell.title = `${r} × ${c} = ${r * c} | Hits: ${stat.hits}, Misses: ${stat.misses}`;
      dom.matrixContainer.appendChild(cell);
    }
  }
}

function renderFactorToggles() {
  dom.customFactorToggles.innerHTML = '';
  for (let f = 1; f <= 12; f++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `factor-toggle-btn ${settings.activeFactors.includes(f) ? 'active' : ''}`;
    btn.textContent = `${f}×`;
    btn.addEventListener('click', () => {
      if (settings.activeFactors.includes(f)) {
        if (settings.activeFactors.length > 1) {
          settings.activeFactors = settings.activeFactors.filter(x => x !== f);
        }
      } else {
        settings.activeFactors.push(f);
        settings.activeFactors.sort((a, b) => a - b);
      }
      settings.preset = 'custom';
      saveSettings();
      syncLobbyControlsUI();
      renderFactorToggles();
    });
    dom.customFactorToggles.appendChild(btn);
  }
}

function syncLobbyControlsUI() {
  // Timer Per Card buttons on Lobby
  document.querySelectorAll('#timer-size-control .seg-btn').forEach(btn => {
    const t = parseInt(btn.dataset.timer, 10);
    btn.classList.toggle('active', t === settings.timerSeconds);
  });

  // Round size buttons
  document.querySelectorAll('#round-size-control .seg-btn').forEach(btn => {
    const sz = parseInt(btn.dataset.size, 10);
    btn.classList.toggle('active', sz === settings.roundSize);
  });

  // Preset chips
  document.querySelectorAll('.preset-row .chip-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === settings.preset);
  });

  const eligibleCount = getEligibleCards().length;
  dom.activeTablesLabel.textContent = `(${eligibleCount} facts in pool)`;

  // Settings form controls
  dom.settingTimer.value = String(settings.timerSeconds);
  dom.settingMic.checked = settings.autoMic;
  dom.settingSpeakQuestion.checked = settings.speakQuestion;
  dom.settingAutoKeypad.checked = settings.autoKeypad;

  dom.keypadGrid.classList.toggle('hidden', !settings.keypadVisible);
  dom.keypadToggleLabel.textContent = settings.keypadVisible ? '⌨️ Hide Keypad' : '⌨️ Show Keypad';
}

/* ==========================================================================
   EVENT LISTENERS & BOOTSTRAP
   ========================================================================== */

function bindEvents() {
  // Start Gauntlet
  document.getElementById('btn-start-gauntlet').addEventListener('click', startGauntletRound);
  document.getElementById('btn-play-again').addEventListener('click', startGauntletRound);
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    clearAllTimers();
    stopListeningSafely();
    state.phase = 'LOBBY';
    showScreen('LOBBY');
  });

  // Timer Per Card Selector (Lobby)
  document.querySelectorAll('#timer-size-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.timerSeconds = parseInt(btn.dataset.timer, 10);
      saveSettings();
      syncLobbyControlsUI();
    });
  });

  // Round Size Selector
  document.querySelectorAll('#round-size-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.roundSize = parseInt(btn.dataset.size, 10);
      saveSettings();
      syncLobbyControlsUI();
    });
  });

  // Table Presets
  document.querySelectorAll('.preset-row .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      settings.preset = preset;
      if (preset === 'all') settings.activeFactors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      else if (preset === 'core') settings.activeFactors = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      else if (preset === 'hard') settings.activeFactors = [6, 7, 8, 9, 11, 12];
      saveSettings();
      syncLobbyControlsUI();
      renderFactorToggles();
    });
  });

  // Flip / Show Answer button on card front
  document.getElementById('btn-flip-giveup').addEventListener('click', () => {
    if (state.phase === 'QUESTION') {
      handleWrongAnswer('', 'flip');
    }
  });

  // Next Card button on card back
  document.getElementById('btn-next-after-flip').addEventListener('click', () => {
    if (state.phase === 'REVEAL') {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      isSpeakingTTS = false;
      loadNextCard();
    }
  });

  // Toggle Mic button
  document.getElementById('btn-mic-toggle').addEventListener('click', () => {
    micPermissionDenied = false;
    settings.autoMic = !settings.autoMic;
    saveSettings();
    syncLobbyControlsUI();
    if (settings.autoMic && state.phase === 'QUESTION') {
      startListeningSafely();
    } else {
      stopListeningSafely();
      updateVoiceBarUI(false, 'Mic off (tap to enable)');
    }
  });

  // Toggle Keypad visibility
  document.getElementById('btn-toggle-keypad').addEventListener('click', () => {
    settings.keypadVisible = !settings.keypadVisible;
    saveSettings();
    syncLobbyControlsUI();
  });

  // On-Screen Keypad Buttons
  dom.keypadGrid.querySelectorAll('.key-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      handleKeypadInput(btn.dataset.key);
    });
  });

  // Hardware Keyboard Support
  window.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') {
      handleKeypadInput(e.key);
    } else if (e.key === 'Backspace') {
      handleKeypadInput('clear');
    } else if (e.key === 'Enter') {
      handleKeypadInput('enter');
    }
  });

  // 12x12 Mastery Grid Modal
  document.getElementById('btn-grid').addEventListener('click', () => {
    renderMasteryMatrix();
    dom.modalGrid.classList.remove('hidden');
  });
  document.getElementById('btn-close-grid').addEventListener('click', () => {
    dom.modalGrid.classList.add('hidden');
  });
  document.getElementById('btn-reset-progress').addEventListener('click', () => {
    if (confirm('Reset all 144 multiplication mastery stats?')) {
      localStorage.removeItem(STORAGE_KEY_STATS);
      stats144 = loadStats();
      saveStats();
      renderMasteryMatrix();
    }
  });

  // Settings Modal
  document.getElementById('btn-settings').addEventListener('click', () => {
    renderFactorToggles();
    dom.modalSettings.classList.remove('hidden');
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    dom.modalSettings.classList.add('hidden');
  });

  dom.settingTimer.addEventListener('change', () => {
    settings.timerSeconds = parseInt(dom.settingTimer.value, 10) || 20;
    saveSettings();
    syncLobbyControlsUI();
  });
  dom.settingMic.addEventListener('change', () => {
    settings.autoMic = dom.settingMic.checked;
    saveSettings();
    if (state.phase === 'QUESTION') {
      if (settings.autoMic) startListeningSafely();
      else stopListeningSafely();
    }
  });
  dom.settingSpeakQuestion.addEventListener('change', () => {
    settings.speakQuestion = dom.settingSpeakQuestion.checked;
    saveSettings();
  });
  dom.settingAutoKeypad.addEventListener('change', () => {
    settings.autoKeypad = dom.settingAutoKeypad.checked;
    saveSettings();
  });

  document.getElementById('btn-end-round').addEventListener('click', () => {
    dom.modalSettings.classList.add('hidden');
    clearAllTimers();
    stopListeningSafely();
    state.phase = 'LOBBY';
    showScreen('LOBBY');
  });

  // Force Reload / Cache Buster badge on tap
  document.getElementById('app-version').addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    window.location.reload();
  });
}

// Register Network-First Service Worker so refreshing the phone ALWAYS gets the newest push
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

initSpeechRecognition();
bindEvents();
syncLobbyControlsUI();
updateMasteryUI();
