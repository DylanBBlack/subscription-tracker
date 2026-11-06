import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';
const fixed=`const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[2026,10,6,12]))}static now(){return new OriginalDate(2026,10,6,12).getTime()}};`;
const record=(id,start,mode='manual',amountPence=100,frequency='monthly',overrides={})=>({id,name:id,start,mode,amountPence,frequency,overrides});

test('unpaid card opens only current-month unpaid occurrences and supports paying, editing and deletion',async()=>{
  const page=await browser({initScript:fixed});
  try{
    const bills=[record('overdue','2026-10-02'),record('today','2026-11-06'),record('later','2026-11-20'),record('next-month','2026-12-01'),record('automatic-paid','2026-11-01','auto'),record('explicit-paid','2026-11-08','manual',100,'monthly',{'2026-11-08':true}),record('unknown',''),record('weekly','2026-11-01','manual',25,'weekly')];
    await page.evaluate(`(async()=>{records=${JSON.stringify(bills)};secret='123456';await save();gate();document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()})()`);
    await page.wait("!document.getElementById('app').hidden && pendingWrites===0");
    const initialVault=await page.evaluate("localStorage.getItem('bills-encrypted-v2')");
    assert.equal(await page.evaluate("document.getElementById('unpaidDialog').open"),false);
    // Open the card with the keyboard, as well as using its normal button semantics.
    await page.evaluate("document.getElementById('openUnpaid').focus()");
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await page.evaluate("document.getElementById('unpaidDialog').open"),true);
    assert.deepEqual(await page.evaluate("[...document.querySelectorAll('#items strong')].map(el=>el.textContent).sort()"),['later','overdue','today','weekly','weekly','weekly','weekly','weekly'].sort());
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£4.25');
    assert.equal(await page.evaluate("document.getElementById('unpaidDialogTotal').textContent"),'£4.25');
    assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),initialVault);
    await page.evaluate("[...document.querySelectorAll('#items .item')].find(el=>el.querySelector('strong').textContent==='today').querySelector('input').click()");
    await page.wait('pendingWrites===0');
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£3.25');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#items strong')].some(el=>el.textContent==='today')"),false);
    assert.equal(await page.evaluate("document.getElementById('unpaidDialog').open"),true);
    await page.evaluate("[...document.querySelectorAll('#items .item')].find(el=>el.querySelector('strong').textContent==='later').querySelector('button.alt').click()");
    assert.equal(await page.evaluate("document.getElementById('unpaidDialog').open"),false);
    assert.equal(await page.evaluate("document.getElementById('editor').open"),true);
    await page.evaluate("document.getElementById('form').elements.amount.value='2.00';document.getElementById('form').requestSubmit()");
    await page.wait("!document.getElementById('editor').open && document.getElementById('unpaidDialog').open && pendingWrites===0");
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£4.25');
    await page.evaluate("[...document.querySelectorAll('#items .item')].find(el=>el.querySelector('strong').textContent==='later').querySelector('button.alt').click();document.getElementById('cancel').click()");
    await page.wait("document.getElementById('unpaidDialog').open");
    // Moving the occurrence into next month removes it from this month's dialog.
    await page.evaluate("[...document.querySelectorAll('#items .item')].find(el=>el.querySelector('strong').textContent==='later').querySelector('button.alt').click();document.getElementById('form').elements.start.value='2026-12-20';document.getElementById('form').requestSubmit()");
    await page.wait("document.getElementById('unpaidDialog').open && pendingWrites===0");
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£2.25');
    await page.evaluate("window.confirm=()=>true;[...document.querySelectorAll('#items .item')].find(el=>el.querySelector('strong').textContent==='overdue').querySelector('.danger').click()");
    await page.wait('pendingWrites===0');
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£1.25');
    // Mark each remaining weekly occurrence paid; the dialog stays useful when empty.
    for(let i=0;i<5;i++){
      await page.evaluate("document.querySelector('#items input').click()");
      await page.wait('pendingWrites===0');
    }
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£0.00');
    assert.match(await page.evaluate("document.getElementById('items').textContent"),/No unpaid payments/);
    await page.evaluate('gate()');
    assert.equal(await page.evaluate("document.querySelectorAll('dialog[open]').length"),0);
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});

test('unpaid dates respect local calendar month boundaries in different time zones',async()=>{
  const page=await browser({initScript:fixed});
  try{
    for(const timezoneId of ['Europe/London','America/Los_Angeles','Pacific/Auckland']){
      await page.send('Emulation.setTimezoneOverride',{timezoneId});
      await page.evaluate(`records=[${JSON.stringify(record('first','2026-11-01'))},${JSON.stringify(record('last','2026-11-30'))},${JSON.stringify(record('outside','2026-12-01'))}];render()`);
      assert.deepEqual(await page.evaluate("[...document.querySelectorAll('#items strong')].map(el=>el.textContent)"),['first','last']);
      assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£2.00');
    }
  }finally{await page.close()}
});
