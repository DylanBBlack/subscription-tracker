import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the production calculation functions without a browser or storage.
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const plans=readFileSync(new URL('../instalments.js',import.meta.url),'utf8');
function calculations(date='2026-11-22'){
 const context=vm.createContext({document:{addEventListener(){}},Intl});
 vm.runInContext(`const RealDate=Date;Date=class extends RealDate{constructor(...args){super(...(args.length?args:['${date}T12:00:00']))}static now(){return new RealDate('${date}T12:00:00').getTime()}};`,context);
 vm.runInContext(app.split('\n')[1]+'\n'+app.slice(app.indexOf('function addMonths('),app.indexOf('function show('))+'\n'+plans,context);
 return expression=>JSON.parse(JSON.stringify(vm.runInContext(expression,context)));
}
const plan=`({id:'example',name:'Example',start:'2026-11-30',frequency:'monthly',amountPence:3333,mode:'manual',overrides:{},instalments:buildInstalments(10000,3,'2026-11-30','monthly')})`;

test('instalments distribute exact integer pence and preserve anchored monthly dates',()=>{
 const run=calculations();
 assert.deepEqual(run("buildInstalments(10000,3,'2026-11-30','monthly').schedule"),[{date:'2026-11-30',amountPence:3333},{date:'2026-12-30',amountPence:3333},{date:'2027-01-30',amountPence:3334}]);
 assert.deepEqual(run("buildInstalments(300,3,'2028-01-31','monthly').schedule.map(p=>p.date)"),['2028-01-31','2028-02-29','2028-03-31']);
 for(let total=1;total<400;total++){
  const count=Math.min(total,7);
  assert.equal(run(`buildInstalments(${total},${count},'2026-11-22','monthly').schedule.reduce((s,p)=>s+p.amountPence,0)`),total);
 }
 assert.deepEqual(run("buildInstalments(300,3,'2027-03-21','fortnightly').schedule.map(p=>p.date)"),['2027-03-21','2027-04-04','2027-04-18']);
});

test('finite plans affect only scheduled months, preserve recurring totals and stop after the final payment',()=>{
 const run=calculations();
 assert.deepEqual(run(`totals([{amountPence:1450,frequency:'monthly'},${plan}])`),{monthly:4783,annual:27400});
 assert.deepEqual(run(`occurrences(${plan},parse('2027-02-01'),parse('2030-12-31'))`),[]);
 assert.deepEqual(calculations('2027-02-01')(`totals([${plan}])`),{monthly:0,annual:0});
 assert.deepEqual(run(`(()=>{const r=${plan};r.overrides['2026-11-30']=true;return planBalance(r)})()`),{paidCount:1,paidPence:3333,remainingPence:6667});
 assert.deepEqual(run(`(()=>{const r=${plan};for(const p of r.instalments.schedule)r.overrides[p.date]=true;return planBalance(r)})()`),{paidCount:3,paidPence:10000,remainingPence:0});
});

test('invalid schedules are rejected and automatic completion respects explicit overrides',()=>{
 const run=calculations('2027-01-01');
 for(const args of [[0,3,'2026-11-01','monthly'],[2,3,'2026-11-01','monthly'],[100,121,'2026-11-01','monthly'],[100,3,'2026-02-31','monthly'],[100,3,'2026-11-01','yearly']]){
  assert.equal(run(`(()=>{try{buildInstalments(...${JSON.stringify(args)});return false}catch{return true}})()`),true);
 }
 assert.equal(run(`validInstalments(${plan})`),true);
 assert.equal(run(`(()=>{const r=${plan};r.instalments.schedule[2].amountPence++;return validInstalments(r)})()`),false);
 assert.deepEqual(run(`(()=>{const r=${plan};r.mode='auto';r.overrides['2026-12-30']=false;return planBalance(r)})()`),{paidCount:1,paidPence:3333,remainingPence:6667});
 assert.equal(run(`finalPlanDueThisMonth(${plan})`),true);
 assert.equal(calculations('2026-12-01')(`finalPlanDueThisMonth(${plan})`),false);
});
