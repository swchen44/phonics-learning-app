'use strict';

const pronunciationEndpoint = document.querySelector('meta[name="pronunciation-endpoint"]').content;

async function pronunciationWav(recording) {
  const sampleRate = 16000;
  const decoder = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
  if (decoded.duration > 10) return null;

  const mixer = new OfflineAudioContext(1, decoded.length, sampleRate);
  const source = mixer.createBufferSource();
  source.buffer = decoded;
  source.connect(mixer.destination);
  source.start();
  const samples = (await mixer.startRendering()).getChannelData(0);
  const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
  function writeText(offset, text) {
    for (let index = 0; index < text.length; index++) wav.setUint8(offset + index, text.charCodeAt(index));
  }
  writeText(0, 'RIFF');
  wav.setUint32(4, wav.byteLength - 8, true);
  writeText(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  writeText(36, 'data');
  wav.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const amplitude = Math.max(-1, Math.min(1, samples[index]));
    wav.setInt16(44 + index * 2, amplitude * (amplitude < 0 ? 32768 : 32767), true);
  }
  return wav.buffer;
}

async function assessPronunciation(word, recording, accessKey, signal) {
  try {
    const audio = await pronunciationWav(recording);
    if (!audio) return { outcome: 'too-long' };
    const url = new URL(pronunciationEndpoint, window.location.href);
    url.searchParams.set('word', word);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'x-functions-key': accessKey },
      body: audio,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    });
    if (response.status === 401 || response.status === 403) return { outcome: 'access-denied' };
    if (!response.ok) return { outcome: 'unavailable' };
    const result = await response.json();
    const { outcome, sounds } = result;
    if (!['clear', 'retry', 'unheard'].includes(outcome)) return { outcome: 'unavailable' };
    return { outcome, sounds: Array.isArray(sounds) ? sounds.filter(sound => typeof sound === 'string') : [] };
  } catch {
    return { outcome: 'unavailable' };
  }
}
