import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/chat.js';
const A='11111111-1111-4111-8111-111111111111',B='33333333-3333-4333-8333-333333333333',SID='22222222-2222-4222-8222-222222222222';
const TASK='Напиши JavaScript функцию сложения';
async function fixture(fn){
  const oldFetch=globalThis.fetch,saved={...process.env};
  const x={calls:[],approvals:[],jobs:[],histories:[],dispatches:[],active:true,allowed:true,sid:SID,failOwnership:false,revokeOnOwnership:false};
  Object.assign(process.env,{SUPABASE_SECRET_KEY:'SERVER_DB_KEY',GITHUB_DISPATCH_TOKEN:'SERVER_GITHUB_KEY',OPENROUTER_API_KEY:'SERVER_LLM_KEY',SVOYA_PRIMARY_PROVIDER:'openrouter'});
  globalThis.fetch=async(url,opts)=>{
    x.calls.push({url,opts});const caller=opts.headers.Authorization?.includes('user-b-token')?B:A;
    if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:caller,email_confirmed_at:'2026-09-01T00:00:00Z',is_anonymous:false,user_metadata:{owner:true}}),{status:200});
    if(url.endsWith('/rpc/operator_access_check'))return new Response(JSON.stringify({user_id:caller,session_id:x.sid,active_session:x.active,allowed:x.allowed}),{status:200});
    if(url.includes('/coding_approvals')){
      if(opts.method==='POST'){x.approvals.push({...JSON.parse(opts.body),id:'approval',status:'pending',expires_at:Date.now()+600000});return new Response(null,{status:201});}
      const q=new URL(url).searchParams,eq=k=>(q.get(k)||'').slice(3);
      const record=x.approvals.find(r=>r.approval_token_hash===eq('approval_token_hash')&&r.task_hash===eq('task_hash')&&r.session_hash===eq('session_hash')&&r.user_id===eq('user_id')&&r.status==='pending'&&r.expires_at>Date.now());
      if(record)record.status='used';return new Response(JSON.stringify(record?[{id:record.id,task_id:record.task_id}]:[]),{status:200});
    }
    if(url.endsWith('/operator_jobs')){
      if(x.failOwnership)return new Response('{}',{status:503});
      const job=JSON.parse(opts.body);x.jobs.push(job);if(x.revokeOnOwnership)x.active=false;return new Response(JSON.stringify([job]),{status:201});
    }
    if(url.endsWith('/dispatches')){x.dispatches.push(JSON.parse(opts.body));return new Response(null,{status:204});}
    if(url.endsWith('/tasks')){x.histories.push(JSON.parse(opts.body));return new Response(null,{status:201});}
    if(url==='https://openrouter.ai/api/v1/chat/completions'){x.model=JSON.parse(opts.body);return new Response(JSON.stringify({choices:[{message:{content:'Ответ'}}]}),{status:200});}
    throw new Error('Unexpected request');
  };
  x.call=async(body,headers={authorization:'Bearer user-a-token-long-enough-for-test'})=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    await handler({method:'POST',body,headers},res);return res;
  };
  x.approve=async()=>{const res=await x.call({task:TASK});assert.equal(res.code,409);const cookies=res.headers['Set-Cookie'].map(c=>c.split(';')[0]).join('; ');return {res,cookies};};
  try{await fn(x);}finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
}
test('Anonymous, unapproved members and revoked sessions cannot call LLM, create approvals or dispatch jobs',async()=>fixture(async x=>{
  assert.equal((await x.call({task:TASK,preview:true},{})).code,401);assert.equal(x.calls.length,0);
  x.allowed=false;assert.equal((await x.call({task:TASK,confirmed:true})).code,403);
  x.allowed=true;x.active=false;assert.equal((await x.call({task:'Привет'})).code,401);
  assert.equal(x.dispatches.length,0);assert.equal(x.approvals.length,0);assert.equal(x.model,undefined);
}));
test('Approval, job reservation and request history use verified account identity, ignoring a forged owner in the body',async()=>fixture(async x=>{
  const {cookies}=await x.approve();assert.equal(x.approvals[0].user_id,A);
  const res=await x.call({task:TASK,confirmed:true,user_id:B},{authorization:'Bearer user-a-token-long-enough-for-test',cookie:cookies});
  assert.equal(res.code,202);assert.equal(x.jobs[0].user_id,A);assert.equal(x.histories[0].user_id,A);assert.equal(x.dispatches.length,1);
  assert.equal(x.dispatches[0].client_payload.task_id,x.jobs[0].task_id);assert.equal(x.dispatches[0].client_payload.apply_changes,'true');
  const ownIndex=x.calls.findIndex(c=>c.url.endsWith('/operator_jobs')),dispatchIndex=x.calls.findIndex(c=>c.url.endsWith('/dispatches'));assert.ok(ownIndex<dispatchIndex);
}));
test('Copied browser approval cookies cannot be consumed by a different account or a new sign-in session',async()=>fixture(async x=>{
  const {cookies}=await x.approve();
  assert.equal((await x.call({task:TASK,confirmed:true},{authorization:'Bearer user-b-token-long-enough-for-test',cookie:cookies})).code,403);
  x.sid='44444444-4444-4444-8444-444444444444';
  assert.equal((await x.call({task:TASK,confirmed:true},{authorization:'Bearer user-a-token-long-enough-for-test',cookie:cookies})).code,403);
  assert.equal(x.dispatches.length,0);assert.equal(x.approvals[0].status,'pending');
}));
test('Changed tasks, expired approval, malformed cookies and replay do not launch another job',async()=>fixture(async x=>{
  const {cookies}=await x.approve(),headers={authorization:'Bearer user-a-token-long-enough-for-test',cookie:cookies};
  assert.equal((await x.call({task:TASK+' и ещё действие',confirmed:true},headers)).code,403);
  assert.equal((await x.call({task:TASK,confirmed:true},{...headers,cookie:'svoya_session=%bad; svoya_approval=%bad'})).code,403);
  x.approvals[0].expires_at=0;assert.equal((await x.call({task:TASK,confirmed:true},headers)).code,403);
  x.approvals[0].expires_at=Date.now()+600000;
  const results=await Promise.all([x.call({task:TASK,confirmed:true},headers),x.call({task:TASK,confirmed:true},headers)]);
  assert.deepEqual(results.map(r=>r.code).sort(),[202,403]);assert.equal(x.dispatches.length,1);
}));
test('Owner persistence failure or session revocation while reserving a job prevents external execution',async()=>fixture(async x=>{
  x.failOwnership=true;assert.equal((await x.call({task:TASK,preview:true})).code,503);assert.equal(x.dispatches.length,0);
  x.failOwnership=false;x.revokeOnOwnership=true;assert.equal((await x.call({task:TASK,preview:true})).code,401);assert.equal(x.dispatches.length,0);
}));
test('Chat history is owner-bound and model messages never contain account/session or backend credentials',async()=>fixture(async x=>{
  const res=await x.call({task:'Подскажи следующий шаг',user_id:B});assert.equal(res.code,200);assert.equal(x.histories[0].user_id,A);
  const text=JSON.stringify(x.model);for(const secret of [A,SID,'user-a-token','SERVER_DB_KEY','SERVER_GITHUB_KEY','SERVER_LLM_KEY'])assert.ok(!text.includes(secret));
  assert.equal(x.histories[0].answer,'Ответ');
}));
