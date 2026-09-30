const test=require('node:test'),assert=require('node:assert/strict');
const {requireOperator}=require('../lib/operator-auth.cjs');
const ID='11111111-1111-4111-8111-111111111111',SID='22222222-2222-4222-8222-222222222222';
const USER={id:ID,email_confirmed_at:'2026-09-01T00:00:00Z',is_anonymous:false};
const GATE={user_id:ID,session_id:SID,active_session:true,allowed:true};
async function run({token='Bearer signed-user-token-for-testing',user=USER,gate=GATE,status=200,gateStatus=200,network=false}={}){
  const calls=[],res={status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  const actor=await requireOperator({headers:{authorization:token}},res,{fetchImpl:async(url,options)=>{calls.push({url,options});if(network)throw new Error('SECRET_SESSION');return new Response(JSON.stringify(calls.length===1?user:gate),{status:calls.length===1?status:gateStatus});}});
  return {actor,res,calls};
}
test('Missing or malformed authentication makes no network or privileged request',async()=>{
  for(const token of [undefined,'','Bearer short','Bearer token with spaces','Basic signed-user-token-for-testing']){const x=await run({token:token===undefined?null:token});assert.equal(x.actor,null);assert.equal(x.res.code,401);assert.equal(x.calls.length,0);}
});
test('Validated caller and fresh server admission produce only verified identity',async()=>{
  const x=await run();assert.deepEqual(x.actor,{id:ID,sessionId:SID});assert.equal(x.calls.length,2);
  assert.match(x.calls[1].url,/operator_access_check$/);assert.equal(x.calls[1].options.body,'{}');assert.equal(x.calls[1].options.headers.Authorization,x.calls[0].options.headers.Authorization);
});
test('Forged tokens, anonymous accounts, unconfirmed email and invalid IDs cannot pass',async()=>{
  for(const args of [{status:401},{user:{...USER,is_anonymous:true}},{user:{...USER,email_confirmed_at:null}},{user:{...USER,id:'owner'}}]){
    const x=await run(args);assert.equal(x.actor,null);assert.equal(x.res.code,401);assert.equal(x.calls.length,1);
  }
});
test('User-editable owner metadata does not grant access and disabled membership blocks',async()=>{
  const x=await run({user:{...USER,user_metadata:{owner:true,admin:true}},gate:{...GATE,allowed:false}});assert.equal(x.actor,null);assert.equal(x.res.code,403);assert.equal(x.res.data.error_code,'ACCESS_DENIED');
});
test('A still-valid JWT cannot reuse a revoked or missing auth session',async()=>{
  for(const gate of [{...GATE,active_session:false},{...GATE,session_id:null}]){const x=await run({gate});assert.equal(x.actor,null);assert.equal(x.res.code,401);}
});
test('Admission outage, invalid or cross-account gate responses fail closed without raw secrets',async()=>{
  for(const args of [{gateStatus:403},{network:true},{gate:{...GATE,user_id:SID}},{gate:{...GATE,allowed:'true'}}]){
    const x=await run(args);assert.equal(x.actor,null);assert.equal(x.res.code,503);assert.ok(!JSON.stringify(x.res.data).includes('SECRET_SESSION'));
  }
});
