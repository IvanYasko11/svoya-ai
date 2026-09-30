const test=require('node:test'),assert=require('node:assert/strict');
const O=require('../organizer-core.js'),P=require('../organizer-proposals.js');
const plan=operations=>({kind:'proposal',operations});
const update=(target,fields)=>({type:'update',target,fields});
test('Task changes are immutable, explicit, and can create steps without completing the original goal',()=>{
  const state=O.seed(),original=JSON.stringify(state);let n=0;
  const result=P.apply(state,plan([update(state.tasks[0].title,{priority:2}),{type:'create',fields:{title:'Проверить команду',next:'Создать тестовую задачу'}}]),{createId:()=> 'new-'+(++n)});
  assert.equal(JSON.stringify(state),original);assert.equal(result.state.tasks.find(t=>t.id==='agent').status,'active');
  assert.equal(result.state.tasks.find(t=>t.id==='new-1').priority,2);assert.equal(P.diff(state,result.state).length,2);
  assert.deepEqual(P.diff(state,result.state)[0].fields,[{key:'priority',before:1,after:2}]);
});
test('Ambiguous or invented targets cannot choose a card; explicit selection disambiguates',()=>{
  const duplicate=O.upsert(O.seed(),{...O.seed().tasks[0],id:'duplicate'});
  assert.throws(()=>P.apply(duplicate,plan([update(duplicate.tasks[0].title,{status:'done'})])),/неоднозначно/);
  assert.throws(()=>P.apply(O.seed(),plan([update('несуществующая',{status:'done'})])),/не найдена/);
  assert.throws(()=>P.apply(O.seed(),plan([update('$selected',{status:'done'})])),/не найдена/);
  const result=P.apply(duplicate,plan([update('$selected',{status:'done'})]),{selectedId:'duplicate'});
  assert.equal(result.state.tasks.find(t=>t.id==='duplicate').status,'done');assert.equal(result.state.tasks.find(t=>t.id==='agent').status,'active');
});
test('Closed goals stay out of model context and cannot be revived without explicit selection',()=>{
  assert.deepEqual(P.scope(O.seed()).tasks.map(t=>t.id),['agent','income']);
  assert.throws(()=>P.apply(O.seed(),plan([update('Переезд',{status:'active'})])),/не найдена/);
  assert.equal(P.scope(O.seed(),'relocation').tasks[0].id,'relocation');
  assert.throws(()=>P.scope(O.seed(),'unknown'),/не существует/);
  assert.equal(P.needsSelection('заверши эту задачу'),true);assert.equal(P.needsSelection('разбей цель на три шага'),false);
});
test('Injected tools, deletion, IDs, invalid values, collisions, and excessive operations are rejected atomically',()=>{
  const state=O.seed(),original=JSON.stringify(state),title=state.tasks[0].title;
  const attacks=[
    plan([{type:'delete',target:title,fields:{status:'done'}}]),
    plan([update(title,{id:'reels'})]),
    plan([update(title,{priority:'1'})]),
    plan([update(title,{due:'2026-02-30'})]),
    {...plan([update(title,{status:'done'})]),tools:['shell']},
    plan([{...update(title,{status:'done'}),target_id:'agent'}]),
    plan([update(title,{status:'done'}),update(title,{status:'archived'})]),
    plan(Array.from({length:11},()=>update(title,{status:'done'})))
  ];
  for(const attack of attacks){assert.throws(()=>P.apply(state,attack));assert.equal(JSON.stringify(state),original);}
  assert.throws(()=>P.apply(state,plan([{type:'create',fields:{title:'new'}}]),{createId:()=> 'agent'}),/существующий ID/);
  assert.throws(()=>P.apply(state,plan([{type:'create',fields:{title}}])),/уже есть/);
  assert.throws(()=>P.apply(state,plan([update(title,{status:'active'})])),/уже сохранены/);
});
test('Clarification and fenced JSON are supported; prose or mixed instructions never execute',()=>{
  const clarification={kind:'clarification',message:'Какую задачу выбрать?'};
  assert.deepEqual(P.apply(O.seed(),clarification),clarification);
  assert.deepEqual(P.parse('```json\n'+JSON.stringify(clarification)+'\n```'),clarification);
  assert.throws(()=>P.parse('Готово! '+JSON.stringify(clarification)),/не удалось разобрать/);
  assert.throws(()=>P.apply(O.seed(),{...clarification,operations:[]}),/Некорректное/);
  const state={version:1,tasks:Array.from({length:61},(_,i)=>({...O.seed().tasks[0],id:'t'+i,title:'T'+i}))};
  assert.throws(()=>P.scope(state),/слишком большой/);assert.equal(P.scope(state,'t4').tasks.length,1);
});
