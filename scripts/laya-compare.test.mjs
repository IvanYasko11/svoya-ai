import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../api/laya-compare.js';
const ID='11111111-1111-4111-8111-111111111111',SID='22222222-2222-4222-8222-222222222222';
const env={SVOYA_LAYA_URL:'https://laya.example.com',SVOYA_LAYA_ALLOWED_HOSTS:'laya.example.com',SVOYA_LAYA_API_KEY:'SERVER_KEY'};
const headers={authorization:'Bearer test-owner-token-long-enough'};
const json=d=>new Response(JSON.stringify(d),{headers:{'content-type':'application/json'}});
function fixture(options={}){
 const x={calls:[],allowed:true,active:true,clock:100000};
 const fetchImpl=async(url,opts)=>{
  x.calls.push({url,opts});
  if(url.endsWith('/auth/v1/user'))return json({id:ID,email_confirmed_at:'2026-09-01',is_anonymous:false});
  if(url.endsWith('/rpc/operator_access_check'))return json({user_id:ID,session_id:SID,allowed:x.allowed,active_session:x.active});
  if(url==='https://laya.example.com/v1/systemone')return options.infer?options.infer():json({routing:{model:'multilingual'},answers:{intent:{type:'choice',choice:'general',answer_confidence:0.8,probabilities:{coding:0.05,files:0.05,research:0.05,general:0.8,unclear:0.05}}}});
  throw Error('Unexpected external request');
 };
 const handler=createHandler({env:options.env||env,fetchImpl,now:()=>x.clock});
 x.call=async(body={task:'Привет'},h=headers,method='POST')=>{
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
  await handler({method,headers:h,body},res);return res;
 };
 x.modelCalls=()=>x.calls.filter(c=>c.url.endsWith('/v1/systemone'));
 return x;
}
test('method, anonymous, revoked and unapproved users never reach inference',async()=>{
 const x=fixture();assert.equal((await x.call({},headers,'GET')).code,405);assert.equal(x.calls.length,0);
 assert.equal((await x.call({},{})).code,401);assert.equal(x.calls.length,0);
 x.allowed=false;assert.equal((await x.call()).code,403);x.allowed=true;x.active=false;assert.equal((await x.call()).code,401);
 assert.equal(x.modelCalls().length,0);
});
test('client cannot choose a model, destination, credential or owner',async()=>{
 const x=fixture();for(const body of [{task:'ok',url:'https://evil.example.com'},{task:'ok',model:'english'},{task:'ok',api_key:'key'},{task:'ok',user_id:ID},{task:'x'.repeat(1001)},'bad json',[],null]){
  assert.equal((await x.call(body)).code,400);
 }
 assert.equal(x.modelCalls().length,0);
});
test('advisory disagreement does not change actual route or start execution',async()=>{
 const x=fixture(),res=await x.call({task:'Напиши функцию'});
 assert.equal(res.code,200);assert.equal(res.headers['Cache-Control'],'no-store');
 assert.equal(res.data.baseline.route,'CODING_AGENT');assert.equal(res.data.advice.route,'LLM');assert.equal(res.data.disagreement,true);
 assert.equal(res.data.execution_changed,false);assert.equal(res.data.advice.permission_granted,false);
 assert.equal(x.calls.length,3);assert.ok(!JSON.stringify(res.data).includes('SERVER_KEY'));
});
test('disabled integration is explicit and makes only auth requests',async()=>{
 const x=fixture({env:{}}),res=await x.call();assert.equal(res.data.status,'not_configured');assert.equal(res.data.disagreement,null);assert.equal(x.calls.length,2);
});
test('owner burst limit expires and cannot consume unlimited local inference',async()=>{
 const x=fixture();for(let i=0;i<6;i++)assert.equal((await x.call()).code,200);
 assert.equal((await x.call()).code,429);assert.equal(x.modelCalls().length,6);
 x.clock+=60001;assert.equal((await x.call()).code,200);
});
test('concurrent calls are rejected and upstream failure releases active lock',async()=>{
 let release;const x=fixture({infer:()=>new Promise(resolve=>{release=()=>resolve(new Response(null,{status:503}));})});
 const first=x.call();while(!release)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await x.call()).code,429);release();assert.equal((await first).data.status,'unavailable');
 const third=x.call();await new Promise(resolve=>setImmediate(resolve));release();assert.equal((await third).code,200);
});
