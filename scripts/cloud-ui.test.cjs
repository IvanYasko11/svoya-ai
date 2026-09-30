const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const O=require('../organizer-core.js');
async function login(ui){ui.$('cloudEmail').value='owner@example.com';ui.$('cloudPassword').value='secret';await ui.$('cloudAuth').onsubmit({preventDefault(){}});}
function change(ui,state){ui.context.organizerBackup.snapshot=()=>({state,raw:'changed'});ui.events['svoya:tasks-saved']();}
test('Aligned login never uploads; edits debounce and automatically save the latest list',async()=>{
  const ui=setup();await login(ui);assert.equal(ui.timers.size,0);assert.deepEqual(ui.calls,['login','read']);
  const writes=[];ui.cloud.write=async state=>{writes.push(state);return {revision:2};};
  change(ui,{version:1,tasks:[]});change(ui,{version:1,tasks:O.seed().tasks.slice(0,1)});
  assert.equal(ui.timers.size,1);assert.equal(writes.length,0);await ui.flush();
  assert.equal(writes.length,1);assert.equal(writes[0].tasks.length,1);assert.equal(ui.timers.size,0);
  assert.match(ui.$('cloudSyncState').textContent,/Автосохранение включено/);
});
test('Divergent device copies block autosave until an explicit choice',async()=>{
  const ui=setup();ui.cloud.read=async()=>({state:{version:1,tasks:[]},revision:5});await login(ui);
  change(ui,{version:1,tasks:O.seed().tasks.slice(0,1)});await ui.flush();assert.equal(ui.calls.includes('write'),false);
  assert.match(ui.$('cloudSyncState').textContent,/приостановлено/);
  await ui.$('cloudSave').onclick();assert.equal(ui.calls.at(-1),'write');
  change(ui,{version:1,tasks:[]});await ui.flush();assert.equal(ui.calls.filter(x=>x==='write').length,2);
});
test('Edits during an in-flight save are queued, and never reported as already uploaded',async()=>{
  const ui=setup();await login(ui);let release;const writes=[];
  ui.cloud.write=state=>{writes.push(state);return writes.length===1?new Promise(r=>{release=r;}):Promise.resolve({revision:3});};
  change(ui,{version:1,tasks:[]});const pending=ui.flush();
  change(ui,{version:1,tasks:O.seed().tasks.slice(0,1)});assert.equal(writes.length,1);
  release({revision:2});await pending;assert.equal(ui.timers.size,1);assert.match(ui.$('cloudSyncState').textContent,/Готовлю/);
  await ui.flush();assert.equal(writes.length,2);assert.equal(writes[1].tasks.length,1);
});
test('Network failure or revision conflict stops automatic retries and preserves local changes',async()=>{
  for(const message of ['Нет связи с аккаунтом','Копия изменена на другом устройстве']){
    const ui=setup();await login(ui);let attempts=0;
    ui.cloud.write=async()=>{attempts++;throw new Error(message);};
    change(ui,{version:1,tasks:[]});await ui.flush();
    assert.equal(attempts,1);assert.equal(ui.timers.size,0);assert.match(ui.$('cloudMessage').textContent,/остановлено/);
    ui.events['svoya:tasks-saved']();await ui.flush();assert.equal(attempts,1);
    assert.equal(ui.context.organizerBackup.snapshot().state.tasks.length,0);
  }
});
test('Logout, opt-out and cross-tab changes cancel pending automatic writes',async()=>{
  for(const action of ['logout','optout','storage']){
    const ui=setup();await login(ui);change(ui,{version:1,tasks:[]});assert.equal(ui.timers.size,1);
    if(action==='logout')await ui.$('cloudLogout').onclick();
    else if(action==='optout'){ui.$('cloudAuto').checked=false;ui.$('cloudAuto').onchange();}
    else ui.events.storage({key:O.KEY});
    assert.equal(ui.timers.size,0);await ui.flush();assert.equal(ui.calls.includes('write'),false);
  }
});
test('Expired auth session pauses autosave and returns to the login form',async()=>{
  const ui=setup();await login(ui);ui.cloud.write=async()=>{await ui.cloud.logout();throw new Error('Сессия закончилась. Войди снова.');};
  change(ui,{version:1,tasks:[]});await ui.flush();
  assert.equal(ui.$('cloudAuth').hidden,false);assert.equal(ui.timers.size,0);assert.match(ui.$('cloudMessage').textContent,/Войди снова/);
});
function setup(){
  const elements=new Map(),calls=[],events={},timers=new Map();let signed=false,allow=true,timerId=0;
  const cloud={signedIn:()=>signed,async login(email){signed=true;calls.push('login');return email;},async read(){calls.push('read');return {state:O.seed(),revision:1};},async signup(){calls.push('signup');return false;},async write(){calls.push('write');return {revision:2};},async logout(){signed=false;calls.push('logout');}};
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',reportValidity:()=>true});return elements.get(id);}};
  const context={document,SvoyaCloudConfig:{url:'public',key:'public'},SvoyaOrganizer:O,createCloudBackup:()=>cloud,fetch:()=>{},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},confirm:()=>allow,organizerBackup:{snapshot:()=>({state:O.seed(),raw:'initial'}),restore:(state,raw)=>calls.push(['restore',raw])},setTimeout:f=>{const id=++timerId;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,f)=>{events[name]=f;}};context.window=context;
  document.getElementById('cloudAuto').checked=true;
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloud-ui.js'),'utf8'),context);
  return {$:id=>document.getElementById(id),calls,context,cloud,timers,events,flush:async()=>{const jobs=[...timers.values()];timers.clear();for(const f of jobs)await f();},deny:()=>{allow=false;}};
}
test('Login checks remote copy but does not upload or replace local tasks; password is cleared',async()=>{
  const ui=setup();ui.$('cloudEmail').value='owner@example.com';ui.$('cloudPassword').value='secret';
  await ui.$('cloudAuth').onsubmit({preventDefault(){}});
  assert.deepEqual(ui.calls,['login','read']);assert.equal(ui.$('cloudPassword').value,'');assert.equal(ui.$('cloudAuth').hidden,true);
  await ui.$('cloudSave').onclick();assert.equal(ui.calls.at(-1),'write');assert.match(ui.$('cloudMessage').textContent,/сохранена/);
});
test('Cancelled restore makes no network request; confirmed restore passes captured local version',async()=>{
  const cancelled=setup();cancelled.deny();await cancelled.$('cloudRestore').onclick();assert.equal(cancelled.calls.length,0);
  const ui=setup();await ui.$('cloudRestore').onclick();assert.deepEqual(ui.calls,['read',['restore','initial']]);
});
test('Failed local restore never reports success; signup waits for email confirmation',async()=>{
  const ui=setup();ui.context.organizerBackup.restore=()=>{throw new Error('Изменились локальные задачи');};
  await ui.$('cloudRestore').onclick();assert.match(ui.$('cloudMessage').textContent,/Изменились локальные задачи/);
  ui.$('cloudEmail').value='owner@example.com';ui.$('cloudPassword').value='secret';await ui.$('cloudSignup').onclick();
  assert.equal(ui.$('cloudPassword').value,'');assert.match(ui.$('cloudMessage').textContent,/подтверждения/);assert.equal(ui.$('cloudActions').hidden,true);
});
test('Cloud status detects local changes after saving instead of claiming they are uploaded',async()=>{
  const ui=setup();ui.$('cloudEmail').value='owner@example.com';ui.$('cloudPassword').value='secret';
  await ui.$('cloudAuth').onsubmit({preventDefault(){}});
  assert.match(ui.$('cloudSyncState').textContent,/Автосохранение включено/);
  await ui.$('cloudSave').onclick();
  ui.context.organizerBackup.snapshot=()=>({state:{version:1,tasks:[]},raw:'changed'});
  await ui.$('cloudCheck').onclick();
  assert.match(ui.$('cloudSyncState').textContent,/Списки различаются/);
});
