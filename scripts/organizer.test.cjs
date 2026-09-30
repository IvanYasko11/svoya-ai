const test=require('node:test');
const assert=require('node:assert/strict');
const O=require('../organizer-core.js');
function storage(){const data=new Map();return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)};}
test('Save, reload and backup retain edited task fields',()=>{
  const s=storage();const task={id:'custom',title:'Проверить память',next:'Открыть браузер повторно',blocker:'',priority:1,status:'active',due:'2026-10-01'};
  const state=O.upsert(O.load(s),task);O.save(s,state);
  assert.deepEqual(O.load(s),state);
  assert.deepEqual(O.validate(JSON.parse(JSON.stringify(state))),state);
  O.save(s,O.upsert(state,{...task,status:'waiting',blocker:'Нужен ответ'}));
  assert.equal(O.load(s).tasks.find(t=>t.id==='custom').blocker,'Нужен ответ');
});
test('Closed and deferred goals never enter daily plan or model context',()=>{
  const state=O.seed();assert.deepEqual(O.today(state,'2026-09-30').map(t=>t.id),['agent']);
  assert.deepEqual(O.context(state).map(t=>t.title),['СВОЯ AI — организатор задач']);
  const next=O.upsert(state,{...state.tasks[0],status:'done'});
  assert.equal(O.today(next,'2026-09-30').length,0);assert.equal(O.context(next).length,0);
});
test('Overdue active tasks precede priorities and daily plan is capped at three',()=>{
  let state=O.seed();for(let i=0;i<4;i++)state=O.upsert(state,{id:'x'+i,title:'Задача '+i,next:'Шаг',blocker:'',priority:3,status:'active',due:'2026-09-20'});
  assert.equal(O.today(state,'2026-09-30').length,3);
  assert.ok(O.today(state,'2026-09-30').every(t=>t.id!=='agent'));
});
test('Malformed backups, impossible dates and duplicate IDs are rejected',()=>{
  const state=O.seed(), task=state.tasks[0];
  for(const bad of [{version:2,tasks:[]},{version:1,tasks:[task,task]},{version:1,tasks:[{...task,due:'2026-02-30'}]},{version:1,tasks:[{...task,status:'unknown'}]},{version:1,tasks:[{...task,title:'x'.repeat(201)}]}])assert.throws(()=>O.validate(bad));
  const s=storage();s.setItem(O.KEY,'invalid');assert.throws(()=>O.load(s));assert.equal(s.getItem(O.KEY),'invalid');
});
test('Storage failure never reports success',()=>{
  assert.throws(()=>O.save({setItem(){throw new Error('Quota exceeded');}},O.seed()),/Quota/);
});
test('Model context is opt-in, bounded, whitelisted and contains no closed goals',()=>{
  const {organizerMessage}=require('../lib/organizer-context.cjs');
  assert.equal(organizerMessage(null),null);
  const tasks=O.context(O.seed());const result=organizerMessage(tasks);
  assert.equal(result.role,'user');assert.match(result.content,/СВОЯ AI/);
  assert.throws(()=>organizerMessage([{...tasks[0],status:'archived'}]));
  assert.throws(()=>organizerMessage(Array(21).fill(tasks[0])));
  const withExtra=organizerMessage([{...tasks[0],secret:'EXCLUDED'}]);assert.ok(!withExtra.content.includes('EXCLUDED'));
  assert.throws(()=>organizerMessage(Array(20).fill({...tasks[0],next:'x'.repeat(1000)})),/большой/);
});
