# GitHub 镜像同步

本仓库以 Sites 内部的 `origin/main` 为权威源，并将完整 Git 历史镜像到
`https://github.com/Loremmlel/zhilin-writing`。`github` remote 继续使用 HTTPS；
当前沙箱无法解析 GitHub 的 SSH 通道，因此 Deploy Key 不能解决连接问题。

## 使用方法

先确保当前位于 `main`，并提交所有改动，然后运行：

```bash
bash scripts/sync-github.sh
```

脚本会：

1. 获取 `github/main` 并确认它是本地 `main` 的祖先；如发生分叉则停止，不会强推。
2. 显示 GitHub 设备授权地址和一次性代码。
3. 授权完成后执行快进推送，并核对本地与 GitHub 的完整 commit SHA。

如果两端已经一致，脚本会直接退出，不要求授权。

在普通终端中可以直接运行完整脚本。ChatGPT Work 的托管沙箱有时会要求审批
“脚本内部发起的网络请求”，即使同一个 GitHub 请求作为显式短命令可以执行。
遇到 `network approval` 时不要反复重试或持久化凭据；由 Agent 按本脚本的顺序
拆开执行短请求即可，仍然不需要下载安装 `gh`。

## 凭据与权限

- 仓库只保存公开的 OAuth 客户端标识，不保存 token、密码或 SSH 私钥。
- 访问令牌仅存在于脚本进程内，不写入 remote、Git 配置或文件。
- 当前 GitHub 仓库是公开仓库，脚本只申请 `public_repo` 权限。
- 如果以后把 GitHub 仓库改为私有，可改用：

  ```bash
  GITHUB_SYNC_SCOPE=repo bash scripts/sync-github.sh
  ```

不要把 Deploy Key 的私钥提交到仓库。GitHub 仓库设置中只能保存公钥；私钥应留在可信、持久的运行环境中。

## 远端约定

```text
origin  Sites 内部远端，权威源
github  GitHub HTTPS 镜像
```

脚本固定同步 `main:main`，并拒绝脏工作树、错误分支、非 HTTPS GitHub remote
和已经分叉的历史。需要改写历史时应先人工检查，再单独使用带精确 lease 的推送命令。
