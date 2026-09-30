(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SvoyaOrganizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const KEY = 'svoya.organizer.v1';
  const STATUSES = ['active', 'waiting', 'deferred', 'done', 'archived'];
  function text(value, max, required) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error('Проверь текст и длину полей.');
    return value.trim();
  }
  function validate(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.tasks) || data.tasks.length > 200) throw new Error('Неподдерживаемая резервная копия.');
    const ids = new Set();
    const tasks = data.tasks.map(t => {
      if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id)) throw new Error('Некорректный или повторный ID.');
      ids.add(t.id);
      if (!STATUSES.includes(t.status) || ![1,2,3].includes(t.priority)) throw new Error('Некорректный статус или приоритет.');
      if (typeof t.due !== 'string' || (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due))) throw new Error('Некорректная дата.');
      if (t.due && new Date(t.due + 'T00:00:00Z').toISOString().slice(0,10) !== t.due) throw new Error('Несуществующая дата.');
      return {id:t.id, title:text(t.title,200,true), next:text(t.next,1000,false), blocker:text(t.blocker,1000,false), status:t.status, priority:t.priority, due:t.due};
    });
    return {version:1, tasks};
  }
  function seed() {
    return validate({version:1,tasks:[
      {id:'agent',title:'СВОЯ AI — организатор задач',next:'Проверить сохранение задач, приоритеты и восстановление после перезагрузки.',blocker:'',status:'active',priority:1,due:''},
      {id:'income',title:'Первые деньги и окупаемость подписки',next:'После проверки организатора сравнить услуги и приложения без личного общения с клиентами.',blocker:'Сначала довести организатор до рабочего результата.',status:'deferred',priority:2,due:''},
      {id:'relocation',title:'Переезд',next:'',blocker:'Закрыто пользователем: неактуально.',status:'archived',priority:3,due:''},
      {id:'reels',title:'Личный Reels',next:'',blocker:'Закрыто пользователем: неактуально.',status:'archived',priority:3,due:''}
    ]});
  }
  function load(storage) {
    const raw = storage.getItem(KEY);
    return raw === null ? seed() : validate(JSON.parse(raw));
  }
  function save(storage, state) {
    const clean = validate(state);
    storage.setItem(KEY, JSON.stringify(clean));
    return clean;
  }
  function upsert(state, task) {
    const tasks = state.tasks.filter(t=>t.id!==task.id);
    tasks.push(task);
    return validate({version:1,tasks});
  }
  function today(state, date) {
    return state.tasks.filter(t=>t.status==='active').sort((a,b)=> {
      const overdueA = a.due && a.due <= date ? 0 : 1;
      const overdueB = b.due && b.due <= date ? 0 : 1;
      return overdueA-overdueB || a.priority-b.priority || (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title,'ru');
    }).slice(0,3);
  }
  function context(state) {
    return state.tasks.filter(t=>['active','waiting'].includes(t.status)).slice(0,20).map(t=>({title:t.title,next:t.next,blocker:t.blocker,status:t.status,priority:t.priority,due:t.due}));
  }
  function command(state, input, id) {
    const value=text(input,1500,true);
    const add=value.match(/^(?:добавь|создай)\s+задачу\s*:\s*([\s\S]+)$/i);
    if(add) return {kind:'change',label:'Добавить задачу «'+add[1].trim()+'»',state:upsert(state,{id,title:add[1].trim(),next:'',blocker:'',status:'active',priority:2,due:''})};
    if(/^(?:что делать сегодня|план на сегодня)[?.!]*$/i.test(value))return {kind:'today'};
    if(/^покажи задачи[.!]*$/i.test(value))return {kind:'list',filter:'open'};
    if(/^покажи архив[.!]*$/i.test(value))return {kind:'list',filter:'archived'};
    if(/^помощь[.!]*$/i.test(value))return {kind:'help'};
    const status=value.match(/^(заверши|отложи|возобнови|архивируй|заблокируй)\s+задачу\s*:\s*(.+)$/i);
    const step=value.match(/^следующий шаг для\s+«([^»]+)»\s*:\s*([\s\S]+)$/i);
    const priority=value.match(/^приоритет\s+([123])\s+для\s+«([^»]+)»$/i);
    const title=status?.[2]||step?.[1]||priority?.[2];
    if(!title)return {kind:'help'};
    const found=state.tasks.filter(t=>t.title.toLocaleLowerCase('ru')===title.trim().toLocaleLowerCase('ru'));
    if(found.length!==1)throw new Error(found.length?'Найдено несколько задач с таким названием. Переименуй нужную карточку.':'Задача не найдена. Используй полное название с карточки.');
    const task={...found[0]};
    if(status)task.status={заверши:'done',отложи:'deferred',возобнови:'active',архивируй:'archived',заблокируй:'waiting'}[status[1].toLowerCase()];
    if(step)task.next=step[2].trim();
    if(priority)task.priority=Number(priority[1]);
    return {kind:'change',label:'Обновить задачу «'+task.title+'»'+(status?' → '+status[1].toLowerCase():step?' → новый следующий шаг':' → приоритет '+task.priority),state:upsert(state,task)};
  }
  return {KEY,STATUSES,validate,seed,load,save,upsert,today,context,command};
});
