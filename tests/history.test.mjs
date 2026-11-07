import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';
const clock=`
  (()=>{
    const RealDate=Date;
    const date=()=>{const [y,m,d]=(localStorage.getItem('test-history-date')||'2026-11-30').split('-').map(Number);return new RealDate(y,m-1,d,12)};
    window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[date().getTime()]))}static now(){return date().getTime()}};
    window.__monthChecks=[];
    const interval=window.setInterval;
    window.setInterval=(fn,ms,...args)=>{if(ms===60000)window.__monthChecks.push(fn);return interval(fn,ms,...args)};
  })();
`;
const bill=(id,amountPence,start,mode='manual',overrides={})=>({id,name:id,amountPence,start,mode,overrides,frequency:'monthly'});
async function unlock(page){
  await page.evaluate("document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");
  await page.wait("!document.getElementById('app').hidden && !document.getElementById('gateButton').disabled && pendingWrites===0");
}
async function seed(page,bills){
  await page.evaluate(`(async()=>{records=${JSON.stringify(bills)};secret='123456';await save();gate()})()`);
  await unlock(page);
}
async function advance(page,date){
  await page.evaluate(`localStorage.setItem('test-history-date','${date}');window.__monthChecks.forEach(fn=>fn())`);
  await page.wait(`historyCurrent==='${date.slice(0,7)}' && pendingWrites===0`);
}
async function stored(page){return page.evaluate("decrypt(JSON.parse(localStorage.getItem(HISTORY)),'123456')")}
async function select(page,month){await page.evaluate(`document.getElementById('historyMonth').value='${month}';document.getElementById('historyMonth').dispatchEvent(new Event('change'))`)}

test('monthly snapshots survive edits, deletion, year rollover, reopening and the three-month visibility window',async()=>{
  const page=await browser({initScript:clock});
  try{
    await seed(page,[bill('Original name',1000,'2026-11-12','manual',{'2026-11-12':true}),bill('Automatic',250,'2026-11-30','auto'),bill('Manual unpaid',375,'2026-11-10')]);
    const mainVault=await page.evaluate('localStorage.getItem(VAULT)');
    await advance(page,'2026-12-01');
    assert.equal(await page.evaluate('records.length'),3);
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£16.25');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#monthItems input')].every(el=>!el.checked)"),true);
    assert.equal(await page.evaluate('localStorage.getItem(VAULT)'),mainVault);
    const november=(await stored(page)).find(m=>m.month==='2026-11');
    assert.deepEqual(november.payments.map(p=>({name:p.name,amount:p.amountPence,date:p.date,paid:p.paid})),[
      {name:'Original name',amount:1000,date:'2026-11-12',paid:true},
      {name:'Automatic',amount:250,date:'2026-11-30',paid:true},
      {name:'Manual unpaid',amount:375,date:'2026-11-10',paid:false}
    ]);
    // December edits must not rewrite November's names, amounts, dates or statuses.
    await page.evaluate("(async()=>{records[0].name='Changed name';records[0].amountPence=2000;records[0].start='2026-12-20';records=records.filter(r=>r.id!=='Automatic');await save();render()})()");
    assert.deepEqual((await stored(page)).find(m=>m.month==='2026-11'),november);
    await advance(page,'2027-01-01');
    assert.deepEqual(await page.evaluate("[...document.getElementById('historyMonth').options].map(o=>o.textContent)"),['January 2027','December 2026','November 2026']);
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£23.75');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#monthItems input')].every(el=>!el.checked)"),true);
    assert.equal(await page.evaluate('records.length'),2);
    const december=(await stored(page)).find(m=>m.month==='2026-12');
    assert.equal(december.payments.length,2);
    assert.equal(december.payments.every(p=>!p.paid),true);
    await page.evaluate("records[0].overrides['2027-01-20']=true;save().then(render)");
    await page.wait('pendingWrites===0');
    assert.deepEqual((await stored(page)).find(m=>m.month==='2026-12'),december);
    await select(page,'2026-11');
    assert.match(await page.evaluate("document.getElementById('history').textContent"),/Original name · £10.00 · Paid/);
    assert.match(await page.evaluate("document.getElementById('history').textContent"),/Automatic · £2.50 · Paid/);
    assert.doesNotMatch(await page.evaluate("document.getElementById('history').textContent"),/Changed name/);
    await advance(page,'2027-02-01');
    assert.deepEqual(await page.evaluate("[...document.getElementById('historyMonth').options].map(o=>o.value)"),['2027-02','2027-01','2026-12']);
    assert.deepEqual((await stored(page)).find(m=>m.month==='2026-11'),november);
    assert.equal((await stored(page)).find(m=>m.month==='2027-01').payments.find(p=>p.id==='Original name').paid,true);
    assert.equal(await page.evaluate('records.length'),2);
    assert.equal(await page.evaluate('new Set(records.map(r=>r.id)).size'),2);
    await page.evaluate('gate()');await unlock(page);
    await select(page,'2026-12');
    assert.match(await page.evaluate("document.getElementById('history').textContent"),/Changed name · £20.00 · Unpaid/);
    await page.evaluate('window.__historyReload=true');await page.send('Page.reload');
    await page.wait("typeof window.__historyReload==='undefined' && typeof historyRender==='function'");
    await unlock(page);
    assert.deepEqual((await stored(page)).find(m=>m.month==='2026-11'),november);
    assert.equal(await page.evaluate('records.length'),2);
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});

test('history is encrypted, included in backup, restored with the same PIN, and old v2 backups remain usable',async()=>{
  const page=await browser({initScript:clock});
  try{
    await seed(page,[bill('Synthetic archive bill',1234,'2026-11-10','manual',{'2026-11-10':true})]);
    await advance(page,'2026-12-01');
    const archived=(await stored(page)).find(m=>m.month==='2026-11');
    const historyCipher=await page.evaluate('localStorage.getItem(HISTORY)');
    assert.doesNotMatch(historyCipher,/Synthetic archive bill|2026-11-10/);
    const backup=await page.evaluate(`(async()=>{let blob;const make=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{blob=b;return make(b)};HTMLAnchorElement.prototype.click=()=>{};try{document.getElementById('export').click();return await blob.text()}finally{URL.createObjectURL=make;HTMLAnchorElement.prototype.click=click}})()`);
    assert.ok(JSON.parse(backup).paymentHistory.cipher);
    await page.evaluate("historyMonths=[];records=[];save().then(render)");await page.wait('pendingWrites===0');
    await page.evaluate(`(async()=>{window.confirm=()=>true;await document.getElementById('restoreFile').onchange({target:{files:[{size:100,text:async()=>${JSON.stringify(backup)}}],value:'x'}})})()`);
    assert.equal(await page.evaluate('records.length'),1);
    assert.deepEqual((await stored(page)).find(m=>m.month==='2026-11'),archived);
    // Main v2 envelope is still the original bill array; older backups have no sidecar.
    const oldBackup=await page.evaluate('localStorage.getItem(VAULT)');
    await page.evaluate(`(async()=>{await document.getElementById('restoreFile').onchange({target:{files:[{size:100,text:async()=>${JSON.stringify(oldBackup)}}],value:'x'}})})()`);
    assert.deepEqual((await stored(page)).find(m=>m.month==='2026-11'),archived);
    assert.equal(await page.evaluate('decrypt(JSON.parse(localStorage.getItem(VAULT)),secret).then(Array.isArray)'),true);
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});

test('weekly and month-end schedules have distinct snapshot dates without duplicating bill records',async()=>{
  const page=await browser({initScript:clock});
  try{
    await seed(page,[{...bill('Weekly',125,'2026-11-01'),frequency:'weekly'},bill('Month end',1000,'2026-10-31')]);
    const november=(await stored(page)).find(m=>m.month==='2026-11');
    assert.deepEqual(november.payments.filter(p=>p.id==='Weekly').map(p=>p.date),['2026-11-01','2026-11-08','2026-11-15','2026-11-22','2026-11-29']);
    assert.equal(november.payments.find(p=>p.id==='Month end').date,'2026-11-30');
    await advance(page,'2026-12-01');
    const december=(await stored(page)).find(m=>m.month==='2026-12');
    assert.equal(december.payments.find(p=>p.id==='Month end').date,'2026-12-31');
    assert.equal(december.payments.every(p=>!p.paid),true);
    assert.equal(await page.evaluate('records.length'),2);
    await page.evaluate('refreshHistory().then(render)');await page.wait('pendingWrites===0');
    assert.equal((await stored(page)).filter(m=>m.month==='2026-12').length,1);
    assert.equal(await page.evaluate('records.length'),2);
  }finally{await page.close()}
});


test('a payment tick on a still-visible row at midnight is saved to its original month',async()=>{
  const page=await browser({initScript:clock});
  try{
    await seed(page,[bill('Midnight payment',1000,'2026-11-10')]);
    await page.evaluate("document.getElementById('monthPayments').open=true;localStorage.setItem('test-history-date','2026-12-01');document.querySelector('#monthItems input').click()");
    await page.wait("pendingWrites===0 && historyCurrent==='2026-12'");
    const months=await stored(page);
    assert.equal(months.find(m=>m.month==='2026-11').payments[0].paid,true);
    assert.equal(months.find(m=>m.month==='2026-12').payments[0].paid,false);
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£10.00');
    await page.evaluate('gate()');await unlock(page);
    await select(page,'2026-11');
    assert.match(await page.evaluate("document.getElementById('history').textContent"),/Midnight payment · £10.00 · Paid/);
    assert.equal(await page.evaluate('records.length'),1);
  }finally{await page.close()}
});
