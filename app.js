'use strict';

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
  if (word.illustration.startsWith('#')) {
    const svg = document.createElementNS(svgNamespace, 'svg');
    const use = document.createElementNS(svgNamespace, 'use');
    use.setAttribute('href', `./pictures.svg${word.illustration}`);
    svg.append(use);
    picture.append(svg);
  } else {
    picture.textContent = word.illustration;
  }
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
  quizzes.reading?.assessmentRequest?.abort();
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
        onComplete(URL.createObjectURL(blob), blob);
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
  root.append(element('h3', `聽音 · ${unit.focus}`), element('p', '先聽單字，再試著把每個聲音連起來。'));
  const examples = element('div', '', 'examples');
  for (const word of unit.words) {
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
    element('p', `${word.p.map(sound => `/${sound}/`).join(' + ')} · ${word.zh}`, 'phonemes'),
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

async function checkReading(quiz, word, clip) {
  if (!pronunciationEndpoint || !$('pronunciationConsent').checked) return;
  const accessKey = $('pronunciationAccess').value.trim();
  if (!accessKey) {
    quiz.assessment = { outcome: 'access-denied' };
    draw();
    return;
  }
  const request = new AbortController();
  quiz.assessmentRequest = request;
  quiz.assessment = { outcome: 'pending' };
  draw();
  const result = await assessPronunciation(word.w, clip, accessKey, request.signal);
  if (request.signal.aborted) return;
  quiz.assessmentRequest = null;
  quiz.assessment = result;
  if (tab === 'reading' && quizzes.reading === quiz) draw();
}

function readingFeedback(assessment) {
  if (!assessment) {
    message('已錄音。可以重聽、比較示範音，或重新錄音。');
    return;
  }
  const { outcome, sounds } = assessment;
  const hints = {
    pending: '正在判定發音…',
    clear: '念得清楚！',
    retry: sounds?.length ? `再試一次，留意 ${sounds.map(sound => `/${sound}/`).join('、')}。` : '再試一次，請只念畫面上的單字。',
    unheard: '沒有聽清楚，請靠近麥克風再錄一次。',
    'too-long': '請在 10 秒內只念這個單字，再錄一次。',
    'access-denied': '請確認發音判定設定中的課堂使用碼，再錄一次。',
    unavailable: '這次無法判定。可以重聽錄音或稍後再試。',
  };
  message(hints[outcome], outcome === 'clear' || outcome === 'pending');
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
      const outcome = quiz.assessment?.outcome;
      const correct = outcome === 'clear' ? true : outcome === 'retry' ? false : undefined;
      log('reading', word, correct);
      releaseRecording(quiz.recordingUrl);
      quiz.recordingUrl = '';
      quiz.assessment = null;
    }
    quiz.index++;
    quiz.selected = null;
    draw();
  });
  next.disabled = listening ? !quiz.selected : !quiz.recordingUrl || Boolean(quiz.assessmentRequest);

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
    root.append(element('p', '看單字，大聲念出來並錄音。'), wordLabel(word, true));
    if (!quiz.assessmentRequest) {
      root.append(recordingControls((url, clip) => {
        releaseRecording(quiz.recordingUrl);
        quiz.recordingUrl = url;
        quiz.assessment = null;
        draw();
        checkReading(quiz, word, clip);
      }, quiz.recordingUrl));
    }
    if (quiz.recordingUrl) {
      const review = element('div', '', 'recording-box');
      review.append(recordingPlayer(quiz.recordingUrl), pronunciationButtons(word));
      root.append(review);
      readingFeedback(quiz.assessment);
    }
    root.append(element('p', pronunciationEndpoint ? '啟用發音判定後，可查看每題的判定與練習提示。' : '目前可錄音並比對示範音，發音判定服務尚未連線。', 'muted'));
  }
  next.classList.add('quiz-next');
  root.append(actions(next));
}

function draw() {
  window.speechSynthesis?.cancel();
  $('pronunciationSetup').hidden = tab !== 'reading' || !pronunciationEndpoint;
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
  $('unitPicker').value = String(unit.id);
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
  db.onversionchange = () => db.close();
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
  const picker = $('unitPicker');
  for (const [index, volume] of volumes.entries()) {
    const group = document.createElement('optgroup');
    group.label = `第 ${index + 1} 冊 · ${volume}`;
    for (const available of units.slice(index * 8, (index + 1) * 8)) {
      group.append(new Option(`Unit ${available.id} · ${available.title}`, available.id));
    }
    picker.append(group);
  }
  picker.onchange = () => {
    const selected = units.find(item => item.id === Number(picker.value));
    if (!selected || !mayNavigate()) {
      picker.value = String(unit.id);
      return;
    }
    resetActivities();
    unit = selected;
    tab = 'sound';
    showUnit();
    progress().catch(reportStorageError);
  };
  showUnit();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init().catch(error => message(`初始化失敗：${error.message}`, false));
