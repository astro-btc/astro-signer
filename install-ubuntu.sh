#!/usr/bin/env bash
set -euo pipefail

APP_NAME="astro-signer"
APP_USER="root"
APP_GROUP="root"
INSTALL_DIR="${INSTALL_DIR:-$(pwd -P)}"
REPO_URL="${REPO_URL:-https://github.com/astro-btc/astro-signer.git}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${INSTALL_DIR}/.env"

PORT="${PORT:-33333}"
# Security default: localhost only (avoid accidental public exposure)
BIND_HOST="${BIND_HOST:-172.17.0.1}"
# If you really want to bind 0.0.0.0, you must explicitly opt-in.
ALLOW_PUBLIC_BIND="${ALLOW_PUBLIC_BIND:-0}"
# 强烈建议通过环境变量传入真实助记词（含空格也可以）
# 例：sudo MNEMONIC="word1 word2 ..." bash install-ubuntu.sh
MNEMONIC="${MNEMONIC:-}"
IPV4_WHITE_LIST="${IPV4_WHITE_LIST:-}"
TRUST_PROXY="${TRUST_PROXY:-0}"

log() { printf "\n[%s] %s\n" "$(date '+%F %T')" "$*"; }
die() { printf "\n[ERROR] %s\n" "$*" >&2; exit 1; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "请用 root 运行：sudo bash $0"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ensure_ubuntu() {
  if [[ ! -f /etc/os-release ]]; then
    die "无法识别系统（缺少 /etc/os-release）。"
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    die "该脚本仅支持 Ubuntu（当前 ID=${ID:-unknown}）。"
  fi
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  log "安装系统依赖（apt）"
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    openssl
}

install_node_if_needed() {
  if need_cmd node; then
    local major
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
    if [[ "${major}" -ge 20 ]]; then
      log "已检测到 Node.js $(node -v)，跳过安装"
      return
    fi
    log "已检测到 Node.js 版本过低：$(node -v)（需要 >= 20）"
  fi

  log "安装 Node.js 20.x（NodeSource）"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  log "Node.js 安装完成：$(node -v)"
}

install_yarn_if_needed() {
  if need_cmd yarn; then
    log "已检测到 Yarn：$(yarn -v)，跳过安装"
    return
  fi
  log "安装 Yarn（classic）"
  npm install -g yarn
  log "Yarn 安装完成：$(yarn -v)"
}

install_pm2_if_needed() {
  if need_cmd pm2; then
    log "已检测到 PM2：$(pm2 -v)，跳过安装"
    return
  fi
  log "安装 PM2"
  npm install -g pm2
  log "PM2 安装完成：$(pm2 -v)"
}

deploy_code() {
  log "部署代码到：${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    git -C "${INSTALL_DIR}" fetch --all --prune
    git -C "${INSTALL_DIR}" checkout "${BRANCH}"
    git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}"
  elif [[ -z "$(ls -A "${INSTALL_DIR}")" ]]; then
    git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
  elif [[ -f "${INSTALL_DIR}/package.json" && -f "${INSTALL_DIR}/bin/www" ]]; then
    log "检测到当前目录已有项目代码，跳过克隆"
  else
    die "目录 ${INSTALL_DIR} 非空且不是 astro-signer 项目目录。请先切到空目录再执行，或通过 INSTALL_DIR 指定目标目录。"
  fi
}

set_env_kv() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"

  # 去掉已有同名 key 行，再追加新值（避免 sed 处理转义/引号过于复杂）
  if [[ -f "${ENV_FILE}" ]]; then
    grep -vE "^${key}=" "${ENV_FILE}" > "${tmp}" || true
  fi
  printf "%s=%s\n" "${key}" "${value}" >> "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

setup_env_file() {
  log "准备环境变量文件：${ENV_FILE}"
  if [[ ! -f "${ENV_FILE}" ]]; then
    if [[ -f "${INSTALL_DIR}/env.example" ]]; then
      cp "${INSTALL_DIR}/env.example" "${ENV_FILE}"
    else
      touch "${ENV_FILE}"
    fi
  fi

  # PORT
  set_env_kv "PORT" "${PORT}"
  set_env_kv "BIND_HOST" "${BIND_HOST}"
  set_env_kv "ALLOW_PUBLIC_BIND" "${ALLOW_PUBLIC_BIND}"

  # REMOTE_SIGNER_SECRET（自动生成；若仍是示例值/为空则覆盖）
  local current_secret=""
  if grep -qE '^REMOTE_SIGNER_SECRET=' "${ENV_FILE}"; then
    current_secret="$(grep -E '^REMOTE_SIGNER_SECRET=' "${ENV_FILE}" | tail -n 1 | cut -d= -f2- || true)"
  fi
  # 去掉常见引号与空格，便于判断是否为空/示例值
  local normalized_secret
  normalized_secret="${current_secret//\"/}"
  normalized_secret="${normalized_secret//\'/}"
  normalized_secret="${normalized_secret// /}"
  if [[ -z "${normalized_secret}" || "${normalized_secret}" == *change-me* || "${normalized_secret}" == *CHANGE_ME* ]]; then
    local secret
    secret="$(openssl rand -hex 32)"
    set_env_kv "REMOTE_SIGNER_SECRET" "\"${secret}\""
    log "已生成 REMOTE_SIGNER_SECRET（已写入 .env）"
  fi

  # MNEMONIC（可选通过环境变量传入；未传入则保持示例值）
  if [[ -n "${MNEMONIC}" ]]; then
    local escaped
    escaped="${MNEMONIC//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    set_env_kv "MNEMONIC" "\"${escaped}\""
  fi

  # 可选项
  if [[ -n "${IPV4_WHITE_LIST}" ]]; then
    set_env_kv "IPV4_WHITE_LIST" "\"${IPV4_WHITE_LIST}\""
  fi
  set_env_kv "TRUST_PROXY" "${TRUST_PROXY}"

  chmod 600 "${ENV_FILE}"
}

install_deps() {
  log "安装 Node 依赖（yarn install --production）"
  (cd "${INSTALL_DIR}" && yarn install --frozen-lockfile --production)
}

prepare_logs_dir() {
  log "准备日志目录（logs/）"
  mkdir -p "${INSTALL_DIR}/logs/error" "${INSTALL_DIR}/logs/info" "${INSTALL_DIR}/logs/debug" "${INSTALL_DIR}/logs/summary"
}

start_pm2_service() {
  local start_cmd
  start_cmd="cd \"${INSTALL_DIR}\" && set -a && . \"${ENV_FILE}\" && set +a && exec /usr/bin/node \"${INSTALL_DIR}/bin/www\""

  log "使用 PM2 启动服务"
  pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
  pm2 start /bin/bash --name "${APP_NAME}" -- -lc "${start_cmd}"
  pm2 save

  log "配置 PM2 开机自启"
  pm2 startup systemd -u "${APP_USER}" --hp "/root"
  systemctl enable "pm2-${APP_USER}"

  pm2 status "${APP_NAME}"
}

post_instructions() {
  cat <<EOF

安装完成。

下一步（强烈建议立刻做）：
1) 编辑 ${ENV_FILE}，把 MNEMONIC 改成你真实的钱包助记词（非常敏感，务必妥善保管）
   同时建议检查/更换 REMOTE_SIGNER_SECRET（该值用于远程调用鉴权，必须保密）
2) 然后重启服务使配置生效：
   pm2 restart astro-signer --update-env

常用命令：
- 查看日志：pm2 logs astro-signer
- 查看状态：pm2 status astro-signer
- 停止服务：pm2 stop astro-signer

注意：
- 修改 .env 后必须重启服务才会生效（一般不需要重启整台服务器）。
- 如果你修改了 PORT，记得同步调整安全组/防火墙/反向代理（Nginx 等）配置。
- 如果你确认已重启服务但仍不生效，可再尝试重启服务器（少数情况下与系统网络/反向代理/防火墙配置联动有关）。
EOF
}

main() {
  require_root
  ensure_ubuntu

  apt_install
  install_node_if_needed
  install_yarn_if_needed
  install_pm2_if_needed

  deploy_code
  prepare_logs_dir
  setup_env_file
  install_deps

  start_pm2_service
  post_instructions
}

main "$@"

