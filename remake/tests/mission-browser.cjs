// Exercise each hangar choice against the real Windows host. A positioning fixture
// isolates the dispatch rules; browser.cjs separately flies a VIP sortie using only inputs.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.FLIGHT_URL||'http://127.0.0.1:42861/remake/';
const output=path.resolve(__dirname,'../verification');
const plans=['rescue/boat','rescue/roof','rescue/train','transport/vip','medevac/street',
  'fire/small','fire/large','riot/crowd','riot/major','speeder/patrol','traffic/gridlock','traffic/burning',
  'criminal/robber','criminal/mugger','criminal/arsonist','criminal/getaway'];
async function exercise(plan){
  const s=window.__sim,{missions,flight,city,civic,transit}=s,dt=.12;
  const [type]=plan.split('/'),phases=[],children=new Set(),transmissions=[];let elapsed=0,lastAction=-5;
  const notify=s.radio.notify;s.radio.notify=event=>{transmissions.push({...event});return notify(event);};
  // Acquire the speeder visually. This fixture can inspect its actual road position;
  // the player receives no pre-discovery coordinate or on-map icon.
  const speeder=type==='speeder'?s.ctx.scene.getObjectByName('models/traffic/lod1/CARROBBR-LOD1.glb'):null;
  const act=tool=>{const node=document.getElementById('fieldTool');node.value=tool;document.querySelector('#useTool').click();};
  while(elapsed<650){
    let m=missions.state;
    if(m.history.some(h=>h.type===type))break;
    const target=m.target||speeder?.position;
    if(!phases.includes(m.phase))phases.push(m.phase);
    if(target){
      const landing=['vip-pickup','vip-dropoff','patient-scene','patient-carry','hospital','safe-release'].includes(m.phase);
      const altitude=landing?0:m.phase==='refill'?5:type==='rescue'?8:12;
      flight.position.set(target.x,target.y+altitude,target.z);
      flight.state.grounded=landing;flight.state.speed=0;flight.state.heading=0;flight.state.altitudeAGL=altitude;
      if(type==='medevac'&&m.phase==='patient-scene'&&!flight.state.onFoot){window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));}
      if(type==='medevac'&&m.phase==='patient-scene'&&flight.state.onFoot)flight.playerPosition.set(target.x,target.y,target.z);
      if(type==='medevac'&&m.phase==='patient-carry'&&flight.state.onFoot){const door=flight.doorPosition;flight.playerPosition.copy(door);window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyE'}));}
      if(m.phase.startsWith('harness')&&type==='rescue')flight.state.grounded=false;
      civic.update(flight.position);
    }
    transit.update(dt,flight.position);missions.update(dt);elapsed+=dt;
    for(const c of missions.state.calls)if(c.type!==type)children.add(c.type);
    if(elapsed-lastAction>1.05){
      const action=missions.state.suggestedTool||'context';
      if(type==='criminal'&&phases.includes('search')&&elapsed<3)act('police');
      else act(action);
      lastAction=elapsed;
    }
  }
  s.radio.notify=notify;
  return {plan,phases,children:[...children],transmissions,elapsed:Math.round(elapsed),outcome:missions.state.history.find(h=>h.type===type),
    last:{phase:missions.state.phase,title:missions.state.title,instruction:missions.state.instruction,feedback:missions.state.feedback,target:missions.state.target,units:missions.state.serviceUnits},
    awards:missions.state.history.slice(),assets:missions.state.assetErrors.slice()};
}
(async()=>{
  const b=await chromium.launch({executablePath:process.env.FLIGHT_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-gpu','--use-angle=d3d11']});
  const errors=[],reports=[];const selected=process.argv.slice(2);
  try{
    const p=await b.newPage({viewport:{width:1440,height:900}});p.on('pageerror',e=>errors.push(e.message));
    p.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
    // Isolated test wallet represents previously earned money. Buy through real
    // shop controls so mission fixtures cannot silently bypass the new loadout.
    await p.addInitScript(()=>{if(!localStorage.getItem('simcopter.career.v1'))localStorage.setItem('simcopter.record',JSON.stringify({cash:20000,completed:100,score:5000,failed:0,partial:0}));});
    await p.goto(base);await p.waitForFunction(()=>!document.getElementById('openShop').disabled);
    await p.click('#openShop');await p.locator('[data-item="JETRANG"]').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('simcopter.career.v1')).selectedAircraft==='JETRANG');
    await p.click('#shopEquipment');
    for(const id of ['harness','cannon','gas']){await p.locator('[data-item="'+id+'"]').click();await p.waitForFunction(id=>JSON.parse(localStorage.getItem('simcopter.career.v1')).ownedEquipment.includes(id),id);}
    await p.click('#closeShop');
    for(const plan of (selected.length?selected:plans)){
      await p.goto(base+'?diag=1&city=small&worldSeed=42&heli=JETRANG');
      await p.waitForFunction(()=>document.querySelector('#missionSelect optgroup')&&!document.querySelector('#citySelect').disabled);
      assert.equal(await p.locator('#missionSelect optgroup').count(),9);
      await p.selectOption('#missionSelect',plan);
      await p.click('#start');await p.waitForFunction(()=>window.__sim?.mode==='flight'||document.querySelector('#dialogTitle').textContent.includes('수 없습니다'),null,{timeout:60000});
      if(!await p.evaluate(()=>!!window.__sim))throw Error(await p.locator('#dialogBody').innerText());
      await p.keyboard.down('ArrowUp');try{await p.waitForFunction(()=>!__sim.flight.state.onFoot,null,{timeout:6000});}finally{await p.keyboard.up('ArrowUp');}
      const r=await p.evaluate(exercise,plan);await p.waitForTimeout(250);
      r.assets=await p.evaluate(()=>__sim.snapshot().assetErrors);reports.push(r);
      console.log(plan,JSON.stringify({phases:r.phases,result:r.outcome?.outcome,award:r.outcome?.points,errors:r.assets,more:r.children,
        voices:r.transmissions.filter(e=>e.kind==='field'||e.kind==='update').map(e=>e.clip),...(!r.outcome?{last:r.last}:{})}));
    }
    if(!selected.length){
      fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,'original-missions.json'),JSON.stringify({method:'Edge WebGL, normal hangar, real scenes/assets/routes, positioned incident QA',errors,reports},null,2));
    }
    for(const r of reports){
      assert.ok(r.outcome&&r.outcome.outcome!=='failed',r.plan+' '+JSON.stringify(r.last));assert.deepEqual(r.assets,[]);
      const clips=r.transmissions.map(e=>e.clip);
      if(r.plan==='speeder/patrol'){assert.ok(clips.includes('FIELD_TICKET'));assert.ok(!clips.includes('FIELD_ARREST'));}
      if(r.plan.startsWith('criminal/')){assert.ok(clips.includes('FIELD_ARREST'));assert.ok(!clips.includes('FIELD_TICKET'));}
      if(r.plan==='medevac/street'||r.plan==='rescue/boat'){
        assert.ok(clips.includes('FIELD_HOSPITAL'));assert.ok(!clips.includes('FIELD_DROPOFF'));
      }
      if(r.plan==='traffic/burning')assert.ok(clips.includes('D1023'));
    }
    assert.deepEqual(errors,[]);
  }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
