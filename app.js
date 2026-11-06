'use strict';

const questionsPerQuiz = 5;
const examSize = 10;
const quizTitles = { quiz: '聽力選擇題測驗', typing: '聽力打字測驗', reading: '朗讀測驗' };
const hintTitles = { first: '第一個字母', last: '最後一個字母', vowel: '母音字母' };
const hintSettingsKey = 'phonics-hint-settings';
let hintSettings = Object.fromEntries(Object.keys(hintTitles).map(kind => [kind, { enabled: false, limit: 1 }]));
const settingsKey = 'phonics-pronunciation-settings';
const slowDurationKey = 'phonics-slow-duration';
const normalRate = 0.9;
const originalSlowRate = 0.6;
let slowDuration = 2;
const $ = id => document.getElementById(id);
const svgNamespace = 'http://www.w3.org/2000/svg';
let db;
let student = '';
let unit = units[0];
let tab = 'sound';
let wordIndex = 0;
let quizzes = {};
let exam = null;
let examSetup = null;
const reviewAudioUrls = new Set();
const openExamReviews = new Set();
let pronunciationSettings = { endpoint: pronunciationEndpoint, accessKey: '' };
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
  if ($('settingsDialog').open) {
    $('settingsFeedback').textContent = text;
    $('settingsFeedback').className = good ? 'ok' : 'bad';
  }
  if ($('studentsDialog').open) {
    $('studentsFeedback').textContent = text;
    $('studentsFeedback').className = good ? 'ok' : 'bad';
  }
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
    button('🔊 正常速度', () => play(normalRate)),
    button('🔊 慢速播放', () => play(originalSlowRate / slowDuration), true),
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
  const typing = events.filter(event => event.kind === 'typing');
  const reading = events.filter(event => event.kind === 'reading');
  const count = unit.words.filter(word => seen.has(word.w)).length;
  $('summary').textContent = `${profile?.name || '學生'}：練習 ${count}/${unit.words.length} 個單字 · 聽力累計答對 ${listening.filter(event => event.correct).length}/${listening.length} 題 · 打字累計答對 ${typing.filter(event => event.correct).length}/${typing.length} 題 · 朗讀累計完成 ${reading.length} 題`;
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

function questionFor(lesson, word, kind) {
  const options = kind === 'quiz' ? shuffled([word, ...shuffled(lesson.words.filter(option => option !== word)).slice(0, 3)]) : [];
  return { word, options, kind, unit: lesson.id };
}

function createQuiz(questions) {
  return {
    index: 0,
    score: 0,
    selected: null,
    recordingUrl: '',
    questions,
    answers: [],
  };
}

function unitQuiz(kind) {
  return createQuiz(shuffled(unit.words).slice(0, questionsPerQuiz).map(word => questionFor(unit, word, kind)));
}

function combinedQuiz(lessons, kinds) {
  const choices = lessons.flatMap(lesson => lesson.words.map(word => ({ lesson, word })));
  let deck = shuffled(choices);
  const rotation = shuffled(kinds);
  return createQuiz(shuffled(Array.from({ length: examSize }, (_, index) => {
    if (!deck.length) deck = shuffled(choices);
    const { lesson, word } = deck.pop();
    return questionFor(lesson, word, rotation[index % rotation.length]);
  })));
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

function resetStudentActivities() {
  resetActivities();
  exam?.assessmentRequest?.abort();
  releaseRecording(exam?.recordingUrl);
  exam = null;
  examSetup = null;
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
  root.append(element('h3', `音標練習 · ${unit.focus}`), element('p', '先聽單字，再試著把每個聲音連起來。'));
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
  root.append(element('h3', following ? '跟讀練習' : '拼讀練習'), wordLabel(word, true),
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
  const { endpoint, accessKey } = pronunciationSettings;
  if (!endpoint || !accessKey || !$('pronunciationConsent').checked) return;
  const request = new AbortController();
  quiz.assessmentRequest = request;
  quiz.assessment = { outcome: 'pending' };
  draw();
  const result = await assessPronunciation(word.w, clip, endpoint, accessKey, request.signal);
  if (request.signal.aborted) return;
  quiz.assessmentRequest = null;
  quiz.assessment = result;
  if ((tab === 'reading' && quizzes.reading === quiz) || (tab === 'exam' && exam === quiz)) draw();
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

function hintButtons(quiz, word) {
  quiz.hintUses ??= {};
  const uses = quiz.hintUses[quiz.index] ??= {};
  const row = actions();
  row.id = 'hintButtons';
  for (const [kind, title] of Object.entries(hintTitles)) {
    const setting = hintSettings[kind];
    if (!setting.enabled) continue;
    const remaining = Math.max(0, setting.limit - (uses[kind] ?? 0));
    const control = button(`${title}（剩餘 ${remaining} 次）`, () => {
      if (quiz.selected || (uses[kind] ?? 0) >= hintSettings[kind].limit) return;
      uses[kind] = (uses[kind] ?? 0) + 1;
      const value = kind === 'vowel' ? [...word.w].filter(letter => 'aeiou'.includes(letter)).map(letter => letter.toUpperCase()).join('、') :
        (kind === 'first' ? word.w[0] : word.w.at(-1)).toUpperCase();
      $('hintDialogTitle').textContent = title;
      $('hintDialogContent').textContent = value || '這個單字沒有 a、e、i、o、u 母音字母。';
      $('hintDialog').showModal();
      control.textContent = `${title}（剩餘 ${Math.max(0, hintSettings[kind].limit - uses[kind])} 次）`;
      control.disabled = uses[kind] >= hintSettings[kind].limit;
    }, true);
    control.disabled = remaining === 0 || Boolean(quiz.selected);
    row.append(control);
  }
  return row;
}

function initSlowDuration() {
  const control = $('slowDuration');
  const status = $('slowDurationStatus');
  try {
    const saved = Number(localStorage.getItem(slowDurationKey));
    if ([1.5, 2, 2.5].includes(saved)) slowDuration = saved;
  } catch {
    status.textContent = '無法讀取慢速播放設定，已使用 2 倍時間。';
  }
  control.value = String(slowDuration);
  control.onchange = () => {
    const value = Number(control.value);
    if (![1.5, 2, 2.5].includes(value)) {
      control.value = String(slowDuration);
      return;
    }
    try {
      localStorage.setItem(slowDurationKey, String(value));
      slowDuration = value;
      status.textContent = '慢速播放設定已儲存。';
    } catch {
      control.value = String(slowDuration);
      status.textContent = '無法儲存慢速播放設定。';
    }
  };
}

function initHintSettings() {
  const root = $('hintSettings');
  const status = $('hintSettingsStatus');
  try {
    const saved = JSON.parse(localStorage.getItem(hintSettingsKey));
    for (const kind of Object.keys(hintTitles)) {
      if (typeof saved?.[kind]?.enabled === 'boolean' && Number.isInteger(saved[kind].limit) && saved[kind].limit >= 1 && saved[kind].limit <= 99) {
        hintSettings[kind] = saved[kind];
      }
    }
  } catch {
    status.textContent = '無法讀取提示設定。';
  }
  for (const [kind, title] of Object.entries(hintTitles)) {
    const group = element('fieldset');
    const enabled = element('input');
    enabled.type = 'checkbox';
    enabled.checked = hintSettings[kind].enabled;
    const enabledLabel = element('label');
    enabledLabel.append(enabled, ` 顯示${title}按鈕`);
    const limit = element('input');
    limit.type = 'number';
    limit.min = '1';
    limit.max = '99';
    limit.step = '1';
    limit.value = hintSettings[kind].limit;
    limit.setAttribute('aria-label', `${title}每題次數`);
    const limitLabel = element('label');
    limitLabel.append('每題次數 ', limit);
    const save = () => {
      const count = Number(limit.value);
      if (!Number.isInteger(count) || count < 1 || count > 99) {
        status.textContent = '每題次數請填 1 到 99 的整數。';
        enabled.checked = hintSettings[kind].enabled;
        return;
      }
      const next = { ...hintSettings, [kind]: { enabled: enabled.checked, limit: count } };
      try {
        localStorage.setItem(hintSettingsKey, JSON.stringify(next));
        hintSettings = next;
        status.textContent = '提示設定已儲存。';
        const quiz = tab === 'exam' ? exam : quizzes[tab];
        const question = quiz?.questions[quiz.index];
        const current = $('hintButtons');
        if (current && question && ['quiz', 'typing'].includes(question.kind)) current.replaceWith(hintButtons(quiz, question.word));
      } catch {
        enabled.checked = hintSettings[kind].enabled;
        limit.value = hintSettings[kind].limit;
        status.textContent = '無法儲存提示設定。';
      }
    };
    enabled.onchange = save;
    limit.onchange = save;
    group.append(element('legend', title), enabledLabel, limitLabel);
    root.append(group);
  }
}

function drawQuiz(root, quiz = quizzes[tab] ??= unitQuiz(tab), combined = false) {
  const total = quiz.questions.length;
  if (quiz.index === total) {
    if (combined) {
      drawExamResult(root, quiz);
    } else {
      root.append(element('h3', quizTitles[tab]), element('p', tab === 'reading' ? `已完成 ${total} / ${total} 題朗讀` : `答對 ${quiz.score} / ${total} 題`),
        actions(button('再做一次', () => { quizzes[tab] = unitQuiz(tab); draw(); })));
    }
    return;
  }

  const { word, options, kind: mode, unit: questionUnit } = quiz.questions[quiz.index];
  const listening = mode === 'quiz';
  const reading = mode === 'reading';
  root.append(element('h3', quizTitles[mode]), element('p', `第 ${quiz.index + 1} / ${total} 題${combined ? ` · Unit ${questionUnit}` : ''}`, 'question-counter'));
  if (!reading) root.append(hintButtons(quiz, word));
  const next = button(quiz.index + 1 === total ? '看結果 →' : '下一題 →', () => {
    if (next.disabled || !mayNavigate() || quiz.questions[quiz.index]?.word !== word) return;
    next.disabled = true;
    const outcome = quiz.assessment?.outcome;
    const answer = listening ? quiz.selected?.w : quiz.selected;
    const correct = reading ? (outcome === 'clear' ? true : outcome === 'retry' ? false : null) : answer.toLowerCase() === word.w;
    if (combined) {
      quiz.answers.push({ unit: questionUnit, kind: mode, word: word.w, answer, correct,
        source: reading && correct !== null ? 'server' : null, sounds: quiz.assessment?.sounds ?? [] });
      if (reading) quiz.clips.set(quiz.index, quiz.currentClip);
    }
    if (reading) {
      if (!combined) log('reading', word, correct ?? undefined);
      releaseRecording(quiz.recordingUrl);
      quiz.recordingUrl = '';
      quiz.assessment = null;
      quiz.currentClip = null;
    }
    quiz.index++;
    quiz.selected = null;
    if (combined && quiz.index === total) saveExam(quiz);
    draw();
  });
  next.disabled = reading ? !quiz.recordingUrl || Boolean(quiz.assessmentRequest) : !quiz.selected;

  if (listening) {
    root.append(element('p', '先聽發音，再選出聽到的單字。'), pronunciationButtons(word));
    const grid = element('div', '', 'choices');
    for (const option of options) {
      const choice = button('', () => {
        if (quiz.selected) return;
        quiz.selected = option;
        const correct = option === word;
        if (correct) quiz.score++;
        if (!combined) log('quiz', word, correct);
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
  } else if (mode === 'typing') {
    root.append(element('p', '聽慢速發音，輸入完整單字。'),
      actions(button('🔊 慢速播放', () => speak(word.w, originalSlowRate / slowDuration), true)));
    const input = element('input');
    input.id = 'typingAnswer';
    input.lang = 'en';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.maxLength = 64;
    input.required = true;
    input.value = quiz.selected ?? '';
    input.disabled = Boolean(quiz.selected);
    const label = element('label', '完整單字');
    label.htmlFor = input.id;
    const submit = button('送出', null);
    submit.type = 'submit';
    submit.disabled = input.disabled;
    const form = element('form');
    form.append(actions(label, input, submit));
    form.onsubmit = event => {
      event.preventDefault();
      const answer = input.value.trim();
      if (quiz.selected || !answer) return;
      quiz.selected = answer;
      const correct = answer.toLowerCase() === word.w;
      if (correct) quiz.score++;
      if (!combined) log('typing', word, correct);
      draw();
      $('stage').querySelector('.quiz-next').focus();
    };
    root.append(form);
    if (quiz.selected) {
      const correct = quiz.selected.toLowerCase() === word.w;
      message(correct ? '答對了！' : `正確拼法是 ${word.w}。`, correct);
    }
  } else {
    root.append(element('p', '看單字，大聲念出來並錄音。'), wordLabel(word, true));
    if (!quiz.assessmentRequest) {
      root.append(recordingControls((url, clip) => {
        releaseRecording(quiz.recordingUrl);
        quiz.recordingUrl = url;
        if (combined) quiz.currentClip = clip;
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
    root.append(element('p', combined ? '沒有啟用發音判定時，可在交卷後回放並人工評分。' : '未啟用發音判定時，這題只錄音，不計分。', 'muted'));
  }
  next.classList.add('quiz-next');
  root.append(actions(next));
}

function examScore(answers) {
  const graded = answers.filter(answer => answer.correct !== null);
  const ungraded = answers.length - graded.length;
  const correct = graded.filter(answer => answer.correct).length;
  const score = graded.length ? `答對 ${correct} / ${graded.length} 題（${Math.round(correct / graded.length * 100)} 分）` : '已完成錄音，這輪無可計分題目';
  return ungraded ? `${score} · ${ungraded} 題未評分` : score;
}

function examRecording(owner, examId, question) {
  const key = [owner, examId, question];
  const row = actions();
  let audioUrl;
  const play = button('播放錄音', async () => {
    play.disabled = true;
    try {
      const entry = await req(db.transaction('examAudio').objectStore('examAudio').get(key));
      if (!row.isConnected) return;
      if (!entry) {
        row.replaceChildren(element('span', '沒有本機錄音。', 'muted'));
        return;
      }
      audioUrl = URL.createObjectURL(entry.clip);
      reviewAudioUrls.add(audioUrl);
      const player = recordingPlayer(audioUrl);
      play.replaceWith(player);
      player.play().catch(() => {});
    } catch {
      if (row.isConnected) message('無法讀取錄音。', false);
      play.disabled = false;
    }
  }, true);
  const remove = button('刪除錄音', async () => {
    if (!confirm('刪除這一題的錄音？題目與分數仍會保留。')) return;
    remove.disabled = true;
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('examAudio', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = reject;
        transaction.objectStore('examAudio').delete(key);
      });
      releaseRecording(audioUrl);
      reviewAudioUrls.delete(audioUrl);
      if (row.isConnected) row.replaceChildren(element('span', '錄音已刪除。', 'muted'));
    } catch {
      if (row.isConnected) message('無法刪除錄音。', false);
      remove.disabled = false;
    }
  }, true);
  row.append(play, remove);
  const request = db.transaction('examAudio').objectStore('examAudio').getKey(key);
  request.onsuccess = () => {
    if (row.isConnected && request.result === undefined && !audioUrl && !play.disabled && !remove.disabled) {
      row.replaceChildren(element('span', '沒有本機錄音。', 'muted'));
    }
  };
  return row;
}

function manualGrade(owner, result, index, answer) {
  const control = element('select');
  control.setAttribute('aria-label', `第 ${index + 1} 題人工評分`);
  control.append(new Option('待人工評分', ''), new Option('念對', 'true'), new Option('需再練習', 'false'));
  control.value = answer.correct === null ? '' : String(answer.correct);
  control.onchange = async () => {
    const correct = control.value === '' ? null : control.value === 'true';
    control.disabled = true;
    try {
      await new Promise((resolve, reject) => {
        const target = store('readwrite');
        const request = target.get(owner);
        request.onsuccess = () => {
          const profile = request.result;
          const stored = profile?.exams?.find(item => item.id === result.id);
          const question = stored?.answers[index];
          if (!question || question.kind !== 'reading' || question.source === 'server') {
            target.transaction.abort();
            return;
          }
          question.correct = correct;
          question.source = correct === null ? null : 'manual';
          target.put(profile);
        };
        target.transaction.oncomplete = resolve;
        target.transaction.onabort = reject;
      });
      answer.correct = correct;
      answer.source = correct === null ? null : 'manual';
      if (tab === 'exam' && student === owner) draw();
    } catch {
      if (control.isConnected) {
        control.value = answer.correct === null ? '' : String(answer.correct);
        control.disabled = false;
        message('無法儲存人工評分。', false);
      }
    }
  };
  return control;
}

function examReview(result, owner, audioAvailable = true) {
  const list = element('ol', '', 'exam-errors');
  for (const [index, answer] of result.answers.entries()) {
    const prefix = `Unit ${answer.unit} · ${quizTitles[answer.kind]}`;
    const source = answer.source === 'server' ? '（伺服器）' : answer.source === 'manual' ? '（人工）' : '';
    const grade = answer.correct === null ? '未評分' : `${answer.correct ? '答對' : '需再練習'}${source}`;
    const item = element('li', '', answer.correct === false ? 'exam-mistake' : '');
    item.append(element('p', `${prefix} · ${answer.word} · ${grade}`));
    if (answer.kind === 'reading') {
      if (answer.sounds.length) item.append(element('p', `留意 ${answer.sounds.map(sound => `/${sound}/`).join('、')}`));
      if (audioAvailable) {
        item.append(examRecording(owner, result.id, index));
        if (answer.source !== 'server') item.append(manualGrade(owner, result, index, answer));
      }
    } else if (answer.correct === false) {
      item.append(element('p', `你的答案是「${answer.answer}」。`));
    }
    list.append(item);
  }
  return list;
}

async function saveExam(quiz) {
  if (quiz.saving || quiz.saved) return;
  quiz.saving = true;
  quiz.result ??= { id: crypto.randomUUID(), at: new Date().toISOString(), answers: quiz.answers };
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['students', 'examAudio'], 'readwrite');
      const target = transaction.objectStore('students');
      const request = target.get(quiz.student);
      request.onsuccess = () => {
        const profile = request.result;
        if (!profile) {
          target.transaction.abort();
          return;
        }
        const exams = profile.exams ?? [];
        if (exams.some(item => item.id === quiz.result.id)) return;
        target.put({ ...profile, exams: [...exams, quiz.result] });
        const recordings = transaction.objectStore('examAudio');
        for (const [question, clip] of quiz.clips) {
          recordings.put({ student: quiz.student, exam: quiz.result.id, question, clip });
        }
      };
      target.transaction.oncomplete = resolve;
      target.transaction.onabort = reject;
    });
    quiz.saved = true;
    quiz.clips.clear();
  } catch {
    quiz.saved = false;
  } finally {
    quiz.saving = false;
    if (tab === 'exam' && exam === quiz) draw();
  }
}

function drawExamResult(root, quiz) {
  root.append(element('h3', '綜合測驗結果'), element('p', examScore(quiz.answers)), examReview(quiz.result, quiz.student, quiz.saved));
  if (quiz.saved) {
    root.append(element('p', '已儲存到目前學生的測驗紀錄。', 'muted'), actions(button('回到出題設定', () => { exam = null; draw(); })));
  } else if (quiz.saving) {
    root.append(element('p', '正在儲存測驗結果…', 'muted'));
  } else {
    root.append(element('p', '儲存失敗，請再試一次。'), actions(button('重試儲存', () => { saveExam(quiz); draw(); })));
  }
}

async function showExamHistory(root, activeStudent) {
  try {
    const profile = await req(store().get(activeStudent));
    if (!root.isConnected || activeStudent !== student) return;
    const exams = profile?.exams ?? [];
    if (!exams.length) root.append(element('p', '目前還沒有完成的綜合測驗。', 'muted'));
    for (const result of [...exams].reverse()) {
      const detail = element('details', '', 'exam-history');
      detail.open = openExamReviews.has(result.id);
      detail.ontoggle = () => {
        if (detail.open) openExamReviews.add(result.id);
        else openExamReviews.delete(result.id);
      };
      detail.append(element('summary', `${new Date(result.at).toLocaleString('zh-TW')} · ${examScore(result.answers)}`), examReview(result, activeStudent));
      root.append(detail);
    }
  } catch {
    if (root.isConnected) root.append(element('p', '無法讀取測驗紀錄。'));
  }
}

function examCheckbox(text, selected, value) {
  const label = element('label');
  const control = element('input');
  control.type = 'checkbox';
  control.checked = selected.has(value);
  control.onchange = () => {
    if (control.checked) selected.add(value);
    else selected.delete(value);
  };
  label.append(control, ` ${text}`);
  return label;
}

function drawExam(root) {
  if (exam) {
    drawQuiz(root, exam, true);
    return;
  }
  const setup = examSetup ??= { volumes: new Set([Math.floor((unit.id - 1) / 8)]), kinds: new Set(Object.keys(quizTitles)) };
  const range = element('fieldset');
  range.append(element('legend', '選擇冊別（可多選）'), actions(...volumes.map((volume, index) => examCheckbox(`第 ${index + 1} 冊 · ${volume}`, setup.volumes, index))));
  const types = element('fieldset');
  types.append(element('legend', '題型（可多選）'), actions(...Object.entries(quizTitles).map(([kind, title]) => examCheckbox(title, setup.kinds, kind))));
  const start = button('開始 10 題綜合測驗', () => {
    const selected = units.filter(lesson => setup.volumes.has(Math.floor((lesson.id - 1) / 8)));
    if (!selected.length || !setup.kinds.size) {
      message('請至少勾選一冊和一種題型。', false);
      return;
    }
    exam = combinedQuiz(selected, [...setup.kinds]);
    exam.student = student;
    exam.clips = new Map();
    draw();
  });
  const history = element('section', '', 'exam-history');
  history.append(element('h4', '這位學生的測驗紀錄'));
  root.append(element('h3', '綜合測驗'), element('p', '從所選冊的所有單字中隨機抽題。'), range, types, actions(start), history);
  showExamHistory(history, student);
}

async function scanMistakes(root, activeStudent) {
  try {
    const profile = await req(store().get(activeStudent));
    if (!root.isConnected || student !== activeStudent || tab !== 'mistakes') return;
    const counts = { listening: new Map(), reading: new Map() };
    function count(kind, word, correct) {
      if (correct !== false || typeof word !== 'string') return;
      const category = kind === 'reading' ? counts.reading : ['quiz', 'typing'].includes(kind) ? counts.listening : null;
      if (category) category.set(word, (category.get(word) ?? 0) + 1);
    }
    for (const event of profile?.events ?? []) count(event.kind, event.word, event.correct);
    for (const result of profile?.exams ?? []) {
      for (const answer of result.answers ?? []) count(answer.kind, answer.word, answer.correct);
    }
    root.replaceChildren();
    for (const [category, title] of [['listening', '聽力'], ['reading', '朗讀']]) {
      const section = element('section', '', 'mistake-section');
      section.append(element('h4', title));
      const entries = [...counts[category]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      if (!entries.length) section.append(element('p', '目前沒有錯誤紀錄。', 'muted'));
      else {
        const list = element('ol');
        for (const [word, times] of entries) list.append(element('li', `${word} · ${times} 次`));
        section.append(list);
      }
      root.append(section);
    }
  } catch {
    if (root.isConnected) root.textContent = '無法讀取學生紀錄。';
  }
}

function drawMistakes(root) {
  const results = element('div', '', 'mistake-results');
  root.append(element('h3', '常錯字'), element('p', '掃描目前學生的單元練習與綜合測驗紀錄。'),
    actions(button('掃描常錯字', () => scanMistakes(results, student))), results);
}

function draw() {
  window.speechSynthesis?.cancel();
  for (const url of reviewAudioUrls) releaseRecording(url);
  reviewAudioUrls.clear();
  $('pronunciationSetup').hidden = tab !== 'reading' && !(tab === 'exam' && exam?.questions[exam.index]?.kind === 'reading');
  document.querySelector('.lesson-heading').hidden = tab === 'exam' || tab === 'mistakes';
  document.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-pressed', node.dataset.tab === tab));
  const root = $('stage');
  root.replaceChildren();
  message('');
  if (tab === 'sound') drawSound(root);
  else if (tab === 'blend' || tab === 'record') drawPractice(root, unit.words[wordIndex]);
  else if (tab === 'exam') drawExam(root);
  else if (tab === 'mistakes') drawMistakes(root);
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

function restoredExams(exams) {
  if (!Array.isArray(exams)) return [];
  return exams.filter(result => result && typeof result.id === 'string' && typeof result.at === 'string' &&
    !Number.isNaN(Date.parse(result.at)) && Array.isArray(result.answers) && result.answers.length === examSize &&
    result.answers.every(answer => answer && Number.isInteger(answer.unit) && Object.hasOwn(quizTitles, answer.kind) &&
      typeof answer.word === 'string' && (answer.kind === 'reading' || typeof answer.answer === 'string') &&
      [true, false, null].includes(answer.correct) && Array.isArray(answer.sounds) && answer.sounds.every(sound => typeof sound === 'string')))
    .map(({ id, at, answers }) => ({ id, at, answers: answers.map(({ unit, kind, word, answer, correct, sounds, source }) => ({
      unit, kind, word, answer: kind === 'reading' ? null : answer, correct, sounds,
      source: kind === 'reading' && correct !== null && ['manual', 'server'].includes(source) ? source : null,
    })) }));
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
      return { id: profile.id, name: profile.name.slice(0, 30), events, exams: restoredExams(profile.exams) };
    });
    if (!mayNavigate() || !confirm('匯入會覆蓋相同學生 ID 的進度，確定嗎？')) return;
    const target = store('readwrite');
    await Promise.all(profiles.map(async profile => {
      const previous = await req(target.get(profile.id));
      const exams = new Map(profile.exams.map(result => [result.id, result]));
      for (const result of previous?.exams ?? []) exams.set(result.id, result);
      await req(target.put({ ...profile, exams: [...exams.values()].sort((a, b) => a.at.localeCompare(b.at)) }));
    }));
    await students();
    message('備份匯入完成。');
  } catch (error) {
    message(`匯入失敗：${error.message}`, false);
  }
}

function initPronunciationSettings() {
  const endpointInput = $('pronunciationUrl');
  const keyInput = $('pronunciationAccess');
  const consent = $('pronunciationConsent');
  const status = $('pronunciationStatus');
  function setFields() {
    endpointInput.value = pronunciationSettings.endpoint;
    keyInput.value = pronunciationSettings.accessKey;
    consent.disabled = !pronunciationSettings.accessKey || !pronunciationSettings.endpoint;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (saved && typeof saved.endpoint === 'string' && typeof saved.accessKey === 'string') pronunciationSettings = saved;
  } catch {
    status.textContent = '無法讀取本機評估設定。';
  }
  setFields();
  $('savePronunciation').onclick = () => {
    const accessKey = keyInput.value.trim();
    const endpoint = endpointInput.value.trim();
    try {
      if (endpoint !== pronunciationEndpoint || !pronunciationEndpoint) {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
      }
      if (!accessKey) throw Error();
    } catch {
      status.textContent = '請輸入有效的 HTTPS 評估網址與課堂使用碼。網址請勿包含金鑰或查詢參數。';
      return;
    }
    try {
      localStorage.setItem(settingsKey, JSON.stringify({ endpoint, accessKey }));
      pronunciationSettings = { endpoint, accessKey };
      consent.checked = false;
      setFields();
      status.textContent = '已儲存。勾選「啟用發音判定」後開始使用。';
    } catch {
      status.textContent = '瀏覽器無法儲存評估設定。';
    }
  };
  $('clearPronunciation').onclick = () => {
    try {
      localStorage.removeItem(settingsKey);
      pronunciationSettings = { endpoint: pronunciationEndpoint, accessKey: '' };
      consent.checked = false;
      setFields();
      status.textContent = '已清除設定，目前只錄音。';
    } catch {
      status.textContent = '瀏覽器無法清除評估設定。';
    }
  };
}

async function init() {
  const request = indexedDB.open('phonics-progress', 2);
  request.onupgradeneeded = event => {
    if (event.oldVersion < 1) request.result.createObjectStore('students', { keyPath: 'id' });
    if (event.oldVersion < 2) request.result.createObjectStore('examAudio', { keyPath: ['student', 'exam', 'question'] });
  };
  request.onblocked = () => message('請關閉這個 App 的其他分頁，再重新整理。', false);
  db = await req(request);
  db.onversionchange = () => db.close();
  await students();
  initPronunciationSettings();
  initSlowDuration();
  initHintSettings();

  $('student').onchange = event => {
    if (!mayNavigate()) {
      event.target.value = student;
      return;
    }
    student = event.target.value;
    resetStudentActivities();
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
      resetStudentActivities();
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
  $('menuToggle').onclick = () => {
    const expanded = $('menuToggle').getAttribute('aria-expanded') === 'true';
    $('menuToggle').setAttribute('aria-expanded', String(!expanded));
    $('menuToggle').setAttribute('aria-label', expanded ? '開啟選單' : '關閉選單');
    $('sideMenu').inert = expanded;
    $('menuBackdrop').hidden = expanded;
    $('sideMenu').classList.toggle('open', !expanded);
  };
  $('menuBackdrop').onclick = () => $('menuToggle').click();
  document.addEventListener('click', event => {
    if ($('menuToggle').getAttribute('aria-expanded') === 'true' &&
        !$('menuToggle').contains(event.target) && !$('sideMenu').contains(event.target)) {
      $('menuToggle').click();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('menuToggle').getAttribute('aria-expanded') === 'true' && !$('settingsDialog').open && !$('studentsDialog').open && !$('hintDialog').open) {
      $('menuToggle').click();
      $('menuToggle').focus();
    }
  });
  $('settingsToggle').onclick = () => {
    if ($('menuToggle').getAttribute('aria-expanded') === 'true') $('menuToggle').click();
    $('settingsFeedback').textContent = '';
    $('settingsDialog').showModal();
  };
  $('closeSettings').onclick = () => $('settingsDialog').close();
  $('settingsDialog').onclose = () => $('menuToggle').focus();
  $('studentsToggle').onclick = () => {
    if ($('menuToggle').getAttribute('aria-expanded') === 'true') $('menuToggle').click();
    $('studentsFeedback').textContent = '';
    $('studentsDialog').showModal();
  };
  $('closeStudents').onclick = () => $('studentsDialog').close();
  $('studentsDialog').onclose = () => $('menuToggle').focus();
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
    showUnit();
    progress().catch(reportStorageError);
  };
  showUnit();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

init().catch(error => message(`初始化失敗：${error.message}`, false));
