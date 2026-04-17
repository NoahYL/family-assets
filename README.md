# 家庭资产 · Family Assets

一个本地运行的家庭资产管理桌面应用。Tauri 2 + React + TypeScript + SQLite。

## MVP 功能（Phase 0 + 1）

- 账户 / 品种 / 持仓 的增删改查
- 手动录入成本 + 数量，或对房产 / 保单 / 现金这类无行情的品种手动估值
- 一键刷新行情，支持 A 股、港股、美股、公募基金、USD/HKD→CNY 汇率、上金所黄金
- 刷新后自动生成一份资产快照，支撑趋势图
- 总览页：总资产、浮盈亏、按资产类别 / 账户 / 币种 的饼图
- 趋势页：总资产走势折线图
- **期权日志（Wheel 策略）**：Sell Put + Covered Call 完整生命周期记账
  - 开仓 → 到期作废 / 提前平仓 / 被行权 / 滚动
  - 自动联动现金持仓，永远不会双重计算
  - 仪表盘：已实现权利金 / 在途 / 占用保证金 / 胜率
- **公积金月度自动累积**：刷新时按月净增自动推进

数据全部存本地，路径：`~/Library/Application Support/com.family.assets/family-assets.db`

## 启动

```bash
# 首次启动前需要在 shell 里有 cargo（rustup 装完后）
source ~/.cargo/env

# 开发模式（热重载）
npm run tauri dev

# 打包 DMG（用于正式安装）
npm run tauri build
```

## 品种代码规则（录入时参考）

| 类别 | symbol 格式 | 示例 | 行情源 |
|---|---|---|---|
| A 股 | `sh` + 代码 / `sz` + 代码 | `sh600519` 贵州茅台 | sina_cn |
| 港股 | `hk` + 5 位代码 | `hk00700` 腾讯 | sina_hk |
| 美股 | `gb_` + 小写代码 | `gb_aapl` 苹果 | sina_us |
| 公募基金 | 6 位基金代码 | `000001` | tiantian |
| 实物黄金 | `gds_AU9999`（预置） | — | sina_gold |
| 现金 / 房产 / 保单 | 任意 | `CNY.CASH` / `REALESTATE-HOME1` | manual |

## 使用建议

1. **先建账户**：在"账户"页，用预置按钮一键添加兴业、中行、国投、富途、支付宝、微信、房产、保单等。
2. **再补品种**：在"品种库"页，把你实际持有的股票 / 基金加上。现金、房产、保单已预置 symbol（`CNY.CASH` / `USD.CASH` / `HKD.CASH` / `REALESTATE` / `INSURANCE` / `GOLD.AU9999`）。
3. **录入持仓**：在"持仓"页，每个"账户 + 品种"组合一行。
   - 股票 / 基金：填**数量**和**成本合计**，行情来自刷新
   - 现金：数量填**金额**，成本 = 金额，手动估值填 `1`
   - 房产 / 保单：数量填 `1`，成本填购入价 / 已缴保费，**手动估值**填当前估值 / 现金价值
   - 实物黄金：数量填**克数**，成本填买入总价，手动估值留空（自动取金价）
4. **点"刷新行情"**：成功后生成一份快照，趋势图会多一个点。

## 已知限制 / 下一步

- **支付宝 / 微信**：目前按余额登记，不导入流水（刻意简化）
- **房产估值**：目前手动；后续可接挂牌均价
- 尚未实现：账单导入、体检报告、预警、推荐引擎（Phase 2-4）

## 代码结构

```
dd/
├── src/                     # 前端
│   ├── pages/               # Dashboard / Accounts / Instruments / Holdings / Trend
│   ├── components/          # ui.tsx / AssetPie.tsx
│   └── lib/                 # api.ts / types.ts / format.ts / cn.ts
├── src-tauri/               # 后端 Rust
│   └── src/
│       ├── db.rs            # SQLite + migrations + 预置品种
│       ├── models.rs        # 所有类型定义
│       ├── error.rs
│       ├── quotes/          # 新浪 / 天天基金 行情适配器
│       └── commands/        # accounts / instruments / holdings / options / dashboard / snapshots / refresh
└── tauri.conf.json          # 窗口配置
```
