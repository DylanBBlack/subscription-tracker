'use strict';
// This script can be served beside an older cached app during the first upgrade.
if ('serviceWorker' in navigator && window.isSecureContext) {
  let registration,attempt=null;
  const notice=document.getElementById('updateNotice');
  const message=notice.querySelector('span');
  const button=document.getElementById('applyUpdate');
  function busy(){
    return !!document.querySelector('dialog[open]') ||
      (typeof pendingWrites!=='undefined' && pendingWrites>0) ||
      document.getElementById('gateButton')?.disabled;
  }
  function offerUpdate(){
    if(registration.waiting && registration.active && navigator.serviceWorker.controller)notice.hidden=false;
  }
  function clearAttempt(){
    if(!attempt)return;
    clearTimeout(attempt.timeout);
    clearInterval(attempt.poll);
    attempt.worker.removeEventListener('statechange',checkActivation);
    attempt=null;
  }
  function retry(text){
    clearAttempt();
    message.textContent=text;
    button.disabled=false;
    button.textContent='Retry update';
    notice.hidden=false;
  }
  function reload(){
    if(busy()){
      retry('The update is ready. Save or cancel your changes before updating.');
      return;
    }
    clearAttempt();
    location.reload();
  }
  function checkActivation(){
    if(!attempt)return;
    if(attempt.worker.state==='activated')reload();
    else if(attempt.worker.state==='redundant')retry('The update changed. Tap Retry update.');
  }
  // A missed controllerchange must not strand a Home Screen session.
  navigator.serviceWorker.addEventListener('controllerchange',checkActivation);
  button.onclick=()=>{
    if(busy()){
      alert('Save or cancel your changes before updating.');
      return;
    }
    if(attempt)return;
    const worker=registration?.waiting;
    if(!worker){reload();return} // Another window may already have activated it.
    button.disabled=true;
    button.textContent='Updating…';
    message.textContent='Installing the update…';
    attempt={worker};
    worker.addEventListener('statechange',checkActivation);
    attempt.poll=setInterval(checkActivation,500);
    attempt.timeout=setTimeout(()=>{
      checkActivation();
      if(attempt)retry('The update has not finished. Retry, or fully close the tracker and reopen it.');
    },12000);
    try{
      worker.postMessage({type:'SKIP_WAITING'});
      checkActivation();
    }catch{
      retry('The update could not start. Tap Retry update.');
    }
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
