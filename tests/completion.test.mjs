import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';

test('past automatic payments visibly tick, while manual, today and future payments stay due',async()=>{
  const page=await browser({initScript:`
    const RealDate=Date;
    window.Date=class extends RealDate{
      constructor(...args){super(...(args.length?args:[2026,10,3,12]))}
      static now(){return new RealDate(2026,10,3,12).getTime()}
    };
  `});
  try{
    const bills=[
      ['Past automatic','2026-11-02','auto',{}],
      ['Today automatic','2026-11-03','auto',{}],
      ['Future automatic','2026-11-04','auto',{}],
      ['Past manual','2026-11-02','manual',{}],
      ['Explicit unpaid','2026-11-02','auto',{'2026-11-02':false}],
      ['Explicit paid','2026-11-04','manual',{'2026-11-04':true}],
      ['Unknown date','','auto',{}]
    ].map(([name,start,mode,overrides],i)=>({id:String(i),name,start,mode,overrides,amountPence:100,frequency:'monthly'}));
    await page.evaluate(`(async()=>{records=${JSON.stringify(bills)};secret='123456';await save();gate()})()`);
    await page.evaluate("document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");
    await page.wait("!document.getElementById('app').hidden");
    const vault=await page.evaluate("localStorage.getItem('bills-encrypted-v2')");
    assert.deepEqual(await page.evaluate(`Object.fromEntries([...document.querySelectorAll('#monthItems .item')].map(el=>[el.querySelector('strong').textContent,el.querySelector('input').checked]))`),{
      'Past automatic':true,'Today automatic':false,'Future automatic':false,
      'Past manual':false,'Explicit unpaid':false,'Explicit paid':true
    });
    assert.match(await page.evaluate("document.querySelector('#monthItems .item small').textContent"),/Paid automatically/);
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£4.00');
    assert.equal(await page.evaluate("[...document.querySelectorAll('#items .item')].find(el=>el.querySelector('strong').textContent==='Past automatic').querySelector('input').checked"),false);
    assert.equal(await page.evaluate("document.querySelector('#needs strong').textContent"),'Unknown date');
    // Rendering and automatic completion do not rewrite the encrypted records.
    assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
    assert.deepEqual(await page.evaluate('records'),bills);
    // A manual override from this month's visible occurrence survives relocking.
    await page.evaluate("document.querySelector('#monthItems input').click()");
    await page.wait('pendingWrites===0');
    assert.equal(await page.evaluate("document.getElementById('unpaid').textContent"),'£5.00');
    await page.evaluate("gate();document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");
    await page.wait("!document.getElementById('app').hidden");
    assert.equal(await page.evaluate("document.querySelector('#monthItems input').checked"),false);
    assert.equal(await page.evaluate("records[0].overrides['2026-11-02']"),false);
    // A cached HTML shell without the new section still renders its existing lists.
    await page.evaluate("document.getElementById('monthItems').remove();render()");
    assert.equal(await page.evaluate("document.querySelectorAll('#items .item').length"),6);
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});
