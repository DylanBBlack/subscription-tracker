import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';
const fixed=`const ActualDate=Date;window.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[2026,10,12,12]))}static now(){return new ActualDate(2026,10,12,12).getTime()}};`;
async function setup(page){
  await page.evaluate(`(async()=>{records=[
    {id:'responsive1',name:'A longer household subscription with a detailed bill name',amountPence:1275,frequency:'monthly',start:'2026-11-18',mode:'manual',overrides:{}},
    {id:'responsive2',name:'Home insurance',amountPence:840,frequency:'monthly',start:'2026-11-04',mode:'auto',overrides:{}}
  ];secret='123456';await save();gate();document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()})()`);
  await page.wait("!document.getElementById('app').hidden && pendingWrites===0");
}
async function finishMotion(page){await page.evaluate('Promise.all(document.getAnimations().map(animation=>animation.finished))')}

test('dashboard, disclosures and dialogs remain usable across phone, tablet and desktop widths',async()=>{
  const page=await browser({initScript:fixed});
  try{
    await setup(page);
    const vault=await page.evaluate('localStorage.getItem(VAULT)');
    assert.match(await page.evaluate("document.querySelector('#calendar .hit').getAttribute('aria-label')"),/1 payment$/);
    assert.equal(await page.evaluate("document.getElementById('prev').getAttribute('aria-label')"),'Previous month');
    assert.equal(await page.evaluate("document.getElementById('next').getAttribute('aria-label')"),'Next month');
    for(const width of [320,390,768,1024,1440]){
      await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});
      await page.evaluate("document.getElementById('monthPayments').open=true");
      assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`overflow at ${width}`);
      const positions=await page.evaluate(`(()=>{const bills=document.getElementById('monthPayments').getBoundingClientRect(),calendar=document.getElementById('calendarSection').getBoundingClientRect();return {billsRight:bills.right,billsBottom:bills.bottom,calendarLeft:calendar.left,calendarTop:calendar.top}})()`);
      if(width>=768)assert.ok(positions.calendarLeft>positions.billsRight,'Desktop calendar uses a separate column');
      else assert.ok(positions.calendarTop>=positions.billsBottom,'Mobile maintains the existing vertical reading order');
      await page.evaluate("document.getElementById('openSettings').click();document.getElementById('settings').scrollTop=document.getElementById('settings').scrollHeight");
      await finishMotion(page);
      const close=await page.evaluate(`(()=>{const dialog=document.getElementById('settings').getBoundingClientRect(),button=document.getElementById('closeSettings').getBoundingClientRect();return {inside:button.top>=dialog.top&&button.bottom<=dialog.bottom,width:document.getElementById('settings').scrollWidth<=document.getElementById('settings').clientWidth}})()`);
      assert.equal(close.inside,true,`Done stays visible at ${width}`);
      assert.equal(close.width,true,`Settings does not scroll sideways at ${width}`);
      await page.evaluate("document.getElementById('closeSettings').click();document.getElementById('openUnpaid').click()");
      await finishMotion(page);
      assert.equal(await page.evaluate("document.getElementById('unpaidDialog').scrollWidth<=document.getElementById('unpaidDialog').clientWidth"),true);
      assert.equal(await page.evaluate("document.querySelectorAll('#items .item').length"),1);
      await page.evaluate("document.getElementById('closeUnpaid').click()");
      assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£12.75');
    }
    assert.equal(await page.evaluate('localStorage.getItem(VAULT)'),vault);
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});

test('all saved font choices fit a small phone and reduced-motion preferences are honored',async()=>{
  const page=await browser({initScript:fixed});
  try{
    await setup(page);
    await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await page.evaluate("document.getElementById('openSettings').click()");
    assert.equal(await page.evaluate("getComputedStyle(document.getElementById('settings')).animationName"),'none');
    for(const [value,family] of [['system',null],['manrope','Manrope'],['lora','Lora']]){
      await page.evaluate(`(()=>{const select=document.getElementById('fontChoice');select.value='${value}';select.dispatchEvent(new Event('change'))})()`);
      if(family)await page.evaluate(`document.fonts.load('400 16px ${family}')`);
      await page.evaluate("document.getElementById('closeSettings').click()");
      assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${value} fits 320px`);
      await page.evaluate("document.getElementById('openUnpaid').click()");
      assert.equal(await page.evaluate("document.getElementById('unpaidDialog').scrollWidth<=document.getElementById('unpaidDialog').clientWidth"),true);
      await page.evaluate("document.getElementById('closeUnpaid').click();document.getElementById('openSettings').click()");
    }
    await page.evaluate("document.getElementById('closeSettings').click()");
    for(const scheme of ['light','dark']){
      await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
      assert.equal(await page.evaluate('getComputedStyle(document.documentElement).colorScheme'),'dark','Preserve the original dark-only product choice');
    }
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});
