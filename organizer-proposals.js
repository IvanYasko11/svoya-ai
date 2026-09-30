(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./organizer-core.js'));
  else root.SvoyaProposals=factory(root.SvoyaOrganizer);
})(typeof globalThis!=='undefined'?globalThis:this,function(O){
  'use strict';
  const FIELDS=['title','next','blocker','status','priority','due'];
  function needsSelection(command){return /(?:^|\s)(?:эту|этой|эта|её|ее|ней)(?:\s|[,.!?]|$)/i.test(command);}
  function object(value,keys){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Error('Предложение содержит недопустимые поля.');
  }
  function scope(state,selectedId=''){
    const clean=O.validate(state);
    if(typeof selectedId!=='string')throw new Error('Некорректный выбор задачи.');
    if(selectedId&&!clean.tasks.some(t=>t.id===selectedId))throw new Error('Выбранная задача больше не существует.');
    const tasks=selectedId?clean.tasks.filter(t=>t.id===selectedId):clean.tasks.filter(t=>t.status!=='archived');
    if(tasks.length>60||JSON.stringify(tasks).length>60000)throw new Error('Список слишком большой для разбора. Выбери одну задачу в поле «К какой задаче».');
    return {version:1,tasks};
  }
  function parse(content){
    if(typeof content!=='string'||content.length>24000)throw new Error('Модель не вернула допустимое предложение.');
    const text=content.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i,'$1');
    try{return JSON.parse(text);}catch{throw new Error('Ответ модели не удалось разобрать. Задачи не изменены. Повтори команду точнее.');}
  }
  function apply(state,plan,{selectedId='',createId=()=>crypto.randomUUID()}={}){
    const clean=O.validate(state),available=scope(clean,selectedId);
    object(plan,['kind','operations','message']);
    if(plan.kind==='clarification'){
      if(plan.operations!==undefined||typeof plan.message!=='string'||!plan.message.trim()||plan.message.length>1200)throw new Error('Некорректное уточнение модели.');
      return {kind:'clarification',message:plan.message.trim()};
    }
    if(plan.kind!=='proposal'||plan.message!==undefined||!Array.isArray(plan.operations)||!plan.operations.length||plan.operations.length>10)throw new Error('Допустимо от 1 до 10 изменений за команду.');
    let next=clean;const touched=new Set();
    for(const op of plan.operations){
      object(op,['type','target','fields']);object(op.fields,FIELDS);
      if(!Object.keys(op.fields).length)throw new Error('В предложении нет изменённых полей.');
      if(op.type==='create'){
        if(op.target!==undefined)throw new Error('Новая задача не должна заменять существующую.');
        const task={id:createId(),title:'',next:'',blocker:'',status:'active',priority:2,due:'',...op.fields};
        if(next.tasks.some(t=>t.id===task.id))throw new Error('Новая задача получила существующий ID. Повтори разбор.');
        if(typeof task.title!=='string')throw new Error('У новой задачи должно быть название.');
        if(next.tasks.some(t=>t.title.toLocaleLowerCase('ru')===task.title.trim().toLocaleLowerCase('ru')))throw new Error('Задача с таким названием уже есть. Уточни новое название.');
        next=O.upsert(next,task);
      }else if(op.type==='update'){
        if(typeof op.target!=='string')throw new Error('Для изменения нужна конкретная задача.');
        const found=op.target==='$selected'?available.tasks.filter(t=>t.id===selectedId):available.tasks.filter(t=>t.title.toLocaleLowerCase('ru')===op.target.trim().toLocaleLowerCase('ru'));
        if(found.length!==1)throw new Error(found.length?'Название неоднозначно. Выбери нужную карточку в поле «К какой задаче».':'Задача не найдена. Укажи её название или выбери карточку.');
        const task=found[0];
        if(touched.has(task.id))throw new Error('Одна задача указана дважды. Повтори команду проще.');
        touched.add(task.id);next=O.upsert(next,{...task,...op.fields});
      }else throw new Error('Это действие недоступно. Можно создавать задачи и изменять поля карточек.');
    }
    if(!diff(clean,next).length)throw new Error('Предложение не меняет задачи: указанные значения уже сохранены.');
    return {kind:'proposal',state:next};
  }
  function diff(before,after){
    const old=O.validate(before),next=O.validate(after);
    return next.tasks.flatMap(task=>{
      const previous=old.tasks.find(t=>t.id===task.id);
      const fields=FIELDS.filter(key=>!previous||previous[key]!==task[key]).map(key=>({key,before:previous?previous[key]:null,after:task[key]}));
      return fields.length?[{title:previous?.title||task.title,created:!previous,fields}]:[];
    });
  }
  return {scope,parse,apply,diff,needsSelection};
});
