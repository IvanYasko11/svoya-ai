const http=require("http");
const RETRYABLE=new Set([408,409,425,429,500,502,503,504]);
const PROVIDERS={
 openrouter:{keyEnv:"OPENROUTER_API_KEY",baseUrl:"https://openrouter.ai/api/v1/chat/completions",defaultModel:"openrouter/free",modelEnv:"OPENROUTER_CODING_MODEL",fallbackModel:"qwen/qwen3.8-27b:free",secondFallback:"openrouter/free"},
 groq:{keyEnv:"GROQ_API_KEY",baseUrl:"https://api.groq.com/openai/v1/chat/completions",defaultModel:"openai/gpt-oss-120b",modelEnv:"GROQ_CODING_MODEL"},
 gemini:{keyEnv:"GEMINI_API_KEY",baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",defaultModel:"gemini-3.8-flash",modelEnv:"GEMINI_CODING_MODEL"},
 mistral:{keyEnv:"MISTRAL_API_KEY",baseUrl:"https://api.mistral.ai/v1/chat/completions",defaultModel:"mistral-small-latest",modelEnv:"MISTRAL_CODING_MODEL"}
};
const ORDER=["openrouter","groq","gemini","mistral"];
function inferProvider(model,env=process.env){
 const explicit=String(env.SVOYA_PRIMARY_PROVIDER||"").trim().toLowerCase();
 if(PROVIDERS[explicit]) return explicit;
 const prefix=String(model||"").split(":")[0].split("/")[0].toLowerCase();
 return PROVIDERS[prefix]?prefix:"openrouter";
}
function hasKey(p,env=process.env){return Boolean(String(env[PROVIDERS[p].keyEnv]||"").trim());}
function modelForProvider(p,requested,env=process.env){
 const cfg=PROVIDERS[p],r=String(requested||"").trim(),primary=inferProvider(r,env);
 if(p===primary){
  if(p==="openrouter"||!r.includes("/")) return r||cfg.defaultModel;
  const prefix=r.split("/")[0].toLowerCase();
  if(prefix===p) return r.slice(p.length+1)||cfg.defaultModel;
 }
 return String(env[cfg.modelEnv]||"").trim()||cfg.defaultModel;
}
function openrouterModels(requested,env=process.env){
 return [modelForProvider("openrouter",requested,env),env.OPENROUTER_FALLBACK_MODEL||PROVIDERS.openrouter.fallbackModel,env.OPENROUTER_SECOND_FALLBACK_MODEL||PROVIDERS.openrouter.secondFallback]
  .map(x=>String(x||"").trim()).filter((x,i,a)=>x&&a.indexOf(x)===i);
}
function candidates(requested,env=process.env){
 const primary=inferProvider(requested,env),out=[];
 if(hasKey(primary,env)){
  if(primary==="openrouter") for(const model of openrouterModels(requested,env)) out.push({provider:primary,model});
  else out.push({provider:primary,model:modelForProvider(primary,requested,env)});
 }
 for(const p of ORDER){
  if(p===primary||!hasKey(p,env)) continue;
  if(p==="openrouter") for(const model of openrouterModels("",env)) out.push({provider:p,model});
  else out.push({provider:p,model:modelForProvider(p,"",env)});
 }
 return out;
}
function isAccountQuotaError(status,text){
 return status===429&&/free-models-per-day|free model.*daily|daily quota|add 10 credits|free-models.*limit/i.test(String(text||""));
}
function providerHeaders(p,env=process.env){
 const h={Authorization:"Bearer "+env[PROVIDERS[p].keyEnv],"Content-Type":"application/json"};
 if(p==="openrouter"){h["HTTP-Referer"]="https://svoya-ai.vercel.app";h["X-Title"]="Svoya AI Provider Router";}
 if(p==="gemini") h["x-goog-api-client"]="svoya-ai/1.7";
 return h;
}
async function requestWithFallback(body,{env=process.env,fetchImpl=fetch}={}){
 const list=candidates(body?.model,env);
 if(!list.length) return {ok:false,status:503,provider:null,model:null,code:"NO_PROVIDER_CONFIGURED",attempts:[],text:JSON.stringify({error:{message:"No LLM provider configured."}})};
 let last={ok:false,status:502,provider:null,model:null,code:"PROVIDER_ROUTER_FAILURE",attempts:[]};
 const skipped=new Set();
 for(const item of list){
  if(skipped.has(item.provider)) continue;
  try{
   const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),90000);
   let response;
   try{response=await fetchImpl(PROVIDERS[item.provider].baseUrl,{method:"POST",headers:providerHeaders(item.provider,env),body:JSON.stringify({...body,model:item.model}),signal:ctl.signal});}
   finally{clearTimeout(timer);}
   const text=await response.text(),attempts=last.attempts.concat({provider:item.provider,model:item.model,status:response.status});
   if(response.ok||!RETRYABLE.has(response.status)) return {ok:response.ok,status:response.status,provider:item.provider,model:item.model,code:response.ok?null:"PROVIDER_ERROR",attempts,text};
   if(isAccountQuotaError(response.status,text)){
    console.log("SVoya Provider Router: account quota exhausted for OpenRouter; skip remaining OpenRouter models.");
    skipped.add(item.provider);
    last={ok:false,status:response.status,provider:item.provider,model:item.model,code:"ACCOUNT_QUOTA_EXHAUSTED",attempts,text};
    continue;
   }
   last={ok:false,status:response.status,provider:item.provider,model:item.model,code:"RETRYABLE_PROVIDER_ERROR",attempts,text};
  }catch(error){
   last={ok:false,status:504,provider:item.provider,model:item.model,code:error?.name==="AbortError"?"PROVIDER_TIMEOUT":"PROVIDER_REQUEST_FAILED",attempts:last.attempts.concat({provider:item.provider,model:item.model,status:0,error:error?.name==="AbortError"?"timeout":"request_failed"}),text:JSON.stringify({error:{message:"Provider request failed."}})};
  }
 }
 return {...last,text:JSON.stringify({error:{message:last.code==="ACCOUNT_QUOTA_EXHAUSTED"?"OpenRouter free quota is exhausted and no alternate configured provider succeeded.":"All configured LLM providers failed.",code:last.code,provider:last.provider,model:last.model,attempts:last.attempts}})};
}
function createBrokerServer({port=8786,role="agent",env=process.env,fetchImpl=fetch}={}){
 return http.createServer((req,res)=>{
  if(req.method==="GET"&&req.url==="/v1/models"){res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({object:"list",data:[{id:role==="repair"?"repair":"agent",object:"model",owned_by:"svoya-ai"}]}));return;}
  if(req.method!=="POST"||req.url!=="/v1/chat/completions"){res.writeHead(404);res.end();return;}
  let body="";req.setEncoding("utf8");req.on("data",chunk=>{body+=chunk;if(body.length>260000)req.destroy();});
  req.on("end",async()=>{try{
   const payload=JSON.parse(body);
   if(!payload||!Array.isArray(payload.messages)){res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"Invalid chat completion payload."}}));return;}
   const r=await requestWithFallback(payload,{env,fetchImpl});
   res.writeHead(r.status,{"Content-Type":"application/json","X-Svoya-Provider":r.provider||"none","X-Svoya-Model":r.model||"none"});res.end(r.text);
  }catch{res.writeHead(400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"Invalid broker request."}}));}});
 });
}
if(require.main===module){
 const port=Number(process.env.SVOYA_BROKER_PORT||process.argv[2]||8786),role=process.env.SVOYA_BROKER_ROLE||"agent";
 const server=createBrokerServer({port,role});server.listen(port,"127.0.0.1",()=>console.log("SVoya Provider Router broker listening on 127.0.0.1:"+port+" ("+role+")"));
}
module.exports={PROVIDERS,inferProvider,modelForProvider,isAccountQuotaError,candidates,requestWithFallback,createBrokerServer};
