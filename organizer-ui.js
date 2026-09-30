(function() {
  'use strict';
  const O=window.SvoyaOrganizer, P=window.SvoyaProposals, $=id=>document.getElementById(id);
  const labels={active:'В работе',waiting:'Заблокировано',deferred:'Отложено',done:'Готово',archived:'Архив'};
  let state, raw=null, editing=null, storage;
  let proposed=null, proposalRaw=null,proposalCommand='',proposalSelected='';
  let commandGeneration=0,planningController=null;
  function message(s){$('organizerMessage').textContent=s;}
  function planning(busy){$('orgPlanning').hidden=!busy;$('orgParse').disabled=busy;$('orgCommandForm').setAttribute?.('aria-busy',String(busy));}
  function invalidate(){
    commandGeneration++;planningController?.abort();planningController=null;
    proposed=null;proposalRaw=null;$('orgProposal').hidden=true;planning(false);
  }
  try {storage=window.localStorage; state=O.load(storage); raw=storage.getItem(O.KEY);}
  catch {state=null; message('Не удалось прочитать задачи. Сохранённые данные не перезаписаны. Проверь доступ к хранилищу или импортируй резервную копию.');}
  function commit(next, recovery=false) {
    try {
      if(!recovery && storage.getItem(O.KEY)!==raw) throw new Error('Задачи изменены в другой вкладке. Обнови страницу перед сохранением.');
      const clean=O.save(storage,next); state=clean; raw=storage.getItem(O.KEY); invalidate();render();
      message('Сохранено в этом браузере.'); window.dispatchEvent?.(new Event('svoya:tasks-saved')); return true;
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
    const command=node('button','Дать команду');command.type='button';command.className='task-edit';command.onclick=()=>{
      window.openSvoyaView?.('tasks');invalidate();$('orgTarget').value=t.id;$('orgCommand').focus();message('Выбрана задача «'+t.title+'». Можно написать: «заверши эту» или «разбей её на три шага».');
    };e.append(command);
    const b=node('button','Изменить'); b.type='button';b.className='task-edit'; b.onclick=()=>edit(t); e.append(b); return e;
  }
  function localDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function render(){
    const list=$('organizerList'), focus=$('organizerToday'); list.replaceChildren();focus.replaceChildren();
    if(!state){list.append(node('p','Задачи пока недоступны.'));return;}
    const selected=$('orgTarget').value;$('orgTarget').replaceChildren();
    const any=node('option','По названию в команде');any.value='';$('orgTarget').append(any);
    state.tasks.forEach(t=>{const option=node('option',t.title+' · '+labels[t.status]);option.value=t.id;$('orgTarget').append(option);});
    $('orgTarget').value=state.tasks.some(t=>t.id===selected)?selected:'';
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
    window.openSvoyaView?.('tasks');$('orgEditor').open=true;
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
  $('orgNew').onclick=()=>{reset();window.openSvoyaView?.('tasks');$('orgEditor').open=true;$('orgTitle').focus();};
  function preview(next,source,metadata=''){
    const changes=P.diff(state,next);
    if(!changes.length){message('Задачи уже имеют указанные значения.');return;}
    proposed=O.validate(next);proposalRaw=source;proposalCommand=$('orgCommand').value;proposalSelected=$('orgTarget').value;
    const box=$('orgProposalText');box.replaceChildren();
    box.append(node('p','Предложение · '+changes.length+' '+(changes.length===1?'карточка':'карточек')+(metadata?' · '+metadata:'')));
    const names={title:'Название',next:'Следующий шаг',blocker:'Препятствие',status:'Статус',priority:'Приоритет',due:'Срок'};
    const value=(key,v)=>v===null?'Новая задача':key==='status'?labels[v]:v===''?'Не задано':String(v);
    changes.forEach(change=>{
      const card=node('div');card.className='proposal-task';card.append(node('strong',(change.created?'Добавить: ':'Изменить: ')+change.title));
      change.fields.forEach(f=>card.append(node('p',names[f.key]+': '+(change.created?'':value(f.key,f.before)+' → ')+value(f.key,f.after))));
      box.append(card);
    });
    $('orgProposal').hidden=false;message('Разбор завершён. Проверь каждое изменение и нажми «Применить».');
  }
  $('orgCommandForm').onsubmit=async e=>{
    e.preventDefault();invalidate();
    if(!state){message('Задачи недоступны. Восстанови резервную копию.');return;}
    const command=$('orgCommand').value,selectedId=$('orgTarget').value,source=raw,generation=commandGeneration;
    let timeout;
    try{
      if(storage.getItem(O.KEY)!==raw)throw new Error('Задачи изменились. Обнови страницу.');
      const localState=selectedId?P.scope(state,selectedId):state;
      const result=O.command(localState,command,crypto.randomUUID());
      if(result.kind==='change'){
        const next=selectedId?result.state.tasks.reduce((acc,t)=>O.upsert(acc,t),state):result.state;
        preview(next,source,'без обращения к модели');
      }else if(result.kind==='today'){
        message(O.today(state,localDate()).map((t,i)=>(i+1)+'. '+t.title+' — '+(t.next||'Уточни следующий шаг')).join('\n')||'Нет активных задач.');
      }else if(result.kind==='list'){
        $('organizerFilter').value=result.filter;$('orgSearch').value='';render();message(result.filter==='archived'?'Открыт архив.':'Открыты незавершённые задачи.');
      }else if(/^помощь[.!]*$/i.test(command.trim())){
        message('Напиши обычную фразу: «Разбей цель на три шага», «Заверши задачу про дизайн». Для «эту задачу» сначала выбери карточку в поле «К какой задаче» или нажми на карточке «Дать команду». Свободные фразы требуют входа. Команды «Добавь задачу: название» и «Заверши задачу: полное название» работают бесплатно без модели. Сохранение — только после «Применить».');
      }else{
        const scoped=P.scope(state,selectedId);
        if(!selectedId&&P.needsSelection(command))throw new Error('Уточни задачу: выбери карточку в поле «К какой задаче» или укажи её полное название.');
        let token;
        try{token=window.getOrganizerAccessToken?.();if(!token)throw new Error('Для свободной команды войди в аккаунт в разделе «Аккаунт».');}
        catch(e){$('cloud').open=true;window.openSvoyaView?.('account');throw e;}
        planningController=new AbortController();const controller=planningController;
        planning(true);message('Готовлю предложение. Задачи пока не изменены.');
        timeout=setTimeout(()=>controller.abort(),120000);
        const response=await window.fetch('/api/organizer-plan',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({command,state:scoped,selectedId,localDate:localDate()}),signal:controller.signal});
        const data=await response.json();
        if(generation!==commandGeneration)return;
        if(source!==raw||storage.getItem(O.KEY)!==source||$('orgCommand').value!==command||$('orgTarget').value!==selectedId)throw new Error('Список или команда изменились во время разбора. Повтори команду.');
        if(!response.ok){if(response.status===401){window.clearOrganizerSession?.();$('cloud').open=true;window.openSvoyaView?.('account');}throw new Error((data.error||'Не удалось разобрать команду.')+(data.hint?' '+data.hint:''));}
        const checked=P.apply(state,data.plan,{selectedId});
        if(checked.kind==='clarification')message(checked.message);
        else preview(checked.state,source,(data.provider||'модель')+' · '+(data.model||''));
      }
    }catch(e){if(generation===commandGeneration)message(e.name==='AbortError'?'Разбор остановлен по времени. Задачи не изменены. Повтори позже.':e.message);}
    finally{if(timeout)clearTimeout(timeout);if(generation===commandGeneration){planningController=null;planning(false);}}
  };
  $('orgCommand').oninput=()=>{invalidate();message('Команда изменена. Нажми «Разобрать», чтобы получить новое предложение.');};
  $('orgTarget').onchange=()=>{invalidate();message('Выбор задачи изменён. Нажми «Разобрать».');};
  $('orgLoginLink').onclick=()=>{$('cloud').open=true;window.openSvoyaView?.('account');};
  $('orgApply').onclick=()=>{
    if(!proposed)return;
    if(proposalRaw!==raw || storage.getItem(O.KEY)!==proposalRaw||proposalCommand!==$('orgCommand').value||proposalSelected!==$('orgTarget').value){message('Список изменился или команда отредактирована. Повтори команду для актуальных задач.');invalidate();return;}
    if(commit(proposed)){proposed=null;$('orgProposal').hidden=true;$('orgCommand').value='';reset();}
  };
  $('orgDismiss').onclick=()=>{invalidate();message('Изменение отменено.');};
  $('orgStop').onclick=()=>{invalidate();message('Разбор отменён. Задачи не изменены.');};
  window.addEventListener('svoya:account-changed',()=>{invalidate();message('Аккаунт изменён. Повтори разбор команды после входа.');});
  document.querySelectorAll?.('[data-command]').forEach(b=>{b.onclick=()=>{invalidate();$('orgCommand').value=b.dataset.command;$('orgTarget').value='';$('orgCommand').focus();};});
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
    invalidate();
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
  window.organizerBackup={
    snapshot(){
      if(!state || storage.getItem(O.KEY)!==raw)throw new Error('Обнови страницу: локальные задачи недоступны или изменились.');
      return {state:O.validate(state),raw};
    },
    restore(incoming,expectedRaw){
      if(raw!==expectedRaw || storage.getItem(O.KEY)!==expectedRaw)throw new Error('За время загрузки задачи изменились. Повтори восстановление.');
      if(!commit(O.validate(incoming)))throw new Error('Не удалось сохранить восстановленный список.');
      proposed=null;$('orgProposal').hidden=true;reset();
    }
  };
  render();
})();
