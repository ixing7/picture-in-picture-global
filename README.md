# 画中画视频（全局快捷键）

把网页里的视频一键放入系统画中画小窗口。支持 **全局快捷键**：即使焦点在别的软件里，只要 Chrome 还在运行，也能开关画中画。

> 基于 Chrome 扩展 [Picture in Picture for Videos](https://chromewebstore.google.com/detail/picture-in-picture-for-vi/icmpjbkbjlbfpimllboiokakocdgfijb) 修改，增加了可设为「全局」的自定义快捷键，并修复全局快捷键下手势丢失导致经常无效的问题。

## 功能

- 点击扩展图标：切换当前标签页最大视频的画中画
- 快捷键（默认 `Ctrl+Shift+P` / Mac：`⌘+Shift+P`）：同上
- 可在 Chrome 快捷键设置里改为 **全局**
- 关掉小窗口后再按快捷键，会优先恢复上次那个视频标签页
- 图标角标提示：`OK` 进入 / `OFF` 退出 / `NO` 未找到视频 / `X` 失败

## 从 GitHub 下载安装

### 方式一：下载 ZIP（推荐，不用装 Git）

1. 打开本仓库页面
2. 点击绿色按钮 **Code** → **Download ZIP**
3. 解压到任意目录，例如：
   - `D:\Apps\picture-in-picture-global`
4. 按下方「加载到 Chrome」步骤安装

### 方式二：使用 Git 克隆

```bash
git clone https://github.com/ixing7/picture-in-picture-global.git
```

然后用克隆出来的文件夹加载扩展。

### 加载到 Chrome

1. 打开 Chrome，地址栏进入：`chrome://extensions/`
2. 右上角打开 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本项目文件夹（里面要能直接看到 `manifest.json`）
5. 安装完成后打开：`chrome://extensions/shortcuts`
6. 找到 **切换当前视频的画中画**
7. 右侧作用范围选 **全局**
8. 确认快捷键为 `Ctrl+Shift+P`（可改成你喜欢的组合；不建议用 `Alt+P`，做全局时容易冲突）

> 若你以前装过商店版「画中画视频」，建议先禁用或移除，避免快捷键冲突。

## 使用方法

1. 打开带 HTML5 视频的网页（如 YouTube），先让视频开始播放
2. 按 `Ctrl+Shift+P`，或点击工具栏扩展图标
3. 视频会进入系统画中画小窗口，可拖到任意位置继续看
4. 再按一次快捷键：若小窗口还在，会关闭；若已关掉，会再次打开（恢复）

### 角标含义

| 角标 | 含义 |
|------|------|
| OK | 已进入画中画 |
| OFF | 已退出画中画 |
| NO | 当前目标页没有可用视频 |
| X | 调用失败（受限页面、站点禁止等） |
| ? | 找不到可用标签页 |

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` / `scripting` | 在当前页注入脚本，触发画中画 |
| `tabs` | 读取标签 URL，避开 `chrome://` 等无法注入的页面 |
| `alarms` | 短暂显示角标后自动清除 |
| `host_permissions`（http/https） | 全局快捷键时 Chrome 可能没有焦点，需要跨站注入能力 |

本扩展 **不收集、不上传** 浏览数据；逻辑均在本地运行。

## 常见问题

**全局快捷键没反应？**  
先确认 `chrome://extensions/shortcuts` 里该项是 **全局**，且组合键没被其他软件占用。可改成 `Ctrl+Shift+9` 等再试。扩展图标闪 `OK` 才算真正进入成功。

**只在 Chrome 里有效、全局无效？**  
请重新加载扩展，并确保使用本仓库修改版（不是商店原版）。商店原版用的是 `_execute_browser_action`，无法设为全局。

**某些网站无效？**  
部分站点使用自定义播放器、DRM，或不提供标准 `<video>`，可能无法调用系统画中画。

**更新扩展？**  
重新 Download ZIP / `git pull` 覆盖文件后，到 `chrome://extensions/` 点本扩展的 **重新加载**。

## 本地目录

开发机上的项目路径示例：

```text
d:\Pro\Cursor\picture-in-picture-global
```

目录中需包含：

```text
manifest.json
background.js
script.js
js/bg-worker.js
icons/
_locales/
README.md
```

## 致谢

原始扩展： [Picture in Picture for Videos](https://chromewebstore.google.com/detail/picture-in-picture-for-vi/icmpjbkbjlbfpimllboiokakocdgfijb)  
本仓库在其基础上增加了全局快捷键支持与相关修复，仅供学习与个人使用。
