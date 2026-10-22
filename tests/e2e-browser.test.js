const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ROOT_DIR = path.resolve(__dirname, '..');
const USER_DATA_DIR = path.join(__dirname, '.chrome-test-profile');

function startStaticServer() {
  return new Promise((resolve) => {
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    const server = http.createServer((req, res) => {
      const cleanPath = req.url.split('?')[0];
      const filePath = path.join(ROOT_DIR, cleanPath === '/' ? 'index.html' : cleanPath);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(fs.readFileSync(filePath));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function connectCDP(debugPort) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await res.json();
      const pageTarget = targets.find(t => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
          let msgId = 1;
          const pending = new Map();
          const exceptions = [];
          const logs = [];

          ws.onopen = () => {
            const send = (method, params = {}) => new Promise((resSend, rejSend) => {
              const id = msgId++;
              pending.set(id, { resolve: resSend, reject: rejSend });
              ws.send(JSON.stringify({ id, method, params }));
            });
            resolve({ ws, send, exceptions, logs });
          };
          ws.onmessage = (ev) => {
            const data = JSON.parse(ev.data);
            if (data.id && pending.has(data.id)) {
              const p = pending.get(data.id);
              pending.delete(data.id);
              if (data.error) p.reject(new Error(data.error.message));
              else p.resolve(data.result);
            } else if (data.method === 'Runtime.exceptionThrown') {
              exceptions.push(data.params.exceptionDetails);
            } else if (data.method === 'Runtime.consoleAPICalled') {
              logs.push(data.params);
            }
          };
          ws.onerror = reject;
        });
      }
    } catch {
      // Wait and retry
    }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Could not connect to Chrome CDP');
}

describe('Real Chrome E2E: Continuous Microphone Lifecycle, Confirmation Loop & Mobile Viewport Fit', () => {
  let serverObj;
  let chromeProc;
  let cdp;
  const debugPort = 9334;

  before(async () => {
    serverObj = await startStaticServer();
    chromeProc = spawn(CHROME_PATH, [
      '--headless=new',
      '--no-sandbox',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${USER_DATA_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank'
    ]);
    cdp = await connectCDP(debugPort);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
  });

  after(async () => {
    if (cdp && cdp.ws) cdp.ws.close();
    if (chromeProc) {
      chromeProc.kill();
      await new Promise(r => setTimeout(r, 250));
    }
    if (serverObj && serverObj.server) serverObj.server.close();
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup race on Windows
    }
  });

  it('recovers from poisoned localStorage (autoMic: false), initializes v1.8, and starts continuous SpeechRecognition on START GAUNTLET', async () => {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        // Simulate poisoned v1.6/v1.7 localStorage where autoMic was accidentally toggled to false
        localStorage.setItem('gauntlet_settings_v2', JSON.stringify({ autoMic: false, speakPraise: true }));

        window.__recInstances = [];
        window.__recEvents = [];
        class MockSpeechRecognition {
          constructor() {
            this.lang = 'en-US';
            this.continuous = false;
            this.interimResults = false;
            this.maxAlternatives = 1;
            this.active = false;
            this.history = [];
            window.__recInstances.push(this);
          }
          start() {
            window.__recEvents.push('start');
            if (this.active) {
              const err = new Error('recognition has already started');
              err.name = 'InvalidStateError';
              throw err;
            }
            this.active = true;
            this.history = [];
            setTimeout(() => {
              if (this.onstart) this.onstart();
            }, 10);
          }
          abort() {
            window.__recEvents.push('abort');
            this.active = false;
            setTimeout(() => {
              if (this.onend) this.onend();
            }, 10);
          }
          stop() {
            window.__recEvents.push('stop');
            this.active = false;
            setTimeout(() => {
              if (this.onend) this.onend();
            }, 10);
          }
          // Simulates realistic continuous Android/Desktop SpeechRecognition where event.results accumulates segments
          simulateSpeech(transcript, isFinal = true) {
            if (!this.onresult || !this.active) return;
            const res = [{ transcript, confidence: 0.99 }];
            res.isFinal = isFinal;
            this.history.push(res);
            const event = {
              resultIndex: this.history.length - 1,
              results: [...this.history]
            };
            this.onresult(event);
          }
        }
        window.SpeechRecognition = MockSpeechRecognition;
        window.webkitSpeechRecognition = MockSpeechRecognition;

        // Fast deterministic speechSynthesis mock for wrong-answer REVEAL test
        window.__spokenUtterances = [];
        window.speechSynthesis.cancel = () => {};
        window.speechSynthesis.speak = (utterance) => {
          window.__spokenUtterances.push(utterance.text);
          setTimeout(() => {
            if (utterance.onend) utterance.onend();
          }, 60);
        };
      `
    });

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 384,
      height: 832,
      deviceScaleFactor: 2.8,
      mobile: true
    });

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverObj.port}/` });
    await new Promise(r => setTimeout(r, 350));

    assert.equal(cdp.exceptions.length, 0, `Unexpected page exceptions: ${JSON.stringify(cdp.exceptions)}`);

    const initialCheck = await cdp.send('Runtime.evaluate', {
      expression: `({
        version: document.getElementById('app-version').textContent.trim(),
        micCheckedInSettings: document.getElementById('setting-mic').checked,
        praiseCheckedInSettings: document.getElementById('setting-speak-praise').checked
      })`,
      returnByValue: true
    });

    assert.equal(initialCheck.result.value.version, 'v1.8 ↻');
    assert.equal(initialCheck.result.value.micCheckedInSettings, true, 'Poisoned autoMic: false from v2 should be repaired to true');
    assert.equal(initialCheck.result.value.praiseCheckedInSettings, false, 'speakPraise should default to false to protect Android mic audio focus');
  });

  it('keeps SpeechRecognition continuously active across Question 1 -> 0ms Voice Confirmation -> Question 2 with zero abort() calls', async () => {
    await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('btn-start-gauntlet').click()`
    });
    await new Promise(r => setTimeout(r, 80));

    const q1 = await cdp.send('Runtime.evaluate', {
      expression: `({
        recActive: window.__recInstances[window.__recInstances.length - 1].active,
        voiceBarListening: document.getElementById('voice-bar').classList.contains('listening'),
        left: Number(document.getElementById('slot-left').textContent),
        mid: Number(document.getElementById('slot-mid').textContent)
      })`,
      returnByValue: true
    });

    assert.equal(q1.result.value.recActive, true, 'Mic must be active on Question 1');
    assert.equal(q1.result.value.voiceBarListening, true, 'Voice bar must have .listening on Question 1');

    const ans1 = q1.result.value.left * q1.result.value.mid;

    // Speak the answer on Question 1
    await cdp.send('Runtime.evaluate', {
      expression: `window.__recInstances[window.__recInstances.length - 1].simulateSpeech('${ans1}', true)`
    });

    // Wait for settleMs (350ms for exact match final result)
    await new Promise(r => setTimeout(r, 420));

    const confirmState = await cdp.send('Runtime.evaluate', {
      expression: `({
        confirmVisible: !document.getElementById('voice-confirm-box').classList.contains('hidden'),
        confirmListening: document.getElementById('voice-confirm-box').classList.contains('listening'),
        promptText: document.getElementById('voice-confirm-prompt').textContent,
        events: [...window.__recEvents]
      })`,
      returnByValue: true
    });

    assert.equal(confirmState.result.value.confirmVisible, true, 'Confirmation banner must be visible');
    assert.equal(confirmState.result.value.confirmListening, true, 'Confirmation banner must be immediately unlocked and listening (0ms delay)');
    assert.ok(confirmState.result.value.promptText.includes(String(ans1)));
    assert.equal(
      confirmState.result.value.events.includes('abort'),
      false,
      `SpeechRecognition must NEVER be aborted when entering confirmation, got events: ${JSON.stringify(confirmState.result.value.events)}`
    );

    // Immediately confirm by repeating the number (tests Android progressive results accumulation too!)
    await cdp.send('Runtime.evaluate', {
      expression: `window.__recInstances[window.__recInstances.length - 1].simulateSpeech('${ans1}', true)`
    });

    // Wait for 450ms praise transition to Question 2
    await new Promise(r => setTimeout(r, 550));

    const q2 = await cdp.send('Runtime.evaluate', {
      expression: `({
        scoreText: document.getElementById('stat-score').textContent,
        cardTag: document.getElementById('card-tag').textContent,
        recActive: window.__recInstances[window.__recInstances.length - 1].active,
        voiceBarListening: document.getElementById('voice-bar').classList.contains('listening'),
        events: [...window.__recEvents]
      })`,
      returnByValue: true
    });

    assert.ok(q2.result.value.scoreText.startsWith('1 /'), `Expected score to advance to 1, got ${q2.result.value.scoreText}`);
    assert.ok(q2.result.value.cardTag.includes('CARD 2 OF'), `Expected CARD 2, got ${q2.result.value.cardTag}`);
    assert.equal(q2.result.value.recActive, true, 'Mic must remain active on Question 2');
    assert.equal(q2.result.value.voiceBarListening, true, 'Voice bar must remain .listening on Question 2');
    assert.equal(
      q2.result.value.events.includes('abort'),
      false,
      `SpeechRecognition must NEVER be aborted across Question 1 -> Confirmation -> Question 2`
    );
  });

  it('wakes the microphone ON when #btn-mic-toggle is tapped while the mic is paused (never flips autoMic to false)', async () => {
    // Simulate Android OS unexpectedly ending recognition (e.g. brief audio interruption)
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const rec = window.__recInstances[window.__recInstances.length - 1];
        rec.active = false;
        if (rec.onend) rec.onend();
      })()`
    });

    // Immediately tap #btn-mic-toggle before the background timer even fires
    await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById('btn-mic-toggle').click()`
    });
    await new Promise(r => setTimeout(r, 50));

    const afterTap = await cdp.send('Runtime.evaluate', {
      expression: `({
        recActive: window.__recInstances[window.__recInstances.length - 1].active,
        micSettingChecked: document.getElementById('setting-mic').checked,
        voiceBarListening: document.getElementById('voice-bar').classList.contains('listening')
      })`,
      returnByValue: true
    });

    assert.equal(afterTap.result.value.recActive, true, 'Tapping #btn-mic-toggle when paused must wake the mic');
    assert.equal(afterTap.result.value.micSettingChecked, true, 'autoMic must remain true');
    assert.equal(afterTap.result.value.voiceBarListening, true);
  });

  it('flips card on wrong answer, keeps all 4 keypad rows 100% visible inside viewport, unlocks voice echo, and advances when target answer is spoken', async () => {
    // Get current card's target answer and submit a wrong answer via keypad
    const qInfo = await cdp.send('Runtime.evaluate', {
      expression: `({
        left: Number(document.getElementById('slot-left').textContent),
        mid: Number(document.getElementById('slot-mid').textContent)
      })`,
      returnByValue: true
    });
    const correctAns = qInfo.result.value.left * qInfo.result.value.mid;
    const wrongAns = correctAns === 25 ? 26 : 25;

    for (const digit of String(wrongAns)) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('.key-btn[data-key="${digit}"]').click()`
      });
    }
    await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('.key-btn[data-key="enter"]').click()`
    });

    // Wait for mock TTS (60ms) to finish and unlock the flipped card back
    await new Promise(r => setTimeout(r, 200));

    const revealState = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const keys = [...document.querySelectorAll('.key-btn')].map(btn => {
          const r = btn.getBoundingClientRect();
          return { key: btn.dataset.key, top: r.top, bottom: r.bottom, height: r.height };
        });
        return {
          flipped: document.getElementById('flashcard').classList.contains('flipped'),
          echoLocked: document.getElementById('echo-prompt-box').classList.contains('locked'),
          echoListening: document.getElementById('echo-prompt-box').classList.contains('listening'),
          echoText: document.getElementById('echo-prompt-text').textContent,
          viewportHeight: window.innerHeight,
          keys
        };
      })()`,
      returnByValue: true
    });

    assert.equal(revealState.result.value.flipped, true, 'Card should be flipped to back on wrong answer');
    assert.equal(revealState.result.value.echoLocked, false, 'Echo box should be unlocked after TTS completes');
    assert.equal(revealState.result.value.echoListening, true, 'Echo box mic dot must be green (.listening)');
    assert.ok(revealState.result.value.echoText.includes(String(correctAns)));

    // Verify all 12 keypad buttons (especially bottom row: clear, 0, enter) have plenty of clearance at bottom
    for (const k of revealState.result.value.keys) {
      assert.ok(
        k.bottom <= revealState.result.value.viewportHeight - 10,
        `Key "${k.key}" bottom (${k.bottom}px) is too close to or below viewport bottom (${revealState.result.value.viewportHeight}px)`
      );
      assert.ok(k.height >= 34, `Key "${k.key}" height (${k.height}px) is too small`);
    }

    // Now speak the required echo answer on the flipped card back and verify it advances to the next card!
    await cdp.send('Runtime.evaluate', {
      expression: `window.__recInstances[window.__recInstances.length - 1].simulateSpeech('${correctAns}', true)`
    });

    await new Promise(r => setTimeout(r, 480));

    const afterEcho = await cdp.send('Runtime.evaluate', {
      expression: `({
        flipped: document.getElementById('flashcard').classList.contains('flipped'),
        voiceBarListening: document.getElementById('voice-bar').classList.contains('listening')
      })`,
      returnByValue: true
    });

    assert.equal(afterEcho.result.value.flipped, false, 'Speaking the target answer on the flipped card back must advance to the next card');
    assert.equal(afterEcho.result.value.voiceBarListening, true, 'Next card must be actively listening');
  });
});
