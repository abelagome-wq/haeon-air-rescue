import {soundEntries, soundLibrary} from './sound-library.js';
import spokenLines from './spoken-lines.js';
import {speakOnDevice, voiceMode, setVoiceMode} from './device-speech.js';
import {isRadioVoice, playRadioPreview} from './radio-channel.js';
import {dispatchPhrase} from './dispatch-phrases.js';

export function setupSoundEditor() {
  const $ = id => document.getElementById(id);
  const dialog = $('soundEditor'), group = $('soundGroup'), search = $('soundSearch');
  const list = $('soundList'), fileInput = $('soundFile'), notice = $('soundNotice');
  const preset = $('soundPreset'), applyPreset = $('applySoundPreset');
  const entries = new Map(soundEntries.map(entry => [entry.id, entry]));
  let loaded = false, busy = false, preview = null, previewButton = null, fileTarget = '';
  let activePlayback = null, previewSerial = 0;
  const modeSelector = $('voiceMode');
  modeSelector.value = voiceMode();
  modeSelector.onchange = () => { stopPreview(); setVoiceMode(modeSelector.value); };

  for (const name of new Set(soundEntries.map(entry => entry.group))) {
    group.add(new Option(name, name));
  }
  preset.add(new Option('내장 소리 선택',''));
  for(const entry of soundEntries)preset.add(new Option(entry.group+' · '+entry.label+' · '+entry.id,entry.id));
  function message(text = '', error = false) {
    notice.textContent = text;
    notice.toggleAttribute('data-error', error);
  }
  function stopPreview() {
    ++previewSerial;
    activePlayback?.stop();
    activePlayback = null;
    if (preview) {
      preview.onended = preview.onerror = null;
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
      preview = null;
    }
    previewButton = null;
    $('previewOriginal').textContent = '기본 소리 듣기';
    $('previewCustom').textContent = '교체본 듣기';
    $('radioDemo').textContent = '관제 무전 들어보기';
  }
  function showSelection() {
    const entry = entries.get(list.value);
    $('soundDetail').hidden = !entry;
    if (!entry) return;
    const filename = soundLibrary.filename(entry.id);
    const sourceId = soundLibrary.preset(entry.id);
    const source = spokenLines[entry.id] ? '한국어 합성 음성' : entry.group === '효과음' ? '게임용 합성 효과음' : '게임용 연주곡';
    $('soundLabel').textContent = entry.label;
    $('soundSource').textContent = sourceId ? '적용 중인 내장 소리 · '+filename+' · '+sourceId :
      filename ? '적용 중인 파일 · ' + filename : '기본 소리 · ' + source;
    for(const option of preset.options)option.disabled=option.value===entry.id;
    preset.value=sourceId;
    applyPreset.disabled=busy||!preset.value||preset.value===sourceId;
    $('previewCustom').hidden = $('resetSound').hidden = !filename;
  }
  function populate() {
    const selectedId = list.value, term = search.value.trim().toLowerCase();
    const found = soundEntries.filter(entry => (!group.value || group.value === entry.group) &&
      [entry.id, entry.label, entry.url.split('/').pop(), soundLibrary.filename(entry.id)]
        .some(value => (value || '').toLowerCase().includes(term)));
    list.replaceChildren(...found.map(entry => new Option(
      entry.label + ' · ' + entry.id + (soundLibrary.filename(entry.id) ? ' (교체됨)' : ''), entry.id)));
    if (found.some(entry => entry.id === selectedId)) list.value = selectedId;
    if (!found.length) list.add(new Option('검색 결과가 없습니다.', ''));
    $('soundCount').textContent = found.length + '개';
    list.disabled = busy || !found.length;
    showSelection();
  }
  function refresh() {
    stopPreview();
    message();
    populate();
  }
  function lockControls() {
    for (const el of [group, search, list, preset, applyPreset, $('previewOriginal'), $('previewCustom'), $('replaceSound'), $('resetSound'), $('radioDemo')]) {
      el.disabled = busy || !loaded;
    }
    dialog.setAttribute('aria-busy', String(busy || !loaded));
    if (loaded) populate();
  }
  function open() {
    if (dialog.open) return;
    dialog.showModal();
    lockControls();
    message(busy ? '파일 변경을 적용하고 있습니다…' : loaded ? '' : '저장된 소리를 불러오는 중입니다…');
  }
  async function listen(button, url, id, text) {
    const same = button === previewButton;
    stopPreview();
    message();
    if (same) return;
    const serial = previewSerial;
    previewButton = button;
    button.textContent = '미리듣기 정지';
    if (isRadioVoice(id)) {
      if (text) message(text);
      try {
        activePlayback = playRadioPreview(url);
        await activePlayback.finished;
        if (serial === previewSerial) stopPreview();
      } catch {
        if (serial === previewSerial) { stopPreview(); message('무전 소리를 재생할 수 없습니다.', true); }
      }
      return;
    }
    if (text) {
      const playback = speakOnDevice(text);
      if (playback) {
        activePlayback = playback;
        const finished = await playback.finished;
        if (serial !== previewSerial) return;
        activePlayback = null;
        if (finished) { stopPreview(); return; }
      }
    }
    const audio = new Audio(url);
    preview = audio;
    const failed = () => {
      if (audio !== preview) return;
      stopPreview();
      message('소리를 재생할 수 없습니다. 파일 형식이나 연결 상태를 확인하세요.', true);
    };
    audio.onerror = failed;
    audio.onended = () => { if (audio === preview) stopPreview(); };
    try { await audio.play(); } catch { failed(); }
  }
  async function apply(id, file, sourceId='') {
    if (!id || busy) return;
    busy = true;
    stopPreview();
    lockControls();
    message(sourceId?'선택한 내장 소리를 적용하는 중입니다…':file ? '파일을 확인하고 저장하는 중입니다…' : '기본 소리로 복원하는 중입니다…');
    try {
      if (sourceId) await soundLibrary.replaceWithPreset(id,sourceId);
      else if (file) await soundLibrary.replace(id, file);
      else await soundLibrary.reset(id);
      message(id + (sourceId||file ? ' 소리를 교체했습니다.' : ' 소리를 기본값으로 복원했습니다.'));
    } catch (error) {
      message(error?.message || '파일 변경을 저장할 수 없습니다.', true);
    } finally {
      busy = false;
      lockControls();
    }
  }

  $('openSoundEditor').addEventListener('click', open);
  $('pauseSoundEditor').addEventListener('click', open);
  $('closeSoundEditor').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { stopPreview(); fileTarget = ''; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); });
  group.onchange = refresh;
  search.oninput = refresh;
  list.onchange = () => { stopPreview(); message(); showSelection(); };
  $('radioDemo').onclick = event => {
    const sample = dispatchPhrase(['D1013','L005','D2018']);
    return listen(event.currentTarget, sample.url, 'D1013', sample.text);
  };
  $('previewOriginal').onclick = event => listen(event.currentTarget, entries.get(list.value).url, list.value, spokenLines[list.value]);
  $('previewCustom').onclick = event => listen(event.currentTarget, soundLibrary.url(list.value), list.value);
  preset.onchange=()=>{applyPreset.disabled=busy||!preset.value||preset.value===soundLibrary.preset(list.value);};
  applyPreset.onclick=()=>apply(list.value,null,preset.value);
  $('replaceSound').onclick = () => {
    fileTarget = list.value;
    fileInput.value = '';
    try{
      if(typeof fileInput.showPicker==='function')fileInput.showPicker();
      else if(navigator.userActivation?.isActive===false)throw Error('activation');
      else fileInput.click();
    }catch{
      fileTarget='';
      message('개인 파일은 ‘파일로 교체’를 클릭하거나 터치해 기기의 파일 창에서 선택하세요. 패드로는 ‘교체할 내장 소리’를 사용할 수 있습니다.');
    }
  };
  fileInput.onchange = () => {
    const file = fileInput.files[0], id = fileTarget;
    fileTarget = '';
    if (file && dialog.open && id === list.value) void apply(id, file);
  };
  $('resetSound').onclick = () => apply(list.value, null);
  soundLibrary.subscribe(id => {
    if (!dialog.open) return;
    if (id === list.value) stopPreview();
    populate();
  });
  soundLibrary.ready.then(() => {
    loaded = true;
    lockControls();
    if (dialog.open) message();
  });
  if (new URLSearchParams(location.search).get('sound') === 'radio') {
    open();
    soundLibrary.ready.then(() => { if (dialog.open) $('radioDemo').focus(); });
  }
}
