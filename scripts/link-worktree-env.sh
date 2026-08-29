#!/usr/bin/env bash
# 把主仓库的 .env.local 软链接进当前 git worktree。
#
# 为什么需要：.env.local 被 git 忽略，所以 `git worktree add` 出来的新工作副本
# 不会带上它 —— 每开一个 worktree 就要手动复制一次，且主仓库改了 key 之后
# 各副本还会各自过期。软链接让所有副本共享同一份，改一次全部生效。
#
# 设计约束：
#   - 幂等：已经是软链接就直接退出，可以每次会话开始都跑
#   - 非破坏：如果当前目录已存在真实的 .env.local 文件（可能含本副本特有的键），
#     绝不覆盖，只提示，让人自己决定
#   - 无副作用：不在主仓库里跑、不是 worktree、主仓库没有 .env.local —— 都静默跳过
#   - 不打印任何键值
set -uo pipefail

ENV_FILE=".env.local"

# 不在 git 仓库里就退出
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# git-common-dir 在 worktree 里指向主仓库的 .git，在主仓库里就是 .git 本身
common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
main_root=$(dirname "$common_dir")
here=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# 在主仓库里跑：无事可做
[ "$here" = "$main_root" ] && exit 0

src="$main_root/$ENV_FILE"
dst="$here/$ENV_FILE"

# 主仓库没有源文件：跳过（不报错，可能这个仓库本来就不用 .env.local）
[ -f "$src" ] || exit 0

# 已经是软链接：幂等退出
[ -L "$dst" ] && exit 0

# 已存在真实文件：不动它，只提示
if [ -e "$dst" ]; then
  echo "note: $ENV_FILE 已存在于本工作副本且不是软链接，保持原样未改动。"
  echo "      若想改为与主仓库共享，先自行备份再删除它，下次会话会自动建链接。"
  exit 0
fi

ln -s "$src" "$dst" && echo "已将主仓库的 $ENV_FILE 链接进本工作副本（改主仓库即全部生效）。"
