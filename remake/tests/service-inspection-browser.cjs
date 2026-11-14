const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const [base,out]=process.argv.slice(2);
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.FLIGHT_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true,args:['--enable-gpu','--use-angle=d3d11']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:860}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
    await page.goto(base);await page.waitForFunction(()=>!document.querySelector('#start')?.disabled);
    const fleet=await page.evaluate(async()=>{
      const {FLEET}=await import(new URL('src/fleet.js',document.baseURI));
      return FLEET.map(({id,name,designation,path})=>({id,name,designation,service:path.includes('/service/')}));
    });
    const checks=[];
    for(const h of fleet){
      await page.selectOption('#heliSelect',h.id);
      if(h.service)await page.waitForFunction(()=>document.getElementById('airPhoto').naturalWidth===1080);
      await page.click('#previewAircraft');await page.waitForFunction(({name,designation})=>{
        const info=document.querySelector('#modelInfo');
        return document.querySelector('#inspection').open&&info.textContent===designation+' · '+name+' · 비행 기체';
      },h);
      assert.equal(await page.locator('#modelInfo a').count(),0);
      assert.equal(await page.locator('#inspectorView canvas').count(),1);
      assert.equal(await page.locator('#objectSelect option:checked').textContent(),h.designation+' · '+h.name);
      if(out&&h.id==='GYEOPNAL'){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'격납고-기체점검.png')});}
      checks.push({name:h.name,designation:h.designation});await page.click('#closeInspect');
    }
    assert.equal(checks.length,20);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
