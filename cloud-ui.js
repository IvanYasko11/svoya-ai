(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  if(!window.SvoyaCloudConfig||!window.createCloudBackup)return;
  const cloud=window.createCloudBackup({...window.SvoyaCloudConfig,fetch:window.fetch.bind(window),validate:window.SvoyaOrganizer.validate});
  const controls=['cloudLogin','cloudSignup','cloudLogout','cloudCheck','cloudSave','cloudRestore'];
  let busy=false,baseline=undefined;
  function syncState(){
    if(!cloud.signedIn()){$('cloudSyncState').textContent='Задачи сохраняются на этом устройстве. Войди для сохранения в аккаунте.';return;}
    if(baseline===undefined){$('cloudSyncState').textContent='Статус копии неизвестен. Нажми «Проверить копию».';return;}
    try{
      const current=JSON.stringify(window.organizerBackup.snapshot().state);
      $('cloudSyncState').textContent=current===baseline?'Текущий список совпадает с проверенной копией аккаунта.':'Есть локальные изменения. Нажми «Сохранить в аккаунте», чтобы перенести их на другое устройство.';
    }catch{$('cloudSyncState').textContent='Локальный список изменился в другой вкладке или недоступен. Обнови страницу.';}
  }
  function render(){
    const signed=cloud.signedIn();$('cloudAuth').hidden=signed;$('cloudActions').hidden=!signed;
    controls.forEach(id=>{$(id).disabled=busy;});
    syncState();
  }
  async function run(action){
    if(busy)return;busy=true;render();$('cloudMessage').textContent='Подожди…';
    try{await action();}catch(e){baseline=undefined;$('cloudMessage').textContent=e.message;}
    finally{busy=false;render();}
  }
  async function check(){
    const copy=await cloud.read();
    baseline=copy?JSON.stringify(copy.state):null;
    $('cloudMessage').textContent=copy?'В аккаунте '+copy.state.tasks.length+' задач · версия '+copy.revision+'. Выбери, какой список сохранить.':'В аккаунте пока нет копии. Можно сохранить текущие задачи.';
  }
  $('cloudAuth').onsubmit=e=>{e.preventDefault();return run(async()=>{
    const password=$('cloudPassword').value;$('cloudPassword').value='';
    baseline=undefined;const email=await cloud.login($('cloudEmail').value.trim(),password);$('cloudAccount').textContent=email;await check();
  });};
  $('cloudSignup').onclick=()=>run(async()=>{
    if(!$('cloudAuth').reportValidity())throw new Error('Укажи почту и пароль от 8 символов.');
    const password=$('cloudPassword').value;$('cloudPassword').value='';
    const signed=await cloud.signup($('cloudEmail').value.trim(),password);
    if(signed){$('cloudAccount').textContent=$('cloudEmail').value.trim();await check();}
    else $('cloudMessage').textContent='Если регистрация доступна, письмо подтверждения придёт на почту. Подтверди адрес и вернись сюда, чтобы войти. Задачи пока только в этом браузере.';
  });
  $('cloudLogout').onclick=()=>run(async()=>{await cloud.logout();$('cloudAccount').textContent='';$('cloudMessage').textContent='Выход выполнен. Локальный список остаётся на этом устройстве. На общем устройстве очисти данные сайта после экспорта.';});
  $('cloudCheck').onclick=()=>run(check);
  $('cloudSave').onclick=()=>run(async()=>{
    if(!confirm('Сохранить текущий список в аккаунте? Это заменит прежнюю облачную копию.')){$('cloudMessage').textContent='Сохранение отменено.';return;}
    const snapshot=window.organizerBackup.snapshot();const copy=await cloud.write(snapshot.state);
    baseline=JSON.stringify(snapshot.state);
    $('cloudMessage').textContent='Копия сохранена в аккаунте · версия '+copy.revision+'. Новые изменения сохраняй этой кнопкой.';
  });
  $('cloudRestore').onclick=()=>run(async()=>{
    if(!confirm('Заменить задачи в этом браузере копией из аккаунта? Сначала скачай резервную копию текущего списка.')){$('cloudMessage').textContent='Восстановление отменено.';return;}
    const snapshot=window.organizerBackup.snapshot(),copy=await cloud.read();
    if(!copy)throw new Error('В аккаунте пока нет копии.');
    window.organizerBackup.restore(copy.state,snapshot.raw);
    baseline=JSON.stringify(copy.state);
    $('cloudMessage').textContent='Список восстановлен из аккаунта. Изменения сохраняются локально; для переноса нажимай «Сохранить в аккаунте».';
  });
  // Confirmation links can carry tokens. This app uses password login; discard them.
  if(/(?:access_token|refresh_token|error_description)=/.test(location.hash))history.replaceState(null,'',location.pathname+location.search+'#cloud');
  window.addEventListener?.('svoya:tasks-saved',syncState);
  window.addEventListener?.('storage',syncState);
  render();
})();
