'use strict';
const words=[{w:'cat',zh:'貓',p:['/k/','/æ/','/t/']},{w:'bat',zh:'蝙蝠',p:['/b/','/æ/','/t/']},{w:'hat',zh:'帽子',p:['/h/','/æ/','/t/']},{w:'jam',zh:'果醬',p:['/dʒ/','/æ/','/m/']},{w:'ram',zh:'公羊',p:['/r/','/æ/','/m/']},{w:'can',zh:'能、罐子',p:['/k/','/æ/','/n/']}];
const $=id=>document.getElementById(id);let db,student='',tab='sound',idx=0,question=null,recorder=null,recorded=null,chunks=[];
function req(r){return new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}
function os(mode='readonly'){return db.transaction('students',mode).objectStore('students')}
async function all(){return req(os().getAll())}async function current(){return req(os().get(student))}async function save(p){return req(os('readwrite').put(p))}
function message(s,good=true){$('feedback').textContent=s;$('feedback').className=good?'ok':'bad'}
function button(s,fn,secondary=false){const b=document.createElement('button');b.textContent=s;if(secondary)b.className='secondary';b.onclick=fn;return b}
function speak(text, rate) {
  if (!('speechSynthesis' in window)) {
    message('裝置不支援語音合成', false);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.pitch = 1;
  utterance.rate = rate;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function pronunciationButtons(word, onPlay) {
  function play(rate) {
    speak(word, rate);
    onPlay?.();
  }

  return [
    button('🔊 正常速度', () => play(0.9)),
    button('🔊 慢速播放', () => play(0.6), true),
  ];
}
async function log(kind,correct=true,w=words[idx].w){const p=await current();if(!p)return;p.events.push({at:new Date().toISOString(),unit:1,word:w,kind,correct});p.events=p.events.slice(-3000);await save(p);await progress()}
async function progress(){const p=await current();const ev=p?.events||[];const seen=new Set(ev.filter(x=>['listen','record'].includes(x.kind)).map(x=>x.word));const qs=ev.filter(x=>x.kind==='quiz');$('summary').textContent=(p?.name||'學生')+'：已練習 '+seen.size+'/6 個單字；測驗答對 '+qs.filter(x=>x.correct).length+'/'+qs.length+' 題';$('progress').style.width=(seen.size/6*100)+'%'}
async function students(){let list=await all();if(!list.length){const p={id:crypto.randomUUID(),name:'學生 1',events:[]};await save(p);list=[p]}$('student').replaceChildren(...list.map(p=>new Option(p.name,p.id)));if(!list.some(p=>p.id===student))student=list[0].id;$('student').value=student;await progress()}
function nextQuestion(){const answer=words[Math.floor(Math.random()*words.length)].w;const others=words.map(x=>x.w).filter(x=>x!==answer).sort(()=>Math.random()-.5).slice(0,3);question={answer,options:[answer,...others].sort(()=>Math.random()-.5)}}
function draw() {
  document.querySelectorAll('[data-tab]').forEach(b => b.style.opacity = b.dataset.tab === tab ? '1' : '.7');
  const root = $('stage');
  root.replaceChildren();
  message('');
  const w = words[idx];
  const h = document.createElement('h3');
  const p = document.createElement('p');

  if (tab === 'sound') {
    h.textContent = '① 聽短母音 /æ/';
    p.textContent = '先聽單字中的短母音，注意張嘴發出短促的 /æ/。瀏覽器語音合成不適合獨立音素評分。';
    root.append(h, p);
    for (const word of ['cat', 'bat']) {
      const group = document.createElement('fieldset');
      const label = document.createElement('legend');
      label.textContent = word;
      group.append(label, ...pronunciationButtons(word, () => log('listen', true, word)));
      root.append(group);
    }
  }

  if (tab === 'blend') {
    h.textContent = '② 逐音拼讀';
    const big = document.createElement('div');
    big.className = 'word';
    big.textContent = w.w;
    const parts = document.createElement('div');
    parts.className = 'parts';
    parts.textContent = w.p.join(' + ');
    p.textContent = w.zh;
    root.append(h, big, parts, p,
      ...pronunciationButtons(w.w, () => log('listen', true, w.w)),
      button('下一個 →', () => { idx = (idx + 1) % words.length; draw(); }, true));
  }

  if (tab === 'record') {
    h.textContent = '③ 聽音後跟讀';
    const big = document.createElement('div');
    big.className = 'word';
    big.textContent = w.w;
    p.textContent = w.zh + ' · ' + w.p.join(' ');
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.hidden = true;
    if (recorded?.word === w.w) {
      audio.src = recorded.url;
      audio.hidden = false;
    }
    root.append(h, big, p,
      ...pronunciationButtons(w.w),
      button('🎙 開始錄音', startRecord),
      button('⏹ 停止錄音', stopRecord, true),
      audio,
      button('下一個 →', () => { idx = (idx + 1) % words.length; draw(); }, true));
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '錄音只在本頁暫存，供重聽比較；尚無自動發音評分。';
    root.append(note);
  }

  if (tab === 'quiz') {
    if (!question) nextQuestion();
    const { answer, options } = question;
    h.textContent = '④ 聽音選字';
    p.textContent = '聽到哪個單字？';
    root.append(h, p, ...pronunciationButtons(answer));
    const grid = document.createElement('div');
    grid.className = 'choices';
    for (const option of options) {
      grid.append(button(option, async () => {
        const correct = option === answer;
        await log('quiz', correct, answer);
        message(correct ? '答對了！' : '再聽一次，正確答案：' + answer, correct);
        grid.querySelectorAll('button').forEach(b => b.disabled = true);
      }, true));
    }
    root.append(grid, button('下一題 →', () => { nextQuestion(); draw(); }));
  }
}
async function startRecord(){if(recorder?.state==='recording')return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){message('此瀏覽器不支援麥克風錄音',false);return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);const word=words[idx].w;recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=async()=>{const blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});if(recorded?.url)URL.revokeObjectURL(recorded.url);recorded={word,url:URL.createObjectURL(blob)};stream.getTracks().forEach(t=>t.stop());await log('record',true,word);draw();message('錄音完成！按播放鍵重聽自己的發音')};recorder.start();message('錄音中…')}catch(e){message('麥克風無法使用：'+e.message,false)}}
function stopRecord(){if(recorder?.state==='recording')recorder.stop()}
async function backup(){const data={schema:1,exportedAt:new Date().toISOString(),profiles:await all()};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='phonics-progress.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function restore(file){try{if(file.size>5000000)throw Error('檔案太大');const d=JSON.parse(await file.text());if(d.schema!==1||!Array.isArray(d.profiles))throw Error('備份格式錯誤');const entries=d.profiles.map(p=>{if(typeof p.id!=='string'||typeof p.name!=='string'||!Array.isArray(p.events))throw Error('學生資料格式錯誤');return{id:p.id,name:p.name.slice(0,30),events:p.events.filter(e=>e&&typeof e.kind==='string'&&typeof e.word==='string').slice(-3000)}});if(!confirm('匯入會覆蓋相同學生 ID 的進度，確定嗎？'))return;for(const p of entries)await save(p);await students();message('備份匯入完成')}catch(e){message('匯入失敗：'+e.message,false)}}
async function init(){db=await new Promise((ok,no)=>{const r=indexedDB.open('phonics-progress',1);r.onupgradeneeded=()=>r.result.createObjectStore('students',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});await students();$('student').onchange=async e=>{student=e.target.value;await progress()};$('addStudent').onclick=async()=>{const name=$('newStudent').value.trim();if(!name)return;const p={id:crypto.randomUUID(),name,events:[]};await save(p);student=p.id;$('newStudent').value='';await students()};$('export').onclick=backup;$('import').onchange=e=>{if(e.target.files[0])restore(e.target.files[0]);e.target.value=''};document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(recorder?.state==='recording'){message('請先停止錄音',false);return}tab=b.dataset.tab;draw()});$('units').append(button('Unit 1 · Short a',()=>{tab='sound';draw();$('lesson').scrollIntoView({behavior:'smooth'})}));for(let i=2;i<=32;i++){const b=button('Unit '+i+' · 待開發',()=>{},true);b.disabled=true;$('units').append(b)}draw();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{})}
init().catch(e=>message('初始化失敗：'+e.message,false));
