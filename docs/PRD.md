# AlphaPlan — 可审计的 AI 基金经理

> **每一笔交易，都先有一份能复算的「计划」。**

黑客松画像：单人 · 半天 · 一条赛道 **🧠 Verifiable AI** · 用 Chainlink CRE。

> ## ⚠️ 保真度声明
>
> **本 demo 处于 L1/L2，不在 L3。DON 不会真的定时执行。**
>
> | 档位 | 路径 | 证明了什么 | 没证明什么 |
> |---|---|---|---|
> | **L1** | `cre workflow simulate`（无 broadcast） | 真 WASM、真 HTTP、真链上读、真聚合 | 无交易 |
> | **L2** | `simulate --broadcast` | 真交易、真 `forwarder → onReport` 路径 | **签名方不是 DON**，是本地 CLI 侧签的 |
> | **L3** | anvil + `vm.prank` | 只有合约逻辑 | 与 CRE 完全无关 |
>
> 本项目的 demo 用 **L2**。即使 `--broadcast` 成功，签名方仍是本地 CLI，不是 DON 共识。
> 原因是 `cre whoami` → `Deploy Access: Not enabled`。若使用 L3，必须逐字声明
> 「本节演示合约逻辑，DON 签名路径见 simulate 日志」，**不得声称 DON 在跑**。

---

## 1. 问题定义

市面上所有"AI 交易"产品都在说同一句话：*我们的策略很赚钱*。这句话**无法验证**。
用户能看到的只有收益率截图，和一份没人能审计的黑盒。

AlphaPlan 反过来承诺一件可验证的事：

> **我们不承诺 AI 赚钱。我们承诺：AI 做的每一次决定，你都能拿到它的原始辩论记录，
> 自己算一次哈希，和链上记录对上。对不上就说明被篡改过。**

产品卖的是**出处证明（provenance）**，不是收益。它恰好是 CRE 能提供、
单机脚本提供不了的东西（DON 执行 + forwarder 签名 + 链上留痕）。

名字即机制：**Alpha**（超额收益）+ **Plan**（每一笔决策先有书面计划）。
计划文件就是证据，链上只存它的哈希。

### 1.1 金库的角色：执行落点，不是商业模式

金库**不是**这个产品的商业模式。产品是**决策记录本身**：任何事后必须向第三方
解释「AI 为什么这么做」的场合都需要它。这个 demo 用一笔真实资金把记录变成
有后果的东西——**只有赔得起钱的决策，才值得被审计**。

**demo 里的第一笔存款来自开发者本人。这不是用户验证，是机制验证。**
「谁会存钱进来」在本阶段**不是本项目要解决的问题**，我们不编市场故事。

---

## 2. 分工原则（整个设计的地基）

| 谁 | 干什么 | 安全目标 |
|---|---|---|
| **合约** | 持仓、算 NAV、执行 swap、强制执行风控 | **trustless** —— 不需要信任任何人 |
| **CRE workflow** | 取计划、校验、生成报告、写链 | **traceable** —— 需要出处证明 |
| **AI 辩论层（链下）** | 3 个 agent 辩论出目标仓位，产出计划文件 | 可复算 —— 输出即证据 |

**NAV 绝不由 CRE 报告。** 否则报告与执行之间的时间差就是免费套利窗口。
NAV = 持仓 × Chainlink Data Feeds 价格，合约内实时计算，任何人随时可查。

---

## 3. 产品机制

### 3.1 份额与 NAV

- 合约是标准 **ERC-4626**：`deposit(USDC)` → 拿份额；`redeem` → 换回 USDC。
- `totalAssets()` = USDC 余额 + WETH 余额 × ETH/USD（Chainlink feed），实时计算。
- **申购/赎回是原子的**，价格就是当前区块的 NAV —— 没有"上一期净值"可套利。

### 3.2 投资授权（mandate，写死在合约里）

| 参数 | 值 | 含义 |
|---|---|---|
| `MAX_WETH_BPS` | 6000 | 风险资产最多 60%（**唯一**的仓位上限） |
| `TOLERANCE_BPS` | 300 | 偏离目标 3% 以内不交易 |
| `MAX_SWAP_BPS` | 5000 | 单次报告最多换掉 50% 的 NAV |
| `SLIPPAGE_BPS` | 50 | 最小成交量由 **oracle 价格**推出，不由报告携带 |
| `MIN_INTERVAL` | 60s | 两次执行的最小间隔 |
| `MAX_PLAN_AGE` | 3600s | 计划自 `asOf` 起的最长可执行时限 |

> **没有 `MIN_CASH_BPS`。** 曾经有一个，被删了，理由是它**数学上恒不生效**：
> 买入量 = `desired − current`，买入后现金 = `total − desired`，而 `desired ≤ 0.6·total`，
> 所以现金必然 ≥ `0.4·total`。现金下限永远不是约束，真正起作用的是 `MAX_WETH_BPS`。
> 把它写成"第二道保险"是误导——它是一行永不触发的代码。

资产宇宙 = **USDC + WETH 两种**。这不是偷懒：Base Sepolia 上实测只有 USDC/WETH 池子有流动性
（WBTC、LINK 的候选地址在该测试网无代码），其他标的没有可交易对象。
带宽窄反而让「仓位权重」这个数字变得干净可验证。

> **40% 现金不是不变量，只是调仓那一刻的推论。** WETH 涨价会让现金占比自动跌破 40%，
> 此时金库处于**偏离 mandate** 状态，直到下一份计划把它拉回来。
> 合约不会自动再平衡，也不会因此 revert。现金变薄**不阻断赎回** ——
> 赎回会自动卖 WETH 补足，代价是那笔赎回要付一次 swap（见 §3.5）。

### 3.3 一次决策的完整生命周期

```
①  链下：bull / bear / risk 三个 agent 辩论 → judge 裁决
        → src/backend/plans/<planId>.json（含全部原始意见）
                                    ↓  静态文件 / HTTP
②  CRE workflow（cron 触发）：
      evm 读：金库持仓 / currentWethBps / lastNonce
      evm 读：ETH/USD latestRoundData（权威价格，陈旧即失败）
      HTTP 取 ① 的文件 → **对原始字节算 keccak256 = planHash**
      evm 读：planUsed[planHash]  → 已用则 log 并跳过（不发报告）
      校验：asOf 时效、validUntil、边界、nonce
      生成报告 → 经 Forwarder 写入金库
                                    ↓
③  合约 onReport：
      sender == forwarder、asOf ≤ now、now−asOf ≤ MAX_PLAN_AGE
      validUntil ≥ now、nonce == lastNonce+1、!planUsed[planHash]
      targetWethBps ≤ MAX_WETH_BPS（**越界即拒，不静默夹取**）
      计算偏离 → swap 量 → 用 oracle 价推 amountOutMinimum → Uniswap V3
      置 planUsed[planHash] = true；发 PlanExecuted(reportHash, planHash, asOf, validUntil, ...)
                                    ↓
④  任何人：读事件拿 planHash → 对仓库里那份 JSON 原始字节算 keccak256 → 对上
```

**一份计划至多被执行一次**（`planUsed`）。想再调仓必须出**新计划**——
包括上一笔 swap 被 `MAX_SWAP_BPS` 或仓位上限截断的情况，不能拿旧计划补完。
理由不是洁癖：AI 在 `asOf` 时刻看着条件 X 做的判断，20 分钟后条件已是 Y，
拿它继续下单就是**用过期判断交易**。

### 3.4 费率（写死，不可改）

- 管理费 **0.1% / 30 天**，用**铸份额**给 `feeRecipient`。
- 常量，无 setter，无代理升级。**合约里不存在任何能把用户资产转给 owner 的函数。**
- 唯一 owner 权限：暂停策略（`pause`）、切换 forwarder 地址。两者都**不影响赎回**。

**多周期行为（明确定义，不留歧义）**：**近似线性累计（非严格复利）**。

```
periods       = floor((now − lastFeeAccrual) / 30 days)
feeShares     = totalSupply × 0.1% × periods
lastFeeAccrual += periods × 30 days          // 余数保留，避免长期累计误差
```

90 天没人调用 → 补 **0.3%**，不是 0.1%。否则「不调用」惩罚收费方、奖励持有者，
且收费金额取决于 keeper 勤快程度，不可预期。

**计费基数是 `totalSupply`，不是 `totalAssets`。** 准确地说，这个公式保证的是：

> **每位既有持有人，每一期被稀释恰好 0.1%**（相对自己的份额），
> 与期间有没有新资金进来无关。

但**绝对费用金额不是不变的**：期内存入让 `totalSupply` 变大，
`feeShares = totalSupply × 0.1% × periods` 也等比变大。这是设计使然 ——
新资金也享用了同一期的管理，理应同比例付费。**不要把它写成「临时存入不影响收费金额」，
那句话是错的。**

**「近似线性累计（非严格复利）」的含义：** 公式每次都乘在「已经长大的」`totalSupply` 上，
所以：

```
90 天一次调用： S × 1.003          = 1.003000·S
分三次调用：    S × 1.001³         = 1.003003·S
差 ≈ 3.0e-6（相对）
```

即「一次性补多期」比「按期调用」略微少收。这是刻意选择的取舍：
真复利需要循环（gas 随期数线性增长，且 `totalSupply` 逐期变化），
3e-6 在 demo 尺度完全不可见。**测试断言用相对误差 ≤ 1e-5，不要断言严格相等。**

调用时机：`onReport` 内部**先调用** `accrueFee()`，同时保留公开入口供任何人触发。
诚实说明：没有计划被接受就不会收费。

**已承认的边界：摩擦落在晚存入者身上，不在老持有人身上。**
按此公式，费用结算前一秒存入的人，**自己的份额被立即稀释 0.1%**，
却完全没有享受这一期的管理服务。反过来说，老持有人不会因为有人临时存入而多付费用
（绝对金额变大，但他们的稀释比例恒为 0.1%）。这是份额制管理费的固有摩擦，
接受并标注，**不引入锁定期 / 持有时间加权**（那会让合约复杂度翻倍，且赎回条款变复杂）。

### 3.5 赎回（`redeem` 永远可用，现金不足时自动卖 WETH）

**机制**

1. 先按 `previewRedeem(shares)` 算出这次要付的 USDC（= `needed`）。
2. 若金库 USDC 现金 `>= needed`：直接付现金，**不碰 router**。
3. 若现金不足（`shortfall = needed − cash`）：自动卖 WETH 补足，然后付现金。
   - **第 1 笔**卖出量 = 刚好够，不多卖：`amountIn = ceilDiv(shortfall × 1e20, ethPrice)`。
     取整向上是刻意的：宁可多卖 1 wei 的 WETH，也不能少付 1 wei 的 USDC。
   - **补卖**：单次 `ceilDiv` 不保证够 —— 池子手续费（0.3%）与滑点会让实际到账
     少于 oracle 预期。因此实现**最多补卖 4 轮**，每轮按**差额**重新计算，几何收敛。
     池子足额时第 1 轮即成功。
     补卖笔 `want = deficit + 2` 且按最差可用价放大：
     `amountIn = ceilDiv(want × BPS × 1e20, (BPS − SLIPPAGE_BPS) × ethPrice)`。
     差额逐次几何收敛（每轮缺口缩到上一轮的 ≤ 0.5%），所以 4 轮是充裕上界，不是随机数。
   - `amountOutMinimum` 由**同一个 oracle 价**逐笔推出（`SLIPPAGE_BPS = 50`），
     不使用任何报告/计划携带的价格。这条与 `onReport` 的 swap 用的是同一套定价规则。
   - 卖出总额的**经济上界**：`ceilDiv(shortfall × BPS × 1e20 / ((BPS − 50) × ethPrice))`。
     即「即使池价一直贴着容差下沿，卖这么多也够」，永远卖不出这个量之上。
4. 只有**极端情况才 revert**：WETH 全卖光仍不足（池子枯竭 / 成交价劣化到超出滑点容差）。
   此时抛自定义 error `InsufficientLiquidity(uint256 required, uint256 cashAvailable, uint256 wethValue)`，
   **不是**裸 revert、**不是** OZ 的 `ERC20InsufficientBalance` —— 前者说不清发生了什么，
   后者会让人误以为是份额余额问题。三个参数分别回答「要多少 / 现有多少现金 / WETH 值多少」，
   拿到 revert 数据的人不用猜。
   另：在**动手卖之前**先做一次预检 `cash + realizable < assets` 就 revert，
   不会白跑一笔 swap 再失败。

**不变量与边界**

- `redeem` 永远可用，`pause` 不拦赎回 —— **包括走自动卖 WETH 的那条路径**。
  `_withdraw` 里不得出现 `whenNotPaused`，否则暂停策略会顺带冻结退出。
- 现金充足是 `MAX_WETH_BPS` 在**调仓那一刻**的推论，不是持续不变量。WETH 涨价会把
  现金占比压到 40% 以下 —— 但这**不再阻断赎回**，只意味着这次赎回要触发一次 swap。
- 卖出后金库 USDC 可能有 **[0, 3] wei 的零头**（取整残留），不是 bug。
  为什么是 3 而不是 1：补卖分支会额外多要 2 个 USDC 单位（`want = deficit + 2`），
  因为两层 floor 取整会让 1 单位的缺口永远卖不出来。所以最终零头上限是 3 wei。
  前端对账小结会看到这个零头，它必须有解释 —— 这就是解释。
- **`maxRedeem` / `maxWithdraw` 返回「当前 USDC 现金可覆盖的部分」（保守）。**

  ERC-4626 的约定是「视图不该 revert」，所以视图绝不能返回一个会 revert 的数字。
  但"卖不卖得出去"取决于池子深度，合约看不见。因此：

  | 视图 | 返回 | 含义 |
  |---|---|---|
  | `maxRedeem` | `min(totalSupply, convertToShares(cash))` | 现金够付的上限 |
  | `maxWithdraw` | `min(totalAssets, cash)` | 同上，按资产计 |
  | `previewRedeem` | 按当前 NAV 全额 | 应付多少，与能不能付无关 |

  **视图不撒谎，实际能力更大**：超出 `maxRedeem` 仍然可以 `redeem`（会自动卖 WETH），
  只是视图不承诺它一定成功。这个不对称是刻意的 —— 保守视图 + 更大实际能力，
  比"视图全额返回但可能 revert"对集成方友好得多。

**为什么不做 T+N 赎回（明确的取舍，不是遗漏）**

真实基金赎回要等基金经理卖股票：用户提交申请，几天后到账。我们做成**即时**，
代价是**每次触发自动卖出的赎回都要付一次 swap 的 gas 和滑点**（gas 由赎回人出，
滑点按 §9 说明由留下的持有人承担）。

这个取舍得失清楚：
- 换来的是「赎回即时完成，不用等基金经理卖股票」—— 这是 demo 能演示 full cash out 的前提；
- 付出的是赎回路径从「只读自己的 USDC 余额」变成「依赖 Uniswap 池子 + oracle 新鲜度」。

反过来说，如果哪天池子枯竭或 oracle 陈旧，赎回会 revert —— 这是选了即时性之后
必须承认的代价，不假装没有（见 §9 第 4 条）。

---

## 4. 系统结构（按现有仓库）

```
SuperBi4o/
├── docs/
│   ├── PRD.md
│   └── PLAN.md
└── src/
    ├── contract/                     # 合约端（Foundry）
    │   ├── src/AlphaPlanVault.sol
    │   ├── test/AlphaPlanVault.t.sol
    │   └── script/Deploy.s.sol
    ├── backend/                      # 后端（Bun，单个 package.json）
    │   ├── package.json
    │   ├── src/debate.ts             # AI 辩论层
    │   ├── src/schema.ts             # zod，计划文件格式即契约
    │   ├── src/verify.ts             # 链上 ↔ 文件 哈希对账
    │   ├── plans/*.json              # 计划文件（提交进 Git = 证据）
    │   └── cre/                      # CRE 工程（cre init 生成，自成一包）
    │       ├── project.yaml
    │       └── alpha-plan/           # workflow
    └── frontend/
        └── alpha-plan/               # 前端（Next.js，已有脚手架）
```

**一个合约，不是两个。** 之前讨论过拆 Vault / Executor，最终决定合并：Executor 不持币，
拆开只是多一层调用和一组权限，半天工期里换不来任何安全性，只换来更多出错面。
要换策略，换的是 workflow，不是合约。

**包管理器**：前端沿用已有的 pnpm；后端用 Bun（CRE 的 TS workflow 本来就是
Bun 编译 → WASM，`bunx cre-setup` 也要求 Bun，统一一个工具链比混两套 lockfile 干净）。

---

## 5. 合约接口

```solidity
contract AlphaPlanVault is ERC4626, Ownable {
    // —— 不可变依赖 ——
    IERC20  immutable WETH;
    AggregatorV3Interface immutable ETH_USD_FEED;
    ISwapRouter immutable ROUTER;
    uint24  immutable POOL_FEE;
    address immutable FEE_RECIPIENT;

    // —— 常量（无 setter）——
    uint16 constant MAX_WETH_BPS = 6000;          // 唯一的仓位上限
    uint16 constant TOLERANCE_BPS = 300;
    uint16 constant MAX_SWAP_BPS  = 5000;
    uint16 constant SLIPPAGE_BPS  = 50;
    uint64 constant MIN_INTERVAL  = 60;
    uint64 constant MAX_PLAN_AGE  = 3600;
    uint16 constant FEE_BPS_PER_PERIOD = 10;      // 0.1%
    uint64 constant FEE_PERIOD = 30 days;

    // —— 状态 ——
    address public forwarder;        // owner 可改（mock ↔ prod）
    bool    public paused;           // 只停策略，不停赎回
    uint64  public lastNonce;
    uint64  public lastExecutedAt;
    uint16  public lastTargetWethBps;
    bytes32 public lastPlanHash;
    uint64  public lastFeeAccrual;
    mapping(bytes32 planHash => bool used) public planUsed;   // 一份计划至多执行一次

    // —— 视图 ——
    function totalAssets() public view override returns (uint256);   // USDC + WETH 估值
    function currentWethBps() public view returns (uint16);
    function lastPlan() external view returns (bytes32, uint16, uint64);

    // —— 核心 ——
    function onReport(bytes calldata metadata, bytes calldata report) external;
    function accrueFee() external;                // 任何人可调
    function setForwarder(address) external onlyOwner;
    function pause() / unpause() external onlyOwner;

    event PlanExecuted(
        bytes32 indexed reportHash,
        bytes32 indexed planHash,
        uint64 asOf,
        uint64 validUntil,
        uint16 targetWethBps,
        uint16 actualWethBps,
        uint256 usdcIn,
        uint256 wethIn,
        uint64 nonce
    );

    /// @dev 接受但未交易（偏离在容差内，或被仓位上限截断到 0）
    event PlanRecorded(
        bytes32 indexed reportHash,
        bytes32 indexed planHash,
        uint64 asOf,
        uint64 validUntil,
        uint16 targetWethBps,
        uint16 actualWethBps,
        uint64 nonce
    );

    /// @dev 赎回触发的自动卖 WETH。**没有计划**，是流动性管理，不是策略决策。
    event LiquiditySold(
        address indexed forHolder,   // 赎回的人
        uint256 wethIn,              // 卖出的 WETH
        uint256 usdcOut,             // 换回的 USDC
        uint256 shares,              // 为多少份额赎回而卖
        uint64  timestamp
    );
}
```

**事件签名（唯一事实来源，与 `src/contract/out/.../AlphaPlanVault.json` 一致）：**

| 事件 | 签名 | topic0 |
|---|---|---|
| `PlanExecuted` | `PlanExecuted(bytes32,bytes32,uint64,uint64,uint16,uint16,uint256,uint256,uint64)` | `0x32fcaf0e03b774dd6c329a94ed690d2c36cab98914f95e28d809f9ef81104f11` |
| `PlanRecorded` | `PlanRecorded(bytes32,bytes32,uint64,uint64,uint16,uint16,uint64)` | `0xb7e38568320cd4c1f411da3b661de985d1ca19a9c83d0ff910bbf8a592dd823c` |
| `LiquiditySold` | `LiquiditySold(address,uint256,uint256,uint256,uint64)` | `0xc1ce2ec3be95b90ba620b8bf68f85fe76a5890db4d6145149a5f446e182a8e14` |

两个 `Plan*` 事件的 `indexed` 均为 `reportHash, planHash`；`asOf`/`validUntil` 是**非 indexed 的第 3、4 个字段**。
`LiquiditySold` 的 `indexed` 只有 `forHolder`。

> **为什么需要 `LiquiditySold`：** 产品论点是「每一笔交易都先有一份计划」，而赎回触发的
> 卖 WETH **既无计划也无 `PlanExecuted` 事件**。不发这个事件，链上持仓变了但日志里查不到
> 对应交易 —— 前端「计划历史」会和链上对不上，这是评委最容易抓的地方。
>
> 发出去之后叙事变成：**「每一笔*投资决策*都有计划；赎回是流动性管理，同样上链可查。」**
> 前端据此可以两条流分开渲染：`PlanExecuted`/`PlanRecorded` = 策略交易，
> `LiquiditySold` = 非计划交易（明确标注）。
>
> 这比"我们也有例外"强，因为例外被编码进了数据模型，而不是写在脚注里。

> **为什么事件里要带 `asOf` / `validUntil`：** 可审计性要求数据在链上。审计者只读链上日志
> 就能知道"这份计划是何时生成的、何时失效的"，不需要拿到你的本地文件。若只留在文件里，
> 一个被攻破的 workflow 可以报 `asOf = now` 却指向旧文件的哈希（见上面第 5、6 条注解），
> 链上没有任何东西能反驳它。
>
> ⚠️ **改事件签名必须同时改三处，缺一即静默错位：**
> PRD §5（本节签名表）+ `docs/ACCEPTANCE.md` A14（期望 topic0）+ `.qa` 脚本（期望签名 / 解码序）。
> 这三处已经因为不同步出过两次问题。**下游解码时第 3 个字段是 `asOf`，不是 `targetWethBps`** ——
> 按旧 ABI 解码不会报错，只会把 `asOf` 当仓位读走，哈希与时序校验全部错。

### 报告 ABI（CRE 端 `encodeAbiParameters` 生成）

```
(address vault, uint64 asOf, uint64 validUntil, uint64 nonce,
 uint16 targetWethBps, bytes32 planHash)
```

`onReport` 校验顺序（任一失败即 revert，全部 fail-closed）：

| # | 校验 | 挡住什么 |
|---|---|---|
| 1 | `msg.sender == forwarder` | 任意人伪造报告 |
| 2 | `vault == address(this)` | 报告发错金库 |
| 3 | `!paused` | owner 暂停期间执行 |
| 4 | `block.timestamp >= lastExecutedAt + MIN_INTERVAL` | 高频刷执行 |
| 5 | **`asOf <= block.timestamp`** | 未来时间戳的计划 |
| 6 | **`block.timestamp - asOf <= MAX_PLAN_AGE`** | **拿陈旧计划下单** |
| 7 | `validUntil >= block.timestamp` | 过期计划 |
| 8 | `nonce == lastNonce + 1` | 报告层重放 / 乱序 |
| 9 | `targetWethBps <= MAX_WETH_BPS` | workflow 被攻破后超配 |
| 10 | **`!planUsed[planHash]`**，然后置 true | **同一份计划被执行两次** |
| 11 | 偏离 ≤ `TOLERANCE_BPS` → 只记录不交易 | 无谓的交易磨损 |

> 第 9 条是 CRE 文档明确要求的模式：*never trust a value carried by the report as authoritative*。
> 即使 workflow 被攻破，最大仓位也只有 60%。
>
> 第 8 与第 10 条**职责不同，都要保留**：`nonce` 防报告重放且有显式顺序，
> `planUsed` 防同一份计划跨周期重放。成本为零，不合并。
>
> **第 5、6 条只保证「报告」的时效，不能保证「文件」的时效** ——
> 合约看不到文件。被攻破的 workflow 可以报 `asOf = now` 却 pin 一个 2020 年文件的哈希。
> 所以这条性质必须在第二层同时成立：`verify.ts` 与前端徽章校验
> `report.asOf == file.asOf` 且 `file.asOf + file.validitySeconds == file.validUntil`。
> **两层缺一，可追溯性就不成立**，这是合约看不见文件的结构性限制，只能承认。

### 参数约束：`validUntil` 是主约束，`MAX_PLAN_AGE` 是兜底

当前取值：**`validitySeconds = 900`**、`MAX_PLAN_AGE = 3600`（cron 周期 10 分钟）。

`MAX_PLAN_AGE >= validitySeconds` 是硬性关系，否则合法计划会在有效期内被年龄检查拒掉。

这两个检查**不是两个独立的安全层**，优先级必须写清：

| 时间窗口 | 结果 | 挡住的是 |
|---|---|---|
| `0 ≤ age ≤ 900` | 通过 | —— |
| `900 < age ≤ 3600` | **`validUntil` 先拦下** | 过期计划 |
| `age > 3600` | 年龄检查也拦 | 陈旧计划 |

也就是说，**`validUntil` 是主约束**（它定义了"这份计划的有效期"），
**`MAX_PLAN_AGE` 只是兜底**（防一份 `validitySeconds` 被设得离谱的计划——
比如 `validitySeconds = 999999999` 时，靠它把窗口压回来）。

`validitySeconds = 900` 的选择理由：cron 每 10 分钟（600s）一次，900s 刚好覆盖
一个周期多一点，保证「这次生成、下次执行」不会因为排队而失效，同时不给跨周期的
复用留下空间。**900 不是可调的美学数字，它由 cron 周期推出。**

后端默认值必须与本文一致，且 `bun run debate --check` 必须断言
`plan.validitySeconds <= MAX_PLAN_AGE`（ACCEPTANCE A5c 只覆盖了合约侧常量关系，
文档侧的这一条要在 B 线单独断言）。

### 降级计划不得上链

`degraded: true` 表示**这份计划的输入不是来自实时数据源**（offline 样例、feed 降级、
24h 涨跌幅缺失等）。这类计划**允许存在于仓库**，用于演示哈希管线、断网兜底，
但**不允许被广播上链**。

理由：offline 计划与 live 计划在链上看起来**完全一样**——都是一个 `planHash`。
链上无法区分「这是一次真实决策」还是「这是一份演示样例」。一旦 offline 文件进了金库，
审计记录里就多了一条看起来正常、实则没有现实依据的决策。**这比崩溃更糟**：
崩溃会被发现，假决策不会。

所以 `degraded` 必须**必填**（不能默认 `false`，否则 offline 运行会自动伪装成 live），
且是 workflow 的**第 0 步前置检查**：

```
0. plan.degraded === true → runtime.log("degraded plan, refusing to write") → return
```

它在 `planUsed` 之前，因为拒绝上链比追问"执行过没有"更根本。

**这道门禁防的是「误用」，不是「蓄意伪装」。** gate 读的是**文件里**的 `degraded` 字段，
手写一个 `false` 就能绕过。所以它拦得住「demo 时手滑把 offline 样例指向了生产 target」，
拦不住「有人故意把降级样例标成 live」。真正的锚点始终是**链上计划哈希**与前端 / verify
的哈希比对 —— 那里对不上就是假的，不需要相信文件里的任何自述字段。

### 价格与滑点

```
usdcValueOfWeth = wethIn  * ethPrice / 1e20    // WETH 18dec, feed 8dec → USDC 6dec
expectedWethOut = usdcIn  * 1e20 / ethPrice
minOut = expected * (10000 - SLIPPAGE_BPS) / 10000
```

`minOut` 由 **oracle** 推出 —— 报告里不带价格，抢跑者只能在 50bps 里做文章。

---

## 6. CRE workflow

单个 cron handler，cron 必须是**六段**：`0 */10 * * * *`。

```
1. getNetwork(ethereum-testnet-sepolia-base-1)
2. evm 读：totalAssets / currentWethBps / lastNonce / lastExecutedAt
3. evm 读：ETH/USD latestRoundData → roundId>0、answeredInRound>=roundId、未过期
4. HTTP 取计划文件 → 对**原始响应字节**算 keccak256 = planHash
5. 【第 0 步前置】plan.degraded === true
      → runtime.log("degraded plan, refusing to write") → return（不发报告）
6. evm 读：planUsed[planHash]
      → 已用：runtime.log("plan already executed, skipping") → return（不发报告）
7. 校验：asOf 时效、validUntil 未过、targetWethBps ∈ [0,6000]、nonce == lastNonce+1
8. mode === "local-simulation" → log 并 return {mode, currentWethBps, target, driftBps, planHash, wouldWrite}
9. production → runtime.report(...) → evmClient.writeReport(...) → 返回 txHash
```

**第 5 步（降级）排在第 6 步（planUsed）之前**：拒绝写入一份没有现实依据的计划，
比追问"它执行过没有"更根本。顺序反了会让降级检查变成一条永不触发的死分支。

**第 5 步是必须的前置检查，不能靠捕获 revert。** 两个理由：
`TX_STATUS_REVERTED` 在 CRE 日志里是红色错误，demo 观感差；更重要的是 gas 照付、
状态没变，每 10 分钟白烧一次。

读后写的非原子性在这里不是问题：单 workflow、单写入者、cron 串行，
中间没有第二个写者。将来允许多写入者才需要关心。

**第 5 步在 `local-simulation` target 下也必须执行**（只是"读"，不写链），
否则模拟路径与广播路径行为不一致，两边日志对不上。

### 聚合方式（相对上一版做了修正）

计划文件是**静态文件**，所以用 **`identical`** 聚合，不用 `median`：

| 字段 | 聚合 | 为什么 |
|---|---|---|
| `planId` / `planHash` | identical | 两个节点读到不同文件必须**失败**，不能混 |
| `targetWethBps` | identical | 同上；从一个文件里读出来的数不该有分歧 |

`median` 只在数据源本身是逐个节点独立取、且允许抖动时才对（比如实时 LLM 端点）。
静态文件用 median 是错的：它会把"两个不同的计划"静默平均成一个。价格不需要聚合，
因为它来自链上 feed。

### 三条硬约束（踩了就白跑）

1. **cron 六段**，五段会被拒。
2. **不要用 `z.string().url()`**：QuickJS 没有 `URL` 全局，合法 URL 也校验失败。用 `.regex()`。
3. **不要 `await` capability**：用 `.result()`。`process` / `Buffer` / `Date.now()` 也不可用。

---

## 7. AI 辩论层

### 7.1 三个 agent + 一个裁决

| agent | 立场 | 输出 |
|---|---|---|
| `bull` | 找上涨理由 | `{targetWethBps, confidence, reason}` |
| `bear` | 找下跌理由 | 同上 |
| `risk` | 只看回撤/波动/流动性 | 同上（偏保守） |
| `judge` | 读三方 + 权威数据，出最终值 | `{targetWethBps, confidence, rationale}` |

- 三者**并行**，judge 拿到全部意见后裁决。
- 输入只用**权威数据**：链上 ETH/USD、BTC/USD 最新价与涨跌幅、金库当前持仓与 NAV。
  新闻源是可选增量，**不作必要性依赖**（demo 不能因为新闻 API 挂了翻车）。
- **为什么辩论在链下**：多轮 LLM 调用动辄十几秒，CRE 的 HTTP 请求有超时与执行配额
  （具体数值见 `docs.chain.link/cre/service-quotas`，**未在本机核实，不要当事实写进 README**）。
  链下产出文件，CRE 只负责"取 + 哈希 + 上链"，辩论全程留档反而成了最好的溯源素材。

### 7.2 计划文件 = 证据

`src/backend/plans/<planId>.json`，**文件本身的原始字节就是被哈希的对象**：

```json
{
  "planId": "2026-10-24T03:00:00Z",
  "asOf": 1792810993,
  "validitySeconds": 900,
  "degraded": false,
  "input": {
    "ethUsd": 2385.06, "ethUsd24hPct": -1.2,
    "btcUsd": 80958.09, "btcUsd24hPct": 0.4,
    "vault": { "navUsdc": 1000.0, "wethBps": 28 }
  },
  "rounds": [
    { "agent": "bull", "targetWethBps": 4500, "confidence": 0.60,
      "model": "claude-sonnet-5", "promptTemplateSha": "0x…", "temperature": 0,
      "reason": "…" },
    { "agent": "bear", "targetWethBps": 1500, "confidence": 0.55,
      "model": "claude-sonnet-5", "promptTemplateSha": "0x…", "temperature": 0,
      "reason": "…" },
    { "agent": "risk", "targetWethBps": 3000, "confidence": 0.70,
      "model": "claude-sonnet-5", "promptTemplateSha": "0x…", "temperature": 0,
      "reason": "…" }
  ],
  "final": { "targetWethBps": 3200, "confidence": 0.58,
             "model": "claude-sonnet-5", "promptTemplateSha": "0x…", "temperature": 0,
             "rationale": "…" }
}
```

**文件里不存自己的哈希**（存不了）。哈希由 CRE 对原始字节算出后写链。

**关键规则 1：哈希永远算原始字节，绝不对 JSON 重新序列化后再算。**
解析再 stringify 会改变键顺序/空格，哈希立刻对不上。CRE 拿的是 HTTP 响应体原始字节，
前端和 verify 脚本拿的是文件原始字节 —— 三者必须一致。

**关键规则 2：`promptTemplateSha` 必须是 prompt 模板原文的 keccak256，
且模板文件必须提交进仓库**（`src/backend/prompts/bull.txt`、`bear.txt`、`risk.txt`、
`judge.txt`）。哈希一个不在仓库里的字符串等于没哈希 —— 别人无法复算，
「我们能验证用了哪个 prompt」就只是声明。判据见下方自查命令。

**关键规则 3：`temperature` 必须写 0。** 非 0 则输出本身不可复现，
前面所有哈希的意义打折。若确实设了非 0，文件里必须标 `"nondeterministic": true`，
不许假装能复现。

> **边界声明**：`model` / `promptTemplateSha` / `temperature` 是**同一个进程的自述**。
> 手写一份 JSON 也能这么写。所以 planHash 绑定的是「输出」+「它对模型的声称」，
> **不是**「模型真的跑了什么」。这不是 zkML，不是推理证明。
> 能证明的是：这个声称被冻结了，事后不能改口。README 必须照这个说。

### 自查：先跑 canary，再验文件

**第 1 步 — 确认自己的 `cast` 用法是对的**（canary）：

```bash
cast keccak 0x616263
# 必须等于 0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45
```

对不上就**不要往下走** —— 说明哈希算法或参数形式出了问题，后面所有比对都会是错的。

**第 2 步 — 验计划文件与模板**：

```bash
cast keccak 0x$(xxd -p -c 1000000 <file> | tr -d '\n')
```

具体：

```bash
cast keccak 0x$(xxd -p -c 1000000 src/backend/plans/2026-10-24T03:00:00Z.json | tr -d '\n')
# 与链上 PlanExecuted 事件里的 planHash 对比
cast keccak 0x$(xxd -p -c 1000000 src/backend/prompts/bull.txt | tr -d '\n')
# 与计划文件里 bull 的 promptTemplateSha 对比
```

> **两个坑，都会让哈希算错，而且都不报错：**
>
> **坑 1：缺 `0x` 前缀。** `xxd -p` 输出的是 ASCII 十六进制**字符**，不是字节。
> `cast keccak` 看到不带 `0x` 的参数会把它当 UTF-8 文本去哈希，
> 于是算的是「`"616263"` 这六个字符」而不是「字节 `61 62 63`」。
>
> | 命令 | 结果 |
> |---|---|
> | `cast keccak $(xxd -p t.bin)`，文件内容是 `abc` | `0x656fed88…` ❌ 算的是字符串 `"616263"` |
> | `cast keccak 0x$(xxd -p t.bin)` | `0x4e03657a…` ✅ 等于 `keccak256("abc")` 公认值 |
>
> **坑 2：`xxd -p -c N` 在文件超过 N 字节时会折行。** 实测 120KB 文件用
> `-c 100000` 输出 **2 行**，多行进 `$( )` 会被 shell 拆成多个参数，
> `cast keccak` 直接报 `error: unexpected argument` —— 干脆算不出来。
>
> ```
> xxd -p -c 100000  big.bin | wc -l   # 2 行  ❌
> xxd -p -c 1000000 big.bin | wc -l   # 1 行  ✅
> ```
>
> 所以统一写法是 **`-c 1000000` 加 `| tr -d '\n'`**：前者让它几乎不折行，
> 后者兜住万一折了的情况。**两个都要，不能只写一个。**
>
> 这两条错误都曾经写进文档，reviewer 复验时抓出来。**规则没错（哈希算原始字节），
> 错的是复算命令的写法。**

参考值（4 个 prompt 模板的 `promptTemplateSha`，实测）：

| agent | promptTemplateSha |
|---|---|
| `bull` | `0xceb2a196bb23d0116cc8f56d3664d310e5aa9725998624ff655b7086fc28b1f7` |
| `bear` | `0x3497e792e2d5922b1dc5d267ab881412558438cb17779270b2a8a0c8c41d3ccd` |
| `risk` | `0x2854e9da2c5c7251d69bfadb47c7109fecaa5c5ebcee54bc8cb85f112742ef66` |
| `judge` | `0xd37d3c2b09ea95b65db915969b4fd246da5ab91a084506eb5cccd30cad76ff3e` |

---

## 8. 前端（`src/frontend/alpha-plan`）

现有脚手架：Next 16.4.2 / React 19.3 / Tailwind v4 / pnpm。
**单页只读仪表盘**，四个区块：

| 区块 | 内容 | 数据来源 |
|---|---|---|
| 金库 | NAV、份额价格、现金 %、WETH %、总份额 | 合约 view 调用（viem） |
| 执行链路图 | 7 节点可点击图，每个数字带来源标签 | 见下「执行链路图」 |
| 最新计划 | planId、三家 agent 的意见（仓位/信心/理由）、judge 裁决、`planHash`、**哈希校验徽章 ✓/✗** | 计划文件 + `PlanExecuted` 事件 |
| 计划历史 | 两条流分开渲染 + **对账小结** | 事件日志 |

**v1 不做申赎 UI。** 赎回通过命令行（`cast`）演示。不做不是遗漏，是范围决策：
申赎 UI 需要完整的钱包交易子系统（连接/换链/approve/redeem/receipt/pending），
它会挤掉本版更核心的可审计性部分。

**哈希校验徽章是全场最重要的一格**：服务端读文件原始字节算 keccak256，
与链上 `planHash` 比对，显示 ✓。评委看到的就是"页面自己验证了链上记录"。

**计划历史要分两条流渲染，不能混成一张表**（裁定 2）：

| 事件 | 归类标签 | 显示 |
|---|---|---|
| `PlanExecuted` / `PlanRecorded` | **策略交易** | 目标 vs 实际、偏离、`planHash`、tx |
| `LiquiditySold` | **流动性调整（非计划交易）** | `wethIn → usdcOut`、为哪个持有人、tx |

混成一张表会让"每一笔交易都有计划"这个论点在评委眼里当场破产；
分开渲染则变成「投资决策有计划，流动性管理同样上链可查」。

**对账小结（两条流之外的第三块）** —— 把"持仓变了多少"和"事件解释了多少"对上：

```
未解释的持仓变化 = 余额变化 − 策略 swap 净额 − LiquiditySold 卖出额
```

只有算出来**恰为 0** 才显示「对账通过」。不为 0 就如实显示差额，不四舍五入、不吞掉 ——
差多少就写多少。这一格是整页唯一能证明"没有任何未记录的资金移动"的地方。

### 执行链路图（7 节点，可点击）

`src/frontend/alpha-plan/lib/workflow-run.ts` + `app/_components/workflow-graph.tsx`。
7 个节点：`CRON 触发 → EVM READ → HTTP 取计划 → KECCAK 哈希 → AI 共识 → 门禁 → 写链`，
蛇形两行布局，每个节点可点开看它读到的字段。

**核心规则：卡片上没有无来源的数字。** 每个字段必须带一个来源标签：

| 标签 | 含义 |
|---|---|
| **链上** | 这次请求时真读的链上值 |
| **计划文件** | 计划文件里记载的（asOf 时刻的快照，不是现值） |
| **规范** | PRD / 合约源码里写死的值，不是某次执行的采集 |
| **推断** | 由上三类推出来的结论，明确标「推断」 |
| **未采集** | 拿不到 —— 写明缺什么，**绝不编造** |

节点状态四态：`done`（齐了且能核对）/ `blocked`（有数据但被门禁拦下，如 degraded）/
`partial`（部分有其他缺）/ `unavailable`（没有数据源）。

> **为什么这一块值得进 PRD：** 它是"可审计"的具体体现 —— 不是一句形容词，而是
> **每一个数字都被强制回答"你从哪来"**。拿不到就写「未采集 + 缺什么」，
> 比编一个看起来合理的数字诚实得多，也是评委最容易验证的一条（随便点开一个节点，
> 看它敢不敢说"我没有"）。
>
> 这套设计在 P3/P4 交付前后都成立：数据还没接上时它显示「未采集」，
> 接上之后同一张图自动变成全绿 —— 页面不会因为后端进度而撒谎。

> ⚠️ 这个 Next 版本有 breaking changes，`next dev` 自己生成了 `AGENTS.md` 警告。
> 写前端前必须先读 `node_modules/next/dist/docs/` 里对应章节（尤其 `cacheComponents`、
> `partialPrefetching`、Route Handler 的缓存语义），**不要按训练数据里的 Next 写法硬写**。

---

## 9. 诚实边界（README 原样写出来）

> 第 1 条必须做成 README **顶部的 ⚠️ 横幅**（见文档开头），不能藏在正文第 9 节 ——
> 评委不会翻到第 9 节。

1. **保真度：本 demo 是 L1/L2，不是 L3，DON 不会真的定时执行。**
   `cre whoami` → `Deploy Access: Not enabled`。`cre workflow simulate --broadcast`
   **确实**发真交易、走真 `forwarder → onReport` 路径，但**签名方是本地 CLI，不是 DON 共识**。
   `MockKeystoneForwarder` 是测试网合约，不代表去中心化执行。
   *"拿到审批后换成生产 forwarder 与 production target，逻辑一行不用改"* —— 这句话是
   未来时，不是现在时。**若走 anvil + `vm.prank` 的 L3 退路，必须逐字说明
   「本节演示合约逻辑，DON 签名路径见 simulate 日志」。**
2. **不保证策略优秀。** 60/40 带宽内的择时，alpha 大概率不如躺平。我们卖的是可审计性。
3. **计划里的 `model` / `promptTemplateSha` 是自述，不是证明。** 手写 JSON 也能这么写。
   planHash 证明「这份输出没被事后篡改」，**不证明「是哪个模型真跑了」**。
   这不是 zkML，本项目**没有**推理证明。
   另注：`degraded: true` 的计划（offline 样例、输入降级）**在链上不会出现** ——
   workflow 在生成报告前就拒绝它，因为链上无法区分降级计划与真实决策。
4. **赎回依赖 Uniswap 池子，不只是自己的 USDC 余额。**
   赎回时若现金不足会自动卖出 WETH，因此赎回依赖 Uniswap 池子的流动性与价格喂价新鲜度。
   池子枯竭或 oracle 偏离超过 50bps 容差时赎回仍会 revert。**这是即时赎回的代价。**
   - `maxRedeem` / `maxWithdraw` 返回的是**当前 USDC 现金可覆盖**的份额数。
     超出这个数量仍然可以 `redeem`（会自动卖 WETH），但视图不承诺它一定成功，
     因为它依赖池子流动性。**视图保守，实际能力更大。**
   - **gas 上界**：现金不足时的赎回最多触发 **4 次 swap**，gas 由赎回人承担。
     极端情况下（池子深度不足、需要多次补卖）gas 会接近普通 swap 的 4 倍。
     这是即时赎回 + 自动补足的代价，不是实现缺陷。
   - **滑点成本由所有持有人共同承担**，不是只由赎回人承担：自动卖 WETH 时若成交价
     劣于 oracle 价，差额体现为 NAV 多减一点（上限 `SLIPPAGE_BPS = 50`bps）。
     这是池子滑点的固有问题，不是实现缺陷 —— 但它确实是留下来的持有人替离场的人
     付了一点成本，所以说清楚。
   - 赎回触发的卖 WETH **没有计划**。它是流动性管理，不是策略决策，
     因此单独发 `LiquiditySold` 事件上链（§5），前端与「计划驱动的交易」分开显示。
     叙事口径：**「每一笔*投资决策*都有计划；赎回是流动性管理，同样上链可查。」**
5. **只支持 USDC/WETH。** 该测试网其余标的没有流动性。
6. **owner 可暂停、可换 forwarder，但不能转移用户资产、不能升级逻辑、不能改费率。**
7. **计划文件是仓库里的静态文件**，前端直接从磁盘读。生产形态应该是对象存储/IPFS，
   demo 阶段不假装。
8. **demo 里的第一笔存款来自开发者本人。** 这不是用户验证，是机制验证。

---

## 10. 已核实的链上参数（Base Sepolia, chainId 84532）

本次实测，非抄文档：

| 项 | 地址 / 值 | 核实方式 |
|---|---|---|
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6) | `symbol()` / `decimals()` |
| WETH | `0x4200000000000000000000000000000000000006` (18) | `symbol()` / `decimals()` |
| ETH/USD feed | `0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3` (8dec) | `latestRoundData()` = 2385.05，新鲜 |
| BTC/USD feed | `0x961AD289351459A45fC90884eF3AB0278ea95DDE` (8dec) | 实测 80958.08（**仅作 AI 信号，不可交易**） |
| USDC/USD feed | `0xf3138B59cAcbA1a4d7d24fA7b184c20B3941433e` | 实测 0.99987（**心跳 86400s，不判新鲜度**） |
| Uniswap V3 Factory | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | router.factory() 一致 |
| Uniswap V3 Router | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` | `factory()` 回值正确 |
| USDC/WETH 500 池 | `0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0` | liquidity 4.48e11，token0=USDC |
| USDC/WETH 3000 池 | `0x46880b404CD35c165EDdefF7421019F8dD25F4Ad` | liquidity 5.5e14（更深，**默认用它**） |
| 生产 Forwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | 有代码 |
| Mock Forwarder | `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` | 有代码（`--broadcast` 用） |
| CRE chain selector | `ethereum-testnet-sepolia-base-1` (10344971235874465080) | `cre workflow supported-chains` |
| CRE registry | `private`（离链）/ `onchain:ethereum-mainnet` | `cre registry list` |

精度统一写死成常量（USDC 6 / WETH 18 / feed 8），测试里断言一次。

---

## 11. Demo 剧本（3 分钟）

| 时间 | 画面 | 台词 |
|---|---|---|
| 0:00–0:20 | 前端首页：金库存了 100 USDC，NAV、现金%、WETH% | "这是个链上基金，钱在合约里。" |
| 0:20–0:55 | 终端 `bun run debate` → 三条意见滚动 → `plans/xxx.json` | "三个 AI 吵完，留下这份计划。" |
| 0:55–1:35 | `cre workflow simulate ... --non-interactive --trigger-index 0` → 日志里有真实持仓、feed 价、planHash、`wouldWrite` | "workflow 的执行路径，真跑了一遍。**注意：这是 L1，DON 没参与。**" |
| 1:35–2:15 | 同命令加 `--broadcast` → tx hash → 浏览器 | "上链了。**签名方是本地 CLI，不是 DON。**" |
| 2:15–2:45 | 刷新前端 → 新计划卡片，**✓ 哈希一致** | "页面自己算了一遍哈希。" |
| 2:45–3:00 | 两行哈希并排 → 完全一致 | "这个决策，就是这份计划。你可以自己算。" |

片尾那一帧就是全部：**链上哈希 = 你手里文件的哈希**，评委可以当场复算。

> 台词里的加粗句**必须说出口**。省掉它们换来的是"这项目在假装去中心化"的质疑，
> 说出口换来的是"这个人知道自己边界在哪"。

---

## 12. 验收标准

- [ ] `forge test` 全绿：NAV、deposit/redeem、`onReport` **11 条校验**、容差、
      swap 方向与 minOut、`pause` 不影响 redeem、费率多周期累计、`planUsed` 幂等、
      `asOf` 上下界
- [ ] **赎回自动卖 WETH**（对应 ACCEPTANCE A11b–A11e）：
      - 现金不足时 `redeem` 不 revert，`router.exactInputSingle` 调用次数 **1 ≤ n ≤ 4**，
        且**池子足额成交时必须 n == 1**（补卖只在第 1 笔不够时才发生）
      - **第 1 笔** `amountIn == ceilDiv(shortfall × 1e20, ethPrice)`（**精确值，不是"不超过"**）
      - **补卖笔** `amountIn ≤ ceilDiv((deficit + 2) × BPS × 1e20, (BPS − 50) × ethPrice)`
      - 卖出后金库 USDC 零头 ∈ **`[0, 3]` wei**
      - 现金充足时 `router` **零调用**，且不 emit `LiquiditySold`
      - 卖出后仍不足 → revert 自定义 error `InsufficientLiquidity(...)`，且状态全回滚
      - **每一笔** swap 的 `amountOutMinimum` 都由同一 oracle 价与 `SLIPPAGE_BPS` 推出
        （`×(10000−50)/10000`），**逐笔断言**；任一笔成交价劣于其 `minOut` 即 revert
      - `pause` 期间走自动卖 WETH 的 `redeem` **仍然成功**
- [ ] **`LiquiditySold` 事件在赎回路径上 emit**，字段 `forHolder/wethIn/usdcOut/shares/timestamp`
      与 ACCEPTANCE A14 的 topic0 一致：
      `LiquiditySold(address,uint256,uint256,uint256,uint64)` = `0xc1ce2ec3…`；
      现金充足（未触发卖出）时**不得** emit
- [ ] **`maxRedeem` / `maxWithdraw` 返回现金可覆盖部分**（保守回退），
      且 `maxRedeem < totalSupply` 时超出的 `redeem` 仍能成功（自动卖 WETH）
- [ ] `bun run debate` 产出合法计划文件；`--offline` 可产出固定样例；
      `promptTemplateSha` 与仓库里 `prompts/*.txt` 的 keccak256 一致
- [ ] `cre workflow simulate` 在 `local-simulation` target 下非交互跑通，读到真实持仓与 feed，
      并验证两道前置门禁**都能被触发**：
      **① `degraded` 门禁**（§6 第 5 步）—— 喂一份 `degraded: true` 的计划，
      日志必须是 `degraded plan, refusing to write`，且 `planUsed` 为 false 也不写；
      **② `planUsed` 门禁**（§6 第 6 步）—— 同一份 live 计划跑第二次，
      日志必须是 `plan already executed, skipping`
- [ ] `--broadcast` 在 Base Sepolia 产生真实交易（失败见退路 R2，且按 §9 第 1 条声明档位）
- [ ] `bun run verify <txHash>` 退出码 0，且校验 `report.asOf == file.asOf`
- [ ] 前端单页显示金库状态 + 最新计划 + **哈希 ✓** + 执行链路图（7 节点，
      **每个字段都有来源标签，拿不到的写「未采集」+ 缺什么，不得出现无来源数字**）
- [ ] 计划历史**分两条流**：`Plan*` 标「策略交易」、`LiquiditySold` 标「流动性调整（非计划交易）」
- [ ] **对账小结**：`未解释变化 = 余额变化 − 策略 swap 净额 − LiquiditySold 卖出额`，
      恰为 0 才显示「对账通过」；不为 0 时如实显示差额
- [ ] README **顶部**有保真度横幅 + 含 §9 全部诚实边界

---

## 13. 明确不做

多链 · 借贷/杠杆 · BTC/LINK 等跨资产 · 治理代币 · 新闻源作必要依赖 ·
钱包连接与申赎表单（v1；**只读展示与历史在范围内**）· 升级代理 · 抢跑防护（50bps 滑点之外）· 回测框架。
