# Phase 6 人工验收清单（2026-08-31）

> 自动化门禁已全绿：`tsc --noEmit` ×2 (0 errors)、vitest 300/300、Playwright chromium 60 passed / 2 预存失败（users search + setup full-flow，见 D104/D106）。
> 以下 4 项需要真实外部服务 / 真实硬件，无法自动化，逐项人工验证。

## 1. GitHub OAuth 真实 App 往返

- [ ] **前置**: 创建 GitHub OAuth App（Settings → Developer settings → OAuth Apps），Homepage = `http://localhost:5173`，Callback = `http://localhost:5101/api/v1/auth/oauth/github/callback`
- [ ] 写入环境变量后重启 server：`GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...`
- [ ] 打开 `/login` → 点击 "GitHub" 按钮 → GitHub 授权页 → 同意 → 回跳 `/dashboard` 且已登录
- [ ] `/profile` 链接账号列表出现 GitHub 条目；解除绑定后无法再用该 GitHub 身份登录
- **验证点**: state cookie 的 httpOnly/SameSite=Lax；D109（GitHub 无 PKCE 豁免）符合预期

## 2. Google OAuth 真实 App 往返

- [ ] **前置**: Google Cloud Console → OAuth 同意屏幕 + OAuth 客户端（Web），Redirect URI = `http://localhost:5101/api/v1/auth/oauth/google/callback`
- [ ] 写入环境变量后重启 server：`GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...`
- [ ] `/login` → "Google" 按钮 → Google 授权页（应出现 PKCE，参数含 `code_challenge`）→ 回跳 `/dashboard`
- [ ] 错误路径：拒绝授权 → 回到 `/login?error=...`（反枚举，无堆栈泄露）
- **验证点**: D85/D109 — Google 必须带 PKCE（state + code_verifier 双 cookie）

## 3. 真实硬件安全键 Passkey 仪式（Chrome）

- [ ] **前置**: 硬件安全键（YubiKey 等）+ Chrome；`/settings` → Security 标签
- [ ] 注册：点击 "Add Passkey" → 触摸安全键 → 列表出现新凭证（device name/transports 可见）
- [ ] 登出 → `/login` → "Passkey" 按钮 → 触摸安全键 → **无需输入用户名**直接登录成功（D112 用户名无发现）
- [ ] 重复用同一 challenge 登录 → 被拒（FlowToken 单次消费）
- [ ] （可选，克隆检测）导出/重放旧 assertion → counter 回退被拒
- **验证点**: RP ID = localhost；challenge 一次性；counter 单调

## 4. Phase 6 新页面视觉走查

- [ ] `/dashboard`：4 张统计卡数值与后端一致（对照 `GET /api/v1/stats`），Recent Activity 最多 10 条、相对时间正确，Quick Actions 3 个按钮跳转正确
- [ ] `/settings` General 标签：站点信息保存后刷新仍在（localStorage）
- [ ] `/settings` Security 标签：会话列表 + 撤销后行消失；Passkey 列表 + 删除后行消失
- [ ] `/profile`：关联账号（OAuth links）区渲染、解绑按钮工作
- [ ] 中英文切换后以上页面无 missing key（i18n en/zh）
- **验证点**: 0 控制台应用错误（过滤 findDOMNode/chrome-extension/ResizeObserver）；无 antd static message 依赖（PIT-023）
