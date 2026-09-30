const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(response){
  const elements=new Map(),intervals=new Map();let sequence=0,time=100;
  const $=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{value:'',textContent:'',style:{},disabled:false,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}});}return elements.get(id);};
  const tick=()=>[...intervals.values()].forEach(f=>f());
  const context={document:{getElementById:$},Math,performance:{now:()=>time},getOrganizerContext:()=>null,
    setInterval:f=>{const id=++sequence;intervals.set(id,f);return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:(f,ms)=>{if(ms<1000){tick();f();}},
    fetch:async()=>{if(response instanceof Error)throw response;return {...response,json:async()=>{tick();return response.body;}};}};
  context.window=context;
  const source=fs.readFileSync(require.resolve('../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(source,context);$('task').value='Подскажи следующий шаг';
  return {$,intervals,tick,advance:ms=>{time+=ms;tick();}};
}
const good={ok:true,status:200,body:{answer:'Открой список задач',provider:'openrouter',model:'openrouter/free',risk_level:'LOW',requires_confirmation:false,route:'GENERAL'}};
test('Completed answer ends waiting and progress cannot fall back after reaching 100%',async()=>{
  const ui=setup(good);await ui.$('run').onclick();ui.tick();
  assert.equal(ui.$('progressBar').style.width,'100%');assert.equal(ui.$('activity').classList.contains('active'),false);
  assert.equal(ui.$('status').textContent,'Готово');assert.match(ui.$('result').textContent,/Результат\n\nОткрой список/);
  assert.equal(ui.intervals.size,0);assert.equal(ui.$('run').disabled,false);
});
test('API errors, confirmation waits and network errors stop the thinking indicator',async()=>{
  for(const response of [{ok:false,status:503,body:{error:'Квота закончилась'}},{ok:false,status:409,body:{requires_confirmation:true,risk_level:'MEDIUM'}},new Error('Нет сети')]){
    const ui=setup(response);await ui.$('run').onclick();
    assert.equal(ui.$('activity').classList.contains('active'),false);assert.equal(ui.intervals.size,0);assert.equal(ui.$('run').disabled,false);
    assert.notEqual(ui.$('status').textContent,'Готово');assert.ok(ui.$('result').textContent);
  }
});
test('Queued coding job retains a real waiting state instead of claiming completion',async()=>{
  const ui=setup({...good,body:{...good.body,route:'CODING_AGENT',task_id:'job'}});await ui.$('run').onclick();
  assert.equal(ui.$('status').textContent,'Coding Agent работает');assert.equal(ui.$('activity').classList.contains('active'),true);assert.equal(ui.intervals.size,0);
});
test('Long-running requests keep advancing past the former 82% cap without claiming completion',async()=>{
  const ui=setup(good),pending=ui.$('run').onclick();
  ui.advance(300000);const first=parseFloat(ui.$('progressBar').style.width);
  ui.advance(600000);const later=parseFloat(ui.$('progressBar').style.width);
  assert.ok(first>82);assert.ok(later>first&&later<100);
  await pending;assert.equal(ui.$('progressBar').style.width,'100%');
});
