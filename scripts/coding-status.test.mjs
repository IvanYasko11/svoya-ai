import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/coding-status.js';
const A='11111111-1111-4111-8111-111111111111',B='33333333-3333-4333-8333-333333333333',SID='22222222-2222-4222-8222-222222222222',JOB='55555555-5555-4555-8555-555555555555';
async function fixture(fn){
  const oldFetch=globalThis.fetch,oldKey=process.env.GITHUB_DISPATCH_TOKEN;
  const x={calls:[],owned:true,jobOwner:A,allowed:true,active:true,githubStatus:200,run:{display_title:'Coding Agent · '+JOB,status:'completed',conclusion:'success',id:42,html_url:'https://github.com/IvanYasko11/svoya-ai/actions/runs/42'}};
  process.env.GITHUB_DISPATCH_TOKEN='PRIVATE_GITHUB_KEY';
  globalThis.fetch=async(url,opts)=>{
    x.calls.push({url,opts});const id=opts.headers.Authorization?.includes('user-b-token')?B:A;
    if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id,email_confirmed_at:'2026-09-01T00:00:00Z',is_anonymous:false}),{status:200});
    if(url.endsWith('/rpc/operator_access_check'))return new Response(JSON.stringify({user_id:id,session_id:SID,active_session:x.active,allowed:x.allowed}),{status:200});
    if(url.includes('/operator_jobs?'))return new Response(JSON.stringify(x.owned&&x.jobOwner===id?[{task_id:JOB,user_id:id}]:[]),{status:200});
    if(url.includes('/actions/runs?'))return new Response(JSON.stringify(x.githubStatus===200?{workflow_runs:x.run?[x.run]:[]}:{error:'PRIVATE_GITHUB_KEY'}),{status:x.githubStatus});
    if(url.includes('/pulls?'))return new Response('[]',{status:200});
    throw new Error('Unexpected URL');
  };
  x.call=async({taskId=JOB,headers={authorization:'Bearer user-a-token-for-testing-123'},method='GET'}={})=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    await handler({method,headers,query:{task_id:taskId}},res);return res;
  };
  try{await fn(x);}finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.GITHUB_DISPATCH_TOKEN;else process.env.GITHUB_DISPATCH_TOKEN=oldKey;}
}
test('No token, revoked session or missing admission cannot read jobs or GitHub results',async()=>fixture(async x=>{
  assert.equal((await x.call({headers:{}})).code,401);assert.equal(x.calls.length,0);
  x.allowed=false;assert.equal((await x.call()).code,403);x.allowed=true;x.active=false;assert.equal((await x.call()).code,401);
  assert.ok(x.calls.every(c=>!c.url.includes('/operator_jobs?')&&!c.url.includes('api.github.com')));
}));
test('Other-account and unknown jobs return the same 404 and never query GitHub',async()=>fixture(async x=>{
  const foreign=await x.call({headers:{authorization:'Bearer user-b-token-for-testing-123'}});assert.equal(foreign.code,404);
  x.owned=false;const unknown=await x.call();assert.equal(unknown.code,404);assert.deepEqual(unknown.data,foreign.data);
  assert.ok(x.calls.every(c=>!c.url.includes('api.github.com')));
  assert.ok(x.calls.find(c=>c.url.includes('/operator_jobs?')).url.includes('user_id=eq.'+B));
}));
test('Only a registered owned UUID returns its run and never exposes server credentials',async()=>fixture(async x=>{
  const res=await x.call();assert.equal(res.code,200);assert.equal(res.data.status,'completed');assert.equal(res.data.run_id,42);assert.equal(res.headers['Cache-Control'],'no-store');
  assert.ok(!JSON.stringify(res.data).includes('PRIVATE_GITHUB_KEY'));
  const own=x.calls.find(c=>c.url.includes('/operator_jobs?'));assert.equal(own.opts.headers.Authorization,'Bearer user-a-token-for-testing-123');
}));
test('Malformed IDs and substring probes cannot search arbitrary runs',async()=>fixture(async x=>{
  for(const taskId of ['55','%',JOB.slice(0,-1),[JOB]])assert.equal((await x.call({taskId})).code,400);
  assert.ok(x.calls.every(c=>!c.url.includes('api.github.com')));
  x.run.display_title='Coding Agent · x'+JOB+'x';const res=await x.call();assert.equal(res.data.status,'queued');assert.ok(!('run_id'in res.data));
}));
test('GitHub key rejection remains an upstream failure and hides raw upstream errors',async()=>fixture(async x=>{
  x.githubStatus=401;const res=await x.call();assert.equal(res.code,502);assert.equal(res.data.github_status,401);assert.ok(!JSON.stringify(res.data).includes('PRIVATE_GITHUB_KEY'));
}));
