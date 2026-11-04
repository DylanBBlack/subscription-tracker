import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browser} from './browser.mjs';

function contrast(a,b){
  const luminance=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const values=[luminance(a),luminance(b)].sort((a,b)=>b-a);
  return (values[0]+.05)/(values[1]+.05);
}
async function unlock(page){
  await page.evaluate("document.getElementById('pin').value='123456';document.getElementById('gateForm').requestSubmit()");
  await page.wait("!document.getElementById('app').hidden && pendingWrites===0");
}
async function tap(page,selector){
  const point=await page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
}

test('settings exposes bill tools and four persistent accessible themes without changing the vault',async()=>{
  const page=await browser();
  try{
    await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'forest');
    assert.equal(await page.evaluate("getComputedStyle(document.documentElement).backgroundColor"),'rgb(23, 33, 29)');
    await unlock(page);
    for(const id of ['add','import','export','restore']){
      assert.equal(await page.evaluate(`document.getElementById('${id}').closest('dialog')?.id`),'settings');
      assert.equal(await page.evaluate(`document.getElementById('${id}').getClientRects().length`),0);
    }
    await tap(page,'#openSettings');
    assert.equal(await page.evaluate("document.getElementById('settings').open"),true);
    assert.equal(await page.evaluate("document.querySelectorAll('#settings input[name=theme]').length"),4);
    await tap(page,'#add');
    assert.equal(await page.evaluate("document.getElementById('settings').open"),false);
    assert.equal(await page.evaluate("document.getElementById('editor').open"),true);
    await page.evaluate("const f=document.getElementById('form').elements;f.name.value='Synthetic settings bill';f.amount.value='12.34';document.getElementById('form').requestSubmit()");
    await page.wait("!document.getElementById('editor').open && pendingWrites===0");
    const vault=await page.evaluate("localStorage.getItem('bills-encrypted-v2')");
    await tap(page,'#openSettings');
    const backup=await page.evaluate(`(async()=>{
      let savedBlob;
      const originalURL=URL.createObjectURL,originalClick=HTMLAnchorElement.prototype.click;
      URL.createObjectURL=blob=>{savedBlob=blob;return originalURL(blob)};
      HTMLAnchorElement.prototype.click=()=>{};
      try{document.getElementById('export').click();return await savedBlob.text()}
      finally{URL.createObjectURL=originalURL;HTMLAnchorElement.prototype.click=originalClick}
    })()`);
    assert.equal(backup,vault);
    for(const [action,input] of [['import','importFile'],['restore','restoreFile']]){
      await page.evaluate(`document.getElementById('${input}').click=()=>window.__picked='${input}'`);
      await tap(page,'#'+action);
      assert.equal(await page.evaluate('window.__picked'),input);
      assert.equal(await page.evaluate("document.getElementById('settings').open"),false);
      await tap(page,'#openSettings');
    }
    for(const [theme,background] of [['emerald','#171c1a'],['forest','#17211d'],['olive','#23251f'],['sage','#202423']]){
      await tap(page,`input[name=theme][value=${theme}]`);
      assert.equal(await page.evaluate('document.documentElement.dataset.theme'),theme);
      assert.equal(await page.evaluate("localStorage.getItem('subscription-tracker-theme-v1')"),theme);
      assert.equal(await page.evaluate("document.querySelector('meta[name=theme-color]').content"),background);
      assert.equal(await page.evaluate("document.querySelectorAll('input[name=theme]:checked').length"),1);
      const colours=await page.evaluate(`(()=>{const root=getComputedStyle(document.documentElement),panel=getComputedStyle(document.querySelector('.panel')),button=getComputedStyle(document.getElementById('add')),muted=getComputedStyle(document.querySelector('.panel small'));return {text:root.color,bg:root.backgroundColor,panel:panel.backgroundColor,muted:muted.color,buttonText:button.color,button:button.backgroundColor}})()`);
      for(const [fg,bg] of [[colours.text,colours.bg],[colours.text,colours.panel],[colours.muted,colours.panel],[colours.buttonText,colours.button]]){
        assert.ok(contrast(fg,bg)>=4.5,`${theme} text contrast ${contrast(fg,bg)}`);
      }
      assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    }
    // Locking while a settings dialog is open must close the top-layer dialog.
    await page.evaluate('gate()');
    assert.equal(await page.evaluate("document.getElementById('settings').open"),false);
    assert.equal(await page.evaluate("document.querySelectorAll('dialog[open]').length"),0);
    await page.evaluate("window.__themeReload=true");await page.send('Page.reload');
    await page.wait("typeof window.__themeReload==='undefined' && typeof render==='function'");
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'sage');
    assert.equal(await page.evaluate("document.getElementById('gate').hidden"),false);
    assert.equal(await page.evaluate("document.querySelector('input[name=theme][value=sage]').checked"),true);
    await unlock(page);
    assert.equal(await page.evaluate('records[0].name'),'Synthetic settings bill');
    assert.equal(await page.evaluate("localStorage.getItem('bills-encrypted-v2')"),vault);
    // A second phone/profile at the same URL retains its own appearance and data.
    const other=await browser({url:page.origin+'/tracker/'});
    try{
      assert.equal(await other.evaluate('document.documentElement.dataset.theme'),'forest');
      assert.equal(await other.evaluate("localStorage.getItem('bills-encrypted-v2')"),null);
    }finally{await other.close()}
    assert.deepEqual(page.errors,[]);
  }finally{await page.close()}
});

test('invalid and blocked theme preferences fall back without preventing PIN setup',async()=>{
  const page=await browser({initScript:"localStorage.setItem('subscription-tracker-theme-v1','not-a-theme')"});
  try{
    assert.equal(await page.evaluate('document.documentElement.dataset.theme'),'forest');
    await unlock(page);
    assert.equal(await page.evaluate('records.length'),0);
  }finally{await page.close()}
  const blocked=await browser({initScript:`
    const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;
    Storage.prototype.getItem=function(key){if(key==='subscription-tracker-theme-v1')throw Error('Blocked preference');return originalGet.call(this,key)};
    Storage.prototype.setItem=function(key,value){if(key==='subscription-tracker-theme-v1')throw Error('Blocked preference');return originalSet.call(this,key,value)};
  `});
  try{
    assert.equal(await blocked.evaluate('document.documentElement.dataset.theme'),'forest');
    await unlock(blocked);
    await blocked.evaluate("document.getElementById('openSettings').click();document.querySelector('input[value=olive]').click()");
    assert.equal(await blocked.evaluate('document.documentElement.dataset.theme'),'olive');
    assert.match(await blocked.evaluate("document.getElementById('themeStatus').textContent"),/this session/);
    assert.deepEqual(blocked.errors,[]);
  }finally{await blocked.close()}
});
