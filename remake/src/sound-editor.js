import {soundEntries, soundLibrary} from './sound-library.js';
import {dialogueLines} from './dialogue-lines.js';
import {speakOnDevice, voiceMode, setVoiceMode} from './device-speech.js';
import {isRadioVoice, playRadioPreview} from './radio-channel.js';
import {dispatchPhrase} from './dispatch-phrases.js';

export function setupSoundEditor({language='ko', onLanguage=()=>{}}={}) {
  const $ = id => document.getElementById(id);
  const dialog = $('soundEditor'), group = $('soundGroup'), search = $('soundSearch');
  const list = $('soundList'), fileInput = $('soundFile'), notice = $('soundNotice');
  const preset = $('soundPreset'), applyPreset = $('applySoundPreset');
  const entries = new Map(soundEntries.map(entry => [entry.id, entry]));
  let loaded = false, busy = false, preview = null, previewButton = null, fileTarget = '';
  let activePlayback = null, previewSerial = 0;
  const modeSelector = $('voiceMode'), langSelector = $('dialogueLanguage');
  langSelector.value=language;
  const filename=id=>soundLibrary.filename(id,language), label=id=>soundLibrary.label(id,language);
  const demoButtonText=()=>{
    const dispatch=$('demoScene').value==='dispatch';
    return language==='en'?(dispatch?'Preview dispatch':'Play dialogue'):(dispatch?'관제 무전 들어보기':'현장 대사 들어보기');
  };
  const demoPhrase=()=>dispatchPhrase(['D1013','L005','D2018'],language);
  function drawDemo(){
    const id=$('demoScene').value,line=$('demoLine');line.lang=language;
    line.textContent=id==='dispatch'?demoPhrase().text:dialogueLines(language)[id];
  }
  function updateLanguage(){
    const en=language==='en';
    const note=$('soundStorageNote');
    note.lang=en?'en':'ko';note.textContent=en?'Dialogue and subtitles are in English. Your selection is saved on this device.':'관제 무전과 현장 대사는 한국어 음성·자막으로 나옵니다. 이 기기에 선택이 저장됩니다.';
    const scenes=$('demoScene');scenes.lang=language;
    const sceneNames=en?['Dispatch · Medical call','Medical crew · Patient handoff','Passenger · Arrival']:['관제 · 응급 출동','의료진 · 환자 인계','승객 · 목적지 도착'];
    for(let i=0;i<scenes.length;i++)scenes.options[i].text=sceneNames[i];
    $('radioDemo').textContent=demoButtonText();
    drawDemo();
  }
  function buildPresets(){
    preset.replaceChildren(new Option('내장 소리 선택',''),...soundEntries.map(entry=>
      new Option(entry.group+' · '+label(entry.id)+' · '+entry.id,entry.id)));
  }
  langSelector.onchange=()=>{
    stopPreview();language=langSelector.value==='en'?'en':'ko';onLanguage(language);
    buildPresets();updateLanguage();message();populate();
  };
  updateLanguage();
  modeSelector.value = voiceMode();
  modeSelector.onchange = () => { stopPreview(); setVoiceMode(modeSelector.value); };

  for (const name of new Set(soundEntries.map(entry => entry.group))) {
    group.add(new Option(name, name));
  }
  buildPresets();
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
    $('radioDemo').textContent = demoButtonText();
  }
  function showSelection() {
    const entry = entries.get(list.value);
    $('soundDetail').hidden = !entry;
    if (!entry) return;
    const file = filename(entry.id);
    const sourceId = soundLibrary.preset(entry.id,language);
    const spoken = dialogueLines(language)[entry.id];
    const source = spoken ? (language==='en'?'영어':'한국어')+' 내장 음성' : entry.group === '효과음' ? '게임용 합성 효과음' : '게임용 연주곡';
    $('soundLabel').textContent = label(entry.id);$('soundLabel').lang=spoken?language:'ko';
    $('soundSource').textContent = sourceId ? '적용 중인 내장 소리 · '+file+' · '+sourceId :
      file ? '적용 중인 파일 · ' + file : '기본 소리 · ' + source;
    for(const option of preset.options)option.disabled=option.value===entry.id;
    preset.value=sourceId;
    applyPreset.disabled=busy||!preset.value||preset.value===sourceId;
    $('previewCustom').hidden = $('resetSound').hidden = !file;
  }
  function populate() {
    const selectedId = list.value, term = search.value.trim().toLowerCase();
    const found = soundEntries.filter(entry => (!group.value || group.value === entry.group) &&
      [entry.id, entry.label, label(entry.id), entry.url.split('/').pop(), filename(entry.id)]
        .some(value => (value || '').toLowerCase().includes(term)));
    list.replaceChildren(...found.map(entry => new Option(
      label(entry.id) + ' · ' + entry.id + (filename(entry.id) ? ' (교체됨)' : ''), entry.id)));
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
    langSelector.disabled=busy;
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
  async function listen(button, url, id, text, useDevice=true) {
    const same = button === previewButton;
    stopPreview();
    message();
    if (same) return;
    const serial = previewSerial;
    previewButton = button;
    button.textContent = '미리듣기 정지';
    if (text) message(text);
    if (isRadioVoice(id)) {
      try {
        activePlayback = playRadioPreview(url);
        await activePlayback.finished;
        if (serial === previewSerial) stopPreview();
      } catch {
        if (serial === previewSerial) { stopPreview(); message('무전 소리를 재생할 수 없습니다.', true); }
      }
      return;
    }
    if (text && useDevice) {
      const playback = speakOnDevice(text,globalThis,language);
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
      if (sourceId) await soundLibrary.replaceWithPreset(id,sourceId,language);
      else if (file) await soundLibrary.replace(id, file,language);
      else await soundLibrary.reset(id,language);
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
    const id=$('demoScene').value;
    if(id!=='dispatch')return listen(event.currentTarget,soundLibrary.originalURL(id,language),id,dialogueLines(language)[id]);
    const sample = demoPhrase();
    return listen(event.currentTarget, sample.url, 'D1013', sample.text);
  };
  $('demoScene').onchange=()=>{stopPreview();message();drawDemo();};
  $('previewOriginal').onclick = event => listen(event.currentTarget, soundLibrary.originalURL(list.value,language), list.value, dialogueLines(language)[list.value]);
  $('previewCustom').onclick = event => listen(event.currentTarget, soundLibrary.url(list.value,language), list.value,soundLibrary.caption(list.value,language),false);
  preset.onchange=()=>{applyPreset.disabled=busy||!preset.value||preset.value===soundLibrary.preset(list.value,language);};
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
  soundLibrary.subscribe((id,changedLanguage) => {
    if (!dialog.open || (changedLanguage && changedLanguage!==language)) return;
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
