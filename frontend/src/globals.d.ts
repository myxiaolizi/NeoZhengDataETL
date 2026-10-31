/**
 * 构建期注入的全局常量（V9）
 *
 * 由 `vite.config.ts` 的 `define` 在**构建时**替换为字面量，
 * 因此运行时不产生任何请求，也不依赖后端是否提供版本接口
 * （`src/routes/api.js` 当前被并行会话占用，避免为此新增路由）。
 *
 * - `__FE_VERSION__`：`frontend/package.json` 的 version（前端构建版本）
 * - `__BE_VERSION__`：根 `package.json` 的 version（后端服务版本）
 *
 * 两者在正常情况下应当一致（发版时一起改）；不一致往往意味着
 * 「只更新了前端产物」或「只更新了后端源码」，`系统设置 → 关于` 卡片会把
 * 这种不一致**显式标红**，方便部署后立刻发现没部署全。
 */
declare const __FE_VERSION__: string;
declare const __BE_VERSION__: string;
