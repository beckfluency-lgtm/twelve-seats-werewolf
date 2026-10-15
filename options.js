import {PROVIDERS,DEFAULT_ADAPTERS} from './core.js';
import {editableAdapter,validateAdapter,validateAdapterFile} from './adapters.js';
const $=id=>document.getElementById(id),key='werewolfAdapterOverrides';
let overrides={};
const status=text=>{$('status').textContent=text};
const safe=fn=>async(...args)=>{try{await fn(...args)}catch(error){status(error.message)}};
const css=selector=>document.querySelector(selector);
function show(){$('config').value=JSON.stringify(editableAdapter(overrides[$('provider').value]||DEFAULT_ADAPTERS[$('provider').value]),null,2);}
async function store(){await chrome.storage.local.set({[key]:overrides});}
for(const [id,p] of Object.entries(PROVIDERS))$('provider').add(new Option(p.name,id));
$('provider').onchange=()=>{show();status('已读取配置')};
$('defaults').onclick=()=>{$('config').value=JSON.stringify(editableAdapter(DEFAULT_ADAPTERS[$('provider').value]),null,2);status('已加载默认配置，点击保存后生效')};
$('save').onclick=safe(async()=>{const cfg=validateAdapter(JSON.parse($('config').value),css);overrides[$('provider').value]=cfg;await store();status('已保存')});
$('reset').onclick=safe(async()=>{overrides[$('provider').value]=validateAdapter(editableAdapter(DEFAULT_ADAPTERS[$('provider').value]),css);await store();show();status('已恢复默认配置')});
$('exportAdapters').onclick=safe(async()=>{
 const adapters=Object.fromEntries(Object.keys(PROVIDERS).map(id=>[id,editableAdapter(overrides[id]||DEFAULT_ADAPTERS[id])]));
 const url=URL.createObjectURL(new Blob([JSON.stringify({format:'twelve-seats-adapters',version:1,adapters},null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='twelve-seats-adapters.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出适配配置');
});
$('importAdapters').onchange=safe(async event=>{const file=event.target.files[0];if(!file)return;const imported=validateAdapterFile(JSON.parse(await file.text()),PROVIDERS,css);overrides={...overrides,...imported};await store();show();event.target.value='';status('已导入适配配置')});
safe(async()=>{overrides=(await chrome.storage.local.get(key))[key]||{};show()})();
