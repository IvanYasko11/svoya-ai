const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const O=require('../organizer-core.js');
function setup(storage){
  const elements=new Map(),events={};
  function element(){return {value:'',checked:false,textContent:'',children:[],append(...x){this.children.push(...x)},replaceChildren(){this.children=[]},focus(){},reset(){},click(){}};}
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)},createElement(){return element()}};
  const context={SvoyaOrganizer:O,document,localStorage:storage,crypto:{randomUUID:()=> 'new-task'},Date,JSON,Blob,URL,setTimeout,confirm:()=>true,addEventListener:(n,f)=>{events[n]=f}};
  context.window=context;document.getElementById('organizerFilter').value='open';
  vm.runInNewContext(fs.readFileSync(require.resolve('../organizer-ui.js'),'utf8'),context);
  return {context,$:id=>document.getElementById(id),events};
}
function storage(){const data=new Map();return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)};}
test('UI saves task, reloads it and excludes context until explicitly enabled',()=>{
  const s=storage(),ui=setup(s);ui.$('orgTitle').value='<img src=x onerror=alert(1)>';
  ui.$('orgNext').value='Открыть ещё раз';ui.$('orgBlocker').value='';ui.$('orgPriority').value='1';ui.$('orgStatus').value='active';ui.$('orgDue').value='';
  ui.$('organizerForm').onsubmit({preventDefault(){}});
  assert.match(ui.$('organizerMessage').textContent,/Сохранено/);
  const reloaded=setup(s);assert.equal(O.load(s).tasks.find(t=>t.id==='new-task').next,'Открыть ещё раз');
  const cards=reloaded.$('organizerList').children;
  assert.ok(cards.some(c=>c.children[0].textContent==='<img src=x onerror=alert(1)>'));
  assert.equal(reloaded.context.getOrganizerContext(),null);
  reloaded.$('orgShare').checked=true;assert.equal(reloaded.context.getOrganizerContext().length,2);
});
test('UI never overwrites corrupt storage or stale edits',()=>{
  const s=storage();s.setItem(O.KEY,'broken');const broken=setup(s);
  broken.$('organizerForm').onsubmit({preventDefault(){}});assert.equal(s.getItem(O.KEY),'broken');
  const fresh=storage(),ui=setup(fresh);
  ui.$('organizerList').children[0].children.at(-1).onclick();
  O.save(fresh,O.upsert(O.seed(),{...O.seed().tasks[0],next:'Changed elsewhere'}));
  ui.$('organizerForm').onsubmit({preventDefault(){}});
  assert.match(ui.$('organizerMessage').textContent,/другой вкладке/);
  assert.equal(O.load(fresh).tasks[0].id,'income');
  assert.equal(O.load(fresh).tasks.find(t=>t.id==='agent').next,'Changed elsewhere');
});
