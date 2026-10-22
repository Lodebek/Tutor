const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  APP_VERSION,
  WORD_TO_NUM,
  createInitialStats,
  syncCommutativeStats,
  recordFactHit,
  recordFactMiss,
  getCardStatus,
  stripQuestionEcho,
  extractSpokenNumbers,
  getWrongAnswerDebounceMs,
  advanceRetryQueueOnHit,
  scheduleRetryOnMiss,
  getProximityFeedback,
  getMentalMathTrick
} = require('../app.js');

describe('1. Homophone & Filler Speech Immunity', () => {
  it('excludes conversational homophones from WORD_TO_NUM dictionary', () => {
    const forbiddenHomophones = ['to', 'too', 'for', 'fore', 'won', 'ate', 'free', 'oh', 'tree', 'sex', 'tin'];
    for (const word of forbiddenHomophones) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(WORD_TO_NUM, word),
        false,
        `Expected homophone "${word}" to not be in WORD_TO_NUM`
      );
    }
  });

  it('ignores common conversational filler sentences with "to", "for", "won", "ate", "oh"', () => {
    const card = { a: 7, b: 8, product: 56, targetAnswer: 56 };
    assert.deepEqual(extractSpokenNumbers('wait for it', card), []);
    assert.deepEqual(extractSpokenNumbers("I'm going to think about this", card), []);
    assert.deepEqual(extractSpokenNumbers('oh man I almost won', card), []);
    assert.deepEqual(extractSpokenNumbers('hold on let me see', card), []);
  });

  it('extracts genuine spoken number words even when surrounded by homophones and filler', () => {
    const card = { a: 7, b: 8, product: 56, targetAnswer: 56 };
    assert.deepEqual(
      extractSpokenNumbers("I'm going to say wait for it fifty six", card),
      [56]
    );
    assert.deepEqual(
      extractSpokenNumbers('um I think it is forty two', { a: 6, b: 7 }),
      [42]
    );
  });
});

describe('2. Question-Echo Stripping (Digits & Number Words)', () => {
  const card7x8 = { a: 7, b: 8, product: 56, targetAnswer: 56 };

  it('strips digit question echoes ("7 times 8", "7 x 8 is") without leaking [7, 8]', () => {
    assert.deepEqual(extractSpokenNumbers('7 times 8', card7x8), []);
    assert.deepEqual(extractSpokenNumbers('7 times 8 is', card7x8), []);
    assert.deepEqual(extractSpokenNumbers('7 x 8 equals 56', card7x8), [56]);
  });

  it('strips spoken-word question echoes ("seven times eight is...") when a child pauses mid-thought', () => {
    assert.deepEqual(extractSpokenNumbers('seven times eight', card7x8), []);
    assert.deepEqual(extractSpokenNumbers('seven times eight is', card7x8), []);
    assert.deepEqual(extractSpokenNumbers('seven times eight equals', card7x8), []);
    assert.deepEqual(extractSpokenNumbers('seven times', card7x8), []);
  });

  it('strips commutative spoken-word question echoes ("eight times seven is...")', () => {
    assert.deepEqual(extractSpokenNumbers('eight times seven is', card7x8), []);
    assert.deepEqual(extractSpokenNumbers('eight times seven is fifty six', card7x8), [56]);
  });

  it('preserves the actual answer when the child repeats the question and states the product', () => {
    assert.deepEqual(extractSpokenNumbers('seven times eight is fifty six', card7x8), [56]);
    assert.deepEqual(extractSpokenNumbers('12 times 12 is one hundred forty four', { a: 12, b: 12 }), [144]);
  });

  it('strips missing-factor question echoes ("7 times what is 56")', () => {
    const missingCard = { a: 7, b: 8, product: 56, targetAnswer: 8, qType: 'missing_factor' };
    assert.deepEqual(extractSpokenNumbers('seven times what is fifty six', missingCard), []);
    assert.deepEqual(extractSpokenNumbers('7 times what is 56 it is eight', missingCard), [8]);
  });
});

describe('3. Paused Compound Numbers & Child-Friendly Debounce', () => {
  it('combines paused decade + unit speech ("fifty ... six" or "50 6") into 56', () => {
    const card = { a: 7, b: 8, product: 56, targetAnswer: 56 };
    assert.deepEqual(extractSpokenNumbers('fifty six', card), [56]);
    assert.deepEqual(extractSpokenNumbers('50 6', card), [56]);
    assert.deepEqual(extractSpokenNumbers('one hundred 44', { a: 12, b: 12 }), [144]);
    assert.deepEqual(extractSpokenNumbers('one hundred forty four', { a: 12, b: 12 }), [144]);
  });

  it('uses extended debounce windows when spoken number is a decade/hundred prefix ("fifty..." on the way to "fifty six")', () => {
    // Normal wrong number (e.g. 48 when target is 56)
    assert.equal(getWrongAnswerDebounceMs(48, 56, true), 1000);
    assert.equal(getWrongAnswerDebounceMs(48, 56, false), 1500);

    // Decade prefix "50" when target is 56 (or even when child is about to say "fifty four")
    assert.equal(getWrongAnswerDebounceMs(50, 56, true), 1900);
    assert.equal(getWrongAnswerDebounceMs(50, 56, false), 2300);

    // Hundred prefix "100" when target is 144
    assert.equal(getWrongAnswerDebounceMs(100, 144, true), 1900);
    assert.equal(getWrongAnswerDebounceMs(100, 144, false), 2300);
  });
});

describe('4. Commutative Mastery Synchronization (7×8 === 8×7)', () => {
  it('credits both a×b and b×a when recording a hit', () => {
    const stats = createInitialStats();
    recordFactHit(stats, 7, 8, 1800);
    recordFactHit(stats, 7, 8, 1600);

    assert.equal(stats['7x8'].hits, 2);
    assert.equal(stats['8x7'].hits, 2);
    assert.equal(stats['7x8'].streak, 2);
    assert.equal(stats['8x7'].streak, 2);
    assert.equal(getCardStatus(stats['7x8']), 'mastered');
    assert.equal(getCardStatus(stats['8x7']), 'mastered');
  });

  it('records misses on both a×b and b×a commutatively', () => {
    const stats = createInitialStats();
    recordFactMiss(stats, 6, 9);

    assert.equal(stats['6x9'].misses, 1);
    assert.equal(stats['9x6'].misses, 1);
    assert.equal(stats['6x9'].streak, 0);
    assert.equal(stats['9x6'].streak, 0);
  });

  it('synchronizes legacy asymmetric stats on load via syncCommutativeStats', () => {
    const stats = createInitialStats();
    stats['7x8'] = { a: 7, b: 8, product: 56, hits: 3, misses: 0, streak: 3, lastMs: 1400 };
    stats['8x7'] = { a: 8, b: 7, product: 56, hits: 0, misses: 0, streak: 0, lastMs: null };

    syncCommutativeStats(stats);

    assert.equal(stats['8x7'].hits, 3);
    assert.equal(stats['8x7'].streak, 3);
    assert.equal(stats['8x7'].lastMs, 1400);
    assert.equal(getCardStatus(stats['8x7']), 'mastered');
  });
});

describe('5. 1 → 3 → 7 Expanding Spacing Queue & Explicit Ladder Reset', () => {
  it('graduates a retry card through stages 1 → 2 → 3 before counting as cleared', () => {
    const queue = [
      { id: 'c1', a: 2, b: 3, product: 6, targetAnswer: 6 },
      { id: 'c2', a: 3, b: 4, product: 12, targetAnswer: 12 },
      { id: 'c3', a: 4, b: 5, product: 20, targetAnswer: 20 },
      { id: 'c4', a: 5, b: 6, product: 30, targetAnswer: 30 }
    ];
    const missedCard = { id: '7x8', a: 7, b: 8, product: 56, targetAnswer: 56, isRetry: false, retryStage: 0 };

    // Initial miss -> schedules stage 1 after 1 card (index 1)
    const missRes = scheduleRetryOnMiss(queue, missedCard, 'expanding');
    assert.equal(missRes.cleared, false);
    assert.equal(missRes.wasReset, false);
    assert.equal(queue[1].id, '7x8');
    assert.equal(queue[1].retryStage, 1);

    // Pull stage 1 card and pass it -> schedules stage 2 after 3 cards
    const stage1Card = queue.splice(1, 1)[0];
    const clearedAfter1 = advanceRetryQueueOnHit(queue, stage1Card, 'expanding');
    assert.equal(clearedAfter1, false);
    const stage2Card = queue.find(c => c.id === '7x8');
    assert.equal(stage2Card.retryStage, 2);

    // Pull stage 2 card and pass it -> schedules stage 3 after 7 cards (clamped to queue end)
    const idx2 = queue.findIndex(c => c.id === '7x8');
    const pulledStage2 = queue.splice(idx2, 1)[0];
    const clearedAfter2 = advanceRetryQueueOnHit(queue, pulledStage2, 'expanding');
    assert.equal(clearedAfter2, false);
    const stage3Card = queue.find(c => c.id === '7x8');
    assert.equal(stage3Card.retryStage, 3);

    // Pull stage 3 card and pass it -> finally cleared!
    const idx3 = queue.findIndex(c => c.id === '7x8');
    const pulledStage3 = queue.splice(idx3, 1)[0];
    const clearedAfter3 = advanceRetryQueueOnHit(queue, pulledStage3, 'expanding');
    assert.equal(clearedAfter3, true);
  });

  it('explicitly reports a ladder reset when a stage 2 or stage 3 retry card is missed', () => {
    const queue = [{ id: 'c1', a: 2, b: 2, product: 4, targetAnswer: 4 }];
    const stage2Retry = { id: '7x8', a: 7, b: 8, product: 56, targetAnswer: 56, isRetry: true, retryStage: 2 };

    const outcome = scheduleRetryOnMiss(queue, stage2Retry, 'expanding');
    assert.equal(outcome.wasReset, true);
    assert.match(outcome.message, /Ladder Reset \(was 2\/3\)/);
    assert.equal(queue[1].retryStage, 1);
  });
});

describe('6. Proximity Coaching & Mental Math Tricks', () => {
  const card3x9 = { a: 3, b: 9, product: 27, targetAnswer: 27, qType: 'product' };

  it('classifies answers off by <= 1 factor step as close-tier ("So close! Nice try!")', () => {
    const res = getProximityFeedback(card3x9, 24, 'voice'); // diff = 3 <= 9
    assert.equal(res.tierClass, 'close-tier');
  });

  it('classifies answers off by <= 2x factor step as mid-tier ("Come on, you can do better!")', () => {
    const res = getProximityFeedback(card3x9, 15, 'voice'); // diff = 12 (between 9 and 18)
    assert.equal(res.tierClass, 'mid-tier');
  });

  it('classifies answers off by > 2x factor step as far-tier', () => {
    const res = getProximityFeedback(card3x9, 50, 'voice'); // diff = 23 > 18
    assert.equal(res.tierClass, 'far-tier');
  });

  it('returns mental math decomposition tricks and single-source APP_VERSION', () => {
    assert.equal(APP_VERSION, 'v1.5');
    const trick = getMentalMathTrick(7, 8);
    assert.ok(trick.text.length > 0);
    assert.ok(trick.speech.length > 0);
  });
});
