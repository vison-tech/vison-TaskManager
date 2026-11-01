#!/bin/zsh
# Source-checkout entry. Run the first launch with --data-dir in a terminal.
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print '需要先安装 Node.js 24 或以上版本，再运行 npm install 和 npm run build。'
  read -r 'taskmanager_reply?按回车关闭…'
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  print '当前 Node.js 版本过低，需要 24 或以上版本。'
  read -r 'taskmanager_reply?按回车关闭…'
  exit 1
fi
node --import tsx apps/desktop/index.ts "$@"
taskmanager_status=$?
if (( taskmanager_status != 0 )); then
  read -r 'taskmanager_reply?启动失败，按回车关闭…'
fi
exit "$taskmanager_status"
