# sub2api 0.2.8 接口核对

用户确认版本：**0.2.8**。来源：[Wei-Shaw/sub2api v0.2.8](https://github.com/Wei-Shaw/sub2api/tree/v0.2.8)。核对日期：2026-09-28。真实服务器联调仍待用户填写地址与凭据。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | `{email, password}`，返回完整会话或 2FA 要求 |
| POST | `/api/v1/auth/login/2fa` | `{temp_token, totp_code}`，取得完整会话 |
| POST | `/api/v1/auth/refresh` | `{refresh_token}`，续期并可能轮换刷新令牌 |
| POST | `/api/v1/auth/logout` | 撤销刷新令牌，随后本地清理 |
| GET | `/api/v1/auth/me` | 验证当前账号角色 |
| GET | `/api/v1/admin/accounts?page=1&page_size=100&lite=true` | 分页获取账号基本信息 |
| GET | `/api/v1/admin/accounts/{id}/usage?source=passive&force=false` | Claude OAuth / setup-token 的被动额度 |
| GET | `/api/v1/admin/accounts/{id}/usage?source=active&force=false` | 其他账号沿用服务端查询和缓存 |

管理员接口使用 `Authorization: Bearer <access_token>`。普通推理 Key 不适用。响应外层采用 sub2api 的 `{code, message, data}`；错误响应与 HTTP 状态都要处理。

账号列表响应包含 `items`、`total`、`page`、`page_size` 等分页信息。提取 `id`、`name`、`platform`、`type`、`status` 和脱敏 `credentials.plan_type`（影子账号回退到 `parent_plan_type`），只保留档位字符串，不保存完整 `credentials` 或写入日志。档位用于 5 小时额度的显示规则；缺少档位时不推断账号为 Plus 或 Pro。HTTPS 使用正常证书校验，HTTP 请求不跟随重定向。

0.2.8 使用单账号接口，当前客户端不请求新版批量接口。单账号信息包含 `source`、`updated_at`、`five_hour`、`seven_day`。各窗口的 `utilization` 是已用百分比，`resets_at` 是重置时间，`remaining_seconds` 是服务端给出的剩余秒数。

服务端时间和本次客户端读取时间分别保留；缺失窗口显示 `--`。单账号失败保留旧成功数据及旧时间，其他账号继续更新。429 暂停本轮后续账号请求，遵守 `Retry-After`；缺省至少等待 30 秒。

已核对源码：`frontend/src/api/auth.ts`、`frontend/src/api/admin/accounts.ts`、`backend/internal/handler/admin/account_handler.go`、`backend/internal/service/account_usage_service.go`。

自动刷新和手动刷新均使用 `force=false`。客户端不直接发起推理调用，但服务器 active usage 查询可能触发自己的内部探测；0.2.8 的 OpenAI 查询受服务端探测冷却约束，客户端每次刷新不一定产生新的上游样本。

只有 `/auth/me` 确认管理员权限后才持久化加密会话。续期时刷新令牌轮换后更新 DPAPI 文件；迟到的并发 401 优先重试已经更新的访问令牌，避免重复续期。

服务器启用验证码、防机器人挑战或非标准登录改造时，需要追加对应登录适配，不绕过服务器的登录要求。
