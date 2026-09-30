(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const views=[...document.querySelectorAll('[data-view]')];
 const nav=[...document.querySelectorAll('[data-nav]')];
 const labels={assistant:'Чат с ИИ',home:'Сегодня',tasks:'Мои задачи',account:'Аккаунт и сохранение'};
 const hashes={assistant:'#assistant',home:'#home',tasks:'#tasks',account:'#cloud'};
 function fromHash(){return ({'#assistant':'assistant','#home':'home','#tasks':'tasks','#taskList':'tasks','#orgEditor':'tasks','#cloud':'account'})[location.hash]||'assistant';}
 window.openSvoyaView=function(name,{focus=false,updateHash=true}={}){
   if(!Object.hasOwn(labels,name))return;
   views.forEach(v=>{v.hidden=v.dataset.view!==name;});
   nav.forEach(a=>{if(a.dataset.nav===name)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
   $('viewTitle').textContent=labels[name];
   if(updateHash&&location.hash!==hashes[name])history.replaceState(null,'',location.pathname+location.search+hashes[name]);
   if(name==='account')$('cloud').open=true;
   if(focus)$('mainContent').focus({preventScroll:true});
 };
 document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{
   const target=({'#assistant':'assistant','#home':'home','#tasks':'tasks','#taskList':'tasks','#cloud':'account'})[a.getAttribute('href')];
   if(!target)return;e.preventDefault();window.openSvoyaView(target,{focus:true});
   if(a.id==='sidebarNew')$('orgNew').click();
 }));
 window.addEventListener('hashchange',()=>window.openSvoyaView(fromHash(),{updateHash:false}));
 $('task').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();if(!$('run').disabled)$('run').click();}});
 document.querySelectorAll('[data-chat-prompt]').forEach(b=>b.addEventListener('click',()=>{
   $('task').value=b.dataset.chatPrompt;
   if(/моим задачам/.test(b.dataset.chatPrompt))$('orgShare').checked=true;
   $('task').focus();
 }));
 function answerState(){
   const hasAnswer=Boolean($('result').textContent.trim());
   document.querySelector('.chat-intro').hidden=hasAnswer;
   $('answerLabel').hidden=!hasAnswer;
 }
 new MutationObserver(answerState).observe($('result'),{childList:true,characterData:true,subtree:true});
 function sessionState(){
   const signed=!$('cloudActions').hidden;
   $('sessionLabel').textContent=signed?'Аккаунт подключён':'Войти для ИИ';
   $('navAccountState').replaceChildren(document.createTextNode(signed?'Мой аккаунт':'Войти в аккаунт'));
   const sub=document.createElement('small');sub.textContent=signed?'Задачи и резервная копия':'Сохранение между устройствами';$('navAccountState').append(sub);
 }
 new MutationObserver(sessionState).observe($('cloudActions'),{attributes:true,attributeFilter:['hidden']});
 window.openSvoyaView(fromHash(),{updateHash:false});answerState();sessionState();
})();
