/**
 * Multiplication Gauntlet v1.4 — Research-Backed Learning & Speed Engine
 * Updates in v1.4:
 * - Removed Next Card skip button on flipped cards
 * - Strict UI & Keypad Lock while the failure audio sequence is spoken
 * - Mandatory Active Echo (must say or type the right answer AFTER audio finishes to advance)
 * - Varied voice compliments on every right answer + streak callouts
 * - Proximity-based wrong-answer feedback (<= 1x factor: "You're so close / Nice try",
 *   1x..2x factor: "Come on, you can do better", > 2x factor: "Let's try again, we can do better")
 */

const STORAGE_KEY_STATS = 'gauntlet_144_stats_v1';
const STORAGE_KEY_SETTINGS = 'gauntlet_settings_v2';

const PRAISE_PHRASES = [
  "Boom! Nailed it!",
  "Awesome job!",
  "Crushed it!",
  "Spot on! Keep going!",
  "Yes! Right on the money!",
  "Lightning fast! Nice work!",
  "You got it! Way to go!",
  "Sharp thinking! That's it!",
  "Exact match! Great job!",
  "Bam! You know your stuff!",
  "Superb! Keep that momentum!",
  "Bullseye! Nicely done!",
  "Bingo! Locked it in!",
  "Unstoppable! Great answer!",
  "Brilliant! Keep rolling!",
  "Clean hit! Well done!"
];

const TIMEOUT_REPRIMANDS = [
  "Time is up! Let's lock this one in!",
  "Ran out of time! Listen closely so you nail it next time!",
  "Clock hit zero! Let's learn this fact right now!",
  "Too slow on the clock! Let's memorize this one together!"
];

const CLOSE_WRONG_PHRASES = [
  "Ooh, you're so close! Nice try!",
  "So close! Almost had it!",
  "Nice try! You are right next to the answer!",
  "Super close! Just a tiny bit off!",
  "Good try, you're right in the neighborhood!"
];

const MID_WRONG_PHRASES = [
  "Come on, you can do better than that!",
  "Not quite! Come on, you can get closer than that!",
  "You're a couple groups off—come on, you can do better!",
  "Almost, but focus up—you can do better!",
  "Think carefully, you can do better on this one!"
];

const FAR_WRONG_PHRASES = [
  "Whoa, way off! Let's try again, we can do better!",
  "That one was way off—let's try again, we can do better!",
  "Hold on, let's reset and try again, we can do better!",
  "Way off the mark! Let's learn this one, we can do better!",
  "Let's try again on this one, we can do much better!"
];

const BOSS_15_PAIRS = [
  [6, 6], [6, 7], [6, 8], [6, 9], [6, 12],
  [7, 7], [7, 8], [7, 9], [7, 12],
  [8, 8], [8, 9], [8, 12],
  [9, 12], [11, 12], [12, 12]
];

const defaultSettings = {
  roundSize: 15,
  timerSeconds: 20,
  speakPraise: true,
  retryMode: 'expanding', // 'expanding' (1->3->7) | 'immediate' (1 card) | 'standard' (2-4) | 'off'
  questionMode: 'product', // 'product' (7x8=?) | 'mixed' | 'missing_factor' (7x?=56)
  showTrick: true,
  speakTrick: false,
  showTwin: true,
  autoMic: true,
  speakQuestion: false,
  autoKeypad: true,
  keypadVisible: true,
  preset: 'all', // 'all' | 'true36' | 'boss' | 'core' | 'hard' | 'weak' | 'custom'
  activeFactors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
};

let settings = loadSettings();
let stats144 = loadStats();
let lastPraiseIndex = -1;

// Runtime Game State
const state = {
  phase: 'LOBBY', // 'LOBBY' | 'QUESTION' | 'PRAISE' | 'REVEAL' | 'VICTORY'
  echoUnlocked: false, // False while failure TTS sequence is speaking; True once ready for echo
  queue: [],
  currentCard: null,
  typedInput: '',
  echoInput: '',
  targetCount: 15,
  clearedCount: 0,
  streak: 0,
  retriesCount: 0,
  roundMissedCards: new Set(),
  roundTimesMs: [],
  cardStartTimeMs: 0,
  timerRemainingMs: 20000,
  timerIntervalId: null,
  pendingWrongNumberTimerId: null,
  cardResultCounter: 0
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
  pillEcho: document.getElementById('pill-echo'),
  pillTricks: document.getElementById('pill-tricks'),
  pillSpacing: document.getElementById('pill-spacing'),
  timerStatusText: document.getElementById('timer-status-text'),
  timerSeconds: document.getElementById('timer-seconds'),
  timerBarFill: document.getElementById('timer-bar-fill'),
  flashcard: document.getElementById('flashcard'),
  cardTag: document.getElementById('card-tag'),
  praiseToast: document.getElementById('praise-toast'),
  slotLeft: document.getElementById('slot-left'),
  slotMid: document.getElementById('slot-mid'),
  slotRight: document.getElementById('slot-right'),
  frontTwinBadge: document.getElementById('front-twin-badge'),
  frontHintBox: document.getElementById('front-hint-box'),
  voiceBar: document.getElementById('voice-bar'),
  micStatusLabel: document.getElementById('mic-status-label'),
  voiceTranscript: document.getElementById('voice-transcript'),
  revealBanner: document.getElementById('reveal-banner'),
  revealEquation: document.getElementById('reveal-equation'),
  revealTwin: document.getElementById('reveal-twin'),
  revealTrickBox: document.getElementById('reveal-trick-box'),
  revealTrickText: document.getElementById('reveal-trick-text'),
  echoPromptBox: document.getElementById('echo-prompt-box'),
  echoPromptText: document.getElementById('echo-prompt-text'),
  echoInputPreview: document.getElementById('echo-input-preview'),
  revealDetail: document.getElementById('reveal-detail'),
  keypadGrid: document.getElementById('keypad-grid'),
  keypadToggleLabel: document.getElementById('keypad-toggle-label'),
  modalGrid: document.getElementById('modal-grid'),
  matrixContainer: document.getElementById('matrix-container'),
  modalSettings: document.getElementById('modal-settings'),
  settingTimer: document.getElementById('setting-timer'),
  settingSpeakPraise: document.getElementById('setting-speak-praise'),
  settingRetryMode: document.getElementById('setting-retry-mode'),
  settingQuestionMode: document.getElementById('setting-question-mode'),
  settingShowTrick: document.getElementById('setting-show-trick'),
  settingSpeakTrick: document.getElementById('setting-speak-trick'),
  settingShowTwin: document.getElementById('setting-show-twin'),
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
    // Ignore
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
    // Ignore
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
   COMPLIMENT & PROXIMITY FEEDBACK GENERATORS
   ========================================================================== */

function pickVariedCompliment(streak) {
  if (streak === 5) return "Five in a row! You are on fire!";
  if (streak === 10) return "Ten streak! Unstoppable math machine!";
  if (streak === 15) return "Fifteen straight! Legendary focus!";

  let idx = Math.floor(Math.random() * PRAISE_PHRASES.length);
  if (idx === lastPraiseIndex) {
    idx = (idx + 1) % PRAISE_PHRASES.length;
  }
  lastPraiseIndex = idx;
  return PRAISE_PHRASES[idx];
}

/**
 * Evaluates how close a wrong answer is relative to the factor size:
 * - Off by <= 1x factor (e.g. for 3×9=27, off by <= 9): Supportive ("You're so close! Nice try!")
 * - Off by > 1x factor and <= 2x factor (e.g. 10..18 off): ("Come on, you can do better!")
 * - Off by > 2x factor (e.g. > 18 off): ("Way off! Let's try again, we can do better!")
 */
function getProximityFeedback(card, wrongVal, source) {
  if (wrongVal === undefined || wrongVal === '' || isNaN(Number(wrongVal))) {
    return {
      tierClass: 'mid-tier',
      bannerText: `🔄 LET'S LEARN THIS ONE!`,
      speech: `Let's learn this one together!`
    };
  }

  const numVal = Number(wrongVal);
  const factorStep = Math.max(card.a, card.b);

  // Measure distance in product space
  const diff = card.qType === 'missing_factor'
    ? Math.abs(numVal * card.a - card.product)
    : Math.abs(numVal - card.product);

  const verb = source === 'voice' ? 'said' : 'typed';

  // Tier 1: Off by <= 1x factor
  if (diff <= factorStep) {
    const phrase = CLOSE_WRONG_PHRASES[Math.floor(Math.random() * CLOSE_WRONG_PHRASES.length)];
    return {
      tierClass: 'close-tier',
      bannerText: `🔥 SO CLOSE! (You ${verb} ${numVal} — only ${diff} off!)`,
      speech: phrase
    };
  }

  // Tier 2: Off by > 1x factor up to 2x factor
  if (diff <= factorStep * 2) {
    const phrase = MID_WRONG_PHRASES[Math.floor(Math.random() * MID_WRONG_PHRASES.length)];
    return {
      tierClass: 'mid-tier',
      bannerText: `⚡ COME ON, YOU CAN DO BETTER! (You ${verb} ${numVal})`,
      speech: phrase
    };
  }

  // Tier 3: Off by > 2x factor (way off)
  const phrase = FAR_WRONG_PHRASES[Math.floor(Math.random() * FAR_WRONG_PHRASES.length)];
  return {
    tierClass: 'far-tier',
    bannerText: `🎯 WAY OFF — WE CAN DO BETTER! (You ${verb} ${numVal})`,
    speech: phrase
  };
}

/* ==========================================================================
   STEPPING-STONE MENTAL MATH TRICK ENGINE
   ========================================================================== */

function getMentalMathTrick(a, b) {
  const product = a * b;
  const minF = Math.min(a, b);
  const maxF = Math.max(a, b);

  if (minF === 1) {
    return {
      text: `💡 Identity Rule: Anything × 1 stays itself (${maxF} × 1 = ${maxF})`,
      speech: `Anything times 1 stays ${maxF}.`
    };
  }
  if (a === 10 || b === 10) {
    const other = a === 10 ? b : a;
    return {
      text: `💡 10s Anchor: Put a 0 on the end of ${other} → ${product}`,
      speech: `Ten times ${other} is just ${other} with a zero: ${product}.`
    };
  }
  if ((a === 11 || b === 11) && minF <= 9) {
    return {
      text: `💡 11s Twin Pattern: Repeat the digit ${minF} twice → ${product}`,
      speech: `Eleven times ${minF} repeats the digit: ${product}.`
    };
  }
  if (a === 9 || b === 9) {
    const other = a === 9 ? b : a;
    const tenVal = other * 10;
    const d1 = Math.floor(product / 10);
    const d2 = product % 10;
    return {
      text: `💡 10× Step-Back: (10 × ${other} = ${tenVal}) − ${other} = ${product} (Digits ${d1}+${d2}=${d1 + d2})`,
      speech: `10 times ${other} is ${tenVal}, minus ${other} is ${product}.`
    };
  }
  if (a === b) {
    if (a === 6) {
      return {
        text: `💡 Square Landmark: (5 × 6 = 30) + 6 = 36 ("Six times six is thirty-six!")`,
        speech: `5 times 6 is 30, plus 6 more is 36.`
      };
    }
    if (a === 7) {
      return {
        text: `💡 Square Landmark: (5 × 7 = 35) + (2 × 7 = 14) = 49`,
        speech: `5 sevens is 35, plus 2 sevens is 14, makes 49.`
      };
    }
    if (a === 8) {
      return {
        text: `💡 Square Rhyme: "I ate and I ate and got 64!" (8 × 8 = 64)`,
        speech: `8 times 8 is 64.`
      };
    }
    if (a === 12) {
      return {
        text: `💡 Dozen Gross: (10 × 12 = 120) + (2 × 12 = 24) = 144`,
        speech: `10 twelves is 120, plus 2 twelves is 24, makes 144.`
      };
    }
  }
  if (Math.abs(a - b) === 1 && minF >= 3) {
    const sq = minF * minF;
    return {
      text: `💡 Square + 1 Group: (${minF} × ${minF} = ${sq}) + ${minF} more = ${product}`,
      speech: `${minF} times ${minF} is ${sq}, plus ${minF} more is ${product}.`
    };
  }
  if (a === 12 || b === 12) {
    const other = a === 12 ? b : a;
    return {
      text: `💡 12s Split (10 + 2): (10 × ${other} = ${10 * other}) + (2 × ${other} = ${2 * other}) = ${product}`,
      speech: `10 times ${other} is ${10 * other}, plus 2 times ${other} is ${2 * other}, makes ${product}.`
    };
  }
  if (a === 5 || b === 5) {
    const other = a === 5 ? b : a;
    return {
      text: `💡 Half of 10×: Half of (10 × ${other} = ${10 * other}) is ${product}`,
      speech: `Half of ${10 * other} is ${product}.`
    };
  }
  if (a === 6 || b === 6) {
    const other = a === 6 ? b : a;
    return {
      text: `💡 5× Stepping Stone: (5 × ${other} = ${5 * other}) + ${other} more = ${product}`,
      speech: `5 times ${other} is ${5 * other}, plus ${other} more is ${product}.`
    };
  }
  if (a === 2 || b === 2) {
    const other = a === 2 ? b : a;
    return {
      text: `💡 Double It: ${other} + ${other} = ${product}`,
      speech: `Double ${other} is ${product}.`
    };
  }
  if (a === 4 || b === 4) {
    const other = a === 4 ? b : a;
    return {
      text: `💡 Double-Double: Double ${other} → ${2 * other}, double again → ${product}`,
      speech: `Double ${other} is ${2 * other}, double again is ${product}.`
    };
  }
  if (a === 8 || b === 8) {
    const other = a === 8 ? b : a;
    return {
      text: `💡 Double 3 Times: ${other} → ${2 * other} → ${4 * other} → ${product}`,
      speech: `Double ${other} three times: ${2 * other}, ${4 * other}, ${product}.`
    };
  }
  if (a === 3 || b === 3) {
    const other = a === 3 ? b : a;
    return {
      text: `💡 Double + 1 Group: (2 × ${other} = ${2 * other}) + ${other} = ${product}`,
      speech: `Double ${other} is ${2 * other}, plus ${other} more is ${product}.`
    };
  }

  return {
    text: `💡 Split Into Parts: (5 × ${maxF} = ${5 * maxF}) + (${minF - 5} × ${maxF} = ${(minF - 5) * maxF}) = ${product}`,
    speech: `5 times ${maxF} is ${5 * maxF}, plus ${(minF - 5) * maxF} is ${product}.`
  };
}

/* ==========================================================================
   DECK BUILDER (144 ALL / TRUE 36 PAIRS / BOSS 15 / CORE / HARD / WEAK)
   ========================================================================== */

function getEligibleCards() {
  const allCards = Object.values(stats144);

  if (settings.preset === 'boss') {
    return BOSS_15_PAIRS.map(([a, b]) => {
      const flip = Math.random() < 0.5;
      const fa = flip ? b : a;
      const fb = flip ? a : b;
      return stats144[`${fa}x${fb}`];
    });
  }

  if (settings.preset === 'true36') {
    const coreFactors = [3, 4, 5, 6, 7, 8, 9, 12];
    const pairs = [];
    for (let i = 0; i < coreFactors.length; i++) {
      for (let j = i; j < coreFactors.length; j++) {
        const a = coreFactors[i];
        const b = coreFactors[j];
        const flip = Math.random() < 0.5;
        const fa = flip ? b : a;
        const fb = flip ? a : b;
        pairs.push(stats144[`${fa}x${fb}`]);
      }
    }
    return pairs;
  }

  if (settings.preset === 'weak') {
    const weakOnes = allCards.filter(c => {
      const st = getCardStatus(c);
      return st === 'struggling' || st === 'unseen' || st === 'learning';
    });
    return weakOnes.length >= 5 ? weakOnes : allCards;
  }

  const activeSet = new Set(settings.activeFactors);
  const filtered = allCards.filter(c => activeSet.has(c.a) && activeSet.has(c.b));
  return filtered.length > 0 ? filtered : allCards;
}

function chooseCardQuestionType() {
  if (settings.questionMode === 'missing_factor') return 'missing_factor';
  if (settings.questionMode === 'mixed') {
    return Math.random() < 0.4 ? 'missing_factor' : 'product';
  }
  return 'product';
}

function buildRoundQueue() {
  const pool = getEligibleCards();
  const count = Math.min(settings.roundSize, pool.length);

  const weighted = pool.map(card => {
    const st = getCardStatus(card);
    let weight = 1 + Math.random() * 0.6;
    if (st === 'struggling') weight += 3.2;
    else if (st === 'unseen') weight += 1.5;
    else if (st === 'learning') weight += 0.8;
    return { card, weight };
  });

  weighted.sort((x, y) => y.weight - x.weight);
  const selected = weighted.slice(0, count).map(item => {
    const qType = chooseCardQuestionType();
    const a = item.card.a;
    const b = item.card.b;
    const product = item.card.product;
    return {
      a,
      b,
      product,
      qType,
      targetAnswer: qType === 'missing_factor' ? b : product,
      id: `${a}x${b}`,
      isRetry: false,
      retryStage: 0
    };
  });

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

function extractSpokenNumbers(rawTranscript, currentCard) {
  if (!rawTranscript) return [];
  let text = rawTranscript.toLowerCase().trim();

  if (currentCard) {
    const { a, b } = currentCard;
    const questionRegex = new RegExp(`\\b${a}\\s*(?:times|x|\\*|by|multiplied by)\\s*${b}\\b`, 'gi');
    text = text.replace(questionRegex, ' ');
  }

  text = text.replace(/[-]/g, ' ').replace(/[^a-z0-9\s]/g, ' ');
  const tokens = text.split(/\s+/).filter(Boolean);

  const numbers = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (/^\d+$/.test(tok)) {
      const val = parseInt(tok, 10);
      if (val >= 0 && val <= 999) {
        numbers.push(val);
      }
      i++;
      continue;
    }

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
    if (state.phase === 'QUESTION') {
      updateVoiceBarUI(true, 'Listening for number...');
    } else if (state.phase === 'REVEAL' && state.echoUnlocked) {
      dom.echoPromptBox.classList.add('listening');
    }
  };

  recognition.onresult = (event) => {
    if (!state.currentCard || isSpeakingTTS) return;
    if (state.phase !== 'QUESTION' && state.phase !== 'REVEAL') return;
    // Ignore all speech on REVEAL while locked!
    if (state.phase === 'REVEAL' && !state.echoUnlocked) return;

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

    const target = state.currentCard.targetAnswer;

    // CASE A: Unlocked Active Echo on the Flipped Card Back (REVEAL phase)
    if (state.phase === 'REVEAL') {
      if (allCandidates.includes(target)) {
        completeActiveEcho();
      } else if (allCandidates.length > 0) {
        const heard = allCandidates[allCandidates.length - 1];
        dom.echoInputPreview.textContent = `Heard "${heard}" — say or type "${target}"!`;
      } else if (latestTranscript) {
        dom.echoInputPreview.textContent = `Heard "${latestTranscript}" — say "${target}"!`;
      }
      return;
    }

    // CASE B: Normal Question Answering (QUESTION phase)
    if (allCandidates.length === 0) {
      if (latestTranscript) {
        dom.voiceTranscript.textContent = `Heard "${latestTranscript}" (waiting for a number...)`;
      }
      return;
    }

    const activeSlot = getActiveSlotElement();

    // 1. Exact match -> accept immediately!
    if (allCandidates.includes(target)) {
      clearTimeout(state.pendingWrongNumberTimerId);
      activeSlot.textContent = String(target);
      activeSlot.classList.add('filled');
      dom.voiceTranscript.textContent = `🎙️ Heard: ${target} ✓`;
      handleCorrectAnswer();
      return;
    }

    // 2. Spoken number that does not match yet -> debounce for multi-digit speech
    const spokenNum = allCandidates[allCandidates.length - 1];
    activeSlot.textContent = String(spokenNum);
    activeSlot.classList.add('filled');
    dom.voiceTranscript.textContent = `🎙️ Heard number: ${spokenNum}`;

    clearTimeout(state.pendingWrongNumberTimerId);
    const delayMs = isFinalResult ? 360 : 750;
    state.pendingWrongNumberTimerId = setTimeout(() => {
      if (state.phase === 'QUESTION' && state.cardResultCounter === cardToken) {
        handleWrongAnswer(spokenNum, 'voice');
      }
    }, delayMs);
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      micPermissionDenied = true;
      updateVoiceBarUI(false, 'Mic blocked — tap to retry or use keypad');
    }
  };

  recognition.onend = () => {
    isRecognitionActive = false;
    dom.echoPromptBox.classList.remove('listening');

    const shouldKeepListening =
      !micPermissionDenied &&
      !isSpeakingTTS &&
      settings.autoMic &&
      (state.phase === 'QUESTION' || (state.phase === 'REVEAL' && state.echoUnlocked));

    if (shouldKeepListening) {
      setTimeout(() => {
        if (
          !isRecognitionActive &&
          !isSpeakingTTS &&
          settings.autoMic &&
          (state.phase === 'QUESTION' || (state.phase === 'REVEAL' && state.echoUnlocked))
        ) {
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
    // Ignore if already active
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
  dom.echoPromptBox.classList.remove('listening');
}

function updateVoiceBarUI(listening, labelText) {
  dom.voiceBar.classList.toggle('listening', listening);
  dom.micStatusLabel.textContent = labelText;
}

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
    utterance.rate = 1.02;
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

    // Fallback safety timer so UI never stays locked if mobile TTS drops onend
    const safetyMs = Math.max(2400, text.length * 92);
    setTimeout(finishOnce, safetyMs);

    window.speechSynthesis.speak(utterance);
  } catch {
    isSpeakingTTS = false;
    if (onDone) onDone();
  }
}

/* ==========================================================================
   CORE GAME LOOP & QUESTION RENDERING
   ========================================================================== */

function getActiveSlotElement() {
  if (state.currentCard && state.currentCard.qType === 'missing_factor') {
    return dom.slotMid;
  }
  return dom.slotRight;
}

function setKeypadLocked(locked) {
  dom.keypadGrid.classList.toggle('locked', locked);
}

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
  state.echoUnlocked = false;
  setKeypadLocked(false);

  if (state.queue.length === 0) {
    finishRoundVictory();
    return;
  }

  state.phase = 'QUESTION';
  state.currentCard = state.queue.shift();
  state.typedInput = '';
  state.echoInput = '';

  const card = state.currentCard;

  // Flip to Front
  dom.flashcard.classList.remove('flipped');
  dom.frontHintBox.classList.add('hidden');
  dom.praiseToast.classList.add('hidden');

  // Configure equation slots based on question mode ('product' vs 'missing_factor')
  dom.slotLeft.textContent = String(card.a);
  dom.slotMid.className = 'factor';
  dom.slotRight.className = 'factor';

  if (card.qType === 'missing_factor') {
    dom.slotMid.textContent = '?';
    dom.slotMid.className = 'answer-slot';
    dom.slotRight.textContent = String(card.product);
  } else {
    dom.slotMid.textContent = String(card.b);
    dom.slotRight.textContent = '?';
    dom.slotRight.className = 'answer-slot';
  }

  // Commutative Twin badge on front
  if (settings.showTwin && card.a !== card.b && card.qType === 'product') {
    dom.frontTwinBadge.textContent = `⇄ Same as ${card.b} × ${card.a}`;
    dom.frontTwinBadge.classList.remove('hidden');
  } else if (card.qType === 'missing_factor') {
    dom.frontTwinBadge.textContent = `⇄ Fact Family: ${card.product} ÷ ${card.a} = ?`;
    dom.frontTwinBadge.classList.remove('hidden');
  } else {
    dom.frontTwinBadge.classList.add('hidden');
  }

  // Card Tag (New vs Expanding Retry Stage 1/2/3)
  if (card.isRetry) {
    if (settings.retryMode === 'expanding') {
      const stageLabels = {
        1: '🔁 RETRY 1/3 (1-CARD CHECK)',
        2: '🔁 RETRY 2/3 (3-CARD CHECK)',
        3: '🔁 RETRY 3/3 (7-CARD LOCK-IN)'
      };
      dom.cardTag.textContent = stageLabels[card.retryStage] || '🔁 RETRY CARD';
    } else {
      dom.cardTag.textContent = '🔁 RETRY CARD — MUST CLEAR';
    }
    dom.cardTag.classList.add('retry');
  } else {
    dom.cardTag.textContent = `CARD ${state.clearedCount + 1} OF ${state.targetCount}`;
    dom.cardTag.classList.remove('retry');
  }

  dom.voiceTranscript.textContent = settings.autoMic
    ? 'Say the number out loud (or use keypad)'
    : 'Type the answer on the keypad';

  updateHudStats();

  // Reset countdown bar
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
    const qSpeech = card.qType === 'missing_factor'
      ? `${card.a} times what is ${card.product}?`
      : `${card.a} times ${card.b}`;
    speakText(qSpeech, beginCountdownAndMic);
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
   ANSWER VALIDATION, COMPLIMENTS, PROXIMITY FEEDBACK & LOCKED ECHO
   ========================================================================== */

function handleCorrectAnswer() {
  if (state.phase !== 'QUESTION' || !state.currentCard) return;
  clearAllTimers();
  state.cardResultCounter++;
  state.phase = 'PRAISE';

  const card = state.currentCard;
  const elapsedMs = Math.max(200, performance.now() - state.cardStartTimeMs);
  state.roundTimesMs.push(elapsedMs);
  state.streak++;

  // If this card is in the 1 -> 3 -> 7 Expanding Spacing ladder, schedule its next spacing check!
  if (card.isRetry && settings.retryMode === 'expanding' && card.retryStage < 3 && state.queue.length > 0) {
    const nextStage = card.retryStage + 1;
    const spacingGap = nextStage === 2 ? 3 : 7;
    const insertIdx = Math.min(state.queue.length, spacingGap);
    state.queue.splice(insertIdx, 0, {
      ...card,
      isRetry: true,
      retryStage: nextStage
    });
  } else {
    state.clearedCount++;
  }

  // Update 144 mastery stats
  const stat = stats144[card.id];
  if (stat) {
    stat.hits++;
    stat.streak++;
    stat.lastMs = Math.round(elapsedMs);
    saveStats();
  }

  const compliment = pickVariedCompliment(state.streak);
  dom.praiseToast.textContent = `🌟 ${compliment}`;
  dom.praiseToast.classList.remove('hidden');

  document.body.classList.add('success-flash');
  setTimeout(() => document.body.classList.remove('success-flash'), 280);

  updateHudStats();

  const praiseToken = state.cardResultCounter;
  if (settings.speakPraise) {
    speakText(compliment, () => {
      if (state.cardResultCounter === praiseToken) {
        loadNextCard();
      }
    });
  } else {
    setTimeout(() => {
      if (state.cardResultCounter === praiseToken) {
        loadNextCard();
      }
    }, 450);
  }
}

function handleTimeoutPenalty() {
  if (state.phase !== 'QUESTION' || !state.currentCard) return;
  const phrase = TIMEOUT_REPRIMANDS[Math.floor(Math.random() * TIMEOUT_REPRIMANDS.length)];
  triggerCardFlipAndRequeue({
    tierClass: 'far-tier',
    bannerText: `⏰ TIME'S UP! (${settings.timerSeconds}s EXPIRED)`,
    reprimandSpeech: phrase
  });
}

function handleWrongAnswer(wrongVal, source = 'keypad') {
  if (state.phase !== 'QUESTION' || !state.currentCard) return;
  const prox = getProximityFeedback(state.currentCard, wrongVal, source);
  triggerCardFlipAndRequeue({
    tierClass: prox.tierClass,
    bannerText: prox.bannerText,
    reprimandSpeech: prox.speech
  });
}

function scheduleMissedCardRetry(card) {
  if (settings.retryMode === 'off') {
    state.clearedCount++;
    return 'No retry queued (Retry Off)';
  }

  const retryCard = {
    ...card,
    isRetry: true,
    retryStage: 1
  };

  if (settings.retryMode === 'expanding') {
    const idx = Math.min(state.queue.length, 1);
    state.queue.splice(idx, 0, retryCard);
    return '🔁 Spacing 1→3→7: Next check in 1 card';
  }

  if (settings.retryMode === 'immediate') {
    const idx = Math.min(state.queue.length, 1);
    state.queue.splice(idx, 0, retryCard);
    return '🔁 Queued 1 card back';
  }

  const idx = Math.min(state.queue.length, Math.max(1, Math.floor(Math.random() * 3) + 2));
  state.queue.splice(idx, 0, retryCard);
  return `🔁 Re-queued ${idx} cards back`;
}

function triggerCardFlipAndRequeue({ tierClass, bannerText, reprimandSpeech }) {
  clearAllTimers();
  state.cardResultCounter++;
  state.phase = 'REVEAL';
  state.echoUnlocked = false;
  state.echoInput = '';

  // LOCK the keypad & echo UI until the failure speech sequence finishes!
  setKeypadLocked(true);

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

  const retrySummaryText = scheduleMissedCardRetry(card);
  updateHudStats();

  // 1. Flash <body> red (#ff0000) for 500ms
  document.body.classList.add('penalty-flash');
  setTimeout(() => {
    document.body.classList.remove('penalty-flash');
  }, 500);

  // 2. Populate Card Back: Proximity Banner, Equation, Twin Fact, Mental Trick, Locked Echo Box
  dom.revealBanner.className = `reveal-banner ${tierClass || ''}`;
  dom.revealBanner.textContent = bannerText;

  if (card.qType === 'missing_factor') {
    dom.revealEquation.textContent = `${card.a} × [${card.b}] = ${card.product}`;
  } else {
    dom.revealEquation.textContent = `${card.a} × ${card.b} = ${card.product}`;
  }

  if (settings.showTwin) {
    const twinPart = card.a !== card.b ? `⇄ Twin: ${card.b} × ${card.a} = ${card.product}  |  ` : '';
    dom.revealTwin.textContent = `${twinPart}${card.product} ÷ ${card.a} = ${card.b}`;
    dom.revealTwin.classList.remove('hidden');
  } else {
    dom.revealTwin.classList.add('hidden');
  }

  const trick = getMentalMathTrick(card.a, card.b);
  if (settings.showTrick) {
    dom.revealTrickText.textContent = trick.text;
    dom.revealTrickBox.classList.remove('hidden');
  } else {
    dom.revealTrickBox.classList.add('hidden');
  }

  // Show LOCKED Echo state while the failure sequence is being spoken
  dom.echoPromptBox.classList.remove('hidden', 'listening');
  dom.echoPromptBox.classList.add('locked');
  dom.echoPromptText.textContent = `🔒 Listen closely to the answer...`;
  dom.echoInputPreview.textContent = `Unlocks as soon as the voice finishes`;

  dom.revealDetail.textContent = retrySummaryText;
  dom.flashcard.classList.add('flipped');

  // 3. Speak the full failure sequence: proximity feedback + equation (+ mental trick if enabled)
  let fullSpeech = `${reprimandSpeech} ${card.a} times ${card.b} is ${card.product}!`;
  if (settings.speakTrick) {
    fullSpeech += ` ${trick.speech}`;
  }
  fullSpeech += ` Now say or type ${card.targetAnswer}.`;

  const revealCardToken = state.cardResultCounter;

  speakText(fullSpeech, () => {
    if (state.phase !== 'REVEAL' || state.cardResultCounter !== revealCardToken) return;

    // UNLOCK the UI so the user can ONLY advance by speaking or typing card.targetAnswer!
    state.echoUnlocked = true;
    setKeypadLocked(false);
    dom.echoPromptBox.classList.remove('locked');
    dom.echoPromptText.textContent = `🎙️ Say or type "${card.targetAnswer}" to advance!`;
    dom.echoInputPreview.textContent = `Waiting for "${card.targetAnswer}"...`;

    if (settings.autoMic) {
      startListeningSafely();
    }
  });
}

function completeActiveEcho() {
  if (state.phase !== 'REVEAL' || !state.echoUnlocked || !state.currentCard) return;
  clearAllTimers();
  state.cardResultCounter++;
  state.echoUnlocked = false;

  const target = state.currentCard.targetAnswer;
  dom.echoPromptText.textContent = `✅ Locked in: ${target}!`;
  dom.echoInputPreview.textContent = `Good job! Moving to next card...`;

  document.body.classList.add('success-flash');
  setTimeout(() => document.body.classList.remove('success-flash'), 240);

  setTimeout(() => {
    loadNextCard();
  }, 360);
}

/* ==========================================================================
   KEYPAD & KEYBOARD INPUT (RESPECTS UI LOCK ON REVEAL)
   ========================================================================== */

function handleKeypadInput(key) {
  // 1. If card is flipped on REVEAL screen
  if (state.phase === 'REVEAL' && state.currentCard) {
    // Strictly ignore all keypad/keyboard presses until the failure speech sequence finishes!
    if (!state.echoUnlocked) return;

    const target = state.currentCard.targetAnswer;
    const targetStr = String(target);

    if (key === 'clear') {
      state.echoInput = state.echoInput.slice(0, -1);
      dom.echoInputPreview.textContent = state.echoInput
        ? `Typed: ${state.echoInput}`
        : `Say or type "${target}"`;
      return;
    }

    if (key === 'enter') {
      if (parseInt(state.echoInput, 10) === target) {
        completeActiveEcho();
      } else {
        state.echoInput = '';
        dom.echoInputPreview.textContent = `Type "${target}" to advance!`;
      }
      return;
    }

    if (/^\d$/.test(key) && state.echoInput.length < 3) {
      state.echoInput += key;
      dom.echoInputPreview.textContent = `Typed: ${state.echoInput}`;
      if (parseInt(state.echoInput, 10) === target) {
        completeActiveEcho();
      } else if (state.echoInput.length >= targetStr.length) {
        setTimeout(() => {
          state.echoInput = '';
          if (state.phase === 'REVEAL' && state.echoUnlocked) {
            dom.echoInputPreview.textContent = `Type "${target}" to unlock next card!`;
          }
        }, 250);
      }
    }
    return;
  }

  // 2. Normal QUESTION phase
  if (state.phase !== 'QUESTION' || !state.currentCard) return;

  const activeSlot = getActiveSlotElement();
  const target = state.currentCard.targetAnswer;

  if (key === 'clear') {
    state.typedInput = state.typedInput.slice(0, -1);
    activeSlot.textContent = state.typedInput || '?';
    activeSlot.classList.toggle('filled', state.typedInput.length > 0);
    return;
  }

  if (key === 'enter') {
    if (!state.typedInput) return;
    const val = parseInt(state.typedInput, 10);
    if (val === target) {
      handleCorrectAnswer();
    } else {
      handleWrongAnswer(val, 'keypad');
    }
    return;
  }

  if (/^\d$/.test(key) && state.typedInput.length < 3) {
    state.typedInput += key;
    activeSlot.textContent = state.typedInput;
    activeSlot.classList.add('filled');

    const val = parseInt(state.typedInput, 10);
    const targetStr = String(target);

    if (settings.autoKeypad && val === target) {
      handleCorrectAnswer();
    } else if (state.typedInput.length >= targetStr.length && val !== target) {
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

  speakText(`Awesome work! Gauntlet complete! You conquered ${state.targetCount} cards with ${firstTryPct} percent first try accuracy!`);
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
  clearTimeout(state.pendingWrongNumberTimerId);
}

function renderMasteryMatrix() {
  dom.matrixContainer.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'matrix-cell matrix-header';
  corner.textContent = '×';
  dom.matrixContainer.appendChild(corner);

  for (let col = 1; col <= 12; col++) {
    const ch = document.createElement('div');
    ch.className = 'matrix-cell matrix-header';
    ch.textContent = String(col);
    dom.matrixContainer.appendChild(ch);
  }

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
  document.querySelectorAll('#timer-size-control .seg-btn').forEach(btn => {
    const t = parseInt(btn.dataset.timer, 10);
    btn.classList.toggle('active', t === settings.timerSeconds);
  });

  document.querySelectorAll('#round-size-control .seg-btn').forEach(btn => {
    const sz = parseInt(btn.dataset.size, 10);
    btn.classList.toggle('active', sz === settings.roundSize);
  });

  document.querySelectorAll('#question-mode-control .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.qmode === settings.questionMode);
  });

  document.querySelectorAll('.preset-row .chip-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === settings.preset);
  });

  const eligibleCount = getEligibleCards().length;
  dom.activeTablesLabel.textContent = `(${eligibleCount} facts in pool)`;

  // Lobby Feature Pills
  dom.pillEcho.classList.add('active');
  dom.pillEcho.textContent = `🔒 Must Echo Answer`;

  dom.pillTricks.classList.toggle('active', settings.showTrick);
  dom.pillTricks.textContent = `💡 Tricks: ${settings.showTrick ? 'ON' : 'OFF'}`;

  const spacingLabels = {
    expanding: '🔁 1→3→7 Spacing',
    immediate: '🔁 1-Card Retry',
    standard: '🔁 2–4 Retry',
    off: '🔁 Retry: OFF'
  };
  dom.pillSpacing.classList.toggle('active', settings.retryMode !== 'off');
  dom.pillSpacing.textContent = spacingLabels[settings.retryMode] || '🔁 1→3→7 Spacing';

  // Settings Modal Controls
  dom.settingTimer.value = String(settings.timerSeconds);
  if (dom.settingSpeakPraise) dom.settingSpeakPraise.checked = settings.speakPraise;
  dom.settingRetryMode.value = settings.retryMode;
  dom.settingQuestionMode.value = settings.questionMode;
  dom.settingShowTrick.checked = settings.showTrick;
  dom.settingSpeakTrick.checked = settings.speakTrick;
  dom.settingShowTwin.checked = settings.showTwin;
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
  document.getElementById('btn-start-gauntlet').addEventListener('click', startGauntletRound);
  document.getElementById('btn-play-again').addEventListener('click', startGauntletRound);
  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    clearAllTimers();
    stopListeningSafely();
    state.phase = 'LOBBY';
    showScreen('LOBBY');
  });

  // Lobby Timer Selector
  document.querySelectorAll('#timer-size-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.timerSeconds = parseInt(btn.dataset.timer, 10);
      saveSettings();
      syncLobbyControlsUI();
    });
  });

  // Lobby Round Size Selector
  document.querySelectorAll('#round-size-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.roundSize = parseInt(btn.dataset.size, 10);
      saveSettings();
      syncLobbyControlsUI();
    });
  });

  // Lobby Question Mode Selector
  document.querySelectorAll('#question-mode-control .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      settings.questionMode = btn.dataset.qmode;
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

  // Lobby Quick Feature Pills
  dom.pillTricks.addEventListener('click', () => {
    settings.showTrick = !settings.showTrick;
    saveSettings();
    syncLobbyControlsUI();
  });

  dom.pillSpacing.addEventListener('click', () => {
    const order = ['expanding', 'immediate', 'standard', 'off'];
    const nextIdx = (order.indexOf(settings.retryMode) + 1) % order.length;
    settings.retryMode = order[nextIdx];
    saveSettings();
    syncLobbyControlsUI();
  });

  // Front Hint Button
  document.getElementById('btn-front-hint').addEventListener('click', () => {
    if (state.phase === 'QUESTION' && state.currentCard) {
      const trick = getMentalMathTrick(state.currentCard.a, state.currentCard.b);
      dom.frontHintBox.textContent = trick.text;
      dom.frontHintBox.classList.toggle('hidden');
    }
  });

  // I Don't Know / Flip button on card front (still locks UI & requires echoing the answer!)
  document.getElementById('btn-flip-giveup').addEventListener('click', () => {
    if (state.phase === 'QUESTION') {
      handleWrongAnswer('', 'flip');
    }
  });

  // Toggle Mic button
  document.getElementById('btn-mic-toggle').addEventListener('click', () => {
    micPermissionDenied = false;
    settings.autoMic = !settings.autoMic;
    saveSettings();
    syncLobbyControlsUI();
    if (settings.autoMic && (state.phase === 'QUESTION' || (state.phase === 'REVEAL' && state.echoUnlocked))) {
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

  // Settings Modal Open/Close
  const openSettings = () => {
    renderFactorToggles();
    dom.modalSettings.classList.remove('hidden');
  };
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-open-settings-lobby').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings').addEventListener('click', () => {
    dom.modalSettings.classList.add('hidden');
  });

  // Settings Modal Change Listeners
  dom.settingTimer.addEventListener('change', () => {
    settings.timerSeconds = parseInt(dom.settingTimer.value, 10) || 20;
    saveSettings();
    syncLobbyControlsUI();
  });
  if (dom.settingSpeakPraise) {
    dom.settingSpeakPraise.addEventListener('change', () => {
      settings.speakPraise = dom.settingSpeakPraise.checked;
      saveSettings();
    });
  }
  dom.settingRetryMode.addEventListener('change', () => {
    settings.retryMode = dom.settingRetryMode.value;
    saveSettings();
    syncLobbyControlsUI();
  });
  dom.settingQuestionMode.addEventListener('change', () => {
    settings.questionMode = dom.settingQuestionMode.value;
    saveSettings();
    syncLobbyControlsUI();
  });
  dom.settingShowTrick.addEventListener('change', () => {
    settings.showTrick = dom.settingShowTrick.checked;
    saveSettings();
    syncLobbyControlsUI();
  });
  dom.settingSpeakTrick.addEventListener('change', () => {
    settings.speakTrick = dom.settingSpeakTrick.checked;
    saveSettings();
    syncLobbyControlsUI();
  });
  dom.settingShowTwin.addEventListener('change', () => {
    settings.showTwin = dom.settingShowTwin.checked;
    saveSettings();
    syncLobbyControlsUI();
  });
  dom.settingMic.addEventListener('change', () => {
    settings.autoMic = dom.settingMic.checked;
    saveSettings();
    syncLobbyControlsUI();
    if (state.phase === 'QUESTION' || (state.phase === 'REVEAL' && state.echoUnlocked)) {
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
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) await caches.delete(k);
      }
    } catch {
      // Ignore
    }
    window.location.href = `${window.location.pathname}?t=${Date.now()}`;
  });
}

// Register Network-First Service Worker so refreshing the phone ALWAYS gets the newest push
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js?v=1.4').then((reg) => {
      reg.update().catch(() => {});
    }).catch(() => {});
  });
}

initSpeechRecognition();
bindEvents();
syncLobbyControlsUI();
updateMasteryUI();
