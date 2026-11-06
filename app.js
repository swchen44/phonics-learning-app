'use strict';

const units = [{
  id: 1,
  title: 'Short a',
  soundTitle: '聽短母音 /æ/',
  soundHint: '先聽單字中的短母音。嘴巴張開，發出短促的 /æ/。',
  examples: ['cat', 'bat'],
  words: [
    { w: 'cat', zh: '貓', p: ['/k/', '/æ/', '/t/'], picture: 'cat' },
    { w: 'bat', zh: '蝙蝠', p: ['/b/', '/æ/', '/t/'], picture: 'bat' },
    { w: 'hat', zh: '帽子', p: ['/h/', '/æ/', '/t/'], picture: 'hat' },
    { w: 'jam', zh: '果醬', p: ['/dʒ/', '/æ/', '/m/'], picture: 'jam' },
    { w: 'ram', zh: '公羊', p: ['/r/', '/æ/', '/m/'], picture: 'ram' },
    { w: 'can', zh: '罐子', p: ['/k/', '/æ/', '/n/'], picture: 'can' },
  ],
}];
const questionsPerQuiz = 5;
const $ = id => document.getElementById(id);
const svgNamespace = 'http://www.w3.org/2000/svg';
let db;
let student = '';
let unit = units[0];
let tab = 'sound';
let wordIndex = 0;
let quizzes = {};
let recording = null;
let practiceRecording = null;

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store(mode = 'readonly') {
  return db.transaction('students', mode).objectStore('students');
}

function message(text, good = true) {
  $('feedback').textContent = text;
  $('feedback').className = good ? 'ok' : 'bad';
}

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function button(text, onClick, secondary = false) {
  const node = element('button', text, secondary ? 'secondary' : '');
  node.type = 'button';
  node.onclick = onClick;
  return node;
}

function actions(...children) {
  const row = element('div', '', 'actions');
  row.append(...children);
  return row;
}

function wordLabel(word, large = false) {
  const label = element('span', '', large ? 'word' : 'word-label');
  label.lang = 'en';
  const picture = element('span', '', 'word-picture');
  picture.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(svgNamespace, 'svg');
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', `./pictures.svg#${word.picture}`);
  svg.append(use);
  picture.append(svg);
  label.append(picture, word.w);
  return label;
}

function speak(text, rate) {
  if (!('speechSynthesis' in window)) {
    message('裝置不支援語音合成', false);
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.pitch = 1;
  utterance.rate = rate;
  $('stage').querySelector('audio')?.pause();
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
  return true;
}

function pronunciationButtons(word, onPlay) {
  function play(rate) {
    if (!recording && speak(word.w, rate)) onPlay?.();
  }
  return actions(
    button('🔊 正常速度', () => play(0.9)),
    button('🔊 慢速播放', () => play(0.6), true),
  );
}

function log(kind, word, correct) {
  const event = { at: new Date().toISOString(), unit: unit.id, word: word.w, kind };
  if (correct !== undefined) event.correct = correct;
  const target = store('readwrite');
  const request = target.get(student);
  request.onsuccess = () => {
    const profile = request.result;
    if (!profile) return;
    profile.events = [...profile.events, event].slice(-3000);
    target.put(profile);
  };
  target.transaction.oncomplete = () => progress().catch(reportStorageError);
  target.transaction.onabort = reportStorageError;
}

function reportStorageError() {
  message('這次無法讀取或儲存本機進度。', false);
}

async function progress() {
  const activeStudent = student;
  const activeUnit = unit;
  const profile = await req(store().get(activeStudent));
  if (activeStudent !== student || activeUnit !== unit) return;
  const events = (profile?.events || []).filter(event => (event.unit ?? 1) === unit.id);
  const seen = new Set(events.filter(event => ['listen', 'record'].includes(event.kind)).map(event => event.word));
  const listening = events.filter(event => event.kind === 'quiz');
  const reading = events.filter(event => event.kind === 'reading');
  const count = unit.words.filter(word => seen.has(word.w)).length;
  $('summary').textContent = `${profile?.name || '學生'}：練習 ${count}/${unit.words.length} 個單字 · 聽力累計答對 ${listening.filter(event => event.correct).length}/${listening.length} 題 · 朗讀累計完成 ${reading.length} 題`;
  $('progress').max = unit.words.length;
  $('progress').value = count;
}

async function students() {
  let profiles = await req(store().getAll());
  if (!profiles.length) {
    const profile = { id: crypto.randomUUID(), name: '學生 1', events: [] };
    await req(store('readwrite').put(profile));
    profiles = [profile];
  }
  $('student').replaceChildren(...profiles.map(profile => new Option(profile.name, profile.id)));
  if (!profiles.some(profile => profile.id === student)) student = profiles[0].id;
  $('student').value = student;
  await progress();
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createQuiz() {
  return {
    index: 0,
    score: 0,
    selected: null,
    recordingUrl: '',
    questions: shuffled(unit.words).slice(0, questionsPerQuiz).map(word => ({
      word,
      options: shuffled([word, ...shuffled(unit.words.filter(option => option !== word)).slice(0, 3)]),
    })),
  };
}

function mayNavigate() {
  if (!recording) return true;
  message('請先完成目前的錄音。', false);
  return false;
}

function releaseRecording(url) {
  if (url) URL.revokeObjectURL(url);
}

function resetActivities() {
  releaseRecording(quizzes.reading?.recordingUrl);
  releaseRecording(practiceRecording?.url);
  quizzes = {};
  practiceRecording = null;
  wordIndex = 0;
}

function recordingPlayer(url) {
  const player = document.createElement('audio');
  player.controls = true;
  player.src = url;
  player.setAttribute('aria-label', '重聽自己的錄音');
  return player;
}

function recordingControls(onComplete, hasRecording) {
  const start = button(hasRecording ? '重新錄音' : '開始錄音', async () => {
    if (recording) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      message('此瀏覽器不支援麥克風錄音。', false);
      return;
    }
    const session = {};
    recording = session;
    start.disabled = true;
    message('正在開啟麥克風…');
    let stream;
    function finish(error) {
      stream?.getTracks().forEach(track => track.stop());
      if (recording !== session) return false;
      recording = null;
      start.disabled = false;
      stop.disabled = true;
      if (error) message(error, false);
      return true;
    }
    try {
      window.speechSynthesis?.cancel();
      $('stage').querySelector('audio')?.pause();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      session.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish('錄音失敗，請再試一次。');
      recorder.onstop = () => {
        if (!finish()) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!blob.size) {
          message('沒有錄到聲音，請再試一次。', false);
          return;
        }
        onComplete(URL.createObjectURL(blob));
      };
      recorder.start();
      stop.disabled = false;
      message('錄音中…');
    } catch (error) {
      finish(`麥克風無法使用：${error.message}`);
    }
  });
  const stop = button('停止錄音', () => {
    const recorder = recording?.recorder;
    if (recorder?.state !== 'recording') return;
    stop.disabled = true;
    recorder.stop();
  }, true);
  stop.disabled = true;
  return actions(start, stop);
}

function nextWordButton() {
  return button('下一個單字 →', () => {
    if (!mayNavigate()) return;
    wordIndex = (wordIndex + 1) % unit.words.length;
    draw();
  }, true);
}

function drawSound(root) {
  root.append(element('h3', unit.soundTitle), element('p', unit.soundHint));
  const examples = element('div', '', 'examples');
  for (const word of unit.words.filter(word => unit.examples.includes(word.w))) {
    const group = element('fieldset');
    const label = element('legend');
    label.append(wordLabel(word));
    group.append(label, pronunciationButtons(word, () => log('listen', word, true)));
    examples.append(group);
  }
  root.append(examples);
}

function drawPractice(root, word) {
  const following = tab === 'record';
  root.append(element('h3', following ? '聽音後跟讀' : '逐音拼讀'), wordLabel(word, true),
    element('p', `${word.p.join(' + ')} · ${word.zh}`, 'phonemes'),
    pronunciationButtons(word, following ? undefined : () => log('listen', word, true)));
  if (following) {
    const saved = practiceRecording?.word === word ? practiceRecording.url : '';
    root.append(recordingControls(url => {
      releaseRecording(practiceRecording?.url);
      practiceRecording = { word, url };
      log('record', word, true);
      draw();
      message('錄音完成，可以重聽自己的發音。');
    }, saved));
    if (saved) root.append(recordingPlayer(saved));
  }
  root.append(actions(nextWordButton()));
}

function drawQuiz(root) {
  const mode = tab;
  const listening = mode === 'quiz';
  const quiz = quizzes[mode] ??= createQuiz();
  const total = quiz.questions.length;
  root.append(element('h3', listening ? '聽力測驗' : '朗讀測驗'));
  if (quiz.index === total) {
    root.append(element('p', listening ? `答對 ${quiz.score} / ${total} 題` : `已完成 ${total} / ${total} 題朗讀`),
      actions(button('再做一次', () => { quizzes[mode] = createQuiz(); draw(); })));
    return;
  }

  const { word, options } = quiz.questions[quiz.index];
  root.append(element('p', `第 ${quiz.index + 1} / ${total} 題`, 'question-counter'));
  const next = button(quiz.index + 1 === total ? '看結果 →' : '下一題 →', () => {
    if (!mayNavigate()) return;
    if (!listening) {
      log('reading', word);
      releaseRecording(quiz.recordingUrl);
      quiz.recordingUrl = '';
    }
    quiz.index++;
    quiz.selected = null;
    draw();
  });
  next.disabled = listening ? !quiz.selected : !quiz.recordingUrl;

  if (listening) {
    root.append(element('p', '先聽發音，再選出聽到的單字。'), pronunciationButtons(word));
    const grid = element('div', '', 'choices');
    for (const option of options) {
      const choice = button('', () => {
        if (quiz.selected) return;
        quiz.selected = option;
        const correct = option === word;
        if (correct) quiz.score++;
        log('quiz', word, correct);
        draw();
        $('stage').querySelector('.quiz-next').focus();
      }, true);
      choice.append(wordLabel(option));
      choice.disabled = Boolean(quiz.selected);
      if (quiz.selected && option === word) choice.classList.add('correct');
      if (quiz.selected === option && option !== word) choice.classList.add('incorrect');
      grid.append(choice);
    }
    root.append(grid);
    if (quiz.selected) message(quiz.selected === word ? '答對了！' : `正確答案是 ${word.w}。可以再聽一次。`, quiz.selected === word);
  } else {
    root.append(element('p', '看單字，大聲念出來並錄音。'), wordLabel(word, true),
      recordingControls(url => {
        releaseRecording(quiz.recordingUrl);
        quiz.recordingUrl = url;
        draw();
        message('已錄音。可以重聽、比較示範音，或重新錄音。');
      }, quiz.recordingUrl));
    if (quiz.recordingUrl) {
      const review = element('div', '', 'recording-box');
      review.append(recordingPlayer(quiz.recordingUrl), pronunciationButtons(word));
      root.append(review);
    }
    root.append(element('p', '錄音供自我比對。這項測驗記錄完成題數。', 'muted'));
  }
  next.classList.add('quiz-next');
  root.append(actions(next));
}

function draw() {
  window.speechSynthesis?.cancel();
  document.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-pressed', node.dataset.tab === tab));
  const root = $('stage');
  root.replaceChildren();
  message('');
  if (tab === 'sound') drawSound(root);
  else if (tab === 'blend' || tab === 'record') drawPractice(root, unit.words[wordIndex]);
  else drawQuiz(root);
}

function showUnit() {
  $('unitNumber').textContent = `UNIT ${String(unit.id).padStart(2, '0')}`;
  $('unitTitle').textContent = unit.title;
  $('units').querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', Number(node.dataset.unit) === unit.id));
  draw();
}

async function backup() {
  const data = { schema: 1, exportedAt: new Date().toISOString(), profiles: await req(store().getAll()) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = 'phonics-progress.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function restore(file) {
  try {
    if (file.size > 5000000) throw Error('檔案太大');
    const data = JSON.parse(await file.text());
    if (data.schema !== 1 || !Array.isArray(data.profiles)) throw Error('備份格式錯誤');
    const profiles = data.profiles.map(profile => {
      if (typeof profile.id !== 'string' || typeof profile.name !== 'string' || !Array.isArray(profile.events)) {
        throw Error('學生資料格式錯誤');
      }
      const events = profile.events.filter(event => event && typeof event.kind === 'string' && typeof event.word === 'string').slice(-3000);
      return { id: profile.id, name: profile.name.slice(0, 30), events };
    });
    if (!mayNavigate() || !confirm('匯入會覆蓋相同學生 ID 的進度，確定嗎？')) return;
    const target = store('readwrite');
    await Promise.all(profiles.map(profile => req(target.put(profile))));
    await students();
    message('備份匯入完成。');
  } catch (error) {
    message(`匯入失敗：${error.message}`, false);
  }
}

async function init() {
  const request = indexedDB.open('phonics-progress', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('students', { keyPath: 'id' });
  db = await req(request);
  await students();

  $('student').onchange = event => {
    if (!mayNavigate()) {
      event.target.value = student;
      return;
    }
    student = event.target.value;
    resetActivities();
    draw();
    progress().catch(reportStorageError);
  };
  $('addStudent').onclick = async () => {
    const name = $('newStudent').value.trim();
    if (!name || !mayNavigate()) return;
    try {
      const profile = { id: crypto.randomUUID(), name, events: [] };
      await req(store('readwrite').put(profile));
      if (recording) {
        await students();
        return;
      }
      student = profile.id;
      $('newStudent').value = '';
      resetActivities();
      draw();
      await students();
    } catch {
      reportStorageError();
    }
  };
  $('export').onclick = () => backup().catch(reportStorageError);
  $('import').onchange = event => {
    if (event.target.files[0]) restore(event.target.files[0]);
    event.target.value = '';
  };
  document.querySelectorAll('[data-tab]').forEach(node => node.onclick = () => {
    if (!mayNavigate()) return;
    tab = node.dataset.tab;
    draw();
  });
  for (const available of units) {
    const control = button(`Unit ${available.id} · ${available.title}`, () => {
      if (!mayNavigate()) return;
      if (unit !== available) resetActivities();
      unit = available;
      tab = 'sound';
      showUnit();
      progress().catch(reportStorageError);
      $('lesson').scrollIntoView({ behavior: 'smooth' });
    }, true);
    control.dataset.unit = available.id;
    $('units').append(control);
  }
  const remaining = 32 - units.length;
  $('unitAvailability').textContent = remaining ? `已開放 ${units.length} 個單元，其餘 ${remaining} 個單元待製作。` : '32 個單元皆已開放。';
  showUnit();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init().catch(error => message(`初始化失敗：${error.message}`, false));
