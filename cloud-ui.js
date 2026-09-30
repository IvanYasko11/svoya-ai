(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  if(!window.SvoyaCloudConfig||!window.createCloudBackup)return;
  const cloud=window.createCloudBackup({...window.SvoyaCloudConfig,fetch:window.fetch.bind(window),validate:window.SvoyaOrganizer.validate});
  const controls=['cloudLogin','cloudSignup','cloudLogout','cloudCheck','cloudSave','cloudRestore','cloudAuto'];
  let busy=false,baseline=undefined,autoReady=false,autoSaving=false,saveTimer=null,localEpoch=0;
  function stopTimer(){if(saveTimer!==null){clearTimeout(saveTimer);saveTimer=null;}}
  function sameAsCopy(){return JSON.stringify(window.organizerBackup.snapshot().state)===baseline;}
  function scheduleSave(){
    stopTimer();
    if(busy||!autoReady||!cloud.signedIn()||!$('cloudAuto').checked)return;
    try{if(sameAsCopy())return;}catch{autoReady=false;syncState();return;}
    saveTimer=setTimeout(()=>{saveTimer=null;return run(saveCurrent,true);},800);
  }
  async function saveCurrent(){
    const snapshot=window.organizerBackup.snapshot(),epoch=localEpoch;
    const copy=await cloud.write(snapshot.state);
    baseline=JSON.stringify(snapshot.state);autoReady=epoch===localEpoch;
    $('cloudMessage').textContent='Копия сохранена в аккаунте · версия '+copy.revision+'.';
  }
  function syncState(){
    if(!cloud.signedIn()){$('cloudSyncState').textContent='Задачи сохраняются на этом устройстве. Войди для сохранения в аккаунте.';return;}
    if(baseline===undefined){$('cloudSyncState').textContent='Автосохранение приостановлено. Нажми «Проверить копию».';return;}
    try{
      const current=JSON.stringify(window.organizerBackup.snapshot().state);
      $('cloudSyncState').textContent=autoSaving?'Сохраняю изменения в аккаунте. Локальная копия уже сохранена.':
        current===baseline?(autoReady&&$('cloudAuto').checked?'Список сохранён в аккаунте. Автосохранение включено.':'Текущий список совпадает с проверенной копией аккаунта.'):
        autoReady&&$('cloudAuto').checked?'Изменения сохранены в браузере. Готовлю сохранение в аккаунте…':
        'Списки различаются или копии ещё нет. Выбери «Сохранить в аккаунте» или «Восстановить из аккаунта». Автосохранение пока приостановлено.';
    }catch{$('cloudSyncState').textContent='Локальный список изменился в другой вкладке или недоступен. Обнови страницу.';}
  }
  function render(){
    const signed=cloud.signedIn();$('cloudAuth').hidden=signed;$('cloudActions').hidden=!signed;
    controls.forEach(id=>{$(id).disabled=busy;});
    syncState();
  }
  async function run(action,automatic=false){
    if(busy)return;stopTimer();busy=true;autoSaving=automatic;render();$('cloudMessage').textContent='Подожди…';
    try{await action();}catch(e){autoReady=false;baseline=undefined;$('cloudMessage').textContent=e.message+' Автосохранение остановлено; задачи остаются в браузере.';}
    finally{busy=false;autoSaving=false;render();scheduleSave();}
  }
  async function check(){
    const copy=await cloud.read();
    baseline=copy?JSON.stringify(copy.state):null;
    autoReady=!!copy&&sameAsCopy();
    $('cloudMessage').textContent=copy?'В аккаунте '+copy.state.tasks.length+' задач · версия '+copy.revision+'. Выбери, какой список сохранить.':'В аккаунте пока нет копии. Можно сохранить текущие задачи.';
  }
  $('cloudAuth').onsubmit=e=>{e.preventDefault();return run(async()=>{
    const password=$('cloudPassword').value;$('cloudPassword').value='';
    autoReady=false;baseline=undefined;const email=await cloud.login($('cloudEmail').value.trim(),password);$('cloudAccount').textContent=email;await check();
  });};
  $('cloudSignup').onclick=()=>run(async()=>{
    if(!$('cloudAuth').reportValidity())throw new Error('Укажи почту и пароль от 8 символов.');
    const password=$('cloudPassword').value;$('cloudPassword').value='';
    autoReady=false;baseline=undefined;const signed=await cloud.signup($('cloudEmail').value.trim(),password);
    if(signed){$('cloudAccount').textContent=$('cloudEmail').value.trim();await check();}
    else $('cloudMessage').textContent='Если регистрация доступна, письмо подтверждения придёт на почту. Подтверди адрес и вернись сюда, чтобы войти. Задачи пока только в этом браузере.';
  });
  $('cloudLogout').onclick=()=>run(async()=>{autoReady=false;baseline=undefined;await cloud.logout();$('cloudAccount').textContent='';$('cloudMessage').textContent='Выход выполнен. Локальный список остаётся на этом устройстве. На общем устройстве очисти данные сайта после экспорта.';});
  $('cloudCheck').onclick=()=>run(check);
  $('cloudSave').onclick=()=>run(async()=>{
    if(!confirm('Сохранить текущий список в аккаунте? Это заменит прежнюю облачную копию.')){$('cloudMessage').textContent='Сохранение отменено.';return;}
    await saveCurrent();
  });
  $('cloudRestore').onclick=()=>run(async()=>{
    if(!confirm('Заменить задачи в этом браузере копией из аккаунта? Сначала скачай резервную копию текущего списка.')){$('cloudMessage').textContent='Восстановление отменено.';return;}
    const snapshot=window.organizerBackup.snapshot(),copy=await cloud.read();
    if(!copy)throw new Error('В аккаунте пока нет копии.');
    window.organizerBackup.restore(copy.state,snapshot.raw);
    baseline=JSON.stringify(copy.state);autoReady=true;
    $('cloudMessage').textContent='Список восстановлен из аккаунта. Новые изменения будут сохраняться автоматически, если включено автосохранение.';
  });
  // Confirmation links can carry tokens. This app uses password login; discard them.
  if(/(?:access_token|refresh_token|error_description)=/.test(location.hash))history.replaceState(null,'',location.pathname+location.search+'#cloud');
  $('cloudAuto').onchange=()=>{syncState();scheduleSave();};
  window.addEventListener?.('svoya:tasks-saved',()=>{syncState();scheduleSave();});
  window.addEventListener?.('storage',e=>{
    if(e.key!==window.SvoyaOrganizer.KEY)return;
    localEpoch++;autoReady=false;stopTimer();syncState();
  });
  render();
})();
