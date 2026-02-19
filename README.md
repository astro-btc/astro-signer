# Astro Signer

## Ubuntu 安装指南（1G 内存，一键安装 + 开机自启）

## 一键安装

在一台全新 Ubuntu 机器上，执行下面命令即可完成安装、启动、并设置开机自启（`systemd`）。

```bash
curl -fsSL https://raw.githubusercontent.com/astro-btc/astro-signer/master/install-ubuntu.sh | sudo bash
```

安装完成后，服务名为 `astro-signer`。

## 修改配置（.env）与重启

配置文件路径：`/opt/astro-signer/.env`

```bash
sudo nano /opt/astro-signer/.env
sudo systemctl restart astro-signer
```

注意：**修改 `.env` 后必须重启服务才会生效**。如果你确认已经重启服务但依旧不生效，可以再尝试重启服务器（少数情况下与系统网络/反向代理/防火墙配置联动有关）。

## .env 各字段含义

`env.example` 提供了示例配置，实际运行时使用 `.env`。

- **PORT**：服务监听端口（默认 `33333`）。如果你改了端口，记得同步调整云厂商安全组/防火墙放行规则。
- **BIND_HOST**：服务监听地址。安全起见默认 `127.0.0.1`（仅本机可达，不直接暴露公网）。
- **ALLOW_PUBLIC_BIND（可选）**：当你确实需要 `BIND_HOST=0.0.0.0` 时，必须显式设置为 `1` 才允许启动（强烈不建议直接暴露公网）。
- **MNEMONIC**：助记词（极其敏感）。用于签名的核心私钥来源，**切勿泄露**、不要上传到任何仓库/聊天工具/截图里。
- **REMOTE_SIGNER_SECRET**：远程调用鉴权密钥（HMAC secret）。调用方需用它生成签名请求头；建议设置为足够长的随机字符串，且与 MNEMONIC 一样需要严格保密。
- **IPV4_WHITE_LIST（可选）**：IPv4 白名单，多个 IP 用英文逗号分隔，例如：`"1.2.3.4,5.6.7.8"`。留空表示不启用白名单。
- **TRUST_PROXY（可选）**：是否信任反向代理转发的真实 IP（`X-Forwarded-For`）。当你通过 Nginx/Cloudflare 等反代访问时设置为 `1`；直连一般保持 `0`。

## 服务管理（systemd）

```bash
# 查看状态
sudo systemctl status astro-signer --no-pager

# 查看实时日志
sudo journalctl -u astro-signer -f --no-pager

# 重启/停止/启动
sudo systemctl restart astro-signer
sudo systemctl stop astro-signer
sudo systemctl start astro-signer

# 开机自启（安装脚本已自动设置）
sudo systemctl enable astro-signer
```
