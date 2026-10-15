// Website controls only. No account data, conversation addresses or API access.
const common={scanByRequest:true,nativeSend:false,tested:false,confirmSubmission:true};
const definitions={
  yuanbao:{input:'.ql-editor[contenteditable=true]',send:'#yuanbao-send-btn',reply:'.markdown',stop:''},
  zai:{input:'#chat-input',send:'#send-message-button',reply:'.markdown',stop:'button:has(> span.block.bg-white.size-3)'},
  deepseek:{input:'textarea',send:'div[role=button]._52c986b',reply:'.ds-assistant-message-main-content',stop:''},
  kimi:{input:'.chat-input-editor[contenteditable=true]',send:'.send-button-container',reply:'.chat-content-item-assistant .markdown-container',stop:''},
  doubao:{input:'.tiptap.ProseMirror[contenteditable=true]',send:'#flow-end-msg-send',reply:'[data-testid=receive_message] [data-testid=message_content]',stop:''},
  qianwen:{input:'[contenteditable=true][data-slate-editor=true]',send:'button[aria-label="发送消息"]',reply:'[class*=message-select-wrapper-answer]',emptyText:'向千问提问',inputMode:'slatePaste',stop:''},
  claude:{input:'[contenteditable=true]',send:'[data-testid=chat-input-send],button[aria-label="Send message"]',reply:'[data-testid=assistant-message]',stop:'button[aria-label="Stop response"],button[aria-label="停止回复"]'},
  gemini:{input:'.ql-editor[contenteditable=true]',send:'button[aria-label="Send message"],button[aria-label="发送消息"]',reply:'model-response-content',stop:''},
  mistral:{input:'.ProseMirror[contenteditable=true]',send:'button[aria-label="Send"]',reply:'[data-message-author-role=assistant]',stop:''},
  grok:{input:'.query-bar-editor[contenteditable=true]',send:'button[data-testid=chat-submit]',reply:'[data-testid=assistant-message]',stop:''},
  chatgpt:{input:'.ProseMirror[contenteditable=true][role=textbox]',send:'button[data-testid="send-button"],button[aria-label="Send prompt"],button[aria-label="发送"]',reply:'[data-message-author-role=assistant]',stop:'button[data-testid="stop-button"]'}
};
export const BASE_ADAPTERS=Object.fromEntries(Object.entries(definitions).map(([id,cfg])=>[id,{...common,...cfg}]));
const fields=['input','send','reply','stop','inputMode','sendEvent','emptyText'];
export function validateAdapter(value,selectorCheck=()=>{}){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('适配配置必须为JSON对象');
  if(Object.keys(value).some(key=>!fields.includes(key)))throw Error('配置含有不支持的字段');
  const result={...common};
  for(const key of fields){if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>2000)throw Error('适配字段必须为长度不超过2000的文字');result[key]=value[key].trim();}}
  for(const key of ['input','send','reply'])if(!result[key])throw Error('输入框、发送按钮和回复选择器不能为空');
  for(const key of ['input','send','reply','stop'])if(result[key])selectorCheck(result[key]);
  if(result.inputMode&&!['slatePaste','editorPaste'].includes(result.inputMode))throw Error('不支持的输入方式');
  if(result.sendEvent&&result.sendEvent!=='mousedown')throw Error('不支持的发送事件');
  return result;
}
export function editableAdapter(value){return Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));}
export function validateAdapterFile(value,providers,selectorCheck=()=>{}){
  if(value?.format!=='twelve-seats-adapters'||value.version!==1||!value.adapters||typeof value.adapters!=='object'||Array.isArray(value.adapters))throw Error('不是可识别的适配配置文件');
  const result={};for(const [id,cfg] of Object.entries(value.adapters)){if(!Object.hasOwn(providers,id))throw Error('配置含未知平台');Object.defineProperty(result,id,{value:validateAdapter(cfg,selectorCheck),enumerable:true,writable:true,configurable:true});}return result;
}
