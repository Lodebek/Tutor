/**
 * Multiplication Gauntlet v1.6 — Research-Backed Learning & Speed Engine
 * Fixes & Upgrades in v1.6:
 * 1. Voice Final-Answer Confirmation Loop: Pauses question timer as soon as a spoken number is heard,
 *    asks "Is your final answer X?", accepts "Yes" / repeating X / saying a corrected number / "No",
 *    and auto-submits X after a 10-second confirmation countdown if no further input is given.
 * 2. Removed homophones (to/too/for/won/free/ate/oh) from WORD_TO_NUM to prevent false answers on filler speech.
 * 3. Word + digit question-echo stripping ("seven times eight is...", partial "seven times...").
 * 4. Commutative fact mastery synchronization (mastering 7×8 credits 8×7 across all decks & 12×12 grid).
 * 5. TTS active-speaking poll + 250ms acoustic tail buffer before mic unlock.
 */

const APP_VERSION = 'v1.6';
const CONFIRM_TIMEOUT_MS = 10000;
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
  confirmVoice: true,
  speakQuestion: false,
  autoKeypad: true,
  keypadVisible: true,
  preset: 'all', // 'all' | 'true36' | 'boss' | 'core' | 'hard' | 'weak' | 'custom'
  activeFactors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
};

/* ==========================================================================
   COMMUTATIVE MASTERY & STATS ENGINE (PURE + PERSISTENCE)
   ========================================================================== */

function createInitialStats() {
  const initial = {};
  for (let a = 1; a <= 12; a++) {
    for (let b = 1; b <= 12; b++) {
      const id = `${a}x${b}`;
      initial[id] = { a, b, product: a * b, hits: 0, misses: 0, streak: 0, lastMs: null };
    }
  }
  return initial;
}

/**
 * Ensures commutative twins (a×b and b×a) share identical mastery statistics.
 * If existing saved data had asymmetric counts, merges them without losing progress.
 */
function syncCommutativeStats(statsObj) {
  for (let a = 1; a <= 12; a++) {
    for (let b = a + 1; b <= 12; b++) {
      const id1 = `${a}x${b}`;
      const id2 = `${b}x${a}`;
      const s1 = statsObj[id1];
      const s2 = statsObj[id2];
      if (!s1 || !s2) continue;

      if (s1.hits !== s2.hits || s1.misses !== s2.misses || s1.streak !== s2.streak) {
        const mergedHits = Math.max(s1.hits, s2.hits);
        const mergedMisses = Math.max(s1.misses, s2.misses);
        const mergedStreak = Math.max(s1.streak, s2.streak);
        const mergedLastMs = s1.lastMs !== null && s2.lastMs !== null
          ? Math.min(s1.lastMs, s2.lastMs)
          : (s1.lastMs ?? s2.lastMs);

        s1.hits = s2.hits = mergedHits;
        s1.misses = s2.misses = mergedMisses;
        s1.streak = s2.streak = mergedStreak;
        s1.lastMs = s2.lastMs = mergedLastMs;
      }
    }
  }
  return statsObj;
}

function recordFactHit(statsObj, a, b, elapsedMs) {
  const keys = a === b ? [`${a}x${b}`] : [`${a}x${b}`, `${b}x${a}`];
  const roundedMs = Math.round(elapsedMs);
  for (const k of keys) {
    const stat = statsObj[k];
    if (stat) {
      stat.hits++;
      stat.streak++;
      stat.lastMs = roundedMs;
    }
  }
}

function recordFactMiss(statsObj, a, b) {
  const keys = a === b ? [`${a}x${b}`] : [`${a}x${b}`, `${b}x${a}`];
  for (const k of keys) {
    const stat = statsObj[k];
    if (stat) {
      stat.misses++;
      stat.streak = 0;
    }
  }
}

function getCardStatus(stat) {
  if (!stat || (stat.hits === 0 && stat.misses === 0)) return 'unseen';
  if (stat.streak >= 2 || (stat.hits >= 2 && stat.misses === 0)) return 'mastered';
  if (stat.misses > stat.hits || stat.streak === 0) return 'struggling';
  return 'learning';
}

/* ==========================================================================
   SPOKEN NUMBER PARSER (NO HOMOPHONES, WORD+DIGIT QUESTION STRIPPING)
   ========================================================================== */

// Strict canonical number words only — no homophones (to/too/for/won/free/ate/oh)
const WORD_TO_NUM = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
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
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};

const NUM_TO_WORD = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six',
  7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve',
  13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen',
  18: 'eighteen', 19: 'nineteen', 20: 'twenty', 30: 'thirty', 40: 'forty',
  50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety'
};

function numberToSpokenPattern(n) {
  if (typeof n !== 'number' || isNaN(n)) return '';
  const alts = [String(n)];
  if (NUM_TO_WORD[n]) {
    alts.push(NUM_TO_WORD[n]);
  } else if (n > 20 && n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    if (NUM_TO_WORD[tens] && NUM_TO_WORD[ones]) {
      alts.push(`${NUM_TO_WORD[tens]}[\\s-]+${NUM_TO_WORD[ones]}`);
    }
  } else if (n >= 100 && n <= 144) {
    const rem = n - 100;
    if (rem === 0) {
      alts.push(`(?:one|a)\\s+hundred`);
    } else if (NUM_TO_WORD[rem]) {
      alts.push(`(?:one|a)\\s+hundred(?:\\s+and)?\\s+${NUM_TO_WORD[rem]}`);
    } else {
      const tens = Math.floor(rem / 10) * 10;
      const ones = rem % 10;
      if (NUM_TO_WORD[tens] && NUM_TO_WORD[ones]) {
        alts.push(`(?:one|a)\\s+hundred(?:\\s+and)?\\s+${NUM_TO_WORD[tens]}[\\s-]+${NUM_TO_WORD[ones]}`);
      }
    }
  }
  return `(?:${alts.join('|')})`;
}

/**
 * Strips repeated question phrases from the transcript in both digit and word forms,
 * including commutative order ("7 times 8", "seven times eight", "eight times seven is"),
 * missing-factor questions ("seven times what is fifty six"), and partial repeats ("seven times").
 */
function stripQuestionEcho(rawText, currentCard) {
  if (!rawText) return '';
  let text = rawText.toLowerCase().trim();
  if (!currentCard) return text;

  const { a, b } = currentCard;
  const product = currentCard.product ?? (a * b);
  const aPat = numberToSpokenPattern(a);
  const bPat = numberToSpokenPattern(b);
  const prodPat = numberToSpokenPattern(product);
  const opPat = `(?:times|x|\\*|by|multiplied\\s+by)`;

  // 1. Missing-factor question echo: "7 times what is 56" / "seven times what equals fifty six"
  const missingFactorEcho = new RegExp(
    `\\b(?:${aPat}|${bPat})\\s*${opPat}\\s*(?:what|blank|something)\\s*(?:is|equals|equal|makes)?\\s*${prodPat}\\b`,
    'gi'
  );
  text = text.replace(missingFactorEcho, ' ');

  // 2. Full question echo in either order: "7 times 8 [is/equals]" or "eight times seven [is/equals]"
  const fullEchoAB = new RegExp(`\\b${aPat}\\s*${opPat}\\s*${bPat}(?:\\s+(?:is|equals|equal))?\\b`, 'gi');
  const fullEchoBA = new RegExp(`\\b${bPat}\\s*${opPat}\\s*${aPat}(?:\\s+(?:is|equals|equal))?\\b`, 'gi');
  text = text.replace(fullEchoAB, ' ').replace(fullEchoBA, ' ');

  // 3. Spoken factors without operator followed by "is/equals": "seven eight is 56"
  const bareEchoAB = new RegExp(`^\\s*${aPat}\\s+${bPat}\\s+(?:is|equals)\\b`, 'gi');
  const bareEchoBA = new RegExp(`^\\s*${bPat}\\s+${aPat}\\s+(?:is|equals)\\b`, 'gi');
  text = text.replace(bareEchoAB, ' ').replace(bareEchoBA, ' ');

  // 4. Partial question echo at the end of an interim transcript: "seven times [what]"
  const partialEcho = new RegExp(`\\b(?:${aPat}|${bPat})\\s*${opPat}(?:\\s+what)?\\s*$`, 'gi');
  text = text.replace(partialEcho, ' ');

  return text;
}

/**
 * Extracts spoken numbers from a speech transcript.
 * - Ignores non-numeric words and common homophones ("to", "for", "won", "ate", "free", "oh").
 * - Strips digit and word question echoes ("seven times eight is...").
 * - Combines paused compound tens + ones ("fifty ... six" -> 56) and hundreds ("one hundred ... forty four" -> 144).
 */
function extractSpokenNumbers(rawTranscript, currentCard) {
  if (!rawTranscript) return [];
  let text = stripQuestionEcho(rawTranscript, currentCard);

  // Normalize hyphens and punctuation
  text = text.replace(/[-]/g, ' ').replace(/[^a-z0-9\s]/g, ' ');
  const tokens = text.split(/\s+/).filter(Boolean);

  const rawNumbers = [];
  let i = 0;

  while (i < tokens.length) {
    const tok = tokens[i];

    // Direct digit token (e.g. "56", "144", or split "50" "6")
    if (/^\d+$/.test(tok)) {
      const val = parseInt(tok, 10);
      if (val >= 0 && val <= 999) {
        rawNumbers.push(val);
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
          if (i < tokens.length && WORD_TO_NUM[tokens[i]] !== undefined && WORD_TO_NUM[tokens[i]] >= 1 && WORD_TO_NUM[tokens[i]] <= 9) {
            total += WORD_TO_NUM[tokens[i]];
            i++;
          }
        } else if (nextVal > 0 && nextVal < 20) {
          total += nextVal;
          i++;
        }
      }
      rawNumbers.push(total);
      continue;
    }

    // Standalone "hundred"
    if (tok === 'hundred') {
      rawNumbers.push(100);
      i++;
      continue;
    }

    // Canonical number words
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
        rawNumbers.push(total);
        continue;
      } else {
        rawNumbers.push(val);
        i++;
        continue;
      }
    }

    i++;
  }

  // Combine adjacent split decade/hundred + ones tokens (e.g. [50, 6] -> [56], [100, 44] -> [144])
  const combined = [];
  for (let j = 0; j < rawNumbers.length; j++) {
    const curr = rawNumbers[j];
    const next = rawNumbers[j + 1];

    if (curr === 100 && next !== undefined && next >= 1 && next <= 99) {
      if (next >= 20 && next % 10 === 0 && rawNumbers[j + 2] >= 1 && rawNumbers[j + 2] <= 9) {
        combined.push(100 + next + rawNumbers[j + 2]);
        j += 2;
      } else {
        combined.push(100 + next);
        j += 1;
      }
    } else if (curr >= 20 && curr <= 90 && curr % 10 === 0 && next !== undefined && next >= 1 && next <= 9) {
      combined.push(curr + next);
      j += 1;
    } else {
      combined.push(curr);
    }
  }

  return combined;
}

/**
 * Calculates child-friendly settle time before judging a spoken number as wrong.
 * Gives extra breathing room when the spoken number is a decade/hundred base (e.g. "fifty..." before "...six").
 */
function getWrongAnswerDebounceMs(spokenNum, targetAnswer, isFinalResult) {
  const isDecadeOrHundredPrefix =
    spokenNum === 100 ||
    (spokenNum >= 20 && spokenNum <= 90 && spokenNum % 10 === 0) ||
    (spokenNum >= 110 && spokenNum <= 140 && spokenNum % 10 === 0);

  if (isDecadeOrHundredPrefix && spokenNum !== targetAnswer) {
    return isFinalResult ? 1900 : 2300;
  }
  return isFinalResult ? 1000 : 1500;
}

/**
 * Calculates the settle window before asking "Is your final answer X?" once a spoken number is heard.
 * Note: The question countdown timer is immediately paused on the first spoken digit so the player
 * loses zero time during this settle window.
 */
function getVoiceCaptureSettleMs(spokenNum, targetAnswer, isFinalResult) {
  const isDecadeOrHundredPrefix =
    spokenNum === 100 ||
    (spokenNum >= 20 && spokenNum <= 90 && spokenNum % 10 === 0) ||
    (spokenNum >= 110 && spokenNum <= 140 && spokenNum % 10 === 0);

  if (isDecadeOrHundredPrefix && spokenNum !== targetAnswer) {
    return isFinalResult ? 1150 : 1550;
  }
  if (spokenNum === targetAnswer) {
    return isFinalResult ? 350 : 600;
  }
  return isFinalResult ? 650 : 1000;
}

/**
 * Parses what the student says when asked "Is your final answer <candidateNum>?"
 * Returns one of:
 * - { action: 'confirm', value: candidateNum }  (said "yes"/"yep"/etc. or repeated candidateNum)
 * - { action: 'update_number', value: newNum }  (said a different number to replace candidateNum, e.g. "no, 56" or "56")
 * - { action: 'cancel' }                        (said "no"/"wait"/"cancel" with no replacement number)
 * - { action: 'ignore' }                        (background noise / no actionable tokens)
 */
function parseVoiceConfirmationResponse(rawTranscript, candidateNum, currentCard) {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return { action: 'ignore' };
  }

  const text = rawTranscript.toLowerCase().trim();
  if (!text) return { action: 'ignore' };

  const extractedNums = extractSpokenNumbers(text, currentCard);
  const hasAffirmative = /\b(yes|yeah|yep|yup|ya|correct|right|sure|affirmative|final|lock|submit|ok|okay|uh\s*huh|that\s*is\s*it|thats\s*it|go)\b/i.test(text);
  const hasNegative = /\b(no|nope|nah|wrong|wait|cancel|change|different|not|hold\s*on|try\s*again)\b/i.test(text);

  if (extractedNums.length > 0) {
    const lastNum = extractedNums[extractedNums.length - 1];
    if (lastNum !== candidateNum) {
      return { action: 'update_number', value: lastNum };
    }
    if (!hasNegative) {
      return { action: 'confirm', value: candidateNum };
    }
  }

  if (hasNegative) {
    return { action: 'cancel' };
  }

  if (hasAffirmative) {
    return { action: 'confirm', value: candidateNum };
  }

  return { action: 'ignore' };
}

/* ==========================================================================
   EXPANDING SPACING QUEUE PURE FUNCTIONS
   ========================================================================== */

/**
 * On a correct answer, if the card is in the 1 -> 3 -> 7 Expanding Spacing ladder (stage 1 or 2),
 * inserts the next stage into the queue at the appropriate spacing offset.
 * Returns true if the card was fully cleared for the round, or false if promoted to next spacing stage.
 */
function advanceRetryQueueOnHit(queue, card, retryMode) {
  if (card.isRetry && retryMode === 'expanding' && card.retryStage < 3) {
    const nextStage = card.retryStage + 1;
    const spacingGap = nextStage === 2 ? 3 : 7;
    const insertIdx = Math.min(queue.length, spacingGap);
    queue.splice(insertIdx, 0, {
      ...card,
      isRetry: true,
      retryStage: nextStage
    });
    return false;
  }
  return true;
}

/**
 * Schedules a missed card back into the queue according to retryMode.
 * Explicitly reports if an in-progress expanding ladder card was reset back to Step 1/3.
 */
function scheduleRetryOnMiss(queue, card, retryMode) {
  if (retryMode === 'off') {
    return { cleared: true, wasReset: false, message: 'No retry queued (Retry Off)' };
  }

  const wasRetryStage = card.isRetry ? card.retryStage : 0;
  const retryCard = {
    ...card,
    isRetry: true,
    retryStage: 1
  };

  if (retryMode === 'expanding') {
    const idx = Math.min(queue.length, 1);
    queue.splice(idx, 0, retryCard);
    if (wasRetryStage > 1) {
      return {
        cleared: false,
        wasReset: true,
        message: `🔁 Ladder Reset (was ${wasRetryStage}/3) → Back to Step 1/3 (in 1 card)`
      };
    }
    return {
      cleared: false,
      wasReset: false,
      message: '🔁 Spacing 1→3→7: Step 1/3 check in 1 card'
    };
  }

  if (retryMode === 'immediate') {
    const idx = Math.min(queue.length, 1);
    queue.splice(idx, 0, retryCard);
    return { cleared: false, wasReset: false, message: '🔁 Queued 1 card back' };
  }

  const idx = Math.min(queue.length, Math.max(1, Math.floor(Math.random() * 3) + 2));
  queue.splice(idx, 0, retryCard);
  return { cleared: false, wasReset: false, message: `🔁 Re-queued ${idx} cards back` };
}

/* ==========================================================================
   COMPLIMENT & PROXIMITY FEEDBACK GENERATORS
   ========================================================================== */

let lastPraiseIndex = -1;

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

  const diff = card.qType === 'missing_factor'
    ? Math.abs(numVal * card.a - card.product)
    : Math.abs(numVal - card.product);

  const verb = source === 'voice' ? 'said' : 'typed';

  if (diff <= factorStep) {
    const phrase = CLOSE_WRONG_PHRASES[Math.floor(Math.random() * CLOSE_WRONG_PHRASES.length)];
    return {
      tierClass: 'close-tier',
      bannerText: `🔥 SO CLOSE! (You ${verb} ${numVal} — only ${diff} off!)`,
      speech: phrase
    };
  }

  if (diff <= factorStep * 2) {
    const phrase = MID_WRONG_PHRASES[Math.floor(Math.random() * MID_WRONG_PHRASES.length)];
    return {
      tierClass: 'mid-tier',
      bannerText: `⚡ COME ON, YOU CAN DO BETTER! (You ${verb} ${numVal})`,
      speech: phrase
    };
  }

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
   BROWSER RUNTIME & UI BINDINGS (GUARDED FOR NODE TEST RUNNER)
   ========================================================================== */

if (typeof document !== 'undefined') {
  let settings = loadSettings();
  let stats144 = loadStats();

  const state = {
    phase: 'LOBBY',
    echoUnlocked: false,
    confirmUnlocked: false,
    confirmCandidate: null,
    confirmRemainingMs: CONFIRM_TIMEOUT_MS,
    confirmStartTimeMs: 0,
    confirmIntervalId: null,
    firstSpokenElapsedMs: null,
    queue: [],
    currentCard: null,
    typedInput: '',
    echoInput: '',
    targetCount: 15,
    clearedCount: 0,
    streak: 0,
    retriesCount: 0,
    roundMissedCards: new Set(),
    roundTimesMs: [], // First-try times only
    cardStartTimeMs: 0,
    timerRemainingMs: 20000,
    timerIntervalId: null,
    pendingWrongNumberTimerId: null,
    ttsPollIntervalId: null,
    cardResultCounter: 0
  };

  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isRecognitionActive = false;
  let isSpeakingTTS = false;
  let micPermissionDenied = false;

  const dom = {
    appVersion: document.getElementById('app-version'),
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
    voiceConfirmBox: document.getElementById('voice-confirm-box'),
    voiceConfirmPrompt: document.getElementById('voice-confirm-prompt'),
    voiceConfirmTimer: document.getElementById('voice-confirm-timer'),
    voiceConfirmSub: document.getElementById('voice-confirm-sub'),
    btnConfirmYes: document.getElementById('btn-confirm-yes'),
    btnConfirmNo: document.getElementById('btn-confirm-no'),
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
    settingConfirmVoice: document.getElementById('setting-confirm-voice'),
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

  if (dom.appVersion) {
    dom.appVersion.textContent = `${APP_VERSION} ↻`;
  }

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
    const initial = createInitialStats();
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATS);
      if (!raw) return initial;
      const saved = JSON.parse(raw);
      for (const key of Object.keys(initial)) {
        if (saved[key]) {
          initial[key] = { ...initial[key], ...saved[key] };
        }
      }
      return syncCommutativeStats(initial);
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

  function updateMasteryUI() {
    const all = Object.values(stats144);
    const mastered = all.filter(s => getCardStatus(s) === 'mastered').length;
    const pct = Math.round((mastered / 144) * 100);
    dom.masteryPct.textContent = `${pct}%`;
    dom.lobbyMasteryCount.textContent = `${mastered} / 144 Mastered (${pct}%)`;
    dom.lobbyMasteryFill.style.width = `${pct}%`;
  }

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
      // Deduplicate commutative pairs so Needs Work doesn't put both 7×8 and 8×7 in the same draw
      const uniqueWeak = [];
      for (let a = 1; a <= 12; a++) {
        for (let b = a; b <= 12; b++) {
          const flip = Math.random() < 0.5;
          const fa = flip ? b : a;
          const fb = flip ? a : b;
          const c = stats144[`${fa}x${fb}`];
          const st = getCardStatus(c);
          if (st === 'struggling' || st === 'unseen' || st === 'learning') {
            uniqueWeak.push(c);
          }
        }
      }
      return uniqueWeak.length >= 5 ? uniqueWeak : allCards;
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

  function isVoicePhaseActive() {
    return (
      state.phase === 'QUESTION' ||
      (state.phase === 'CONFIRM_VOICE' && state.confirmUnlocked) ||
      (state.phase === 'REVEAL' && state.echoUnlocked)
    );
  }

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
      if (!isVoicePhaseActive()) return;

      const cardToken = state.cardResultCounter;
      let latestTranscript = '';
      let isFinalResult = false;
      const allCandidates = [];

      // Build combined primary transcript across segments in case of paused speech ("fifty" ... "six")
      const primarySegments = [];
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i][0]) {
          primarySegments.push(event.results[i][0].transcript.trim());
        }
      }
      const fullPrimaryTranscript = primarySegments.join(' ').trim();
      const combinedCrossSegmentNumbers = extractSpokenNumbers(
        fullPrimaryTranscript,
        state.currentCard
      );
      for (const num of combinedCrossSegmentNumbers) {
        allCandidates.push(num);
      }

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

      // CASE B: Voice Final-Answer Confirmation Loop (CONFIRM_VOICE phase)
      if (state.phase === 'CONFIRM_VOICE') {
        const decision = parseVoiceConfirmationResponse(
          fullPrimaryTranscript || latestTranscript,
          state.confirmCandidate,
          state.currentCard
        );

        if (decision.action === 'confirm') {
          clearTimeout(state.pendingWrongNumberTimerId);
          submitConfirmedVoiceAnswer(state.confirmCandidate);
          return;
        }

        if (decision.action === 'update_number') {
          const newNum = decision.value;
          const activeSlot = getActiveSlotElement();
          activeSlot.textContent = String(newNum);
          activeSlot.classList.add('filled');
          if (dom.voiceConfirmSub) {
            dom.voiceConfirmSub.textContent = `🎙️ Heard new number "${newNum}" — updating...`;
          }
          clearTimeout(state.pendingWrongNumberTimerId);
          const settleMs = getVoiceCaptureSettleMs(newNum, target, isFinalResult);
          state.pendingWrongNumberTimerId = setTimeout(() => {
            if (state.phase === 'CONFIRM_VOICE' && state.cardResultCounter === cardToken) {
              enterVoiceConfirmation(newNum, true);
            }
          }, settleMs);
          return;
        }

        if (decision.action === 'cancel') {
          clearTimeout(state.pendingWrongNumberTimerId);
          // Brief 450ms settle in case child is saying "No, fifty six"
          state.pendingWrongNumberTimerId = setTimeout(() => {
            if (state.phase === 'CONFIRM_VOICE' && state.cardResultCounter === cardToken) {
              cancelVoiceConfirmation();
            }
          }, 450);
          return;
        }

        if (latestTranscript && dom.voiceConfirmSub) {
          dom.voiceConfirmSub.textContent = `Heard "${latestTranscript}" — say "Yes", "${state.confirmCandidate}", or a new number`;
        }
        return;
      }

      // CASE C: Initial Question Answering (QUESTION phase)
      if (allCandidates.length === 0) {
        if (latestTranscript) {
          dom.voiceTranscript.textContent = `Heard "${latestTranscript}" (waiting for a number...)`;
        }
        return;
      }

      const activeSlot = getActiveSlotElement();
      const spokenNum = combinedCrossSegmentNumbers.length > 0
        ? combinedCrossSegmentNumbers[combinedCrossSegmentNumbers.length - 1]
        : allCandidates[allCandidates.length - 1];

      // Immediately pause the question countdown timer as soon as a spoken number is heard!
      pauseQuestionTimer();

      activeSlot.textContent = String(spokenNum);
      activeSlot.classList.add('filled');

      if (settings.confirmVoice) {
        dom.voiceTranscript.textContent = `🎙️ Heard ${spokenNum} — pausing timer to confirm...`;
        clearTimeout(state.pendingWrongNumberTimerId);
        const settleMs = getVoiceCaptureSettleMs(spokenNum, target, isFinalResult);
        state.pendingWrongNumberTimerId = setTimeout(() => {
          if (state.phase === 'QUESTION' && state.cardResultCounter === cardToken) {
            enterVoiceConfirmation(spokenNum, false);
          }
        }, settleMs);
        return;
      }

      // Fallback when user disables Voice Confirmation in Settings:
      if (allCandidates.includes(target)) {
        clearTimeout(state.pendingWrongNumberTimerId);
        activeSlot.textContent = String(target);
        activeSlot.classList.add('filled');
        dom.voiceTranscript.textContent = `🎙️ Heard: ${target} ✓`;
        handleCorrectAnswer(state.firstSpokenElapsedMs);
        return;
      }

      dom.voiceTranscript.textContent = `🎙️ Heard number: ${spokenNum}`;
      clearTimeout(state.pendingWrongNumberTimerId);
      const delayMs = getWrongAnswerDebounceMs(spokenNum, target, isFinalResult);
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
        isVoicePhaseActive();

      if (shouldKeepListening) {
        setTimeout(() => {
          if (
            !isRecognitionActive &&
            !isSpeakingTTS &&
            settings.autoMic &&
            isVoicePhaseActive()
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

  /**
   * Speaks text via window.speechSynthesis, polling window.speechSynthesis.speaking
   * so slow voices never unlock the mic mid-sentence, and adds a 250ms acoustic tail buffer
   * after speech ends so the microphone never hears the phone's own speaker.
   */
  function speakText(text, onDone) {
    if (!('speechSynthesis' in window)) {
      if (onDone) onDone();
      return;
    }

    isSpeakingTTS = true;
    stopListeningSafely();
    clearInterval(state.ttsPollIntervalId);

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      const startedAt = performance.now();
      let finished = false;

      const finishOnce = () => {
        if (finished) return;
        finished = true;
        clearInterval(state.ttsPollIntervalId);
        // 250ms acoustic tail buffer so speaker reverb dies down before mic opens
        setTimeout(() => {
          isSpeakingTTS = false;
          if (onDone) onDone();
        }, 250);
      };

      utterance.onend = finishOnce;
      utterance.onerror = finishOnce;

      // Poll speechSynthesis.speaking so slow voices aren't cut off early, with a 15s hard cap
      const minWaitMs = Math.max(1800, text.length * 70);
      state.ttsPollIntervalId = setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const stillSpeaking = window.speechSynthesis.speaking || window.speechSynthesis.pending;
        if (elapsed >= 15000 || (elapsed >= minWaitMs && !stillSpeaking)) {
          finishOnce();
        }
      }, 150);

      window.speechSynthesis.speak(utterance);
    } catch {
      isSpeakingTTS = false;
      if (onDone) onDone();
    }
  }

  function getActiveSlotElement() {
    if (state.currentCard && state.currentCard.qType === 'missing_factor') {
      return dom.slotMid;
    }
    return dom.slotRight;
  }

  function setKeypadLocked(locked) {
    dom.keypadGrid.classList.toggle('locked', locked);
  }

  function pauseQuestionTimer() {
    clearInterval(state.timerIntervalId);
    if (!state.firstSpokenElapsedMs && state.cardStartTimeMs > 0) {
      state.firstSpokenElapsedMs = Math.max(200, performance.now() - state.cardStartTimeMs);
    }
    if (dom.timerStatusText) {
      dom.timerStatusText.textContent = '⏸️ TIMER PAUSED — CONFIRM ANSWER';
    }
  }

  /**
   * Enters the Voice Confirmation Loop:
   * - Stops the question countdown timer
   * - Shows the confirmation banner ("🎙️ Is your final answer 20?")
   * - Speaks "Is your final answer 20?"
   * - Starts a 10-second confirmation timer that auto-submits the candidate if no response is given
   */
  function enterVoiceConfirmation(candidateNum, isUpdate = false) {
    if (!state.currentCard) return;
    clearAllTimers();
    state.cardResultCounter++;
    state.phase = 'CONFIRM_VOICE';
    state.confirmCandidate = candidateNum;
    state.confirmUnlocked = false;
    state.confirmRemainingMs = CONFIRM_TIMEOUT_MS;

    const confirmToken = state.cardResultCounter;
    const activeSlot = getActiveSlotElement();
    activeSlot.textContent = String(candidateNum);
    activeSlot.classList.add('filled');

    if (dom.voiceConfirmBox) {
      dom.voiceConfirmBox.classList.remove('hidden');
      dom.voiceConfirmPrompt.textContent = `🎙️ Final answer: ${candidateNum}?`;
      dom.voiceConfirmTimer.textContent = `${(CONFIRM_TIMEOUT_MS / 1000).toFixed(1)}s`;
      dom.voiceConfirmSub.textContent = `Say "Yes", repeat "${candidateNum}", or say a different number`;
      dom.btnConfirmYes.textContent = `✅ Yes (${candidateNum})`;
    }
    dom.voiceBar.classList.add('hidden');

    if (dom.timerStatusText) {
      dom.timerStatusText.textContent = '⏸️ TIMER STOPPED — CONFIRM FINAL ANSWER (10s)';
    }
    renderTimerUI(CONFIRM_TIMEOUT_MS, CONFIRM_TIMEOUT_MS);

    const promptSpeech = isUpdate
      ? `Got it, ${candidateNum}. Is your final answer ${candidateNum}?`
      : `Is your final answer ${candidateNum}?`;

    speakText(promptSpeech, () => {
      if (state.phase !== 'CONFIRM_VOICE' || state.cardResultCounter !== confirmToken) return;
      state.confirmUnlocked = true;
      startConfirmCountdownLoop(confirmToken);
      if (settings.autoMic) {
        startListeningSafely();
      }
    });
  }

  function startConfirmCountdownLoop(confirmToken) {
    clearInterval(state.confirmIntervalId);
    state.confirmStartTimeMs = performance.now();
    state.confirmRemainingMs = CONFIRM_TIMEOUT_MS;

    state.confirmIntervalId = setInterval(() => {
      if (state.phase !== 'CONFIRM_VOICE' || state.cardResultCounter !== confirmToken) {
        clearInterval(state.confirmIntervalId);
        return;
      }

      const elapsed = performance.now() - state.confirmStartTimeMs;
      state.confirmRemainingMs = Math.max(0, CONFIRM_TIMEOUT_MS - elapsed);

      if (dom.voiceConfirmTimer) {
        dom.voiceConfirmTimer.textContent = `${(state.confirmRemainingMs / 1000).toFixed(1)}s`;
      }
      renderTimerUI(state.confirmRemainingMs, CONFIRM_TIMEOUT_MS);

      if (state.confirmRemainingMs <= 0) {
        clearInterval(state.confirmIntervalId);
        submitConfirmedVoiceAnswer(state.confirmCandidate);
      }
    }, 100);
  }

  function submitConfirmedVoiceAnswer(finalVal) {
    if (!state.currentCard) return;
    clearAllTimers();
    if (dom.voiceConfirmBox) dom.voiceConfirmBox.classList.add('hidden');
    dom.voiceBar.classList.remove('hidden');

    state.phase = 'QUESTION';
    const target = state.currentCard.targetAnswer;
    if (Number(finalVal) === target) {
      handleCorrectAnswer(state.firstSpokenElapsedMs);
    } else {
      handleWrongAnswer(Number(finalVal), 'voice');
    }
  }

  function cancelVoiceConfirmation() {
    if (!state.currentCard) return;
    clearAllTimers();
    state.cardResultCounter++;

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
    isSpeakingTTS = false;

    if (dom.voiceConfirmBox) dom.voiceConfirmBox.classList.add('hidden');
    dom.voiceBar.classList.remove('hidden');

    state.phase = 'QUESTION';
    state.confirmCandidate = null;
    state.confirmUnlocked = false;
    state.firstSpokenElapsedMs = null;
    state.typedInput = '';

    const activeSlot = getActiveSlotElement();
    activeSlot.textContent = '?';
    activeSlot.classList.remove('filled');

    dom.voiceTranscript.textContent = 'Cancelled — say or type the new answer';
    if (dom.timerStatusText) {
      dom.timerStatusText.textContent = 'TIME REMAINING';
    }

    // Resume the question timer from where it paused (giving at least 6s so they aren't insta-expired)
    const resumeMs = Math.max(6000, state.timerRemainingMs);
    const totalMs = settings.timerSeconds * 1000;
    state.cardStartTimeMs = performance.now() - (totalMs - resumeMs);
    startCountdownLoop();

    if (settings.autoMic) {
      startListeningSafely();
    }
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
    state.confirmUnlocked = false;
    state.confirmCandidate = null;
    state.firstSpokenElapsedMs = null;
    setKeypadLocked(false);

    if (dom.voiceConfirmBox) dom.voiceConfirmBox.classList.add('hidden');
    dom.voiceBar.classList.remove('hidden');
    if (dom.timerStatusText) dom.timerStatusText.textContent = 'TIME REMAINING';

    if (state.queue.length === 0) {
      finishRoundVictory();
      return;
    }

    state.phase = 'QUESTION';
    state.currentCard = state.queue.shift();
    state.typedInput = '';
    state.echoInput = '';

    const card = state.currentCard;

    dom.flashcard.classList.remove('flipped');
    dom.frontHintBox.classList.add('hidden');
    dom.praiseToast.classList.add('hidden');

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

    if (settings.showTwin && card.a !== card.b && card.qType === 'product') {
      dom.frontTwinBadge.textContent = `⇄ Same as ${card.b} × ${card.a}`;
      dom.frontTwinBadge.classList.remove('hidden');
    } else if (card.qType === 'missing_factor') {
      dom.frontTwinBadge.textContent = `⇄ Fact Family: ${card.product} ÷ ${card.a} = ?`;
      dom.frontTwinBadge.classList.remove('hidden');
    } else {
      dom.frontTwinBadge.classList.add('hidden');
    }

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

  function handleCorrectAnswer(overrideElapsedMs) {
    if (state.phase !== 'QUESTION' || !state.currentCard) return;
    clearAllTimers();
    state.cardResultCounter++;
    state.phase = 'PRAISE';

    const card = state.currentCard;
    const elapsedMs = overrideElapsedMs || Math.max(200, performance.now() - state.cardStartTimeMs);

    // Track First-Try Speed purely on initial attempts (not retries)
    if (!card.isRetry) {
      state.roundTimesMs.push(elapsedMs);
    }
    state.streak++;

    const fullyCleared = advanceRetryQueueOnHit(state.queue, card, settings.retryMode);
    if (fullyCleared) {
      state.clearedCount++;
    }

    // Credit both a×b and b×a commutatively
    recordFactHit(stats144, card.a, card.b, elapsedMs);
    saveStats();

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

  function triggerCardFlipAndRequeue({ tierClass, bannerText, reprimandSpeech }) {
    clearAllTimers();
    state.cardResultCounter++;
    state.phase = 'REVEAL';
    state.echoUnlocked = false;
    state.echoInput = '';

    if (dom.voiceConfirmBox) dom.voiceConfirmBox.classList.add('hidden');
    dom.voiceBar.classList.remove('hidden');

    setKeypadLocked(true);

    const card = state.currentCard;
    state.streak = 0;
    state.retriesCount++;
    state.roundMissedCards.add(`${card.a} × ${card.b} = ${card.product}`);

    // Record miss on both a×b and b×a commutatively
    recordFactMiss(stats144, card.a, card.b);
    saveStats();

    const retryOutcome = scheduleRetryOnMiss(state.queue, card, settings.retryMode);
    if (retryOutcome.cleared) {
      state.clearedCount++;
    }
    updateHudStats();

    document.body.classList.add('penalty-flash');
    setTimeout(() => {
      document.body.classList.remove('penalty-flash');
    }, 500);

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

    dom.echoPromptBox.classList.remove('hidden', 'listening');
    dom.echoPromptBox.classList.add('locked');
    dom.echoPromptText.textContent = `🔒 Listen closely to the answer...`;
    dom.echoInputPreview.textContent = `Unlocks as soon as the voice finishes`;

    dom.revealDetail.textContent = retryOutcome.message;
    dom.flashcard.classList.add('flipped');

    let fullSpeech = `${reprimandSpeech} ${card.a} times ${card.b} is ${card.product}!`;
    if (settings.speakTrick) {
      fullSpeech += ` ${trick.speech}`;
    }
    fullSpeech += ` Now say or type ${card.targetAnswer}.`;

    const revealCardToken = state.cardResultCounter;

    speakText(fullSpeech, () => {
      if (state.phase !== 'REVEAL' || state.cardResultCounter !== revealCardToken) return;

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

  function handleKeypadInput(key) {
    // Allow keypad interaction during CONFIRM_VOICE phase as well:
    if (state.phase === 'CONFIRM_VOICE' && state.currentCard) {
      if (key === 'enter') {
        submitConfirmedVoiceAnswer(state.confirmCandidate);
        return;
      }
      if (key === 'clear') {
        cancelVoiceConfirmation();
        return;
      }
      if (/^\d$/.test(key)) {
        cancelVoiceConfirmation();
        // Fall through to QUESTION keypad handling below with the pressed digit
      }
    }

    if (state.phase === 'REVEAL' && state.currentCard) {
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

  function updateHudStats() {
    dom.statScore.textContent = `${state.clearedCount} / ${state.targetCount}`;
    const isCardActive =
      state.phase === 'QUESTION' ||
      state.phase === 'CONFIRM_VOICE' ||
      state.phase === 'REVEAL';
    const remaining = state.queue.length + (isCardActive ? 1 : 0);
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
    dom.vAvgTime.textContent = avgMs > 0 ? `${(avgMs / 1000).toFixed(1)}s` : '—';
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
    clearInterval(state.confirmIntervalId);
    clearInterval(state.ttsPollIntervalId);
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

    dom.settingTimer.value = String(settings.timerSeconds);
    if (dom.settingSpeakPraise) dom.settingSpeakPraise.checked = settings.speakPraise;
    dom.settingRetryMode.value = settings.retryMode;
    dom.settingQuestionMode.value = settings.questionMode;
    dom.settingShowTrick.checked = settings.showTrick;
    dom.settingSpeakTrick.checked = settings.speakTrick;
    dom.settingShowTwin.checked = settings.showTwin;
    dom.settingMic.checked = settings.autoMic;
    if (dom.settingConfirmVoice) dom.settingConfirmVoice.checked = settings.confirmVoice;
    dom.settingSpeakQuestion.checked = settings.speakQuestion;
    dom.settingAutoKeypad.checked = settings.autoKeypad;

    dom.keypadGrid.classList.toggle('hidden', !settings.keypadVisible);
    dom.keypadToggleLabel.textContent = settings.keypadVisible ? '⌨️ Hide Keypad' : '⌨️ Show Keypad';
  }

  function bindEvents() {
    document.getElementById('btn-start-gauntlet').addEventListener('click', startGauntletRound);
    document.getElementById('btn-play-again').addEventListener('click', startGauntletRound);
    document.getElementById('btn-back-lobby').addEventListener('click', () => {
      clearAllTimers();
      stopListeningSafely();
      state.phase = 'LOBBY';
      showScreen('LOBBY');
    });

    if (dom.btnConfirmYes) {
      dom.btnConfirmYes.addEventListener('click', () => {
        if (state.phase === 'CONFIRM_VOICE' && state.confirmCandidate !== null) {
          submitConfirmedVoiceAnswer(state.confirmCandidate);
        }
      });
    }

    if (dom.btnConfirmNo) {
      dom.btnConfirmNo.addEventListener('click', () => {
        if (state.phase === 'CONFIRM_VOICE') {
          cancelVoiceConfirmation();
        }
      });
    }

    document.querySelectorAll('#timer-size-control .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.timerSeconds = parseInt(btn.dataset.timer, 10);
        saveSettings();
        syncLobbyControlsUI();
      });
    });

    document.querySelectorAll('#round-size-control .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.roundSize = parseInt(btn.dataset.size, 10);
        saveSettings();
        syncLobbyControlsUI();
      });
    });

    document.querySelectorAll('#question-mode-control .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        settings.questionMode = btn.dataset.qmode;
        saveSettings();
        syncLobbyControlsUI();
      });
    });

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

    document.getElementById('btn-front-hint').addEventListener('click', () => {
      if ((state.phase === 'QUESTION' || state.phase === 'CONFIRM_VOICE') && state.currentCard) {
        const trick = getMentalMathTrick(state.currentCard.a, state.currentCard.b);
        dom.frontHintBox.textContent = trick.text;
        dom.frontHintBox.classList.toggle('hidden');
      }
    });

    document.getElementById('btn-flip-giveup').addEventListener('click', () => {
      if (state.phase === 'QUESTION' || state.phase === 'CONFIRM_VOICE') {
        state.phase = 'QUESTION';
        handleWrongAnswer('', 'flip');
      }
    });

    document.getElementById('btn-mic-toggle').addEventListener('click', () => {
      micPermissionDenied = false;
      settings.autoMic = !settings.autoMic;
      saveSettings();
      syncLobbyControlsUI();
      if (settings.autoMic && isVoicePhaseActive()) {
        startListeningSafely();
      } else {
        stopListeningSafely();
        updateVoiceBarUI(false, 'Mic off (tap to enable)');
      }
    });

    document.getElementById('btn-toggle-keypad').addEventListener('click', () => {
      settings.keypadVisible = !settings.keypadVisible;
      saveSettings();
      syncLobbyControlsUI();
    });

    dom.keypadGrid.querySelectorAll('.key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleKeypadInput(btn.dataset.key);
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeypadInput(e.key);
      } else if (e.key === 'Backspace') {
        handleKeypadInput('clear');
      } else if (e.key === 'Enter') {
        handleKeypadInput('enter');
      }
    });

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

    const openSettings = () => {
      renderFactorToggles();
      dom.modalSettings.classList.remove('hidden');
    };
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-open-settings-lobby').addEventListener('click', openSettings);
    document.getElementById('btn-close-settings').addEventListener('click', () => {
      dom.modalSettings.classList.add('hidden');
    });

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
      if (isVoicePhaseActive()) {
        if (settings.autoMic) startListeningSafely();
        else stopListeningSafely();
      }
    });
    if (dom.settingConfirmVoice) {
      dom.settingConfirmVoice.addEventListener('change', () => {
        settings.confirmVoice = dom.settingConfirmVoice.checked;
        saveSettings();
      });
    }
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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.update().catch(() => {});
      }).catch(() => {});
    });
  }

  initSpeechRecognition();
  bindEvents();
  syncLobbyControlsUI();
  updateMasteryUI();
}

// Export pure logic functions for Node.js unit test suite (node --test)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP_VERSION,
    CONFIRM_TIMEOUT_MS,
    WORD_TO_NUM,
    createInitialStats,
    syncCommutativeStats,
    recordFactHit,
    recordFactMiss,
    getCardStatus,
    stripQuestionEcho,
    extractSpokenNumbers,
    getWrongAnswerDebounceMs,
    getVoiceCaptureSettleMs,
    parseVoiceConfirmationResponse,
    advanceRetryQueueOnHit,
    scheduleRetryOnMiss,
    getProximityFeedback,
    getMentalMathTrick
  };
}
