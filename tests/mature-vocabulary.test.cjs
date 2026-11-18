const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(
  /\}\)\(\);\s*$/,
  'globalThis.testApi = {game, vocabulary, badWords, translations, spawnWord, update, endGame, render};})();'
);
const matureWords = ['damn', 'crap', 'stupid', 'idiot', 'moron', 'loser', 'dumbass', 'piss', 'shit', 'fuck', 'bitch', 'bastard', 'asshole', 'dick', 'slut'];

function loadGame(saved = new Map(), blocked = false) {
  const handlers = new Map();
  const context = new Proxy({}, {
    get(target, key) {
      if (key === 'measureText') return text => ({width:text.length * 10});
      if (key === 'createRadialGradient') return () => ({addColorStop(){}});
      return target[key] ?? (() => {});
    },
    set(target, key, value) { target[key] = value; return true; }
  });
  class Element {
    constructor(tagName = 'DIV') {
      Object.assign(this, {tagName, children:[], textContent:'', value:'', checked:false, disabled:false});
      this.classList = {add(){}, remove(){}};
    }
    addEventListener(type, handler) { handlers.set(this.id + ':' + type, handler); }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    focus() { document.activeElement = this; }
    blur() { document.activeElement = null; }
    getBoundingClientRect() { return {width:950, height:550}; }
    getContext() { return context; }
  }
  const elements = {};
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[1].toUpperCase());
    element.id = match[2];
    element.checked = /\schecked(?:\s|>)/.test(match[0]);
    elements[element.id] = element;
  }
  const document = {
    getElementById(id) { assert(elements[id], `Unknown element ${id}`); return elements[id]; },
    createElement:tag => new Element(tag.toUpperCase()),
    addEventListener:(type, handler) => handlers.set('document:' + type, handler),
    hidden:false
  };
  const sandbox = {
    document,
    window:{matchMedia:() => ({matches:true}), devicePixelRatio:1, addEventListener(){}},
    localStorage:{
      getItem(key) { if (blocked) throw new Error('Storage blocked'); return saved.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error('Storage blocked'); saved.set(key, value); }
    },
    requestAnimationFrame(){}
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, {filename:'index.html'});
  vm.runInContext('Math.random = () => 0', sandbox);
  const fire = (id, type, props = {}) => {
    const event = {target:elements[id], preventDefault(){ this.defaultPrevented = true; }, ...props};
    handlers.get(id + ':' + type)(event);
    return event;
  };
  return {
    ...sandbox.testApi, elements, saved, fire,
    toggle(checked) { elements['mature-words'].checked = checked; fire('mature-words', 'change'); },
    launch() { fire('start', 'click'); },
    key(key, target = elements.typing) { return fire('document', 'keydown', {key, target}); }
  };
}

const fresh = loadGame();
assert.equal(fresh.game.mature, false);
assert.equal(fresh.elements['mature-words'].checked, false);
assert.equal(fresh.elements['vocabulary-count'].textContent, (2000).toLocaleString());
assert.equal(fresh.vocabulary.length, 2000);
assert.equal(fresh.badWords.length, 15);
assert.deepEqual(Array.from(fresh.badWords, entry => entry[0]), matureWords);
assert.equal(new Set([...fresh.vocabulary, ...fresh.badWords].map(entry => entry[0])).size, 2015);
for (const entry of fresh.badWords) {
  assert.equal(entry.length, 4);
  assert.match(entry[0], /^[a-z]+$/);
  assert.match(entry[1], /[\u0e00-\u0e7f]/);
  assert.match(entry[2], /[\u3400-\u9fff]/);
  assert.equal(typeof entry[3], 'string');
  assert(entry[3].trim());
  assert(fresh.translations.has(entry[0]), 'Mature translations exist while opted out');
}
for (const key of [' ', 'Enter', 'Escape', 'm']) {
  assert.equal(fresh.key(key, fresh.elements['mature-words']).defaultPrevented, undefined);
  assert.equal(fresh.game.phase, 'ready', 'Checkbox keys do not trigger game shortcuts');
}
fresh.toggle(true);
assert.equal(fresh.saved.get('typing-laser-mature'), 'true');
assert.equal(fresh.elements['vocabulary-count'].textContent, (2015).toLocaleString());
const restored = loadGame(fresh.saved);
assert.equal(restored.game.mature, true);
assert.equal(restored.elements['mature-words'].checked, true);
assert.equal(restored.elements['vocabulary-count'].textContent, (2015).toLocaleString());
restored.toggle(false);
assert.equal(restored.saved.get('typing-laser-mature'), 'false');
assert.equal(loadGame(restored.saved).game.mature, false);
assert.equal(restored.elements['vocabulary-count'].textContent, (2000).toLocaleString());
for (const value of ['false', 'invalid', '1']) {
  assert.equal(loadGame(new Map([['typing-laser-mature', value]])).game.mature, false);
}
const blocked = loadGame(new Map(), true);
blocked.toggle(true);
blocked.launch();
assert.equal(blocked.game.phase, 'playing');
assert.equal(blocked.game.mature, true);
blocked.endGame();
blocked.toggle(false);
assert.equal(blocked.elements['vocabulary-count'].textContent, (2000).toLocaleString());
console.log('PASS default, persistence, reload, blocked storage, count, data shape, and checkbox keyboard handling');

for (const mature of [false, true]) {
  const app = loadGame(new Map([['typing-laser-mature', String(mature)]]));
  for (const speed of ['slow', 'normal', 'fast', 'expert']) {
    app.elements['falling-speed'].value = speed;
    app.fire('falling-speed', 'change');
    assert.equal(app.game.speed, speed);
    for (const wave of [1, 2, 3, 4]) {
      const maxLength = wave === 1 ? 5 : wave < 4 ? 7 : Infinity;
      const expected = [...app.vocabulary, ...(mature ? app.badWords : [])].filter(([text]) => text.length <= maxLength);
      app.launch();
      app.game.wave = wave;
      const seen = new Set([app.game.words[0].text]);
      while (seen.size < expected.length) {
        app.game.words = [];
        app.spawnWord();
        const word = app.game.words[0];
        assert(word.text.length <= maxLength);
        assert(!seen.has(word.text), 'No repeat before the active pool is exhausted');
        assert(word.thai && word.chinese && word.pinyin, 'All spawned words have translations');
        seen.add(word.text);
      }
      assert.deepEqual(new Set([...seen].filter(text => matureWords.includes(text))),
        new Set(mature ? matureWords.filter(text => text.length <= maxLength) : []),
        `Mature eligibility at wave ${wave}, speed ${speed}, opt-in ${mature}`);
      app.endGame();
    }
  }
}
console.log('PASS exhaustive opt-out and opt-in spawning at every wave tier and all four speeds, without repeats or missing translations');

const flight = loadGame(new Map([['typing-laser-mature', 'true']]));
flight.launch();
assert(flight.elements['mature-words'].disabled);
flight.toggle(false);
assert.equal(flight.game.mature, true);
assert.equal(flight.elements['mature-words'].checked, true);
flight.fire('pause', 'click');
assert.equal(flight.game.phase, 'paused');
assert(flight.elements['mature-words'].disabled);
flight.toggle(false);
assert.equal(flight.game.mature, true);
flight.fire('start', 'click');
assert.equal(flight.game.phase, 'playing');

// Leave only the chosen word eligible to exercise real spawning and history paths.
function spawnMature(app, text) {
  app.game.words = [];
  app.game.lockedId = null;
  app.game.wave = 4;
  app.game.spawnedWords = new Set([...app.vocabulary, ...app.badWords].map(entry => entry[0]).filter(word => word !== text));
  app.game.recentWords = [];
  app.spawnWord();
  assert.equal(app.game.words[0].text, text);
  return app.game.words[0];
}
for (const status of ['cleared', 'missed']) {
  for (const entry of flight.badWords) {
    const word = spawnMature(flight, entry[0]);
    if (status === 'cleared') {
      for (const letter of word.text) flight.key(letter);
    } else {
      flight.game.lives = 3;
      flight.game.spawnIn = 99;
      word.y = 10000;
      flight.update(.01);
    }
    const recorded = flight.game.history[0];
    assert.equal(recorded.status, status);
    assert.deepEqual([recorded.text, recorded.thai, recorded.chinese, recorded.pinyin], Array.from(entry));
    const row = flight.elements['history-list'].children[0];
    assert.deepEqual(row.children.slice(1).map(node => node.textContent), [entry[2], entry[3], entry[1]]);
  }
}
flight.endGame();
assert.equal(flight.elements['mature-words'].disabled, false);
flight.toggle(false);
assert.equal(flight.elements['history-list'].children.length, 30, 'Changing selection preserves existing history');
flight.launch();
assert.equal(flight.game.mature, false);
assert.equal(flight.game.history.length, 0);
assert.equal(flight.game.score, 0);
assert.equal(flight.game.lives, 3);
assert(!matureWords.includes(flight.game.words[0].text));
assert.equal(flight.elements['vocabulary-count'].textContent, (2000).toLocaleString());
flight.render();
console.log('PASS playing/paused toggle lock, all 15 cleared/missed translations in history, selection after game over, replay reset, and render');

const rotation = loadGame(new Map([['typing-laser-mature', 'true']]));
rotation.launch();
const chosen = [rotation.game.words[0].text];
for (let i = 1; i < 4030; i++) {
  rotation.game.wave = i < 10 ? 1 : i < 30 ? 2 : 4;
  rotation.game.words = [];
  rotation.spawnWord();
  chosen.push(rotation.game.words[0].text);
  assert(!chosen.slice(Math.max(0, i - 50), i).includes(chosen[i]), 'No repeats among the previous 50 words');
}
for (let start = 0; start < 4030; start += 2015) {
  assert.equal(new Set(chosen.slice(start, start + 2015)).size, 2015, 'Combined vocabulary cycles without repetition as tiers expand');
}
rotation.launch();
rotation.game.wave = 4;
for (let i = 0; i < 4030; i++) {
  if (rotation.game.words.length >= 9) rotation.game.words.shift();
  rotation.spawnWord();
  assert.equal(new Set(rotation.game.words.map(word => word.text)).size, rotation.game.words.length);
}
console.log('PASS combined-pool exhaustion, wave expansion, recent-50 protection, and no duplicate active words');
