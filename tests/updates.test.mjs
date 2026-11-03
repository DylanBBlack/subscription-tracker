import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';

test('PWA offers a waiting update, protects edits, retains the encrypted vault and works offline',async()=>{
  const page=await browser();
  try{
    await page.wait('!!navigator.serviceWorker.controller');
    assert.equal(await page.evaluate("document.getElementById('updateNotice').hidden"),true);
    await page.evaluate("document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");
    await page.wait("!document.getElementById('app').hidden && pendingWrites===0");
    await page.evaluate("document.getElementById('add').click();const f=document.getElementById('form').elements;f.name.value='Synthetic update record';f.amount.value='4.56';document.getElementById('form').requestSubmit()");
    await page.wait("!document.getElementById('editor').open && pendingWrites===0");
    const vault=await page.evaluate("localStorage.getItem('bills-encrypted-v2')");
    await page.evaluate("Promise.all([caches.open('unrelated-app-cache'),caches.open('subscription-tracker-v3')])");
    page.setRelease('test-next-release');
    await page.evaluate("navigator.serviceWorker.getRegistration().then(r=>r.update())");
    await page.wait("!document.getElementById('updateNotice').hidden");
    await page.wait("navigator.serviceWorker.getRegistration().then(r=>r.waiting?.state==='installed')");
    // A waiting update is offered again after reopening the app, even while locked.
    await page.evaluate('window.__reopen=true');await page.send('Page.reload');
    await page.wait("typeof window.__reopen==='undefined' && typeof render==='function' && !document.getElementById('updateNotice').hidden");
    assert.equal(await page.evaluate("document.getElementById('app').hidden"),true);
    await page.evaluate("window.__beforeUpdate=true;window.alert=message=>window.__alert=message;document.getElementById('add').click();document.getElementById('applyUpdate').click()");
    assert.match(await page.evaluate('window.__alert'),/Save or cancel/);
    assert.equal(await page.evaluate('window.__beforeUpdate'),true);
    assert.equal(await page.evaluate("navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)"),true);
    await page.evaluate("document.getElementById('cancel').click();pendingWrites=1;document.getElementById('applyUpdate').click()");
    assert.equal(await page.evaluate('window.__beforeUpdate'),true);
    await page.evaluate("pendingWrites=0;document.getElementById('applyUpdate').click()");
    await page.wait("typeof window.__beforeUpdate==='undefined' && typeof render==='function'");
    await page.wait("navigator.serviceWorker.getRegistration().then(r=>r.active?.state==='activated')");
    assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
    const keys=await page.evaluate('caches.keys()');
    assert.ok(keys.includes('unrelated-app-cache'));assert.ok(keys.includes('subscription-tracker-test-next-release'));assert.ok(!keys.includes('subscription-tracker-v3'));
    page.setOffline(true);
    await page.evaluate('window.__offlineReload=true');await page.send('Page.reload',{ignoreCache:true});
    await page.wait("typeof window.__offlineReload==='undefined' && typeof render==='function'");
    await page.evaluate("document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");
    await page.wait("!document.getElementById('app').hidden");
    assert.equal(await page.evaluate("document.querySelector('#needs strong').textContent"),'Synthetic update record');
    assert.equal(await page.evaluate("document.getElementById('total').textContent"),'£4.56');
    assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
    // iPhone-sized viewport: rows and actions stay within the document width.
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
    assert.equal(await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});
