#!/bin/bash
# 窗口纪律 · 公共函数
WD_HOME="$HOME/.claude/window-discipline"

wd_brief_file() {
  # $1 = cwd ；用路径的 md5 当文件名，契约不落在 git 仓库里，不污染 git status
  printf '%s' "$1" | md5 -q 2>/dev/null || printf '%s' "$1" | md5sum | cut -d' ' -f1
}

wd_git() { git -C "$1" "${@:2}" 2>/dev/null; }

wd_is_repo() { git -C "$1" rev-parse --git-dir >/dev/null 2>&1; }

wd_branch() { wd_git "$1" rev-parse --abbrev-ref HEAD; }

wd_dirty_count() { wd_git "$1" status --porcelain | grep -c . | tr -d ' '; }

# 欠账缓存：扫所有工作副本要 1-2 秒，所以后台刷新、前台读旧值
wd_debt_line() {
  local cache="$WD_HOME/cache/debt.txt"
  [ -f "$cache" ] && cat "$cache"
}

wd_refresh_debt_bg() {
  local self="$1"
  (
    local out="" total_wt=0 total_files=0
    while read -r wt; do
      [ -z "$wt" ] && continue
      [ "$wt" = "$self" ] && continue
      local n
      n=$(git -C "$wt" status --porcelain 2>/dev/null | grep -c . | tr -d ' ')
      if [ "${n:-0}" -gt 0 ]; then
        total_wt=$((total_wt+1)); total_files=$((total_files+n))
      fi
    done < <(git -C "$self" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2}')
    if [ "$total_wt" -gt 0 ]; then
      out="另有 ${total_wt} 个窗口躺着 ${total_files} 个没提交的文件"
    else
      out="其他窗口都收干净了"
    fi
    printf '%s' "$out" > "$HOME/.claude/window-discipline/cache/debt.txt"
  ) >/dev/null 2>&1 &
}
