# 前端项目部署到 Netlify 完整指南

> 适用：纯静态站点（HTML/CSS/JS）、Vue/React/Vite 等需要构建的框架项目。
> 本文所有命令与结论均在 Windows + 实测部署中验证过。

---

## 一、三种部署方式，先选一个

| 方式 | 适合场景 | 是否需要装工具 | 更新方式 | 是否会过期 |
|---|---|---|---|---|
| **Netlify Drop**（拖拽） | 临时试用、一次性交付 | 不需要 | 重新拖一次 | **未认领约 1 小时过期** |
| **Netlify CLI** | 本地开发、想用命令行 | 需要 Node | `netlify deploy --prod` | 不过期 |
| **Git 连接**（长期推荐） | 正式项目、要持续迭代 | 不需要 | `git push` 自动构建 | 不过期 |

初次接触建议：**先 Drop 试效果 → 再绑定 Git 做长期方案**。

---

## 二、方式一：Netlify Drop（零配置，最快）

### 2.1 操作步骤

1. 浏览器打开 <https://app.netlify.com/drop>
2. 把**项目文件夹整个拖进去**（或点页面上的 "folder" 选择目录）
3. 等待几秒，页面显示 `Your project is live`
4. 复制形如 `https://xxx-yyyy-1234.netlify.app` 的地址

### 2.2 强烈建议拖「文件夹」，不要用 zip

这是本指南最重要的一条实战经验。

**Windows 自带的压缩工具会写出反斜杠路径**（zip 内部条目变成 `js\app.js` 而不是 `js/app.js`），Netlify 解压后会把它当成一个**文件名里带反斜杠的单文件**，而不是 `js/` 目录。

结果就是：`index.html` 能正常打开，但所有 `/js/*.js`、`/css/*.css` 全部 **404**，页面一片空白或按钮全无反应。

> 已验证：`Compress-Archive` 和 .NET 的 `ZipFile.CreateFromDirectory` 在 .NET Framework 下都会写出反斜杠。**直接用 PowerShell 打包是最容易踩这个坑的方式。**

**如果一定要用 zip，打包后先检查条目分隔符：**

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead("site.zip")
$z.Entries | ForEach-Object { $_.FullName }
$z.Dispose()
```

输出必须是 `js/app.js` 这种**正斜杠**。看到 `js\app.js` 就说明包是坏的，换 7-Zip（压缩时选 zip 格式）或直接拖文件夹。

### 2.3 未认领站点的两个限制

刚拖上去的站点属于"未认领"状态：

- **约 1 小时后过期**，链接失效
- **默认带密码保护**，访问需要输入密码（密码会显示在 Drop 成功页面上）

解决：点页面上的 **Claim this site** → 用 GitHub / GitLab / 邮箱注册登录 → 认领成功。

认领后：
- 站点永久保留（免费额度内）
- 密码保护自动解除
- 可进入后台改站点名：**Site settings → Change site name**
- 可绑定自定义域名

> 如果 HTML 页面能打开但 `manifest.webmanifest` 之类资源返回 **401**，基本就是密码保护还在生效，认领后即消失。

---

## 三、方式二：Netlify CLI（命令行）

适合本地开发、需要脚本化部署的场景。

### 3.1 安装与登录

```bash
npm install -g netlify-cli
netlify login
```

`netlify login` 会打开浏览器完成 OAuth 授权，凭据保存在本地，**不要把 token 写进代码或提交到仓库**。

### 3.2 首次部署

```bash
# 在项目根目录执行
netlify init          # 关联/新建站点，会写入 .netlify/ 目录
netlify deploy        # 部署到草稿地址（预览用，不覆盖线上）
netlify deploy --prod # 部署到正式地址
```

### 3.3 指定发布目录

```bash
# 纯静态项目：直接发布当前目录
netlify deploy --prod --dir=.

# 构建型项目：先构建，再发布产物目录
npm run build
netlify deploy --prod --dir=dist
```

`--dir` 指向的是**构建产物目录**，不是源码目录。指错会得到一片空白页 + `Page not found`。

---

## 四、方式三：Git 连接（长期推荐）

### 4.1 操作步骤

1. 把项目推到 GitHub / GitLab / Bitbucket
2. Netlify 后台 → **Add new site → Import an existing project**
3. 选择 Git 平台并授权，选中仓库
4. 填写构建配置：

| 字段 | 纯静态项目 | Vite 项目 | Create React App |
|---|---|---|---|
| Build command | 留空 | `npm run build` | `npm run build` |
| Publish directory | `.` 或 `/` | `dist` | `build` |

5. 点 **Deploy site**

之后每次 `git push` 到主分支，Netlify 自动重新构建并发布。Pull Request 还会自动生成预览地址（Deploy Preview）。

### 4.2 环境变量

构建时需要的变量（API 地址、密钥等）配在 **Site settings → Environment variables**，不要提交 `.env` 到仓库。

> 注意：静态站点打包进前端的所有变量最终都会暴露在浏览器里，**真正的密钥必须放在服务端**。

---

## 五、netlify.toml 配置

放在项目根目录，Netlify 会自动读取。

### 5.1 基础配置

```toml
[build]
  # 发布目录（相对仓库根目录）
  publish = "dist"
  # 构建命令；纯静态项目留空表示不构建
  command = "npm run build"
```

纯静态、无需构建的项目：

```toml
[build]
  publish = "."
  command = ""
```

### 5.2 SPA 刷新 404 的修复（React Router / Vue Router history 模式必配）

单页应用刷新 `/about` 时服务器会去找 `about/index.html`，找不到就 404。加重写规则：

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

也可以不放 `netlify.toml`，而在发布目录里放一个 `_redirects` 文件：

```
/*  /index.html  200
```

### 5.3 自定义响应头

```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "SAMEORIGIN"
    X-Content-Type-Options = "nosniff"

[[headers]]
  for = "/sw.js"
  [headers.values]
    Cache-Control = "no-cache"
```

> Service Worker 文件建议设成 `no-cache`，否则浏览器可能长期使用旧版本，导致代码改动"看起来没生效"。

---

## 六、常见问题排查

按下表对照现象定位，基本能覆盖 90% 的部署问题。

| 现象 | 根因 | 解决 |
|---|---|---|
| 页面全白 / 只有骨架 | `index.html` 里的 `/js/...`、`/css/...` 返回 404 | 检查发布目录结构；确认资源用的是**相对路径**（`js/app.js`）而非绝对路径（`/js/app.js`，部署在子路径时会失效） |
| `js/xxx.js 404`，但 `index.html` 正常 | 上传时丢了子目录（Windows zip 反斜杠问题） | **改拖文件夹**，或用 7-Zip 打包 |
| 内部链接大小写不一致导致 404 | Netlify 运行在 Linux，**文件系统区分大小写** | Windows 本地一切正常不代表线上正常，统一改为小写文件名 |
| 页面被注入了 `@vite/client`、`/@vite/...` 请求 | 项目被误判为需构建的框架项目，触发了构建处理 | 加 `netlify.toml` 显式声明 `publish` 与 `command` |
| `manifest.webmanifest`、部分资源返回 **401** | 未认领的 Drop 站点密码保护在生效 | 认领站点，密码保护自动解除 |
| 部署后仍显示旧版本 | 浏览器或 Service Worker 缓存了旧文件 | SW 改 `network-first`；`sw.js` 设 `no-cache`；必要时在 `chrome://serviceworker-internals` 里 Unregister |
| 刷新子路由 404（SPA） | 缺少重写规则 | 见 5.2 |
| 中文文件名 / 带空格路径异常 | URL 编码与服务器解析不一致 | 部署文件名统一用英文小写 + 连字符 |
| 构建失败 `command not found` | 构建命令与仓库实际脚本不符 | 用仓库 `package.json` 里真实存在的 script 名 |
| 构建成功但页面无内容 | `publish` 指错目录 | 确认产物实际输出到哪（`dist` / `build` / `out`） |

### 排查三步法

1. 浏览器 **F12 → Network**，按状态码排序，先看哪个资源不是 200
2. 404 → 文件没传上去或路径错；401 → 权限/密码保护；200 但白屏 → JS 运行时报错
3. **F12 → Console** 看第一条报错，它通常就是根因，后面的多是连锁反应

### 本地先验证一遍

部署前在本地起一个静态服务器，排除"本地就坏"的可能：

```bash
# Node 22 自带
npx serve .

# 或 Python
python -m http.server 8080
```

> 直接双击 `index.html` 用 `file://` 打开并不等价：Service Worker、`fetch`、部分 CORS 行为在 `file://` 下不可用，必须走 `http://localhost` 才能验证完整。

---

## 七、手机端验证清单

部署完成后，用手机打开地址，逐条确认：

- [ ] 页面能正常渲染，无白屏
- [ ] 控制台（Safari：设置 → Safari → 高级 → Web 检查器）无 404
- [ ] 所有交互按钮点击有响应
- [ ] 数据能保存，刷新后仍在（本地存储写入权限正常）
- [ ] 「添加到主屏幕」后能全屏打开（PWA manifest 生效）
- [ ] 断网后重新打开仍可用（Service Worker 离线缓存生效）

> Service Worker 只在 **HTTPS** 或 **localhost** 下注册。`http://局域网IP:端口` 属于非安全上下文，不会注册，因此没有离线能力。Netlify 默认 HTTPS，满足条件。

---

## 八、自定义域名与 HTTPS

1. 后台 **Domain settings → Add a domain**，填你的域名
2. 按提示配置 DNS：
   - 根域名 `example.com` → 添加 `A` 记录指向 Netlify 提供的 IP
   - 子域名 `app.example.com` → 添加 `CNAME` 指向 `<站点名>.netlify.app`
   - 或直接把域名 NS 托管给 Netlify DNS（最省事）
3. DNS 生效后 Netlify **自动签发并续期 Let's Encrypt 证书**，无需手动配置
4. 开启 **Force HTTPS**，把 http 请求强制跳转到 https

---

## 九、速查：本项目（时间账本）的实际部署命令

纯静态、零依赖、无构建步骤：

```
timetrack/
├── index.html
├── styles.css
├── sw.js
├── manifest.webmanifest
├── netlify.toml
├── icon-192.png
├── icon-512.png
└── js/
    ├── store.js
    ├── charts.js
    └── app.js
```

对应 `netlify.toml`：

```toml
[build]
  publish = "."
  command = ""
```

部署方式：<https://app.netlify.com/drop> → **拖 `timetrack` 文件夹** → 认领 → 完成。

---

## 十、一句话总结

> 拖文件夹而不是拖 zip；认领而不是放任过期；SPA 记得加重写规则；404 先看 Resource 面板；SW 一律 `no-cache`。
