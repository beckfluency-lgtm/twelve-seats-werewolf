# 平台与适配

所有平台均通过网页控件操作，不使用模型API。预置配置不代表每种账号、模型或界面版本均已完成整局验证。界面语言、灰度更新和订阅状态可能改变控件。

| 平台 | 已配置入口 | 说明 |
| --- | --- | --- |
| 腾讯元宝 | https://yuanbao.tencent.com/ | 预置适配 |
| Z.ai | https://zchat.z.ai/ | 预置适配，GLM模型家族 |
| DeepSeek | https://chat.deepseek.com/ | 预置适配，发送控件含网站生成的类名，改版时可能需要更新 |
| Kimi | https://www.kimi.com/ | 预置适配 |
| 豆包 | https://www.doubao.com/chat/ | 预置适配 |
| 千问 | https://www.qianwen.com/ | 预置适配，采用网页编辑器粘贴事件，不使用系统剪贴板 |
| Claude | https://claude.ai/ | 预置适配，含两种发送入口 |
| Gemini | https://gemini.google.com/ | 预置适配 |
| Le Chat | https://chat.mistral.ai/ | 预置适配 |
| Grok | https://grok.com/ | 预置适配 |
| ChatGPT | https://chatgpt.com/ | 预置适配 |
| 阶跃AI | https://chat.stepfun.com/ | 候选适配，暂不支持 Studio 产品入口 |
| 智谱清言 | https://chatglm.cn/ | 已验证后台原回复接收，含逐字显示兼容处理 |
| 讯飞星火 | https://xinghuo.xfyun.cn/desk | 已验证填写后唯一识别发送箭头，空输入时可能没有发送入口 |
| Qwen国际版 | https://chat.qwen.ai/ | 候选适配，与国内千问属于同一模型家族 |
| Perplexity | https://www.perplexity.ai/ | 候选适配，采用网页编辑器粘贴事件 |
| Poe | https://poe.com/ | 候选适配，具体模型由网页选择，尚缺登录后的完整收发验证 |

## 修改适配

在扩展详情中打开“扩展选项”。选择平台，修改JSON后保存。`input` 为输入框，`send` 为发送控件，`reply` 为AI回复正文，`stop` 为停止生成控件。选择器需要唯一定位实际输入与发送控件，避免将历史消息中的按钮当作发送按钮。

`inputMode` 可省略，或使用 `slatePaste`、`editorPaste`。`sendEvent` 可省略，或使用 `mousedown`。这些字段只控制网页交互方式，不接收脚本、API地址或账号数据。

保存的配置从下一次新行动生效。当前已发出的请求保留原发送信息，避免中途改配置导致重复提交。恢复默认会明确采用随当前版本提供的控件配置，覆盖旧存档中缓存的适配。

默认适配集中在 `adapters.js` 和 `core.js` 的 `BACKUP_ADAPTERS`。贡献更新时，请补充脱敏的控件结构、验证方式和回归测试，不要上传真实聊天地址或整段页面正文。
