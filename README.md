# CJK-Font-Cloak
针对【Claude克劳德等AI】CJK字体指纹伪装｜浏览器前端指纹隐私防护油猴脚 | CJK Font Cloak, Tampermonkey userscript for browser frontend‑side fingerprint privacy protection. Only JS‑level modification, cannot change real IP, use at your own risk.
油猴连接：https://greasyfork.org/zh-CN/scripts/602450-%E9%98%B2-claude-chatgpt-%E6%A3%80%E6%B5%8B%E4%B8%8E%E5%B0%81%E5%8F%B7-cjk-%E5%AD%97%E4%BD%93%E4%B8%8E%E8%AF%AD%E8%A8%80%E7%8E%AF%E5%A2%83%E4%BC%AA%E8%A3%85%E5%B7%A5%E5%85%B7-cjk-font-locale-cloak
【【【【【【导入油猴使用】】】】】
⭐ 如果脚本对你有用，欢迎点Star，帮助更多人找到本项目。
<img width="1456" height="729" alt="image" src="https://github.com/user-attachments/assets/11502291-6c6e-4975-865a-31a23cf58053" />

<img width="1044" height="741" alt="image" src="https://github.com/user-attachments/assets/ee9a783c-28d4-4ae5-8c91-7b4c6b3b44a0" />
① 开场（先把预期压下来）

给你个浏览器小工具，作用是让网页检测不到你电脑里的中文字体和中文语言环境。

先说它做不到什么，免得你白折腾:它改不了 IP、改不了任何网络请求头，如果你的用途依赖这两样，这东西帮不上忙。

装之前先打开这个网页看一眼（双击就行，不用装东西）。它什么都不改，只告诉你你电脑现在暴露了哪些东西:env-checkup.html

② 安装三步

装篡改猴。Chrome 应用商店搜 Tampermonkey。商店打不开就直接用 Edge——Edge 加载项商店里能搜到，国内能访问。
导入脚本。点右上角油猴图标 → 管理面板 → 左边「实用工具」→「从文件导入」→ 选 cjk-font-cloak-v3.user.js。
找不到「实用工具」就:管理面板点左上角 + 新建脚本 → 把文件用记事本打开、内容全选复制 → 粘贴覆盖 → Ctrl+S。
刷新任意网页。开着的页面不刷新不生效。
⚠ 别双击那个 .user.js 文件,会跳官网然后被 Chrome 拦掉,看着像装失败了。

③ 装完还得自己改两件

① 系统时区:设置 → 时间和语言 → 日期和时间 → 时区。改完完全退出浏览器再打开。
② 浏览器语言:Chrome 设置 → 语言 → 添加 English (United States) → 拖到最上面 → 完全退出浏览器再打开。
这条决定你发出去的 Accept-Language,是唯一真正落在网络层的改动,脚本改不了。这两步不做等于只做了一半。

④ 出问题

随便开个网站按 F12 → Console → 输 __cloakReport() 回车,把 issues 那段截图发我。它直接告诉我是「你没改」还是「脚本没跑」。
## 功能｜Features
- 【中文】阻止网页检测你电脑装了哪些中文、日文、韩文字体，消除字体指纹，，仅JS层面修改，无法更改真实IP，使用风险自负
- 【English】Block webpage detection of local CJK system fonts, hide fingerprint of installed Chinese / Japanese / Korean fonts.

- 【中文】欺骗网页JS接口，网站读取浏览器语言时拿到的是英文en‑US，看不到你的中文语言环境
- 【English】Spoof browser‑language JS API, websites will receive `en‑US, en`.

- 【中文】在部分网站阻止WebRTC泄露你真实公网IP，不会全局关掉视频通话功能
- 【English】Restrict WebRTC on specific sites to avoid public‑IP leak via STUN. WebRTC will not be disabled globally, normal video calls keep working.

- 【中文】防止网站检测出来脚本被篡改过，把修改后的函数伪装成浏览器原生代码
- 【English】Anti‑detection: make patched functions look like native browser built‑in code.
<img width="662" height="1129" alt="image" src="https://github.com/user-attachments/assets/0dc90b52-2420-43e1-a463-c8fccbbd155f" />
