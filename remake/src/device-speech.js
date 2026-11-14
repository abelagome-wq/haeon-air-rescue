const preference = 'simcopter.voice-mode';
let mode = 'builtin';
try { if (globalThis.localStorage?.getItem(preference) === 'device') mode = 'device'; } catch {}

export function voiceMode() { return mode; }
export function setVoiceMode(value) {
  mode = value === 'device' ? 'device' : 'builtin';
  try { globalThis.localStorage?.setItem(preference, mode); } catch {}
}

// If a device has no local Korean voice, the caller plays the bundled Korean TTS clip.
export function speakOnDevice(text, environment = globalThis) {
  const synth = environment.speechSynthesis, Utterance = environment.SpeechSynthesisUtterance;
  if (mode !== 'device' || !text || !synth || !Utterance) return null;
  const voice = synth.getVoices().find(v => v.localService && /^ko(?:[-_]|$)/i.test(v.lang));
  if (!voice) return null;
  const line = new Utterance(text);
  line.voice = voice;
  line.lang = voice.lang;
  line.rate = 1.04;
  line.volume = .8;
  let settled = false, finish, timer;
  const finished = new Promise(resolve => { finish = resolve; });
  function end(ok, cancel = false) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    line.onstart = line.onend = line.onerror = null;
    if (cancel) synth.cancel();
    finish(ok);
  }
  timer = setTimeout(() => end(false,true), 1800);
  line.onstart = () => {
    clearTimeout(timer);
    timer = setTimeout(() => end(false,true), Math.max(6000, text.length*550));
  };
  line.onend = () => end(true);
  line.onerror = () => end(false);
  try { synth.speak(line); } catch { end(false); }
  return {finished, stop:() => end(false,true)};
}
