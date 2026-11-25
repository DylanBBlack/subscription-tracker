'use strict';
let selectedInstalment=null,returnToInstalment=null,planBackToUnpaid=false,reminderPlans=[];
function isInstalment(r){return !!r?.instalments}
function buildInstalments(totalPence,count,start,frequency){
  const first=parse(start);
  if(!Number.isSafeInteger(totalPence)||totalPence<1||!Number.isInteger(count)||count<1||count>120||totalPence<count||
    !/^\d{4}-\d{2}-\d{2}$/.test(start)||iso(first)!==start||!['monthly','weekly','fortnightly'].includes(frequency))throw Error('Enter a valid total, first payment date and 1–120 payments (at least 1p each).');
  const base=Math.floor(totalPence/count);
  const schedule=Array.from({length:count},(_,i)=>({
    date:iso(frequency==='monthly'?addMonths(first,i):new Date(first.getFullYear(),first.getMonth(),first.getDate()+i*(frequency==='weekly'?7:14),12)),
    amountPence:i===count-1?totalPence-base*(count-1):base
  }));
  return {version:1,totalPence,count,schedule};
}
function validInstalments(r){
  try{
    const p=r.instalments;
    if(p.version!==1||!Array.isArray(p.schedule))return false;
    const expected=buildInstalments(p.totalPence,p.count,r.start,r.frequency);
    return p.schedule.length===expected.schedule.length&&p.schedule.every((entry,i)=>entry.date===expected.schedule[i].date&&entry.amountPence===expected.schedule[i].amountPence)&&r.amountPence===expected.schedule[0].amountPence;
  }catch{return false}
}
function paymentPence(r,date){return isInstalment(r)?r.instalments.schedule.find(p=>p.date===date)?.amountPence||0:r.amountPence}
function planBalance(r){
  const p=r.instalments;
  const paidPayments=p.schedule.filter(entry=>paid(r,entry.date));
  return {paidCount:paidPayments.length,paidPence:paidPayments.reduce((sum,entry)=>sum+entry.amountPence,0),remainingPence:p.totalPence-paidPayments.reduce((sum,entry)=>sum+entry.amountPence,0)};
}
function planRangePence(r,from,to){return occurrences(r,from,to).reduce((sum,date)=>sum+paymentPence(r,date),0)}
function finalPlanDueThisMonth(r){
  return isInstalment(r)&&r.instalments.schedule.at(-1).date.slice(0,7)===today().slice(0,7)&&!paid(r,r.instalments.schedule.at(-1).date);
}
function planExtra(r,date){
  const plan=r.instalments,balance=planBalance(r);
  const index=date?plan.schedule.findIndex(p=>p.date===date):plan.schedule.findIndex(p=>!paid(r,p.date));
  const number=index>=0?index+1:plan.count;
  const wrap=document.createElement('div');wrap.className='plan-extra';
  const circle=document.createElement('button');circle.type='button';circle.className='plan-progress';
  circle.style.setProperty('--plan-progress',`${balance.paidCount/plan.count*360}deg`);
  circle.setAttribute('aria-label',`View ${r.name}: payment ${number} of ${plan.count}, ${balance.paidCount} paid, ${fmt(balance.remainingPence)} remaining`);
  const face=document.createElement('span');face.className='plan-progress-face';
  const label=document.createElement('span');label.textContent=balance.paidCount===plan.count?'Complete':'Payment';
  const value=document.createElement('strong');value.textContent=`${number} of ${plan.count}`;
  face.append(label,value);circle.append(face);circle.onclick=()=>openInstalment(r.id);
  const copy=document.createElement('div');copy.className='plan-copy';
  const left=document.createElement('span');left.textContent=fmt(balance.remainingPence)+' left to pay';
  const end=document.createElement('small');end.textContent='Final payment '+parse(plan.schedule.at(-1).date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  copy.append(left,end);
  if(finalPlanDueThisMonth(r)){
    const reminder=document.createElement('button');reminder.type='button';reminder.className='alt plan-final';reminder.textContent='Final payment this month';reminder.onclick=()=>openInstalment(r.id);copy.append(reminder);
  }
  wrap.append(circle,copy);return wrap;
}
function clearInstalmentDialogs(){selectedInstalment=null;returnToInstalment=null;planBackToUnpaid=false;reminderPlans=[]}
function openInstalment(id,preserveReturn=false){
  if(locked)return;
  const r=records.find(record=>record.id===id&&isInstalment(record));if(!r)return;
  if(!preserveReturn)planBackToUnpaid=!!$('unpaidDialog')?.open;
  $('unpaidDialog')?.close();selectedInstalment=id;
  renderInstalmentDialog();if(!$('planDialog').open)$('planDialog').showModal();
}
function closeInstalment(){
  $('planDialog').close();selectedInstalment=null;
  const back=planBackToUnpaid;planBackToUnpaid=false;
  if(back&&!locked)$('unpaidDialog').showModal();
}
function renderInstalmentDialog(){
  const r=records.find(record=>record.id===selectedInstalment&&isInstalment(record));if(!r)return;
  const plan=r.instalments,balance=planBalance(r);
  $('planTitle').textContent=r.name;
  $('planSummary').textContent=`${plan.count} ${r.frequency} payments · ${balance.paidCount} paid`;
  $('planRemaining').textContent=fmt(balance.remainingPence);
  $('planDates').textContent='First payment '+parse(plan.schedule[0].date).toLocaleDateString('en-GB')+' · Final payment '+parse(plan.schedule.at(-1).date).toLocaleDateString('en-GB');
  $('planFinalNotice').hidden=!finalPlanDueThisMonth(r);
  $('planFinalNotice').textContent='The final payment is due this month on '+parse(plan.schedule.at(-1).date).toLocaleDateString('en-GB')+'.';
  $('planPayments').replaceChildren();
  plan.schedule.forEach((entry,i)=>{
    const item=document.createElement('div');item.className='item';
    const check=document.createElement('input');check.type='checkbox';check.checked=paid(r,entry.date);
    check.setAttribute('aria-label',`Mark payment ${i+1} of ${plan.count} for ${r.name} paid`);
    check.onchange=async()=>{r.overrides??={};r.overrides[entry.date]=check.checked;recordHistoryOverride(r.id,entry.date,check.checked);await save();render()};
    const detail=document.createElement('div');detail.className='detail';
    const title=document.createElement('strong');title.textContent=`Payment ${i+1} of ${plan.count}`;
    const status=document.createElement('small');status.textContent=parse(entry.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+' · '+(paid(r,entry.date)?(r.mode==='auto'&&entry.date<today()&&r.overrides?.[entry.date]==null?'Paid automatically':'Paid'):'Unpaid');
    detail.append(title,status);
    const amount=document.createElement('div');amount.className='amount';amount.textContent=fmt(entry.amountPence);
    item.append(check,detail,amount);$('planPayments').append(item);
  });
}
function renderInstalments(){
  const plans=records.filter(isInstalment);
  if($('plansSection')){
    $('plansSection').hidden=!plans.length;$('planItems').replaceChildren();
    for(const r of plans){const next=r.instalments.schedule.find(p=>!paid(r,p.date))||r.instalments.schedule.at(-1);$('planItems').append(row(r,next.date))}
  }
  if($('planBalances')){
    const ongoing=plans.filter(r=>planBalance(r).remainingPence>0);
    $('planBalances').hidden=!ongoing.length;$('planBalanceItems').replaceChildren();
    for(const r of ongoing){
      const item=document.createElement('div');item.className='item';
      const detail=document.createElement('div');detail.className='detail';
      const name=document.createElement('strong');name.textContent=r.name;
      detail.append(name,planExtra(r,null));item.append(detail);$('planBalanceItems').append(item);
    }
  }
  if($('planDialog')?.open)renderInstalmentDialog();
  // An in-app reminder appears once per plan in its final calendar month.
  setTimeout(maybeInstalmentReminder,0);
}
function maybeInstalmentReminder(){
  if(locked||pendingWrites||document.querySelector('dialog[open]'))return;
  const due=records.filter(r=>finalPlanDueThisMonth(r)&&r.instalments.reminderMonth!==today().slice(0,7));
  if(!due.length)return;
  reminderPlans=due.map(r=>r.id);$('planReminderItems').replaceChildren();
  for(const r of due){
    const item=document.createElement('div');item.className='item';
    const detail=document.createElement('div');detail.className='detail';
    const title=document.createElement('strong');title.textContent=r.name;
    const info=document.createElement('small');const final=r.instalments.schedule.at(-1);info.textContent=fmt(final.amountPence)+' due '+parse(final.date).toLocaleDateString('en-GB');detail.append(title,info);
    const view=document.createElement('button');view.type='button';view.className='alt';view.textContent='View payments';view.onclick=()=>acknowledgeInstalmentReminder(r.id);
    item.append(detail,view);$('planReminderItems').append(item);
  }
  $('planReminder').showModal();
}
async function acknowledgeInstalmentReminder(viewId=null){
  for(const id of reminderPlans){const r=records.find(record=>record.id===id);if(isInstalment(r))r.instalments.reminderMonth=today().slice(0,7)}
  await save();$('planReminder').close();reminderPlans=[];
  if(viewId&&!locked)openInstalment(viewId);
}
function configureInstalmentForm(){
  const f=$('form').elements,plan=f.recordType.value==='instalment';
  const old=records.find(r=>r.id===editing),protectedTerms=isInstalment(old)&&old.instalments.schedule.some(p=>paid(old,p.date));
  $('billAmountField').hidden=plan;$('planFields').hidden=!plan;
  f.amount.required=!plan;f.planTotal.required=plan;f.planCount.required=plan;f.start.required=plan;
  for(const field of [f.planTotal,f.planCount,f.start,f.frequency])field.disabled=plan&&protectedTerms;
  f.recordType.disabled=protectedTerms;
  for(const option of f.frequency.options){option.hidden=plan?['quarterly','yearly'].includes(option.value):option.value==='fortnightly';option.disabled=option.hidden}
  if(f.frequency.selectedOptions[0]?.disabled)f.frequency.value='monthly';
  $('paymentDateLabel').textContent=plan?'First payment date':'Next / first due date (optional)';
  $('planTermsInfo').hidden=!protectedTerms;
  updateInstalmentPreview();
}
function updateInstalmentPreview(){
  if(!$('planSchedulePreview'))return;
  const f=$('form').elements;
  try{
    const plan=buildInstalments(moneyToPence(f.planTotal.value),Number(f.planCount.value),f.start.value,f.frequency.value);
    $('planSchedulePreview').textContent=`${plan.count} payments, ending ${parse(plan.schedule.at(-1).date).toLocaleDateString('en-GB')}. First payment ${fmt(plan.schedule[0].amountPence)}; final payment ${fmt(plan.schedule.at(-1).amountPence)}.`;
  }catch{$('planSchedulePreview').textContent='Enter the total, number of payments and first payment date to preview the plan.'}
}
function prepareInstalmentEditor(r){
  const f=$('form').elements;
  f.recordType.disabled=false;f.recordType.value=isInstalment(r)?'instalment':'recurring';
  f.planTotal.value=isInstalment(r)?(r.instalments.totalPence/100).toFixed(2):'';
  f.planCount.value=isInstalment(r)?r.instalments.count:3;
  configureInstalmentForm();
}
function instalmentFromForm(old){
  const f=$('form').elements;
  if(f.recordType.value!=='instalment'){
    if(isInstalment(old)&&old.instalments.schedule.some(p=>paid(old,p.date)))throw Error('Unmark paid instalments before changing this plan’s payment terms.');
    return null;
  }
  const plan=buildInstalments(moneyToPence(f.planTotal.value),Number(f.planCount.value),f.start.value,f.frequency.value);
  if(isInstalment(old)){
    const same=plan.totalPence===old.instalments.totalPence&&JSON.stringify(plan.schedule)===JSON.stringify(old.instalments.schedule);
    if(!same&&old.instalments.schedule.some(p=>paid(old,p.date)))throw Error('Unmark paid instalments before changing this plan’s payment terms.');
    if(same&&old.instalments.reminderMonth)plan.reminderMonth=old.instalments.reminderMonth;
  }
  return plan;
}
document.addEventListener('DOMContentLoaded',()=>{
  $('form').elements.recordType.onchange=()=>{
    if(!editing&&$('form').elements.recordType.value==='instalment')$('form').elements.mode.value='manual';
    configureInstalmentForm();
  };
  for(const input of [$('form').elements.planTotal,$('form').elements.planCount,$('form').elements.start,$('form').elements.frequency])input.addEventListener('input',updateInstalmentPreview);
  document.addEventListener('close',()=>setTimeout(maybeInstalmentReminder,0),true);
  $('closePlan').onclick=closeInstalment;
  $('planDialog').addEventListener('cancel',e=>{e.preventDefault();closeInstalment()});
  $('editPlan').onclick=()=>openEditor(selectedInstalment);
  $('deletePlan').onclick=async()=>{
    const r=records.find(record=>record.id===selectedInstalment);if(!r)return;
    if(confirm('Delete '+r.name+'?')){records=records.filter(record=>record.id!==r.id);await save();closeInstalment();render()}
  };
  $('dismissPlanReminder').onclick=()=>acknowledgeInstalmentReminder();
  $('planReminder').addEventListener('cancel',e=>{e.preventDefault();acknowledgeInstalmentReminder()});
  $('editor').addEventListener('close',()=>{
    if(!returnToInstalment)return;
    const id=returnToInstalment;returnToInstalment=null;
    if(!locked&&records.some(r=>r.id===id&&isInstalment(r)))openInstalment(id,true);
  });
});
