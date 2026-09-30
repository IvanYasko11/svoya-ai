import operatorAuth from '../lib/operator-auth.cjs';
import laya from '../lib/laya-adapter.cjs';
import routing from '../lib/intent-routing.cjs';
export function createHandler({fetchImpl=fetch,env=process.env,now=()=>Date.now()}={}){
 const active=new Set(),starts=new Map();
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const user=await operatorAuth.requireOperator(req,res,{fetchImpl});if(!user)return;
  let task;
  try{const body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>k!=='task'))throw Error();laya.requestFor(body.task);task=body.task.trim();}
  catch{return res.status(400).json({error:'Передай только текст запроса от 1 до 1000 символов.'});}
  const time=now();for(const [id,times] of starts){if(!times.some(t=>t>time-60000)&&!active.has(id))starts.delete(id);}
  const recent=(starts.get(user.id)||[]).filter(t=>t>time-60000);
  if(active.has(user.id)||recent.length>=6)return res.status(429).json({error:'Подожди минуту перед следующим сравнением.'});
  starts.set(user.id,[...recent,time]);active.add(user.id);
  try{const comparison=await laya.compare(task,{fetchImpl,env});return res.status(200).json({ok:true,baseline:routing.classifyIntent(task),...comparison,disagreement:comparison.advice?comparison.advice.route!==routing.classifyIntent(task).route:null,note:'Это сравнение классификаторов. Оно не выполняет запрос, не разрешает действий и не меняет задачи.'});}
  finally{active.delete(user.id);}
 };
}
export default createHandler();
