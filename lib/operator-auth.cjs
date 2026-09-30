const config=require('../cloud-config.js');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function requireOperator(req,res,{fetchImpl=fetch}={}){
  const fail=(status,error,code)=>{res.status(status).json({error,error_code:code});return null;};
  const token=req.headers?.authorization;
  if(typeof token!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(token))return fail(401,'Для работы помощника войди в аккаунт в разделе «Аккаунт».','UNAUTHENTICATED');
  try{
    const headers={apikey:config.key,Authorization:token};
    const response=await fetchImpl(config.url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
    if(!response.ok)return fail(response.status===401||response.status===403?401:503,'Не удалось подтвердить вход. Войди снова или повтори позже.','UNAUTHENTICATED');
    const user=await response.json();
    if(!UUID.test(user?.id||'')||user.is_anonymous===true||!user.email_confirmed_at)return fail(401,'Нужен вход с подтверждённой почтой.','UNAUTHENTICATED');
    const access=await fetchImpl(config.url+'/rest/v1/rpc/operator_access_check',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
    if(!access.ok)return fail(503,'Проверка доступа временно недоступна. Повтори позже.','AUTH_UNAVAILABLE');
    const gate=await access.json();
    if(gate?.user_id!==user.id||typeof gate.active_session!=='boolean'||typeof gate.allowed!=='boolean')return fail(503,'Сервис доступа не подтвердил аккаунт.','AUTH_UNAVAILABLE');
    if(!gate.active_session||!UUID.test(gate.session_id||''))return fail(401,'Сессия завершилась или была отозвана. Войди снова.','UNAUTHENTICATED');
    if(!gate.allowed)return fail(403,'Доступ к ИИ разрешён только аккаунту владельца проекта.','ACCESS_DENIED');
    return {id:user.id,sessionId:gate.session_id};
  }catch{return fail(503,'Нет связи с сервисом входа. Повтори позже.','AUTH_UNAVAILABLE');}
}
module.exports={requireOperator,UUID};
