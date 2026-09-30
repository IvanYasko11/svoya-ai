const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(response,extras={}){
  const elements=new Map(),intervals=new Map(),timers=new Map(),events={},calls=[];let sequence=0,time=100;
  const $=id=>{if(!elements.has(id)){const classes=new Set();elements.set(id,{value:'',textContent:'',style:{},disabled:false,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)}});}return elements.get(id);};
  const tick=()=>[...intervals.values()].forEach(f=>f());
  const context={document:{getElementById:$},Math,AbortController,performance:{now:()=>time},getOrganizerContext:()=>null,getOrganizerAccessToken:()=> 'private-token',clearTimeout:()=>{},
    setInterval:f=>{const id=++sequence;intervals.set(id,f);return id;},clearInterval:id=>intervals.delete(id),
    setTimeout:(f,ms)=>{if(ms<1000){tick();f();return;}const id=++sequence;timers.set(id,{f,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(n,f)=>{events[n]=f;},
    fetch:async(url,options)=>{calls.push({url,options});const r=typeof response==='function'?await response(url,options):response;if(r instanceof Error)throw r;return {...r,json:async()=>{tick();return r.body;}};},...extras};
  context.window=context;
  const source=fs.readFileSync(require.resolve('../index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(source,context);$('task').value='Подскажи следующий шаг';
  return {$,intervals,timers,events,calls,context,tick,advance:ms=>{time+=ms;tick();},poll:async()=>{const entry=[...timers.entries()].find(([,t])=>t.ms===1500||t.ms===2000);assert.ok(entry,'poll is scheduled');timers.delete(entry[0]);await entry[1].f();}};
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
test('Chat and coding status send the current token only in headers',async()=>{
  const ui=setup(url=>url.startsWith('/api/coding-status')?{ok:true,status:200,body:{status:'completed',run_id:42}}:{...good,body:{...good.body,route:'CODING_AGENT',task_id:'job'}});
  await ui.$('run').onclick();assert.equal(ui.calls[0].options.headers.Authorization,'Bearer private-token');assert.ok(!ui.calls[0].options.body.includes('private-token'));
  await ui.poll();assert.equal(ui.calls[1].options.headers.Authorization,'Bearer private-token');assert.ok(!ui.calls[1].url.includes('private-token'));assert.equal(ui.$('status').textContent,'Готово');
});
test('No login sends no request; account rejection opens login and provider errors preserve the session',async()=>{
  const missing=setup(good,{getOrganizerAccessToken:()=>null});await missing.$('run').onclick();assert.equal(missing.calls.length,0);assert.equal(missing.$('cloud').open,true);
  let clears=0;
  const expired=setup({ok:false,status:401,body:{error:'Войди снова'}},{clearOrganizerSession:()=>{clears++;}});await expired.$('run').onclick();assert.equal(clears,1);assert.equal(expired.$('cloud').open,true);assert.equal(expired.intervals.size,0);
  const provider=setup({ok:false,status:502,body:{error:'Ошибка API-ключа'}},{clearOrganizerSession:()=>{clears++;}});await provider.$('run').onclick();assert.equal(clears,1);
});
test('Account switch clears approvals and ignores a late chat response, including after a newer request',async()=>{
  let release,first=true,epoch=0;
  const ui=setup(()=>{if(first){first=false;return new Promise(r=>release=r);}return good;},{getOrganizerSessionGeneration:()=>epoch});
  const pending=ui.$('run').onclick();await new Promise(r=>setImmediate(r));epoch++;ui.events['svoya:account-changed']();
  assert.equal(ui.$('result').textContent,'');assert.equal(ui.$('activity').classList.contains('active'),false);
  await ui.$('run').onclick();const latest=ui.$('result').textContent;release({...good,body:{...good.body,answer:'Старый приватный ответ'}});await pending;
  assert.equal(ui.$('result').textContent,latest);assert.ok(!latest.includes('Старый приватный'));assert.equal(ui.intervals.size,0);
});
test('Rejected coding status stops polling and clears revoked login without leaking a previous account result',async()=>{
  let clears=0;
  const ui=setup(url=>url.startsWith('/api/coding-status')?{ok:false,status:401,body:{error:'Сессия отозвана'}}:{...good,body:{...good.body,route:'CODING_AGENT',task_id:'job'}},{clearOrganizerSession:()=>{clears++;}});
  await ui.$('run').onclick();await ui.poll();assert.equal(clears,1);assert.equal(ui.timers.size,0);assert.equal(ui.$('activity').classList.contains('active'),false);assert.match(ui.$('status').textContent,/отозвана/);
});
