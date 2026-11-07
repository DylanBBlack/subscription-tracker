'use strict';
// The existing bill vault remains a v2 array. Snapshots use a separate encrypted
// v2 array under the same PIN, so old bills/backups need no destructive migration.
const HISTORY='bills-history-encrypted-v1';
let historyMonths=[],historySelection=null,historyCurrent=null,writeQueue=Promise.resolve();
const monthKey=d=>iso(d).slice(0,7);
function recentHistoryMonths(now=new Date()){
  return Array.from({length:3},(_,i)=>monthKey(new Date(now.getFullYear(),now.getMonth()-i,1,12)));
}
function monthBounds(key){
  const [y,m]=key.split('-').map(Number);
  return [new Date(y,m-1,1,12),new Date(y,m,0,12)];
}
function validHistory(months){
  return Array.isArray(months)&&new Set(months.map(m=>m?.month)).size===months.length&&months.every(m=>
    m&&/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month)&&Array.isArray(m.payments)&&m.payments.every(p=>
      p&&typeof p.id==='string'&&typeof p.name==='string'&&Number.isSafeInteger(p.amountPence)&&p.amountPence>=0&&
      typeof p.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&p.date.slice(0,7)===m.month&&typeof p.paid==='boolean'&&typeof p.automatic==='boolean'));
}
async function loadHistory(pin){
  const stored=localStorage.getItem(HISTORY);
  const candidate=stored?await decrypt(JSON.parse(stored),pin):[];
  if(!validHistory(candidate))throw Error('Invalid encrypted payment history');
  historyMonths=candidate;
  historySelection=null;historyCurrent=null;
}
function snapshotMonth(key,reconstructed=false){
  const [first,last]=monthBounds(key);
  return {month:key,reconstructed,finalized:key<monthKey(new Date()),payments:records.flatMap(r=>
    occurrences(r,first,last).map(date=>({id:String(r.id),name:r.name,amountPence:r.amountPence,date,
      paid:paid(r,date),automatic:r.mode==='auto'&&r.overrides?.[date]==null})))};
}
function recordHistoryOverride(id,date,value){
  // A click on a still-visible row at midnight belongs to that row's own month.
  const payment=historyMonths.find(m=>m.month===date.slice(0,7))?.payments.find(p=>p.id===String(id)&&p.date===date);
  if(payment){payment.paid=value;payment.automatic=false}
}
function syncHistory(){
  const current=monthKey(new Date());
  // Complete automatic dates using their captured mode, never today's edited bill.
  for(const month of historyMonths){
    if(month.month<current&&!month.finalized){
      for(const payment of month.payments)if(payment.automatic)payment.paid=true;
      month.finalized=true;
    }
  }
  for(const key of recentHistoryMonths()){
    const index=historyMonths.findIndex(m=>m.month===key);
    if(index<0)historyMonths.push(snapshotMonth(key,key!==current));
    else if(key===current)historyMonths[index]=snapshotMonth(key);
  }
  // Older months are deliberately retained, not pruned.
}
function persistBillsAndHistory(writeBills=true){
  if(!secret)return Promise.resolve();
  syncHistory();
  const pin=secret,bills=structuredClone(records),months=structuredClone(historyMonths);
  pendingWrites++;
  const operation=writeQueue.then(async()=>{
    const history=await encrypt(months,pin,crypto.getRandomValues(new Uint8Array(16)));
    const vault=writeBills?await encrypt(bills,pin,crypto.getRandomValues(new Uint8Array(16))):null;
    localStorage.setItem(HISTORY,JSON.stringify(history));
    if(vault)localStorage.setItem(VAULT,JSON.stringify(vault));
  }).finally(()=>{pendingWrites--});
  writeQueue=operation.catch(()=>{});
  return operation;
}
async function refreshHistory(){
  await persistBillsAndHistory(false);
}
function historyRender(){
  const current=monthKey(new Date()),keys=recentHistoryMonths();
  if(!keys.includes(historySelection)||historySelection===historyCurrent&&historyCurrent!==current)historySelection=current;
  historyCurrent=current;
  const selector=$('historyMonth');
  if(selector){
    selector.replaceChildren();
    for(const key of keys){
      const option=document.createElement('option');option.value=key;
      option.textContent=monthBounds(key)[0].toLocaleDateString('en-GB',{month:'long',year:'numeric'});
      selector.append(option);
    }
    selector.value=historySelection;
  }
  // Current rows stay in sync with the existing checklist. Historical rows are frozen.
  const month=historySelection===current?snapshotMonth(current):historyMonths.find(m=>m.month===historySelection);
  const info=$('historyInfo');
  if(info){
    info.hidden=!month?.reconstructed;
    info.textContent=month?.reconstructed?'Reconstructed from saved bills when history was enabled. Earlier edits and deleted bills cannot be recovered.':'';
  }
  $('history').replaceChildren();
  for(const payment of [...(month?.payments||[])].sort((a,b)=>b.date.localeCompare(a.date))){
    const p=document.createElement('p');p.className='muted';
    p.textContent=`${payment.date} · ${payment.name} · ${fmt(payment.amountPence)} · ${payment.paid?'Paid':'Unpaid'}`;
    $('history').append(p);
  }
  if(!month?.payments.length)$('history').textContent='No payments recorded for this month.';
}
document.addEventListener('DOMContentLoaded',()=>{
  if($('historyMonth'))$('historyMonth').onchange=e=>{historySelection=e.target.value;historyRender()};
});
// A visible app can cross a month boundary without being closed or refreshed.
setInterval(()=>{
  if(typeof locked!=='undefined'&&!locked&&historyCurrent!==monthKey(new Date())){
    refreshHistory().then(()=>{if(!locked)render()}).catch(()=>show('Could not save payment history. Export a backup before closing the app.'));
  }
},60000);
