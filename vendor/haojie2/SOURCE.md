# 浩劫 2 固定源码

- 来源：https://github.com/Loremmlel/haojie2
- 提交：`2a9768eebcdefde8bb53ee791a885ce4e54ca810`（PR #9，规则 `3.0-feedback4`）
- `src/` 保留该提交原始文件；前后端共用同一份源码，不安装第二份 React。
- 网站只消费纯引擎与受控在线组件；离线入口、AI、发行脚本不作为网站入口。
- 更新时从已审阅提交重新导出整个 `src/`，同步 `lib/haojie/contracts.ts` 中的版本，并完成联机验收。不能在活动对局中切换引擎版本。
- 游戏通用修复回原仓库完成；不要在此维护独立规则分支。

同步命令（在网站根目录，传入本地游戏 checkout 的真实路径）：

```sh
git -C /path/to/haojie2 archive <reviewed-commit> src | tar -x -C vendor/haojie2
```

升级前应先移走旧 `src/`，避免保留上游已经删除的文件；核对完整文件清单后再提交。
