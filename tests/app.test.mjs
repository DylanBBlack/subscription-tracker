import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {browser} from './browser.mjs';
let page;
before(async()=>{page=await browser({initScript:`const OriginalDate=Date;window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[2026,10,3,12]))}static now(){return new OriginalDate(2026,10,3,12).getTime()}};`})});
after(async()=>{await page?.close()});
const bill=(i,start='')=>({id:`bill-${i}`,name:`Example bill ${i}`,amountPence:i*100,frequency:'monthly',start,mode:'auto',overrides:{}});
// Independent v2 writer verifies compatibility with existing vaults, not just a round trip.
async function oldVault(records){
  const salt=webcrypto.getRandomValues(new Uint8Array(16)),iv=webcrypto.getRandomValues(new Uint8Array(12));
  const material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode('123456'),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
  const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(records)));
  const b64=v=>Buffer.from(v).toString('base64');
  return {version:2,salt:b64(salt),iv:b64(iv),cipher:b64(cipher)};
}
async function submit(id){await page.evaluate(`document.getElementById('${id}').requestSubmit()`)}
async function unlock(){await page.evaluate("document.getElementById('pin').value='123456'");await submit('gateForm');await page.wait("!document.getElementById('app').hidden && !document.getElementById('gateButton').disabled")}

test('integer pence calculations and annual equivalents',async()=>{
  assert.deepEqual(await page.evaluate("totals([{amountPence:10000,frequency:'monthly'},{amountPence:6000,frequency:'monthly'},{amountPence:343,frequency:'monthly'}])"),{monthly:16343,annual:196116});
  assert.deepEqual(await page.evaluate("totals([{amountPence:101,frequency:'weekly'},{amountPence:203,frequency:'quarterly'},{amountPence:305,frequency:'yearly'}])"),{monthly:531,annual:6369});
  assert.deepEqual(await page.evaluate("['£1.79','0.01','12.99','1.999','-1','bad'].map(moneyToPence)"),[179,1,1299,null,null,null]);
});
test('existing encrypted vault renders every blank-date bill, including extras, without rewriting it',async()=>{
  const bills=Array.from({length:10},(_,i)=>bill(i+1));bills.push({...bill(11),amountPence:1299});
  const vault=JSON.stringify(await oldVault(bills));
  await page.evaluate(`localStorage.setItem('bills-encrypted-v2',${JSON.stringify(vault)});gate()`);await unlock();
  assert.equal(await page.evaluate("document.querySelectorAll('#needs .item').length"),11);
  assert.equal(await page.evaluate("document.querySelectorAll('#needs .actions button.alt').length"),11);
  assert.equal(await page.evaluate("document.getElementById('total').textContent"),'£67.99');
  assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
  assert.deepEqual(await page.evaluate('records'),bills);
  await page.evaluate("document.querySelector('#needs button').click()");
  assert.deepEqual(await page.evaluate("[document.getElementById('editor').open,document.getElementById('form').elements.start.value]"),[true,'']);
  await page.evaluate("document.getElementById('form').elements.start.value='2026-11-15'");await submit('form');await page.wait("!document.getElementById('editor').open");
  assert.equal(await page.evaluate("document.querySelectorAll('#needs .item').length"),10);
  assert.equal(await page.evaluate("document.querySelectorAll('#items .item').length"),1);
  assert.equal(await page.evaluate("records[0].start"),'2026-11-15');
  assert.equal(await page.evaluate("records[1].start"),'');
  await page.evaluate('gate()');await unlock();
  assert.equal(await page.evaluate("records[0].start"),'2026-11-15');
});
test('edit, completion, history, calendar and explicitly confirmed deletion preserve other records',async()=>{
  await page.evaluate("document.querySelector('#items button').click();document.getElementById('form').elements.amount.value='2.25';document.getElementById('form').elements.mode.value='manual'");
  await submit('form');await page.wait("!document.getElementById('editor').open");
  assert.equal(await page.evaluate('records[0].amountPence'),225);
  await page.evaluate("document.querySelector('#items input').click()");await page.wait('pendingWrites===0');
  assert.equal(await page.evaluate("Object.values(records[0].overrides).includes(true)"),true);
  await page.evaluate("cal=parse('2026-11-01');calendarRender()");
  assert.equal(await page.evaluate("document.querySelectorAll('#calendar .hit').length"),1);
  // Only user confirmation removes an extra record.
  await page.evaluate("window.confirm=()=>true;document.querySelector('#needs .item:last-child .danger').click()");await page.wait('pendingWrites===0');
  assert.equal(await page.evaluate('records.length'),10);
  assert.equal(await page.evaluate("records.some(r=>r.id==='bill-11')"),false);
  assert.equal(await page.evaluate("document.querySelectorAll('#needs .item').length+document.querySelectorAll('#monthItems .item').length"),10);
  await page.evaluate("records[0].start='2026-01-15';render()");
  assert.ok(await page.evaluate("document.getElementById('history').children.length>0"));
});
test('CSV skips duplicates in the vault and within the same import, retaining blank dates',async()=>{
  const result=await page.evaluate(`(async()=>{window.confirm=()=>true;const input=document.getElementById('importFile');await input.onchange({target:{files:[{size:200,text:async()=> 'Name,Amount\\n EXAMPLE BILL 2 ,2.00\\nNew synthetic bill,3.21\\nnew synthetic bill,3.21'}],value:'x'}});return {count:records.length,added:records.filter(r=>r.name==='New synthetic bill'),message:document.getElementById('message').textContent}})()`);
  assert.equal(result.count,11);assert.equal(result.added.length,1);assert.equal(result.added[0].start,'');assert.match(result.message,/skipped 2 duplicates/);
});
test('encrypted backup restore retains records and remains decryptable with the same PIN',async()=>{
  const original=await page.evaluate('records');const vault=await page.evaluate("localStorage.getItem('bills-encrypted-v2')");
  await page.evaluate(`(async()=>{window.confirm=()=>true;await document.getElementById('restoreFile').onchange({target:{files:[{size:100,text:async()=>${JSON.stringify(vault)}}],value:'x'}})})()`);
  // The prior test persisted all records; backup restores those exact data.
  assert.deepEqual(await page.evaluate('records'),original);
  await page.evaluate('gate()');await unlock();assert.deepEqual(await page.evaluate('records'),original);
});
test('empty vault stays empty on unlock; a separate browser profile at the same origin starts without records',async()=>{
  const vault=JSON.stringify(await oldVault([]));await page.evaluate(`localStorage.setItem('bills-encrypted-v2',${JSON.stringify(vault)});gate()`);await unlock();
  assert.equal(await page.evaluate('records.length'),0);assert.equal(await page.evaluate("document.getElementById('total').textContent"),'£0.00');
  await page.evaluate('gate()');await unlock();assert.equal(await page.evaluate('records.length'),0);
  const other=await browser({url:page.origin+'/tracker/'});try{assert.equal(await other.evaluate("localStorage.getItem('bills-encrypted-v2')"),null)}finally{await other.close()}
  assert.deepEqual(page.errors,[]);
});

test('legacy localStorage migrates to the same v2 vault with blank dates and no seeded records',async()=>{
  await page.evaluate("localStorage.removeItem('bills-encrypted-v2');localStorage.setItem('private-subscriptions-v1',JSON.stringify([{id:'legacy',name:'Legacy synthetic bill',amount:1.79,frequency:'monthly',start:''}]));gate()");
  await unlock();
  assert.equal(await page.evaluate('records.length'),1);
  assert.equal(await page.evaluate('records[0].amountPence'),179);
  assert.equal(await page.evaluate('records[0].start'),'');
  assert.equal(await page.evaluate("localStorage.getItem('private-subscriptions-v1')"),null);
  const vault=await page.evaluate("localStorage.getItem('bills-encrypted-v2')");
  await page.evaluate("gate();document.getElementById('pin').value='654321';document.getElementById('gateForm').requestSubmit()");
  await page.wait("!document.getElementById('gateButton').disabled");
  assert.equal(await page.evaluate("document.getElementById('app').hidden"),true);
  assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
  await unlock();assert.equal(await page.evaluate('records.length'),1);
});
