// Authoritative existing route rules. A learned classifier is advisory only.
function classifyIntent(task){
 const text=task.toLowerCase();
 if(/(код|скрипт|программ|функци|javascript|python|sql|debug)/i.test(text))return {intent:'CODING',route:'CODING_AGENT'};
 if(/(файл|pdf|документ|таблиц|xlsx|csv|docx)/i.test(text))return {intent:'FILE_ANALYSIS',route:'FILE_TOOL'};
 if(/(сейчас|сегодня|последн|актуаль|новост|цена|курс|погода|интернет|исследуй|research)/i.test(text))return {intent:'WEB_RESEARCH',route:'WEB_RESEARCH'};
 return {intent:'GENERAL',route:'LLM'};
}
module.exports={classifyIntent};
