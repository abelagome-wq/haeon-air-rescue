// Run against the game's root URL or its /remake/ entry. Real audio decoding,
// settings, saved replacements and cockpit subtitles all use the browser APIs.
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const url = new URL(process.env.FLIGHT_URL || 'http://127.0.0.1:44187/remake/');
for (const [key,value] of Object.entries({diag:'1',city:'small',worldSeed:'42',weather:'calm'})) url.searchParams.set(key,value);
const wait = (page,condition,arg,timeout=60000) => page.waitForFunction(condition,arg,{timeout});
function expectResponse(page,suffix,action) {
  return Promise.all([page.waitForResponse(response => new URL(response.url()).pathname.endsWith(suffix) &&
    response.status()===200,{timeout:45000}),action()]).then(([response])=>response);
}

async function demo(page,language) {
  const path = '/dispatch/' + (language==='en'?'en/':'') + 'D1013-L005-D2018.mp3';
  const response = await expectResponse(page,path,()=>page.click('#radioDemo'));
  const sound = await response.body();
  assert.ok(sound.length>1500);
  await wait(page,lang=>document.querySelector('#soundNotice').textContent === window.lines[lang].demo,language);
  // The preview decodes the recording, then opens the DSP radio and starts the voice.
  await wait(page,()=>window.startedBuffers.some(seconds=>seconds>1));
  await page.evaluate(()=>{window.startedBuffers.length=0;});
}

async function speakPA(page,key,id,language,sourceId=id) {
  const path='/synth/'+(language==='en'?'en/':'')+sourceId+'.mp3';
  const response=await expectResponse(page,path,()=>page.keyboard.press(key));
  assert.ok((await response.body()).length>1500);
  await wait(page,({id,language,sourceId})=>{
    const subtitle=document.querySelector('#radioMessage');
    return __sim.radio.state.clip===id && subtitle.lang===language &&
      subtitle.textContent===(language==='en'?'[PA] ':'[확성기] ')+window.lines[language][sourceId];
  },{id,language,sourceId});
}

(async()=>{
  const browser=await chromium.launch({headless:true,
    executablePath:process.env.FLIGHT_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    args:['--enable-gpu','--use-angle=d3d11','--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let stage='opening the hangar';
  try {
    await page.addInitScript(()=>{
      window.startedBuffers=[];
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){
        if(this.buffer && !this.loop)window.startedBuffers.push(this.buffer.duration);
        return start.apply(this,args);
      };
    });
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:120000});
    await wait(page,()=>!document.querySelector('#openShop').disabled);
    await page.click('#openSoundEditor');
    assert.equal(await page.inputValue('#dialogueLanguage'),'ko');
    async function loadScripts() {
      await page.evaluate(async()=>{
        const {dialogueLines}=await import(new URL('./src/dialogue-lines.js',document.baseURI));
        const {dispatchPhrase}=await import(new URL('./src/dispatch-phrases.js',document.baseURI));
        window.lines=Object.fromEntries(['ko','en'].map(lang=>[lang,{...dialogueLines(lang),
          demo:dispatchPhrase(['D1013','L005','D2018'],lang).text}]));
      });
    }
    await loadScripts();
    await demo(page,'ko');
    stage='previewing and personalizing English';
    await page.selectOption('#dialogueLanguage','en');
    assert.equal(await page.textContent('#soundNotice'),'');
    await demo(page,'en');
    // Give the English traffic announcement a different spoken English line.
    await page.selectOption('#soundList','MG_00_00');
    await page.selectOption('#soundPreset','MG_00_01');
    await page.click('#applySoundPreset');
    await wait(page,()=>!document.querySelector('#resetSound').hidden && !document.querySelector('#dialogueLanguage').disabled);
    await page.selectOption('#dialogueLanguage','ko');
    assert.equal(await page.inputValue('#soundPreset'),'');
    assert.ok(await page.locator('#resetSound').isHidden());
    await page.selectOption('#dialogueLanguage','en');
    assert.equal(await page.inputValue('#soundPreset'),'MG_00_01');
    await page.reload({waitUntil:'domcontentloaded',timeout:120000});
    await wait(page,()=>!document.querySelector('#openShop').disabled);
    await page.click('#openSoundEditor');
    assert.equal(await page.inputValue('#dialogueLanguage'),'en');
    await page.selectOption('#soundList','MG_00_00');
    assert.equal(await page.inputValue('#soundPreset'),'MG_00_01');
    await page.click('#closeSoundEditor');
    await loadScripts();

    stage='boarding and broadcasting in English';
    await page.selectOption('#quality','balanced');
    await page.selectOption('#missionSelect','fire/small');
    await wait(page,()=>!document.querySelector('#start').disabled);
    const dispatchRecording=page.waitForResponse(r=>/\/dispatch\/en\/D1001-L00[1-9]\.mp3$/.test(new URL(r.url()).pathname) && r.status()===200,
      {timeout:120000});
    await page.click('#start');
    await wait(page,()=>window.__sim?.mode==='flight',null,120000);
    const recording=await dispatchRecording;
    const sector=new URL(recording.url()).pathname.match(/(L00[1-9])\.mp3$/)[1];
    const dispatchCaption=await page.evaluate(async sector=>{
      const {dispatchPhrase}=await import(new URL('./src/dispatch-phrases.js',document.baseURI));
      return '[Dispatch] '+dispatchPhrase(['D1001',sector],'en').text;
    },sector);
    await wait(page,text=>document.querySelector('#radioMessage').textContent===text,dispatchCaption);
    await page.click('#boardBtn');
    await wait(page,()=>!__sim.flight.state.onFoot);
    await speakPA(page,'F6','MG_00_00','en','MG_00_01');

    stage='switching at the pause menu';
    await page.click('#pauseBtn');
    await page.click('#pauseSoundEditor');
    await page.selectOption('#dialogueLanguage','ko');
    assert.equal(await page.textContent('#radioMessage'),'');
    assert.equal(await page.inputValue('#soundPreset'),'');
    await page.click('#closeSoundEditor');
    await page.click('#resume');
    await speakPA(page,'F7','MG_01_00','ko');
    assert.equal(await page.evaluate(()=>__sim.radio.state.language),'ko');
    assert.deepEqual(errors,[]);
    console.log('PASS two voiced dispatch previews, English preset isolation and reload, English and Korean cockpit PA playback, subtitles and in-flight language change at',url.origin+url.pathname);
  } catch(error) {
    console.error('Failure during',stage,'at',url.href,await page.locator('#dialogTitle,#dialogBody,#soundNotice,#radioMessage').allTextContents().catch(()=>[]));
    throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
