const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(hash=''){
 const elements=new Map(),events={},observers=[];
 function node(id=''){return {id,hidden:false,dataset:{},textContent:'',value:'',checked:false,disabled:false,attrs:{},events:{},children:[],setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},getAttribute(k){return this.attrs[k]},addEventListener(k,f){this.events[k]=f},focus(){this.focused=true},replaceChildren(...xs){this.children=xs},append(x){this.children.push(x)},click(){this.clicked=true;this.events.click?.({preventDefault(){}})}}}
 const $=id=>{if(!elements.has(id))elements.set(id,node(id));return elements.get(id)};
 const views=['assistant','home','tasks','account'].map(name=>Object.assign(node(),{dataset:{view:name}}));
 const links=['assistant','home','tasks','account'].map(name=>{const n=node();n.dataset.nav=name;n.attrs.href={assistant:'#assistant',home:'#home',tasks:'#tasks',account:'#cloud'}[name];return n});
 const create=node('sidebarNew');create.attrs.href='#tasks';const prompt=node();prompt.dataset.chatPrompt='Выбери шаг по моим задачам';
 const intro=node();$('cloudActions').hidden=true;
 const location={hash,pathname:'/',search:''};const replacements=[];
 const document={getElementById:$,createElement:()=>node(),createTextNode:s=>s,querySelector:s=>{assert.equal(s,'.chat-intro');return intro},querySelectorAll:s=>({'[data-view]':views,'[data-nav]':links,'a[href^="#"]':[...links,create],'[data-chat-prompt]':[prompt]})[s]};
 const context={document,location,history:{replaceState:(_,__,url)=>{replacements.push(url);location.hash=url.slice(url.indexOf('#'))}},addEventListener:(n,f)=>events[n]=f,MutationObserver:class{constructor(f){this.fn=f;observers.push(f)}observe(){}}};context.window=context;
 vm.runInNewContext(fs.readFileSync(require.resolve('../app-shell.js'),'utf8'),context);
 return {context,$,views,links,create,prompt,intro,events,observers,replacements};
}
test('Default chat and legacy deep links reveal only the matching workspace',()=>{
 for(const [hash,expected] of [['','assistant'],['#unknown','assistant'],['#taskList','tasks'],['#cloud','account'],['#home','home']]){
  const ui=setup(hash);assert.deepEqual(ui.views.filter(v=>!v.hidden).map(v=>v.dataset.view),[expected]);
  assert.equal(ui.links.filter(a=>a.attrs['aria-current']==='page').length,1);assert.equal(ui.replacements.length,0);
  if(expected==='account')assert.equal(ui.$('cloud').open,true);
 }
});
test('Navigation and global create reveal the task form without submitting or clearing data',()=>{
 const ui=setup();ui.$('task').value='Черновик';ui.links[2].click();assert.equal(ui.context.location.hash,'#tasks');assert.equal(ui.$('mainContent').focused,true);
 ui.create.click();assert.equal(ui.$('orgNew').clicked,true);assert.equal(ui.$('task').value,'Черновик');
 ui.context.openSvoyaView('account');assert.equal(ui.$('cloud').open,true);const before=ui.replacements.length;ui.context.openSvoyaView('__proto__');assert.equal(ui.replacements.length,before);
});
test('Prompt suggestions opt in to task context without executing a request',()=>{
 const ui=setup();ui.prompt.click();assert.equal(ui.$('task').value,ui.prompt.dataset.chatPrompt);assert.equal(ui.$('orgShare').checked,true);assert.equal(ui.$('task').focused,true);assert.equal(ui.$('run').clicked,undefined);
});
test('Keyboard submission respects busy state, composition and ordinary newlines',()=>{
 const ui=setup(),key=(data)=>ui.$('task').events.keydown({key:'Enter',preventDefault(){},...data});
 key({});assert.equal(ui.$('run').clicked,undefined);key({ctrlKey:true,isComposing:true});assert.equal(ui.$('run').clicked,undefined);
 ui.$('run').disabled=true;key({ctrlKey:true});assert.equal(ui.$('run').clicked,undefined);ui.$('run').disabled=false;key({metaKey:true});assert.equal(ui.$('run').clicked,true);
});
test('Result and account presentation reflects observed DOM state without exposing account identifiers',()=>{
 const ui=setup();ui.$('result').textContent='Готовый ответ';ui.observers[0]();assert.equal(ui.intro.hidden,true);assert.equal(ui.$('answerLabel').hidden,false);
 ui.$('result').textContent='';ui.observers[0]();assert.equal(ui.intro.hidden,false);assert.equal(ui.$('answerLabel').hidden,true);
 ui.$('cloudActions').hidden=false;ui.observers[1]();assert.equal(ui.$('sessionLabel').textContent,'Аккаунт подключён');assert.equal(ui.$('navAccountState').children[0],'Мой аккаунт');
 ui.$('cloudActions').hidden=true;ui.observers[1]();assert.equal(ui.$('navAccountState').children[0],'Войти в аккаунт');
});
