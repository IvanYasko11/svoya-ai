(function(root,factory){
  const create=factory();
  if(typeof module==='object'&&module.exports)module.exports=create;
  else root.createCloudBackup=create;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return function({url,key,fetch,validate,now=()=>Date.now()}){
    let session=null,revision=undefined;
    const base=url.replace(/\/$/,'');
    function clear(){session=null;revision=undefined;}
    async function request(path,{method='GET',body,authenticated=false}={}){
      if(authenticated&&(!session||now()>=session.expires)){clear();throw new Error('Сессия закончилась. Войди снова.');}
      const headers={'apikey':key,'Content-Type':'application/json'};
      if(authenticated)headers.Authorization='Bearer '+session.token;
      if(path.startsWith('/rest/'))headers.Prefer='return=representation';
      let response;
      try{response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}
      catch{throw new Error('Нет связи с аккаунтом. Локальные задачи сохранены. Попробуй позже.');}
      let data;
      try{data=response.status===204?null:await response.json();}
      catch{throw new Error('Сервер вернул непонятный ответ. Локальные задачи сохранены.');}
      if(!response.ok){
        if(response.status===401&&authenticated){clear();throw new Error('Сессия закончилась. Войди снова.');}
        const code=data?.error_code||data?.code;
        if(code==='email_not_confirmed')throw new Error('Подтверди почту по ссылке в письме, затем войди.');
        if(response.status===429)throw new Error('Слишком много попыток. Подожди немного.');
        if(code==='over_email_send_rate_limit'||code==='email_address_not_authorized')throw new Error('Отправка письма ограничена настройками почты Supabase. Аккаунт пока не создан.');
        if(response.status===409)throw new Error('Копия уже появилась на другом устройстве. Нажми «Проверить копию».');
        if(path.includes('/token'))throw new Error('Не удалось войти. Проверь почту, пароль и подтверждение почты.');
        throw new Error('Операция с аккаунтом не выполнена. Локальные задачи сохранены.');
      }
      return data;
    }
    function accept(data){
      if(!data?.access_token||!data?.user?.id||!Number.isFinite(data.expires_in))throw new Error('Не удалось подтвердить сессию.');
      session={token:data.access_token,id:data.user.id,email:data.user.email||'',expires:now()+data.expires_in*1000};revision=undefined;
      return session.email;
    }
    return {
      signedIn:()=>!!session,
      async login(email,password){clear();return accept(await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));},
      async signup(email,password){
        clear();const data=await request('/auth/v1/signup',{method:'POST',body:{email,password}});
        if(data?.access_token){accept(data);return true;}return false;
      },
      async logout(){try{if(session)await request('/auth/v1/logout?scope=local',{method:'POST',authenticated:true});}finally{clear();}},
      async read(){
        const data=await request('/rest/v1/organizer_backups?select=state,revision,updated_at&user_id=eq.'+encodeURIComponent(session?.id||''),{authenticated:true});
        if(!Array.isArray(data)||data.length>1)throw new Error('Не удалось прочитать копию.');
        if(!data.length){revision=null;return null;}
        const row=data[0];if(!Number.isSafeInteger(row.revision)||row.revision<1)throw new Error('Некорректная версия копии.');
        const state=validate(row.state);revision=row.revision;return {state,revision,updatedAt:row.updated_at};
      },
      async write(state){
        const clean=validate(state);
        if(revision===undefined)throw new Error('Сначала нажми «Проверить копию».');
        const insert=revision===null;
        const path='/rest/v1/organizer_backups'+(insert?'':'?user_id=eq.'+encodeURIComponent(session?.id||'')+'&revision=eq.'+revision);
        const data=await request(path,{method:insert?'POST':'PATCH',authenticated:true,body:insert?{user_id:session?.id,state:clean}:{state:clean}});
        if(!Array.isArray(data)||data.length!==1){revision=undefined;throw new Error('Копия изменена на другом устройстве. Нажми «Проверить копию» перед повторным сохранением.');}
        if(!Number.isSafeInteger(data[0].revision)||data[0].revision<1){revision=undefined;throw new Error('Сервер не подтвердил сохранение. Проверь копию.');}
        revision=data[0].revision;return {revision,updatedAt:data[0].updated_at};
      }
    };
  };
});
