const assert=require("node:assert/strict");
const test=require("node:test");
const {requestWithFallback}=require("./provider-router.cjs");

function fakeFetch(sequence,calls){
 let i=0;
 return async(url,options)=>{
  calls.push(JSON.parse(options.body));
  const item=sequence[Math.min(i++,sequence.length-1)];
  return new Response(JSON.stringify(item.body||{}),{status:item.status,headers:{"content-type":"application/json"}});
 };
}

test("OpenRouter account quota stops same-provider retries",async()=>{
 const calls=[];
 const r=await requestWithFallback({model:"cohere/north-mini-code:free",messages:[{role:"user",content:"x"}]},{env:{OPENROUTER_API_KEY:"test"},fetchImpl:fakeFetch([{status:429,body:{error:{message:"Rate limit exceeded: free-models-per-day"}}}],calls)});
 assert.equal(r.code,"ACCOUNT_QUOTA_EXHAUSTED");
 assert.equal(calls.length,1);
});

test("Temporary OpenRouter 429 can try another model",async()=>{
 const calls=[];
 const r=await requestWithFallback({model:"cohere/north-mini-code:free",messages:[{role:"user",content:"x"}]},{env:{OPENROUTER_API_KEY:"test"},fetchImpl:fakeFetch([{status:429,body:{error:{message:"Too many requests"}}},{status:200,body:{choices:[{message:{content:"ok"}}]}}],calls)});
 assert.equal(r.ok,true);
 assert.equal(r.provider,"openrouter");
 assert.equal(calls.length,2);
});

test("OpenRouter account quota falls through to Groq",async()=>{
 const calls=[];
 const r=await requestWithFallback({model:"cohere/north-mini-code:free",messages:[{role:"user",content:"x"}]},{env:{OPENROUTER_API_KEY:"test",GROQ_API_KEY:"test"},fetchImpl:fakeFetch([{status:429,body:{error:{message:"free-models-per-day exhausted"}}},{status:200,body:{choices:[{message:{content:"groq ok"}}]}}],calls)});
 assert.equal(r.ok,true);
 assert.equal(r.provider,"groq");
 assert.equal(calls.length,2);
});

test("Auth errors do not fan out to other providers",async()=>{
 const calls=[];
 const r=await requestWithFallback({model:"cohere/north-mini-code:free",messages:[{role:"user",content:"x"}]},{env:{OPENROUTER_API_KEY:"test",GROQ_API_KEY:"test"},fetchImpl:fakeFetch([{status:401,body:{error:{message:"invalid api key"}}}],calls)});
 assert.equal(r.code,"PROVIDER_ERROR");
 assert.equal(calls.length,1);
});
