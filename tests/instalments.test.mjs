import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';
const clock=`(()=>{const RealDate=Date;const now=()=>{const [y,m,d]=(localStorage.getItem('plan-test-date')||'2026-11-22').split('-').map(Number);return new RealDate(y,m-1,d,12)};window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now().getTime()]))}static now(){return now().getTime()}}})();`;
const ordinary={id:'existing',name:'Existing monthly bill',amountPence:1450,frequency:'monthly',start:'2026-11-01',mode:'auto',overrides:{}};
async function unlock(p){await p.evaluate("document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");await p.wait("!document.getElementById('app').hidden && !document.getElementById('gateButton').disabled && pendingWrites===0")}
async function seed(p,expression='[]'){await p.evaluate(`(async()=>{records=${expression};secret='123456';await save();gate()})()`);await unlock(p)}
async function settle(p){await p.wait('pendingWrites===0')}
const planExpression="[{id:'plan',name:'Example purchase',amountPence:3333,frequency:'monthly',start:'2026-11-30',mode:'manual',overrides:{},instalments:buildInstalments(10000,3,'2026-11-30','monthly')}]";

test('finite schedules round exactly in pence and handle month ends, leap years and payment intervals',async()=>{
 const p=await browser({initScript:clock});
 try{
  assert.deepEqual(await p.evaluate("buildInstalments(10000,3,'2026-11-30','monthly').schedule"),[{date:'2026-11-30',amountPence:3333},{date:'2026-12-30',amountPence:3333},{date:'2027-01-30',amountPence:3334}]);
  assert.deepEqual(await p.evaluate("buildInstalments(5,3,'2027-01-31','monthly').schedule"),[{date:'2027-01-31',amountPence:1},{date:'2027-02-28',amountPence:1},{date:'2027-03-31',amountPence:3}]);
  assert.deepEqual(await p.evaluate("buildInstalments(300,3,'2028-01-31','monthly').schedule.map(p=>p.date)"),['2028-01-31','2028-02-29','2028-03-31']);
  assert.deepEqual(await p.evaluate("buildInstalments(300,3,'2026-11-22','weekly').schedule.map(p=>p.date)"),['2026-11-22','2026-11-29','2026-12-06']);
  for(const timezoneId of ['Europe/London','America/Los_Angeles','Pacific/Auckland']){
   await p.send('Emulation.setTimezoneOverride',{timezoneId});
   assert.deepEqual(await p.evaluate("buildInstalments(300,3,'2027-03-21','fortnightly').schedule.map(p=>p.date)"),['2027-03-21','2027-04-04','2027-04-18']);
  }
  for(const args of [[0,3,'2026-11-01','monthly'],[100,0,'2026-11-01','monthly'],[100,121,'2026-11-01','monthly'],[2,3,'2026-11-01','monthly'],[100,1.5,'2026-11-01','monthly'],[100,3,'2026-02-31','monthly']])assert.equal(await p.evaluate(`(()=>{try{buildInstalments(...${JSON.stringify(args)});return false}catch{return true}})()`),true);
  await p.evaluate(`records=${planExpression}`);
  assert.equal(await p.evaluate('validInstalments(records[0])'),true);
  assert.deepEqual(await p.evaluate(`totals([${JSON.stringify(ordinary)},...records])`),{monthly:4783,annual:27400});
  assert.deepEqual(await p.evaluate("occurrences(records[0],parse('2027-02-01'),parse('2030-12-31'))"),[]);
 }finally{await p.close()}
});

test('create and track an ongoing plan through View payments, protecting paid terms and surviving offline reopening',async()=>{
 const p=await browser({initScript:clock});
 try{
  await p.wait('!!navigator.serviceWorker.controller');
  await seed(p,JSON.stringify([ordinary]));
  await p.evaluate("document.getElementById('openSettings').click();document.getElementById('add').click();const f=document.getElementById('form').elements;f.name.value='Example purchase';f.recordType.value='instalment';f.recordType.dispatchEvent(new Event('change'));f.planTotal.value='100.00';f.planCount.value='3';f.start.value='2026-11-30';f.start.dispatchEvent(new Event('input'));document.getElementById('form').requestSubmit()");
  await p.wait("!document.getElementById('editor').open && pendingWrites===0");
  assert.equal(await p.evaluate('records.length'),2);
  assert.deepEqual(await p.evaluate("records.find(r=>r.id==='existing')"),ordinary);
  assert.equal(await p.evaluate('records.find(isInstalment).mode'),'manual');
  assert.equal(await p.evaluate("document.getElementById('total').textContent"),'£47.83');
  assert.match(await p.evaluate("document.querySelector('#monthItems .plan-progress').textContent"),/1 of 3/);
  await p.evaluate("document.getElementById('openUnpaid').click()");
  assert.equal(await p.evaluate("document.getElementById('unpaid').textContent"),'£33.33');
  assert.match(await p.evaluate("document.getElementById('planBalanceItems').textContent"),/£100.00 left to pay/);
  await p.evaluate("document.querySelector('#planBalanceItems .plan-progress').click()");
  assert.equal(await p.evaluate("document.getElementById('planDialog').open"),true);
  assert.equal(await p.evaluate("document.querySelectorAll('#planPayments input').length"),3);
  await p.evaluate("document.querySelector('#planPayments input').click()");await settle(p);
  assert.equal(await p.evaluate("document.getElementById('planRemaining').textContent"),'£66.67');
  assert.equal(await p.evaluate("document.getElementById('unpaid').textContent"),'£0.00');
  const schedule=await p.evaluate('records.find(isInstalment).instalments.schedule');
  await p.evaluate("document.getElementById('editPlan').click()");
  assert.equal(await p.evaluate("document.getElementById('form').elements.planTotal.disabled"),true);
  await p.evaluate("document.getElementById('form').elements.name.value='Renamed example purchase';document.getElementById('form').requestSubmit()");
  await p.wait("document.getElementById('planDialog').open && pendingWrites===0");
  assert.deepEqual(await p.evaluate('records.find(isInstalment).instalments.schedule'),schedule);
  await p.evaluate("document.getElementById('closePlan').click()");
  assert.equal(await p.evaluate("document.getElementById('unpaidDialog').open"),true);
  assert.match(await p.evaluate("document.getElementById('planBalanceItems').textContent"),/£66.67 left to pay/);
  await p.evaluate('gate()');
  assert.equal(await p.evaluate("document.querySelectorAll('dialog[open]').length"),0);
  p.setOffline(true);
  await p.evaluate('window.__planReload=true');await p.send('Page.reload');
  await p.wait("typeof window.__planReload==='undefined' && typeof render==='function' && typeof buildInstalments==='function'");
  await unlock(p);
  assert.equal(await p.evaluate('planBalance(records.find(isInstalment)).remainingPence'),6667);
  assert.deepEqual(await p.evaluate("records.find(r=>r.id==='existing')"),ordinary);
  assert.equal(await p.evaluate('records.length'),2);
  assert.doesNotMatch(await p.evaluate('localStorage.getItem(VAULT)'),/Renamed example purchase|schedule/);
  assert.deepEqual(p.errors,[]);
 }finally{await p.close()}
});

test('final-month popup is acknowledged once and the last penny clears the plan without further charges',async()=>{
 const p=await browser({initScript:clock+"localStorage.setItem('plan-test-date','2027-01-01');"});
 try{
  await seed(p,"[{id:'final',name:'Example final purchase',amountPence:3333,frequency:'monthly',start:'2026-11-30',mode:'manual',overrides:{'2026-11-30':true,'2026-12-30':true},instalments:buildInstalments(10000,3,'2026-11-30','monthly')}]");
  await p.wait("document.getElementById('planReminder').open");
  assert.match(await p.evaluate("document.getElementById('planReminderItems').textContent"),/£33.34/);
  await p.evaluate("document.querySelector('#planReminderItems button').click()");
  await p.wait("document.getElementById('planDialog').open && pendingWrites===0");
  assert.equal(await p.evaluate("document.getElementById('planRemaining').textContent"),'£33.34');
  assert.equal(await p.evaluate("document.querySelector('#planPayments .item:last-child .amount').textContent"),'£33.34');
  assert.equal(await p.evaluate("document.getElementById('planFinalNotice').hidden"),false);
  assert.equal(await p.evaluate('records[0].instalments.reminderMonth'),'2027-01');
  await p.evaluate("document.getElementById('closePlan').click();gate()");await unlock(p);
  await p.evaluate('maybeInstalmentReminder()');
  assert.equal(await p.evaluate("document.getElementById('planReminder').open"),false);
  await p.evaluate("document.querySelector('#monthItems .plan-final').click()");
  assert.equal(await p.evaluate("document.getElementById('planDialog').open"),true);
  await p.evaluate("document.querySelector('#planPayments .item:last-child input').click()");await settle(p);
  assert.equal(await p.evaluate("document.getElementById('planRemaining').textContent"),'£0.00');
  assert.equal(await p.evaluate("document.getElementById('planFinalNotice').hidden"),true);
  assert.deepEqual(await p.evaluate('planBalance(records[0])'),{paidCount:3,paidPence:10000,remainingPence:0});
  await p.evaluate("document.getElementById('closePlan').click();localStorage.setItem('plan-test-date','2027-02-01');cal=new Date(2027,1,1,12);refreshHistory().then(render)");await settle(p);
  assert.equal(await p.evaluate("document.getElementById('total').textContent"),'£0.00');
  assert.equal(await p.evaluate("document.querySelectorAll('#calendar .hit').length"),0);
  assert.equal(await p.evaluate('records.length'),1);
  assert.equal(await p.evaluate("document.getElementById('planBalances').hidden"),true);
  assert.match(await p.evaluate("document.querySelector('#planItems .plan-progress').textContent"),/Complete3 of 3/);
  const history=await p.evaluate('decrypt(JSON.parse(localStorage.getItem(HISTORY)),secret)');
  assert.equal(history.find(m=>m.month==='2027-01').payments[0].amountPence,3334);
  assert.equal(history.find(m=>m.month==='2027-01').payments[0].paid,true);
  await p.evaluate("document.querySelector('#planItems .plan-progress').click()");
  assert.equal(await p.evaluate("[...document.querySelectorAll('#planPayments input')].every(input=>input.checked)"),true);
  assert.deepEqual(p.errors,[]);
 }finally{await p.close()}
});

test('plan controls fit phone and desktop dialogs, and encrypted backups retain the schedule and ticks',async()=>{
 const p=await browser({initScript:clock});
 try{
  await seed(p,planExpression);
  for(const width of [320,390,1024,1440]){
   await p.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});
   await p.evaluate("document.getElementById('monthPayments').open=true;document.getElementById('plansSection').open=true");
   assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`page fits ${width}`);
   await p.evaluate("document.querySelector('#monthItems .plan-progress').click()");
   await p.evaluate('Promise.all(document.getAnimations().map(a=>a.finished))');
   assert.equal(await p.evaluate("document.getElementById('planDialog').scrollWidth<=document.getElementById('planDialog').clientWidth"),true,`plan dialog fits ${width}`);
   assert.equal(await p.evaluate("document.querySelector('#planPayments input').getAttribute('aria-label')"),'Mark payment 1 of 3 for Example purchase paid');
   await p.evaluate("document.getElementById('closePlan').click()");
  }
  await p.evaluate("document.querySelector('#monthItems .plan-progress').click();document.querySelector('#planPayments input').click()");await settle(p);
  const before=await p.evaluate('records');
  const backup=await p.evaluate('localStorage.getItem(VAULT)');
  await p.evaluate(`(async()=>{window.confirm=()=>true;records=[];await save();await document.getElementById('restoreFile').onchange({target:{files:[{size:1000,text:async()=>${JSON.stringify(backup)}}],value:'x'}})})()`);
  assert.deepEqual(await p.evaluate('records'),before);
  assert.equal(await p.evaluate('planBalance(records[0]).remainingPence'),6667);
  await p.evaluate(`(async()=>{window.__planAlert='';window.alert=s=>window.__planAlert=s;const broken=structuredClone(records);broken[0].instalments.schedule[2].amountPence++;const v=await encrypt(broken,secret,crypto.getRandomValues(new Uint8Array(16)));await document.getElementById('restoreFile').onchange({target:{files:[{size:1000,text:async()=>JSON.stringify(v)}],value:'x'}})})()`);
  assert.match(await p.evaluate('window.__planAlert'),/Invalid bill data/);
  assert.deepEqual(await p.evaluate('records'),before,'Reject corrupt backup without replacing saved data');
  assert.deepEqual(p.errors,[]);
 }finally{await p.close()}
});
