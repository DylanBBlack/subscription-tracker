'use strict';
// Updates are opt-in so a replacement cannot interrupt editing or encrypted writes.
if ('serviceWorker' in navigator && window.isSecureContext) {
  let registration, reloadRequested=false;
  const notice=document.getElementById('updateNotice');
  const button=document.getElementById('applyUpdate');
  function offerUpdate(){
    if(registration.waiting && registration.active && navigator.serviceWorker.controller)notice.hidden=false;
  }
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(reloadRequested)location.reload();
  });
  button.onclick=()=>{
    if(document.getElementById('editor').open || pendingWrites){
      alert('Save or cancel your changes before updating.');
      return;
    }
    reloadRequested=true;
    if(registration?.waiting){
      button.disabled=true;
      registration.waiting.postMessage({type:'SKIP_WAITING'});
    }else location.reload();
  };
  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{
    registration=reg;
    offerUpdate();
    function watchInstalling(){
      const worker=reg.installing;
      if(worker)worker.addEventListener('statechange',()=>{
        if(worker.state==='installed')offerUpdate();
      });
    }
    reg.addEventListener('updatefound',watchInstalling);
    watchInstalling();
    const check=()=>reg.update().then(offerUpdate).catch(()=>{});
    window.addEventListener('focus',check);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
    setInterval(()=>{if(!document.hidden)check()},60*60*1000);
    check();
  }).catch(()=>{}); // Offline startup still unlocks the local vault.
}
