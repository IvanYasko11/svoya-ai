(function() {
  'use strict';
  const O=window.SvoyaOrganizer, $=id=>document.getElementById(id);
  const labels={active:'В работе',waiting:'Заблокировано',deferred:'Отложено',done:'Готово',archived:'Архив'};
  let state, raw=null, editing=null, storage;
  let proposed=null, proposalRaw=null;
  function message(s){$('organizerMessage').textContent=s;}
  try {storage=window.localStorage; state=O.load(storage); raw=storage.getItem(O.KEY);}
  catch {state=null; message('Не удалось прочитать задачи. Сохранённые данные не перезаписаны. Проверь доступ к хранилищу или импортируй резервную копию.');}
  function commit(next, recovery=false) {
    try {
      if(!recovery && storage.getItem(O.KEY)!==raw) throw new Error('Задачи изменены в другой вкладке. Обнови страницу перед сохранением.');
      const clean=O.save(storage,next); state=clean; raw=storage.getItem(O.KEY); render();
      message('Сохранено в этом браузере.'); return true;
    } catch(e){message('Не сохранено: '+e.message); return false;}
  }
  function node(tag,text){const e=document.createElement(tag); if(text!==undefined)e.textContent=text; return e;}
  function row(t){
    const e=node('article'); e.className='org-task';
    e.setAttribute?.('data-status',t.status);
    e.append(node('strong',t.title),node('div','Приоритет '+t.priority+' · '+labels[t.status]+(t.due?' · '+t.due:'')),node('p','Следующий шаг: '+(t.next||'Не задан')));
    if(t.blocker)e.append(node('p','Препятствие: '+t.blocker));
    if(t.status==='active'){
      const done=node('button','✓ Готово');done.type='button';done.className='task-done';done.onclick=()=>commit(O.upsert(state,{...t,status:'done'}));e.append(done);
    }
    const b=node('button','Изменить'); b.type='button';b.className='task-edit'; b.onclick=()=>edit(t); e.append(b); return e;
  }
  function localDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function render(){
    const list=$('organizerList'), focus=$('organizerToday'); list.replaceChildren();focus.replaceChildren();
    if(!state){list.append(node('p','Задачи пока недоступны.'));return;}
    $('orgActiveCount').textContent=state.tasks.filter(t=>t.status==='active').length;
    $('orgWaitingCount').textContent=state.tasks.filter(t=>t.status==='waiting').length;
    $('orgDoneCount').textContent=state.tasks.filter(t=>t.status==='done').length;
    const current=O.today(state,localDate());
    current.forEach(t=>focus.append(row(t)));
    if(!current.length)focus.append(node('p','Нет задач в работе. Выбери одну из отложенных или добавь новую.'));
    const filter=$('organizerFilter').value;
    const search=$('orgSearch').value.trim().toLocaleLowerCase('ru');
    const tasks=state.tasks.filter(t=>(filter==='all'||(filter==='open'?!['done','archived'].includes(t.status):t.status===filter))&&(!search||(t.title+' '+t.next+' '+t.blocker).toLocaleLowerCase('ru').includes(search)));
    tasks.sort((a,b)=>a.priority-b.priority).forEach(t=>list.append(row(t)));
    if(!tasks.length)list.append(node('p','В этом списке нет задач.'));
  }
  function edit(t){
    $('orgEditor').open=true;
    editing=t.id; $('orgTitle').value=t.title; $('orgNext').value=t.next; $('orgBlocker').value=t.blocker;
    $('orgPriority').value=t.priority;$('orgStatus').value=t.status;$('orgDue').value=t.due;
    $('orgSave').textContent='Сохранить изменения';$('orgTitle').focus();
  }
  function reset(){editing=null;$('organizerForm').reset();$('orgSave').textContent='Добавить задачу';}
  $('organizerForm').onsubmit=e=>{
    e.preventDefault();if(!state){message('Сначала восстанови доступ к задачам.');return;}
    try {
      const task={id:editing||crypto.randomUUID(),title:$('orgTitle').value,next:$('orgNext').value,blocker:$('orgBlocker').value,priority:Number($('orgPriority').value),status:$('orgStatus').value,due:$('orgDue').value};
      if(commit(O.upsert(state,task)))reset();
    }catch(e){message('Не сохранено: '+e.message);}
  };
  $('orgCancel').onclick=reset;
  $('organizerFilter').onchange=render;
  $('orgSearch').oninput=render;
  $('orgNew').onclick=()=>{reset();$('orgEditor').open=true;$('orgTitle').focus();};
  $('orgCommandForm').onsubmit=e=>{
    e.preventDefault();proposed=null;$('orgProposal').hidden=true;
    if(!state){message('Задачи недоступны. Восстанови резервную копию.');return;}
    try{
      if(storage.getItem(O.KEY)!==raw)throw new Error('Задачи изменились. Обнови страницу.');
      const result=O.command(state,$('orgCommand').value,crypto.randomUUID());
      if(result.kind==='change'){
        proposed=result.state;proposalRaw=raw;$('orgProposalText').textContent=result.label;
        $('orgProposal').hidden=false;message('Проверь предложенное действие и нажми «Применить».');
      }else if(result.kind==='today'){
        message(O.today(state,localDate()).map((t,i)=>(i+1)+'. '+t.title+' — '+(t.next||'Уточни следующий шаг')).join('\n')||'Нет активных задач.');
      }else if(result.kind==='list'){
        $('organizerFilter').value=result.filter;$('orgSearch').value='';render();message(result.filter==='archived'?'Открыт архив.':'Открыты незавершённые задачи.');
      }else message('Попробуй: «Добавь задачу: название», «Заверши задачу: полное название», «Отложи задачу: полное название», «Возобнови задачу: полное название», «Следующий шаг для «название»: действие», «Приоритет 1 для «название»», «Что делать сегодня».');
    }catch(e){message(e.message);}
  };
  $('orgCommand').oninput=()=>{proposed=null;$('orgProposal').hidden=true;};
  $('orgApply').onclick=()=>{
    if(!proposed)return;
    if(proposalRaw!==raw || storage.getItem(O.KEY)!==proposalRaw){message('Список изменился. Повтори команду для актуальных задач.');proposed=null;$('orgProposal').hidden=true;return;}
    if(commit(proposed)){proposed=null;$('orgProposal').hidden=true;$('orgCommand').value='';reset();}
  };
  $('orgDismiss').onclick=()=>{proposed=null;$('orgProposal').hidden=true;message('Изменение отменено.');};
  document.querySelectorAll?.('[data-command]').forEach(b=>{b.onclick=()=>{$('orgCommand').value=b.dataset.command;proposed=null;$('orgProposal').hidden=true;$('orgCommand').focus();};});
  $('orgExport').onclick=()=>{
    if(!state){message('Нет доступных задач для экспорта.');return;}
    const url=URL.createObjectURL(new Blob([JSON.stringify(O.validate(state),null,2)],{type:'application/json'}));
    const a=node('a');a.href=url;a.download='svoya-tasks-'+localDate()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('Резервная копия подготовлена. Храни её в безопасном месте.');
  };
  $('orgImport').onchange=async e=>{
    const file=e.target.files[0]; if(!file)return;
    try {
      if(file.size>1000000)throw new Error('Файл больше 1 МБ.');
      const incoming=O.validate(JSON.parse(await file.text()));
      if(!confirm('Заменить текущие задачи резервной копией? Сначала сохрани экспорт текущего списка.'))return;
      if(commit(incoming,true))reset();
    }catch(e){message('Импорт отклонён: '+e.message);}
    finally{$('orgImport').value='';}
  };
  window.addEventListener('storage',e=>{
    if(e.key!==O.KEY)return;
    if(editing){message('Задачи изменились в другой вкладке. Обнови страницу перед сохранением.');return;}
    try{state=O.load(storage);raw=storage.getItem(O.KEY);render();message('Список обновлён из другой вкладки.');}
    catch{message('Не удалось прочитать изменения из другой вкладки.');}
  });
  window.getOrganizerContext=()=>{
    if(!$('orgShare').checked)return null;
    if(!state)throw new Error('Не удалось прочитать контекст задач.');
    if(storage.getItem(O.KEY)!==raw)throw new Error('Обнови страницу: список задач изменился.');
    return O.context(state);
  };
  render();
})();
