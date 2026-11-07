import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';

export async function browser({url:initialUrl,legacyApp=false,initScript}={}){
  const root=new URL('../',import.meta.url);
  let offline=false,release='';
  const server=createServer(async(req,res)=>{
    if(offline){res.destroy();return}
    const path=new URL(req.url,'http://localhost').pathname.replace(/^\/tracker\//,'');
    if(path.includes('..')){res.writeHead(404).end();return}
    try{
      let body=await readFile(new URL(path||'index.html',root));
      if(path==='app.js'&&legacyApp)body=body.toString().replace('let pendingWrites=0;\n','').replace('pendingWrites++;try{','').replace('}finally{pendingWrites--}}','}');
      if(path==='sw.js'&&release)body=body.toString().replace(/subscription-tracker-[a-f0-9]+/,`subscription-tracker-${release}`);
      const type=path.endsWith('.js')?'text/javascript':path.endsWith('.ttf')?'font/ttf':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.webmanifest')?'application/manifest+json':'text/html';
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'}).end(body);
    }catch{res.writeHead(404).end()}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const dir=await mkdtemp(join(tmpdir(),'bills-browser-'));
  const child=spawn(process.env.CHROMIUM||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--no-proxy-server','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let stderr='';
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Chromium startup timed out: '+stderr)),15000);
    child.once('error',reject);
    child.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1])}});
  });
  const ws=new WebSocket(endpoint);await once(ws,'open');
  let id=0,session;const pending=new Map(),errors=[];
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data);
    if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p.reject(Error(msg.error.message));else p.resolve(msg.result)}
    if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails);
  });
  function send(method,params={},withSession=true){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,...(withSession&&session?{sessionId:session}:{})}))})}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  session=(await send('Target.attachToTarget',{targetId,flatten:true},false)).sessionId;
  await send('Runtime.enable');await send('Page.enable');
  if(initScript)await send('Page.addScriptToEvaluateOnNewDocument',{source:initScript});
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
  async function wait(expression){const end=Date.now()+15000;while(Date.now()<end){try{if(await evaluate(expression))return}catch{}await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Timed out: '+expression)}
  await send('Page.navigate',{url:initialUrl||origin+'/tracker/'});await wait("typeof render==='function' && typeof historyRender==='function'");
  return {evaluate,wait,send,errors,origin,setOffline:value=>{offline=value},setRelease:value=>{release=value},close:async()=>{ws.close();child.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}};
}
