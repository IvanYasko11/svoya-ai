const test=require('node:test'),assert=require('node:assert/strict');
const create=require('../cloud-backup.js'),O=require('../organizer-core.js');
function setup(){
  let time=1000;const calls=[],responses=[];
  const cloud=create({url:'https://example.supabase.co',key:'public-key',validate:O.validate,now:()=>time,
    fetch:async(url,options)=>{calls.push({url,options});const r=responses.shift();if(r instanceof Error)throw r;assert.ok(r,'unexpected request');return {ok:r.status<400,status:r.status,json:async()=>r.body};}});
  return {cloud,calls,responses,expire:()=>{time=9999999;}};
}
const session={access_token:'private-session',expires_in:3600,user:{id:'owner',email:'owner@example.com'}};
test('Login never uploads a local list; cloud data requires authenticated requests',async()=>{
  const x=setup();await assert.rejects(x.cloud.read(),/Войди/);assert.equal(x.calls.length,0);
  x.responses.push({status:200,body:session});await x.cloud.login('owner@example.com','password');
  assert.equal(x.calls.length,1);assert.match(x.calls[0].url,/token/);assert.equal(x.calls[0].options.headers.Authorization,undefined);
  await assert.rejects(x.cloud.write(O.seed()),/Проверить копию/);assert.equal(x.calls.length,1);
  x.responses.push({status:200,body:[]});assert.equal(await x.cloud.read(),null);
  assert.equal(x.calls[1].options.headers.Authorization,'Bearer private-session');
  x.responses.push({status:201,body:[{revision:1,updated_at:'now'}]});await x.cloud.write(O.seed());
  assert.equal(JSON.parse(x.calls[2].options.body).user_id,'owner');
});
test('Existing copies use compare-and-swap and stale writes require another read',async()=>{
  const x=setup();x.responses.push({status:200,body:session},{status:200,body:[{state:O.seed(),revision:7,updated_at:'now'}]},{status:200,body:[]});
  await x.cloud.login('owner@example.com','password');await x.cloud.read();
  await assert.rejects(x.cloud.write(O.seed()),/другом устройстве/);
  assert.match(x.calls[2].url,/revision=eq.7/);assert.equal(x.calls[2].options.method,'PATCH');
  assert.deepEqual(Object.keys(JSON.parse(x.calls[2].options.body)),['state']);
  await assert.rejects(x.cloud.write(O.seed()),/Проверить копию/);assert.equal(x.calls.length,3);
});
test('Network errors and invalid cloud state do not become successful saves',async()=>{
  const x=setup();x.responses.push({status:200,body:session},new Error('network'),{status:200,body:[{state:{version:999,tasks:[]},revision:1}]});
  await x.cloud.login('owner@example.com','password');await assert.rejects(x.cloud.read(),/Нет связи/);
  await assert.rejects(x.cloud.read(),/резервная копия/);await assert.rejects(x.cloud.write(O.seed()),/Проверить копию/);
});
test('Session expiry and logout remove authorization, signup awaits confirmation',async()=>{
  const x=setup();x.responses.push({status:200,body:{user:{id:'owner'}}});assert.equal(await x.cloud.signup('owner@example.com','password'),false);assert.equal(x.cloud.signedIn(),false);
  x.responses.push({status:200,body:session});await x.cloud.login('owner@example.com','password');x.expire();
  await assert.rejects(x.cloud.read(),/Сессия закончилась/);assert.equal(x.cloud.signedIn(),false);
  x.responses.push({status:200,body:session},{status:204});await x.cloud.login('owner@example.com','password');await x.cloud.logout();
  assert.equal(x.cloud.signedIn(),false);await assert.rejects(x.cloud.read(),/Войди/);
});
test('Auth failure hides raw provider errors and clears prior account session',async()=>{
  const x=setup();x.responses.push({status:200,body:session},{status:400,body:{msg:'private provider error'}});
  await x.cloud.login('owner@example.com','password');await assert.rejects(x.cloud.login('other@example.com','wrong'),/Не удалось войти/);assert.equal(x.cloud.signedIn(),false);
});
test('Command requests can use the in-memory token only before expiry or logout',async()=>{
  const x=setup();assert.throws(()=>x.cloud.accessToken(),/войди в аккаунт/);
  x.responses.push({status:200,body:session});await x.cloud.login('owner@example.com','password');assert.equal(x.cloud.accessToken(),'private-session');
  x.expire();assert.throws(()=>x.cloud.accessToken(),/войди снова/);assert.equal(x.cloud.signedIn(),false);
});
