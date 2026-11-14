// Start a fresh career, fit the starter helicopter and fly the actual cargo rig.
// Only the travel between depots is shortened. Hoisting, payload, controls,
// dry-ground release, dispatch and the career ledger run through the game.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const url = new URL(process.env.FLIGHT_URL || 'http://127.0.0.1:43912/remake/');
for (const [key, value] of Object.entries({diag:'1', career:'career', city:'small', worldSeed:'42', weather:'calm'})) {
  url.searchParams.set(key, value);
}
const output = process.env.FLIGHT_VERIFY_DIR || path.resolve(__dirname, '../verification/cargo');
const profileKey = 'simcopter.career.v1';
const wait = (page, condition, arg) => page.waitForFunction(condition, arg, {timeout:45000});
const profile = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), profileKey);
const nextFrames = (page, count=3) => page.evaluate(count => new Promise(resolve => {
  function frame() { if (--count > 0) requestAnimationFrame(frame); else resolve(); }
  requestAnimationFrame(frame);
}), count);

async function holdUntil(page, key, condition) {
  await page.keyboard.down(key);
  try { await wait(page, condition); } finally { await page.keyboard.up(key); }
}

async function positionAt(page, point, height) {
  await page.evaluate(({point, height}) => {
    __sim.flight.position.set(point.x, point.y + height, point.z);
  }, {point, height});
  await nextFrames(page);
}

const sample = page => page.evaluate(() => {
  const {missions, flight} = __sim;
  const m = missions.state, hook = m.hook, s = flight.state;
  const box = __sim.ctx.scene.getObjectByName('Corrugated cargo container');
  return {
    phase:m.phase, destination:m.destination, target:m.target && {x:m.target.x,y:m.target.y,z:m.target.z},
    attached:hook.attached, grounded:hook.grounded, extension:hook.extension, loadKg:hook.externalLoadKg,
    hook:hook.hookPosition.toArray(), container:box?.position.toArray(), helicopter:flight.position.toArray(),
    speed:s.speed, verticalSpeed:s.verticalSpeed, payloadKg:s.rotorPerformance.payloadKg,
    thrustToWeight:s.rotorPerformance.verticalThrustToWeight, cash:m.cash, score:m.score,
    history:m.history.filter(entry => entry.type === 'cargo'), feedback:m.feedback
  };
});

async function tapPad(page, i) {
  await page.evaluate(i => {
    window.testPad.buttons[i] = {pressed:true, value:1};
  }, i);
  await nextFrames(page);
  await page.evaluate(i => {
    window.testPad.buttons[i] = {pressed:false, value:0};
  }, i);
  await nextFrames(page);
}

async function run() {
  const browser = await chromium.launch({
    executablePath:process.env.FLIGHT_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true, args:['--enable-gpu','--use-angle=d3d11']
  });
  const ctx = await browser.newContext({viewport:{width:1200,height:800}, hasTouch:true, deviceScaleFactor:1});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let stage = 'starting the career';
  try {
    await page.addInitScript(() => {
      window.testPad = {id:'Test Xbox pad', index:0, connected:true, mapping:'standard', axes:[0,0,0,0],
        buttons:Array.from({length:17}, () => ({value:0, pressed:false}))};
      window.testPadConnected = false;
      Object.defineProperty(navigator, 'getGamepads', {value:() => window.testPadConnected ? [window.testPad] : []});
    });
    await page.goto(url.href);
    await wait(page, () => !document.querySelector('#start').disabled);
    assert.equal(await page.inputValue('#careerMode'), 'career');
    assert.equal(await page.inputValue('#heliSelect'), 'SCWZR300');
    const before = await profile(page);
    await page.selectOption('#shift', 'day');
    await page.selectOption('#quality', 'balanced');
    await page.selectOption('#controlsSelect', 'touch');
    await page.selectOption('#missionSelect', 'cargo/container');
    await wait(page, () => document.querySelector('#start').disabled && !document.querySelector('#fitMissionGear').hidden);
    await page.locator('#fitMissionGear').tap();
    assert.equal(await page.locator('[data-item="bucket"]').textContent(), '분리');
    await page.locator('[data-item="hook"]').tap();
    await wait(page, () => document.querySelector('[data-item="hook"]').textContent === '분리');
    await page.locator('#closeShop').tap();
    assert.equal((await profile(page)).cash, before.cash);
    await page.click('#start');
    await page.waitForFunction(() => window.__sim?.mode === 'flight' || document.querySelector('#dialogTitle').textContent.includes('수 없습니다'), null, {timeout:120000});
    assert.ok(await page.evaluate(() => !!window.__sim), await page.locator('#dialogBody').textContent());
    await holdUntil(page, 'ArrowUp', () => !__sim.flight.state.onFoot);
    await holdUntil(page, 'KeyQ', () => __sim.flight.state.altitudeAGL > 10);
    await wait(page, () => __sim.missions.state.phase === 'pickup' && Math.abs(__sim.flight.state.verticalSpeed)<.1);

    stage = 'collecting the container';
    const pickup = (await sample(page)).target;
    await positionAt(page, pickup, 10);
    await page.keyboard.press('KeyV');
    await wait(page, () => {
      const {hook,target} = __sim.missions.state, p = hook.hookPosition;
      return hook.deployed && Math.hypot(target.x-p.x,target.z-p.z)<1 && Math.abs(p.y-target.y-2.55)<.55;
    });
    await page.keyboard.press('KeyX');
    await wait(page, () => __sim.flight.state.cameraId === 'drop' && !document.querySelector('#dropSight').hidden);
    await page.keyboard.press('KeyB');
    await wait(page, () => __sim.missions.state.hook.attached && __sim.missions.state.phase === 'deliver');
    const destination = (await sample(page)).target;
    const distance = Math.hypot(pickup.x-destination.x,pickup.z-destination.z);
    assert.ok(distance >= 144, 'pickup and delivery use separate depots');
    await page.keyboard.press('KeyX');
    await wait(page, () => __sim.flight.state.cameraId === 'chase');

    stage = 'flying the suspended 160 kg load';
    await page.keyboard.press('KeyZ');
    await wait(page, () => !__sim.missions.state.hook.deployed && __sim.missions.state.hook.externalLoadKg === 160);
    await holdUntil(page, 'KeyQ', () => __sim.flight.state.altitudeAGL > 35);
    await wait(page, () => Math.abs(__sim.flight.state.verticalSpeed)<.3 && __sim.flight.state.speed<1);
    const airborne = await sample(page);
    assert.equal(airborne.payloadKg, 160);
    assert.ok(airborne.thrustToWeight > 1);
    assert.ok(airborne.container[1] > pickup.y + 10);
    await page.evaluate(() => {window.testPadConnected=true;});
    await nextFrames(page);
    await tapPad(page, 0);
    const refused = await sample(page);
    assert.equal(refused.attached, true, 'Xbox A cannot release an airborne container');
    assert.match(refused.feedback, /내려놓|바닥/);
    assert.equal(refused.history.length, 0);
    await page.evaluate(() => {window.testPadConnected=false;});
    fs.mkdirSync(output, {recursive:true});
    // An inspection camera frames the actual loaded aircraft, winch and box.
    // Keep the pilot's camera and all scene transforms intact.
    const png = await page.evaluate(() => {
      const {ctx,flight} = __sim, T = ctx.THREE;
      const box = ctx.scene.getObjectByName('Corrugated cargo container');
      const target = box.position.clone().lerp(flight.position,.62);
      target.y += .5;
      const camera = new T.PerspectiveCamera(34,ctx.camera.aspect,.05,1800);
      const angle = flight.state.heading * Math.PI / 180;
      const offset = new T.Vector3(12,4,-16).applyAxisAngle(new T.Vector3(0,1,0), -angle);
      camera.position.copy(target).add(offset);
      camera.lookAt(target);
      ctx.renderer.render(ctx.scene,camera);
      return ctx.renderer.domElement.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(output,'container-in-flight.png'), Buffer.from(png,'base64'));

    stage = 'delivering at the receiving pad';
    await page.keyboard.press('KeyV');
    await wait(page, () => __sim.missions.state.hook.extension > 12);
    await positionAt(page, destination, 10);
    await wait(page, () => __sim.missions.state.hook.grounded && __sim.flight.state.rotorPerformance.payloadKg === 0);
    await page.setViewportSize({width:844,height:390});
    await nextFrames(page);
    if (!await page.locator('#bucketValve').isVisible()) await page.locator('#touchPanelToggle').tap();
    await wait(page, () => document.querySelector('#bucketValve').textContent === '고리 해제');
    await page.locator('#bucketValve').tap();
    await wait(page, () => __sim.missions.state.history.some(r => r.type === 'cargo'));
    await page.keyboard.press('KeyB');
    const delivered = await sample(page);
    const cash = 180+Math.round(distance*.15);
    assert.equal(delivered.attached,false);
    assert.equal(delivered.history.length,1);
    assert.deepEqual([delivered.history[0].outcome, delivered.history[0].cash, delivered.history[0].points], ['success',cash,60]);
    await wait(page, ({key, balance, completed}) => {
      const p = JSON.parse(localStorage.getItem(key));
      return p.cash === balance && p.completed === completed;
    }, {key:profileKey,balance:before.cash+cash,completed:before.completed+1});
    await page.reload();
    await wait(page, () => !document.querySelector('#openShop').disabled);
    const after = await profile(page);
    assert.equal(after.cash, before.cash+cash);
    assert.equal(after.score, before.score+60);
    assert.equal(after.completed, before.completed+1);
    assert.equal(after.fittings.SCWZR300.mounted.water, 'hook');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({url:url.origin+url.pathname,aircraft:'SCWZR300',routeMetres:Math.round(distance),
      airbornePayloadKg:airborne.payloadKg,thrustToWeight:airborne.thrustToWeight,airborneRelease:refused.feedback,
      deliveries:delivered.history.length,reward:cash,score:60,cashAfterReload:after.cash,screenshot:path.join(output,'container-in-flight.png')}));
  } catch (error) {
    const detail = await page.evaluate(() => window.__sim?.mode === 'flight').catch(() => false) ? await sample(page) : await page.locator('#dialogBody').textContent().catch(() => '');
    console.error(stage, JSON.stringify({detail, errors}));
    throw error;
  } finally {
    await browser.close();
  }
}
run().catch(error => {console.error(error); process.exitCode=1;});
