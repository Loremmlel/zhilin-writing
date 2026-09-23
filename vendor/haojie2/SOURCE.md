# 浩劫 2 固定源码

- 来源：https://github.com/Loremmlel/haojie2
- 提交：`cefeafbf6bceb2a828352f10b6f22fba0ad7955f`（2026-09-23 主线，规则 `3.0-feedback5-live-deployment`）
- `src/` 引擎保留该提交原始文件；前后端共用同一份源码，不安装第二份 React。在线悔棋有下述 UI 接口补丁。
- 网站只消费纯引擎与受控在线组件；离线入口、AI、发行脚本不作为网站入口。
- 更新时从已审阅提交重新导出整个 `src/`，同步 `lib/haojie/contracts.ts` 中的版本，并完成联机验收。不能在活动对局中切换引擎版本。
- 游戏通用修复回原仓库完成；不要在此维护独立规则分支。

同步命令（在网站根目录，传入本地游戏 checkout 的真实路径）：

```sh
git -C /path/to/haojie2 archive <reviewed-commit> src | tar -x -C vendor/haojie2
```

升级前应先移走旧 `src/`，避免保留上游已经删除的文件；核对完整文件清单后再提交。

## 网站在线悔棋 UI 接口（2026-09-22）

网站为 `ui/online/types.ts`、`ui/online/useOnlineController.ts`、`ui/GameSurface.tsx`、`ui/board/Battlefield.tsx` 增加可选的 `onUndo` / `canUndo` 与 `showRedo`。只将原有悔棋按钮交给宿主申请双方确认；在线隐藏重做，本地默认行为不变。没有更改引擎、规则版本或在客户端恢复权威状态。同步上游时须保留/合入这四处 UI 接口，并验证网站悔棋流程；不能用全目录覆盖静默丢失该接口。

## 2026-09-23 同步

完整同步上游主线，包括引擎目录调整、万法真君冰冻反制修正、棋子与关键词介绍。保留四处悔棋接口；新增 `ui/library/UnitReferenceProvider.tsx` 可选 `disabled`，宿主暂停操作时关闭新增的介绍弹窗，防止原生 top layer 遮挡双方确认。网站 CSS 继续拥有居中与悬浮布局。旧反馈3／反馈4终局经原状态结构验证后只读投影，不迁移存档、不允许旧局继续操作。

本次再同步上游反馈5规则与增量存档 `haojie-record-v1`，保留上述五处宿主适配。网站 `haojie_rooms.state_json` 仍只保留当前权威局面供轮询和断线续玩；`haojie_records` 从逐步完整局面改为初始局面、命令及悔棋事件，终局档案 formatVersion 2 另附当前局面用于核对。游戏本地导入/导出沿用上游 `serializeSession` / `parseSession`。
