import router from '../scripts/provider-router.cjs';
export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const configured=Object.entries(router.PROVIDERS).filter(([,p])=>Boolean(String(process.env[p.keyEnv]||'').trim())).map(([name])=>name);
  return res.status(200).json({status:configured.length?'CONFIGURED_NOT_TESTED':'NO_PROVIDER_CONFIGURED',configured_providers:configured,environment:process.env.VERCEL_ENV||'unknown',note:'Проверяется только наличие настройки. Работоспособность ключа и квота требуют запроса к модели.'});
}
