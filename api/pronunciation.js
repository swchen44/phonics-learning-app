'use strict';

const sampleRate = 16000;
const maxWavSize = 44 + 10 * sampleRate * 2;
const practiceThreshold = 60;

function grade(result, expected) {
  if (['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout'].includes(result.RecognitionStatus)) {
    return { outcome: 'unheard' };
  }
  if (result.RecognitionStatus !== 'Success') throw Error('Speech service returned no assessment');

  const words = result.NBest?.[0]?.Words;
  if (!Array.isArray(words) || !words.length) throw Error('Speech service returned no word scores');
  const target = words.find(word => word.Word?.toLowerCase() === expected && word.ErrorType !== 'Omission');
  if (!target || words.length !== 1) return { outcome: 'retry', sounds: [] };

  const phonemes = target.Phonemes;
  if (!Number.isFinite(target.AccuracyScore) || !Array.isArray(phonemes) || !phonemes.length ||
      phonemes.some(sound => !Number.isFinite(sound.AccuracyScore) || typeof sound.Phoneme !== 'string')) {
    throw Error('Speech service returned incomplete phoneme scores');
  }
  const sounds = phonemes.filter(sound => sound.AccuracyScore < practiceThreshold).map(sound => sound.Phoneme);
  const clear = target.ErrorType === 'None' && target.AccuracyScore >= practiceThreshold && !sounds.length;
  return { outcome: clear ? 'clear' : 'retry', sounds };
}

function validWav(audio) {
  return audio.length > 44 && audio.length <= maxWavSize && audio.length % 2 === 0 &&
    audio.toString('ascii', 0, 4) === 'RIFF' && audio.readUInt32LE(4) === audio.length - 8 &&
    audio.toString('ascii', 8, 16) === 'WAVEfmt ' && audio.readUInt32LE(16) === 16 &&
    audio.readUInt16LE(20) === 1 && audio.readUInt16LE(22) === 1 &&
    audio.readUInt32LE(24) === sampleRate && audio.readUInt32LE(28) === sampleRate * 2 &&
    audio.readUInt16LE(32) === 2 && audio.readUInt16LE(34) === 16 &&
    audio.toString('ascii', 36, 40) === 'data' && audio.readUInt32LE(40) === audio.length - 44;
}

function response(status, jsonBody) {
  return { status, jsonBody, headers: { 'Cache-Control': 'no-store' } };
}

async function assess(request) {
  const expected = request.query.get('word');
  if (!expected || !/^[a-z]{1,32}$/.test(expected)) return response(400, { error: 'invalid-word' });
  if (Number(request.headers.get('content-length')) > maxWavSize) return response(413, { error: 'audio-too-long' });
  if (request.headers.get('content-type') !== 'audio/wav') return response(415, { error: 'invalid-audio' });

  const key = process.env.AZURE_SPEECH_KEY;
  const resource = process.env.AZURE_SPEECH_RESOURCE;
  if (!key || !resource || !/^[a-z0-9-]+$/i.test(resource)) return response(503, { error: 'assessment-unavailable' });

  try {
    const audio = Buffer.from(await request.arrayBuffer());
    if (!validWav(audio)) return response(400, { error: 'invalid-audio' });
    const parameters = {
      ReferenceText: expected,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
      EnableMiscue: 'True',
      PhonemeAlphabet: 'IPA',
    };
    const result = await fetch(`https://${resource}.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Pronunciation-Assessment': Buffer.from(JSON.stringify(parameters)).toString('base64'),
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: audio,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) return response(502, { error: 'assessment-unavailable' });
    return response(200, grade(await result.json(), expected));
  } catch {
    return response(502, { error: 'assessment-unavailable' });
  }
}

module.exports = { assess, grade };
