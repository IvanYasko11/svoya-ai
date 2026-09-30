const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const O=require('../organizer-core.js');
function setup(){
  const elements=new Map(),calls=[];let signed=false,allow=true;
  const cloud={signedIn:()=>signed,async login(email){signed=true;calls.push('login');return email;},async read(){calls.push('read');return {state:O.seed(),revision:1};},async signup(){calls.push('signup');return false;},async write(){calls.push('write');return {revision:2};},async logout(){signed=false;calls.push('logout');}};
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',reportValidity:()=>true});return elements.get(id);}};
  const context={document,SvoyaCloudConfig:{url:'public',key:'public'},SvoyaOrganizer:O,createCloudBackup:()=>cloud,fetch:()=>{},location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},confirm:()=>allow,organizerBackup:{snapshot:()=>({state:O.seed(),raw:'initial'}),restore:(state,raw)=>calls.push(['restore',raw])}};context.window=context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../cloud-ui.js'),'utf8'),context);
  return {$:id=>document.getElementById(id),calls,context,deny:()=>{allow=false;}};
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
  await ui.$('cloudRestore').onclick();assert.equal(ui.$('cloudMessage').textContent,'Изменились локальные задачи');
  ui.$('cloudEmail').value='owner@example.com';ui.$('cloudPassword').value='secret';await ui.$('cloudSignup').onclick();
  assert.equal(ui.$('cloudPassword').value,'');assert.match(ui.$('cloudMessage').textContent,/подтверждения/);assert.equal(ui.$('cloudActions').hidden,true);
});
test('Cloud status detects local changes after saving instead of claiming they are uploaded',async()=>{
  const ui=setup();ui.$('cloudEmail').value='owner@example.com';ui.$('cloudPassword').value='secret';
  await ui.$('cloudAuth').onsubmit({preventDefault(){}});
  assert.match(ui.$('cloudSyncState').textContent,/совпадает/);
  await ui.$('cloudSave').onclick();
  ui.context.organizerBackup.snapshot=()=>({state:{version:1,tasks:[]},raw:'changed'});
  await ui.$('cloudCheck').onclick();
  assert.match(ui.$('cloudSyncState').textContent,/локальные изменения/);
});
