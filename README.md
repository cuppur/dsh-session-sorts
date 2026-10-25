# DSH session sorts

适配 **DSH 0.2.1 系列（rc.2、rc.3 及后续 rc.x）** 的轻量会话分组侧栏插件，npm 包名与客户端模块 ID 为 `dsh-session-sorts`。

## 兼容范围

`engines.dsh` 声明为范围 `>=0.2.1-rc.2 <0.3.0`（宿主按 semver + `includePrerelease` 判定）：

| 宿主版本 | 结果 |
| --- | --- |
| `0.2.1-rc.2` | 通过 |
| `0.2.1-rc.3` | 通过（0.1.1 起；0.1.0 因精确 pin 被宿主判定 `incompatible-version`） |
| `0.2.1` / `0.2.x` | 通过 |
| `0.2.0`、`0.3.0+` | 拒绝，需要重新适配 |

0.1.0 把 `engines.dsh` 写死成 `0.2.1-rc.2`，升级到 rc.3 后宿主 preflight 直接拒载（插件页显示"异常"）。0.1.1 只把版本声明改为范围并重跑全部 13 项离线检查（其中 3 项针对真实 0.2.1-rc.3 安装目录），运行时代码未改动。

本项目 fork / 派生自 [z-col/dsh-workspace-groups](https://github.com/z-col/dsh-workspace-groups)，保留原作者 zcol 的 MIT 许可与署名。本次适配基于原项目已发布 JavaScript 产物，不声称持有或重建上游完整 TypeScript 工程。

## 功能

- 分类 → 项目 → 会话三层树、展开状态持久化。
- 手动分组新建、改名、删除；规则分组支持显示改名与隐藏。
- 项目拖放归组、拖出、组内顺序和分类顺序。
- 分类、项目、会话搜索；当前会话、运行状态与子智能体计数。
- 使用 DSH 0.2 的 `uiWorkspace`、session retained scope、store 和 UI primitives 接口。
- Host 外置 `js-yaml` 依赖，运行包去掉旧类型声明、source map 和内嵌 YAML 实现。

## 数据兼容与迁移

改名只改变包身份、client module ID、注册标识与显示名。为兼容原数据，以下接口**保持原样**：

| 项目 | 值 |
| --- | --- |
| Cordis configuration row ID | `workspace-groups` |
| locale namespace | `workspaceGroups` |
| 展开状态存储 key | `dsh.workspace.groups.view.v1` |
| 规则 YAML | `$DSH_HOME/workspace-groups.yaml` |
| 手动 JSON sidecar | `$DSH_HOME/workspace-groups.manual.json` |
| HTTP routes | `/workspace-groups/config`、`/workspace-groups/manual` |
| 拖放 MIME / CSS classes | 原 `workspace-groups` / `wg*` 标识 |

`DSH_HOME` 未设置时使用 DSH 默认 home。规则 YAML 只读；手动修改仅更新插件 JSON sidecar，保留校验与同目录临时文件 → fsync → rename 的写入流程。

替换旧插件时应由操作者先备份这两个 sidecar 并停用旧包，避免两个插件争用相同 route、sidebar slot 与存储。此仓库发布过程**没有安装、启用或迁移任何运行插件，也未修改 profile、重启或刷新宿主**。

示例规则（路径为合成示例）：

```yaml
categories:
  - name: Code
    rules:
      - pathPrefix: C:/example/code
```

## 从源码复现

运行包要求 Node >=20；本仓库离线测试使用 `node:module.registerHooks`，测试工具要求 **Node >=22.15（推荐 Node 24+）**。宿主相关测试需一份 DSH **0.2.1-rc.2 或更高 rc.x** 安装目录，仅作只读验证。

```sh
# 不自动安装 DSH peer packages；它们由实际宿主提供。
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm run check
npm test
npm pack --dry-run
npm pack
```

不设置 `DSH_TEST_HOST` 时运行 10 项独立离线检查，显式跳过 3 项安装宿主检查。完整 13 项检查：

```powershell
$env:DSH_TEST_HOST = 'PATH_TO_DSH_ROOT'
npm test
```

该目录应包含 `node_modules/@deepseek-ai/` 和 `node_modules/js-yaml/`。测试只在项目 `out/fixture/` 写入合成 sidecar；结果输出至忽略的 `out/test-results.json`，不提交运行日志或机器路径。

## 工程结构

- `lib/`：可审阅、可运行的派生 JavaScript 源码。
- `adapt.mjs`：从精简 baseline fixtures 锚点式重建；锚点缺失会报错。
- `tests/offline.mjs`：原始失败复现、桥接 API、树、搜索、分组 CRUD、拖放和 Host 边界测试。
- `tests/fixtures/upstream/`：重建与回归所需上游 JS / manifest / MIT 许可；无 source maps、类型文件、依赖目录或用户数据。
- `cordis.patch.yml`：仅描述插件 bundle，不会因测试或打包自动应用。

`npm pack` 仅包含 manifest、README、MIT LICENSE、bundle patch 与两个运行 JS；不含 fixtures、适配脚本、测试、日志或依赖目录。`npm pack` 是本地归档验证，**未向 npm registry 发布**。

## 验证状态与限制

在 DSH 0.2.1-rc.3 文件上，13 项离线检查通过（含宿主 preflight 对 `0.2.1-rc.2`／`0.2.1-rc.3`／`0.2.9` 放行、对 `0.2.0`／`0.2.1-rc.1`／`0.3.0` 拒绝的正反用例）；真实 ClientModuleSystem 和 seed 导出表亦已检查。13 项包括调用原 UI handlers 与合成 drop events 的逻辑回归，不等于浏览器交互验收。

**真实 GUI 验收仍待进行**：实际 Cordis boot、DOM / React 布局、鼠标拖放、原生目录选择、真实会话操作、HMR / 重连、多窗口并发与长列表性能均未在此发布中验证。没有宣称真实 GUI 已可用，也没有 RAM / CPU / 启动时间 benchmark。

详见 [适配说明](ADAPTATION.md)。

## 许可

[MIT](LICENSE)，原始版权 `Copyright (c) 2026 zcol` 完整保留。
