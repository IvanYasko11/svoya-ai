const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const O=require('../organizer-core.js');
const P=require('../organizer-proposals.js');
function setup(storage,extras={}){
  const elements=new Map(),events={};
  function element(){return {value:'',checked:false,textContent:'',children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},focus(){},reset(){},click(){}};}
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement(){return element()}};
  const context={SvoyaOrganizer:O,SvoyaProposals:P,document,localStorage:storage,crypto:{randomUUID:()=> 'new-task'},Date,JSON,Blob,URL,setTimeout,clearTimeout,AbortController,confirm:()=>true,addEventListener:(n,f)=>{events[n]=f},...extras};
  context.window=context;document.getElementById('organizerFilter').value='open';
  vm.runInNewContext(fs.readFileSync(require.resolve('../organizer-ui.js'),'utf8'),context);
  return {context,$:id=>document.getElementById(id),events};
}
function storage(){const data=new Map();return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)};}
test('UI saves task, reloads it and excludes context until explicitly enabled',()=>{
  const s=storage(),ui=setup(s);ui.$('orgTitle').value='<img src=x onerror=alert(1)>';
  ui.$('orgNext').value='Открыть ещё раз';ui.$('orgBlocker').value='';ui.$('orgPriority').value='1';ui.$('orgStatus').value='active';ui.$('orgDue').value='';
  ui.$('organizerForm').onsubmit({preventDefault(){}});
  assert.match(ui.$('organizerMessage').textContent,/Сохранено/);
  const reloaded=setup(s);assert.equal(O.load(s).tasks.find(t=>t.id==='new-task').next,'Открыть ещё раз');
  const cards=reloaded.$('organizerList').children;
  assert.ok(cards.some(c=>c.children[0].textContent==='<img src=x onerror=alert(1)>'));
  assert.equal(reloaded.context.getOrganizerContext(),null);
  reloaded.$('orgShare').checked=true;assert.equal(reloaded.context.getOrganizerContext().length,2);
});
test('UI never overwrites corrupt storage or stale edits',()=>{
  const s=storage();s.setItem(O.KEY,'broken');const broken=setup(s);
  broken.$('organizerForm').onsubmit({preventDefault(){}});assert.equal(s.getItem(O.KEY),'broken');
  const fresh=storage(),ui=setup(fresh);
  ui.$('organizerList').children[0].children.at(-1).onclick();
  O.save(fresh,O.upsert(O.seed(),{...O.seed().tasks[0],next:'Changed elsewhere'}));
  ui.$('organizerForm').onsubmit({preventDefault(){}});
  assert.match(ui.$('organizerMessage').textContent,/другой вкладке/);
  assert.equal(O.load(fresh).tasks[0].id,'income');
  assert.equal(O.load(fresh).tasks.find(t=>t.id==='agent').next,'Changed elsewhere');
});
test('Command preview saves only on apply and rejects a stale preview',()=>{
  const s=storage(),ui=setup(s);
  ui.$('orgCommand').value='Добавь задачу: Новый дизайн';ui.$('orgCommandForm').onsubmit({preventDefault(){}});
  assert.equal(s.getItem(O.KEY),null);assert.equal(ui.$('orgProposal').hidden,false);
  ui.$('orgApply').onclick();assert.ok(O.load(s).tasks.some(t=>t.title==='Новый дизайн'));
  ui.$('orgCommand').value='Заверши задачу: Новый дизайн';ui.$('orgCommandForm').onsubmit({preventDefault(){}});
  O.save(s,O.upsert(O.load(s),{...O.load(s).tasks.find(t=>t.id==='new-task'),next:'Изменение из другой вкладки'}));
  ui.$('orgApply').onclick();assert.equal(O.load(s).tasks.find(t=>t.id==='new-task').status,'active');
  assert.match(ui.$('organizerMessage').textContent,/Список изменился/);
});
test('Search filters titles and next steps without changing stored state',()=>{
  const s=storage(),ui=setup(s);ui.$('orgSearch').value='окупаемость';ui.$('orgSearch').oninput();
  assert.equal(ui.$('organizerList').children.length,1);assert.equal(s.getItem(O.KEY),null);
  ui.$('orgSearch').value='nothingmatches';ui.$('orgSearch').oninput();
  assert.equal(ui.$('organizerList').children[0].textContent,'В этом списке нет задач.');
});
test('Cloud restore refuses changed local state and resets command previews after success',()=>{
  const s=storage(),ui=setup(s),snapshot=ui.context.organizerBackup.snapshot();
  ui.$('orgCommand').value='Добавь задачу: Предложение';ui.$('orgCommandForm').onsubmit({preventDefault(){}});
  ui.context.organizerBackup.restore({...O.seed(),tasks:[]},snapshot.raw);
  assert.equal(O.load(s).tasks.length,0);assert.equal(ui.$('orgProposal').hidden,true);
  ui.$('orgApply').onclick();assert.equal(O.load(s).tasks.length,0);
  const current=ui.context.organizerBackup.snapshot();O.save(s,O.seed());
  assert.throws(()=>ui.context.organizerBackup.restore(current.state,current.raw),/задачи изменились/);
  assert.equal(O.load(s).tasks.length,4);
});
function apiReply(plan,status=200){return {ok:status<400,status,json:async()=>status<400?{plan,provider:'openrouter',model:'openrouter/free'}:{error:'Исчерпана бесплатная квота'}};}
const finishSelected={kind:'proposal',operations:[{type:'update',target:'$selected',fields:{status:'done'}}]};
test('A natural phrase produces a complete field preview, saves only on explicit apply and triggers cloud autosave',async()=>{
  const s=storage(),calls=[],events=[];
  const ui=setup(s,{getOrganizerAccessToken:()=> 'private-token',fetch:async(url,options)=>{calls.push({url,options});return apiReply(finishSelected);},Event,dispatchEvent:e=>events.push(e.type)});
  ui.$('orgTarget').value='agent';ui.$('orgCommand').value='заверши эту задачу';
  await ui.$('orgCommandForm').onsubmit({preventDefault(){}});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/organizer-plan');assert.equal(calls[0].options.headers.Authorization,'Bearer private-token');
  const body=JSON.parse(calls[0].options.body);assert.equal(body.state.tasks.length,1);assert.equal(body.selectedId,'agent');
  assert.equal(s.getItem(O.KEY),null);assert.equal(ui.$('orgProposal').hidden,false);assert.equal(ui.$('orgPlanning').hidden,true);assert.equal(ui.$('orgParse').disabled,false);
  assert.match(ui.$('orgProposalText').children[1].children[1].textContent,/Статус: В работе → Готово/);
  ui.$('orgApply').onclick();assert.equal(O.load(s).tasks.find(t=>t.id==='agent').status,'done');assert.deepEqual(events,['svoya:tasks-saved']);
  assert.equal(O.load(s).tasks.length,4);assert.equal(ui.$('orgProposal').hidden,true);
});
test('Task selection disambiguates a local command and preserves all other cards without LLM',async()=>{
  const s=storage();O.save(s,O.upsert(O.seed(),{...O.seed().tasks[0],id:'same-title'}));const ui=setup(s);
  ui.$('orgTarget').value='same-title';ui.$('orgCommand').value='Заверши задачу: '+O.seed().tasks[0].title;
  await ui.$('orgCommandForm').onsubmit({preventDefault(){}});ui.$('orgApply').onclick();
  assert.equal(O.load(s).tasks.find(t=>t.id==='same-title').status,'done');assert.equal(O.load(s).tasks.find(t=>t.id==='agent').status,'active');assert.equal(O.load(s).tasks.length,5);
});
test('Late responses after cancellation, command editing, another tab, or a local save cannot produce an applicable proposal',async()=>{
  for(const action of ['cancel','input','storage','local']){
    const s=storage();let release;
    const ui=setup(s,{getOrganizerAccessToken:()=> 'private-token',fetch:()=>new Promise(r=>release=r)});
    ui.$('orgTarget').value='agent';ui.$('orgCommand').value='заверши эту задачу';
    const pending=ui.$('orgCommandForm').onsubmit({preventDefault(){}});assert.equal(ui.$('orgPlanning').hidden,false);
    if(action==='cancel')ui.$('orgStop').onclick();
    else if(action==='input'){ui.$('orgCommand').value='другая команда';ui.$('orgCommand').oninput();}
    else if(action==='storage'){O.save(s,O.seed());ui.events.storage({key:O.KEY});}
    else{ui.context.organizerBackup.restore({version:1,tasks:[]},null);}
    const expected=s.getItem(O.KEY);release(apiReply(finishSelected));await pending;
    assert.equal(ui.$('orgProposal').hidden,true);assert.equal(ui.$('orgPlanning').hidden,true);ui.$('orgApply').onclick();assert.equal(s.getItem(O.KEY),expected);
  }
});
test('A stale response or edited preview is rejected even when no input or storage event was received',async()=>{
  const s=storage();let release;
  const ui=setup(s,{getOrganizerAccessToken:()=> 'private-token',fetch:()=>new Promise(r=>release=r)});
  ui.$('orgTarget').value='agent';ui.$('orgCommand').value='заверши эту задачу';const pending=ui.$('orgCommandForm').onsubmit({preventDefault(){}});
  O.save(s,O.seed());release(apiReply(finishSelected));await pending;assert.match(ui.$('organizerMessage').textContent,/изменились/);assert.equal(ui.$('orgProposal').hidden,true);
  const local=setup(storage());local.$('orgCommand').value='Добавь задачу: новая';await local.$('orgCommandForm').onsubmit({preventDefault(){}});
  local.$('orgCommand').value='Добавь задачу: другая';local.$('orgApply').onclick();assert.equal(local.context.organizerBackup.snapshot().raw,null);
});
test('Ambiguous references, missing login, model failures and invalid operations leave tasks untouched and stop animation',async()=>{
  const s=storage();let calls=0;
  const ui=setup(s,{fetch:async()=>{calls++;throw new Error('Should not call');}});
  ui.$('orgCommand').value='заверши эту задачу';await ui.$('orgCommandForm').onsubmit({preventDefault(){}});assert.match(ui.$('organizerMessage').textContent,/Уточни задачу/);
  ui.$('orgCommand').value='разбей цель про агента на три шага';await ui.$('orgCommandForm').onsubmit({preventDefault(){}});assert.match(ui.$('organizerMessage').textContent,/войди в аккаунт/);assert.equal(calls,0);
  const invalid={kind:'proposal',operations:[{type:'create',fields:{title:'New'}},{type:'update',target:'$selected',fields:{tool:'shell'}}]};
  for(const reply of [apiReply(null,429),apiReply(invalid)]){
    const failed=setup(s,{getOrganizerAccessToken:()=> 'private-token',fetch:async()=>reply});failed.$('orgTarget').value='agent';failed.$('orgCommand').value='обнови выбранную задачу';
    await failed.$('orgCommandForm').onsubmit({preventDefault(){}});assert.equal(s.getItem(O.KEY),null);assert.equal(failed.$('orgProposal').hidden,true);assert.equal(failed.$('orgPlanning').hidden,true);assert.equal(failed.$('orgParse').disabled,false);
  }
});
test('A rejected server session reopens login and invalidates local auth without creating a proposal',async()=>{
  const s=storage();let cleared=false;
  const ui=setup(s,{getOrganizerAccessToken:()=> 'private-token',clearOrganizerSession:()=>{cleared=true;},fetch:async()=>apiReply(null,401)});
  ui.$('orgTarget').value='agent';ui.$('orgCommand').value='заверши эту задачу';await ui.$('orgCommandForm').onsubmit({preventDefault(){}});
  assert.equal(cleared,true);assert.equal(ui.$('cloud').open,true);assert.equal(ui.$('orgProposal').hidden,true);assert.equal(s.getItem(O.KEY),null);
});
