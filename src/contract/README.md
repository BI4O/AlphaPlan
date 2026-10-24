# contract

AlphaPlan 的 ERC-4626 金库合约。Foundry 工程。

## 依赖

`lib/` 下两个依赖是 **git submodule**，不是普通的拷贝：

| 依赖 | 版本 |
|---|---|
| `forge-std` | v1.17.0 |
| `openzeppelin-contracts` | v5.7.0 |

新克隆仓库后先初始化 submodule，否则 `forge build` 会找不到 `@openzeppelin/`：

```bash
git submodule update --init --recursive
# 或在本目录
forge install
```

## 命令

```bash
forge build      # 编译
forge test -vv   # 单元测试（不联网，71 个用例，fork 套件自动跳过）
forge fmt        # 格式化
anvil            # 本地链

# demo 全流程的真链回归测试（连 Base Sepolia fork，10 个用例）
forge test --match-contract ForkDemoTest --fork-url https://sepolia.base.org -vv
```

`ForkDemoTest` 用的是**真 USDC / 真 WETH / 真 SwapRouter02 / 真池子**，只有 oracle 被
`MockAggregator` 覆盖（原因见下面「四条实测事实」第 1 条）。它把 demo 里每一处会被点到的
交互都钉住：入金 → 报告买入 → 抬价 → 抬价后双向成交 → 只抬 oracle 必 revert（反证）→
容差路径不交易 → 现金够/不够两种赎回 → 清仓后全额赎回 → 重放被拒。
没接 `--fork-url` 时整组 `vm.skip`，所以普通 `forge test` 仍然是纯离线、秒级。

## 部署

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url <rpc> --private-key <key> --broadcast
```

> 私钥不要写进仓库。用 `--account <keystore>` 或环境变量，见根 README。

## 结构

```
src/
├── AlphaPlanVault.sol        # 金库本体（ERC4626 + onReport + accrueFee）
└── interfaces/
    ├── AggregatorV3Interface.sol   # Chainlink feed 的最小接口
    └── ISwapRouter.sol             # SwapRouter02 的 exactInputSingle
test/
├── AlphaPlanVault.t.sol      # A4–A16 对应用例
test/mocks/
├── MockFeed.sol              # 可控 latestRoundData（含陈旧/坏 round）
├── MockRouter.sol            # 真搬钱、成交不足即 revert
└── MockERC20.sol             # 6/18 位可铸造代币
script/                       # 部署脚本（P4 再做）
```

> **没有 `StalenessGuard.sol`。** feed 新鲜度校验是 `AlphaPlanVault.ethPrice()` 里的
> 一个内部步骤（`MAX_FEED_STALENESS = 1 hours`），按 `docs/PLAN.md` P1 的文件表，不单独成文件。

## 权限面

唯一的 owner 权限是 `pause` / `unpause` / `setForwarder`。合约里**没有**
费率/常量/收款人 setter，没有代理或 upgrade，也没有任何能把金库资产转给 owner 的函数。
`Ownable` 由 OZ 换成本合约内的三行实现，就是为了不引入
`transferOwnership` / `renounceOwnership` 这两条多余的 onlyOwner 路径（见 `docs/ACCEPTANCE.md` A12）。

合约接口设计与参数见 `docs/PRD.md` §5、实现顺序见 `docs/PLAN.md` P1。

---

## demo 剧本（anvil fork，P4）

不真部署、不花 gas。全部跑在 Base Sepolia 的 fork 上，**真 router、真 Uniswap 池子**。

### 1. 一条命令起环境

```bash
bash script/demo-up.sh
```

五件事：起（或复用）`anvil --fork-url https://sepolia.base.org --port 8545` →
`forge build` + 部署金库 → `anvil_setCode` 把 `MockAggregator` 塞到真 feed 地址 →
把 mock 价格设为**池子现货价**并写入 24h 历史 → 用 anvil 默认 account0 存 20 USDC。
最后打印四个值：

```
RPC_URL=http://127.0.0.1:8545
VAULT_ADDRESS=<地址>
DEPLOY_BLOCK=<块号>
CHAIN_ID=84532        # fork 继承 Base Sepolia，不是 31337
```

`RESET=1` 会忽略缓存的地址重新部署（同一 anvil 实例里再想拿一份干净状态时用）。

### 2. 抬价：演示「净值上涨」

```bash
bash script/demo-bump-price.sh 4000      # USDC/WETH
```

**为什么是 4000、不是更高**：抬价要改 Uniswap 池子的 `slot0`（见下），价格偏移越大、
`tick` 离现价越远，越可能跑出 LP 的区间、把深度吃成 0。4000（tick 193380）实测过：
liquidity 不变、买卖两个方向都能成交。更高没验过，不要临场试。

**为什么必须同时改池子**：金库的 `minOut` 由 oracle 推出。只抬 oracle 不动池子，
池子给的就比预期少（8%），50bps 容差直接拒单 —— 而清仓、赎回自动卖币都走卖方向，
演示会卡死在那里。真实世界里 ETH 涨的时候池价也涨，两处一起推才是正确模拟。

改 `slot0` 的做法：它 packed 在一个 slot 里，用位运算只换 `sqrtPriceX96`（bit 0-159）
与 `tick`（bit 160-183），其余位保留；`tick` 取 `tickSpacing=60` 的整数倍、
`sqrtPriceX96` 由同一个 `tick` 反推，保证两者一致（所以实际价是 3999.75 而不是 4000，
这是对齐的必然结果）。改完脚本读回比对，并用 `cast call` 干跑一笔 1 USDC swap 验深度，
任何一步失败就把原 `slot0` 写回去并 `exit 1`。

实测（锁定环境，金库 `0x8f7a1def…1295b`）：

| 项 | 抬价前 | 抬到 4000 |
|---|---|---|
| oracle ETH/USD | 3696.39 | 4000.00 |
| 池子现货 | 3697.71 | 3999.75 |
| `totalAssets()` | 19,980,933 | **20,472,184** |
| 1 份额折合 USDC | 0.999046 | **1.023609** |
| `currentWethBps()` | 2993 | 3161 |
| NAV 变化 | — | **+2.46%** |

**台词**：ETH 从 3696 涨到 4000（+8.2%），金库按 AI 决策持有 30% WETH，
基金净值跟着涨了 2.46% —— 不要吹成"AI 让基金涨了 8%"。

### 3. 赎回演示

锁定状态：现金 14 USDC，`maxRedeem` = 14,013,359 份额（保守回退到现金覆盖的部分）。

> 下表是**参考值，不是承诺**：在锁定环境（块 49478398、`totalAssets` = 19,980,933、
> 现金 14,000,000）测得。链上状态一变，`previewRedeem` 就可能差 1–2 wei ——
> 这是 ERC-4626 floor 舍入的必然结果，不是缺陷。**演示时用 `demo-snapshot.sh` /
> `previewRedeem` 现场取值，不要手抄这张表。**
>
> ```bash
> cast call $VAULT "previewRedeem(uint256)(uint256)" 18000000 --rpc-url $RPC_URL
> ```

| 操作 | 结果 |
|---|---|
| `redeem(14,013,359)` | 现金够，**router 零调用** |
| `redeem(18,000,000)` | 触发自动卖 WETH（**1–4 笔**，补卖轮数取决于实际滑点，典型 1–2 笔），1 条 `LiquiditySold`；实收 = 调用那一刻的 `previewRedeem(18,000,000)`（锁定环境测得 17,982,840） |
| 持着 WETH 时 `redeem(20,000,000)` | revert `InsufficientLiquidity(19,980,933, 14,000,000, 5,980,933)` |
| 先 `onReport(target=0)` 清仓，再全额赎回 | 成功，现金 == NAV，不需要再卖币 |

> 池子有 0.3% 手续费，所以"持着 WETH 赎回 100%"必然差一点点钱 —— 这是真实成本，不是 bug。
> 要演示「全额 cash out」，顺序是**先让计划清仓、再赎回**，而不是直接点赎回全部。
> 清仓时 `MAX_SWAP_BPS` 会截断单次调仓，脚本会把截断后剩下的 dust（< 1 USDC）一并卖掉，
> 否则那点 dust 又会让全额赎回差几个最小单位。

自动卖币的规则、`LiquiditySold` 语义、`maxWithdraw/maxRedeem` 的回退，见下面
「赎回：现金不足时自动卖 WETH」一节。

### 4. demo 前自检 / 证明"确实变了"

```bash
bash script/demo-snapshot.sh            # 打印全部关键值（只读）
bash script/demo-snapshot.sh --before   # 抬价前：存一份基准
bash script/demo-snapshot.sh --after    # 抬价后：打印当前值 + 与基准的差值
```

`--after` 会直接打出 `totalAssets / sharePrice / oracle / 池价 / wethBps` 的前后差
和 NAV 涨幅，不用手抄数字。快照还包含最近一次 `PlanExecuted` 的 tx/块号和 24h 行情，
并检查池价与 oracle 的偏离（>50bps 时卖方向会 revert）。

### 24h 历史（backend 算涨跌幅的前提）

`demo-up.sh` 除了当前价，还会写 24h 前的那个 round（`MockAggregator` 的 slot 3/4），
默认取现价的 **95%**（`ANSWER_24H` 可覆盖），时间戳 = 当前块时间 − 86400。
于是 AI 看到的是「过去 24h 涨了约 5.26%」，计划才不会因为缺数据而 `degraded:true`。

两个 round id 是合成的：`latestRoundData()` 返回 **5000**，`getRoundData(id ≤ 4000)`
返回 24h 前的那一点，`id > 4000` 返回当前。**latest 必须是大于 1 的 id** ——
后端用 `lo = latest - window, hi = latest - 1` 二分搜索，返回 1 的话 `hi = 0 < lo = 1`，
循环根本不跑，永远拿不到 24h 前（这是实测踩过的坑）。

脚本最后会自检并 `exit 1`：`latest.roundId == 5000`、
`getRoundData(4000).updatedAt == NOW-86400`、`getRoundData(4999).updatedAt == NOW`、
两者相差 86400。四条任一不满足就打印实际值退出。

`demo-bump-price.sh` 只改 slot 0/2（当前价 + 时间戳），不动 24h 历史 ——
demo 需要「24h 涨幅更大」时手动写 slot 3 即可。

### 赎回：现金不足时自动卖 WETH

`_withdraw` 里先保证柜台上有 USDC：现金够就**绝不碰 router**；不够就把 WETH 卖成 USDC。
所有赎回路径（`redeem` / `withdraw`）都走这里，`paused` 不影响它。

- 第一笔卖出量 = `ceilDiv(shortfall * 1e20, price)`，正好够，不多卖；
  池子 0.3% 手续费会让实际到账略少，所以最多再补卖 3 次**差额**（几何收敛）。
- `amountOutMinimum = expectedOut * (10000 - SLIPPAGE_BPS) / 10000`，与 `onReport` 同一口径。
- 卖光 WETH 也不够时，**预检在 for 循环之前**就 `revert InsufficientLiquidity(required, cashAvailable, wethValue)`，
  不会白跑一笔 swap。
- 每笔自动卖币都发 `LiquiditySold(forHolder, wethIn, usdcOut, shares, timestamp)`：
  这是流动性管理，不是投资决策，所以它**没有**计划文件，前端要与 `PlanExecuted/PlanRecorded` 分开展示。
- `maxWithdraw` / `maxRedeem` 保守回退到「现金能覆盖的部分」。为此 `redeem` / `withdraw`
  去掉了 OZ 的 `maxRedeem` 前置检查 —— 否则超出现金的那部分永远走不到自动卖币。

> **100% 赎回的限制**：池子有 0.3% 手续费，最后 0.3% 的净值换成现金会亏。
> 所以「持着 WETH 时赎回全部份额」会 revert（`InsufficientLiquidity`），
> 正确顺序是**先让计划清仓（target=0）再全额赎回** —— 清仓后现金 == NAV，赎回不需要再卖币。
> 清仓时 `MAX_SWAP_BPS` 会截断单次调仓，所以脚本会把截断后剩下的 dust（< 1 USDC）一并卖掉，
> 否则那点 dust 又会让全额赎回差几个最小单位。

### 四条实测事实（都是跑出来的，不是推测）

1. **真 feed 在合约上下文里读不出来。** 对 `0xa24A68DD…` 直接
   `cast call latestRoundData`（任意 `--from`）正常返回 2385.05；但**由合约内部发起**
   （`forge test --fork-url` 里的最小 probe 合约）会 revert 字符串 `"No access"`。
   金库的 NAV 必须在合约里算，所以 demo 用 `anvil_setCode` 把 `MockAggregator` 覆盖到
   真 feed 地址上。`MockAggregator` 的存储布局固定：slot0 = answer、slot1 = decimals、
   slot2 = updatedAt（改价必须同步改 slot2，否则 `MAX_FEED_STALENESS` 会 revert）。
2. **池子现货价和 PRD 表里的 feed 价差 55%。** USDC/WETH 3000 池
   （`0x46880b40…f4Ad`）`slot0` 推出来是 **3696.39** USDC/WETH，而真 feed 报 2385 左右。
   金库的 `minOut` 由 oracle 推出、容差 50bps，所以 **mock 初始价必须取池价**，
   否则一笔买入会因为"池子给的比 oracle 预期少 55%"直接 revert。
3. **只改 oracle 不改池子，卖方向一定 revert**：oracle 3696.39、池价也是 3696.39 时正常；
   把 oracle 抬到 4000 而池子不动，卖出拿到的比 oracle 预期少 8%，50bps 容差直接拒单。
   所以 `demo-bump-price.sh` 两处一起推（见上）。
4. **真 router + 真池子的 swap 是通的**，两条路径都验过：
   - 直连：account0 用 `exactInputSingle` 花 1 USDC → `269,714,422,347,503` wei WETH；
   - 经金库：impersonate forwarder → `onReport`（target 3000）花 6 USDC →
     锁定实例上是 `1,618,046,181,452,145` wei WETH，成交后 `currentWethBps()` = **2993**
     （目标 3000，差的 0.3% 就是池子手续费）。

### demo 里手动触发一次再平衡

CRE 的 `onReport` 长这样（fork 上要先 impersonate forwarder）：

```bash
V=0x8f7a1DEFa8B06a8d66ea14a71A2eF2CE4bA1295b
FW=0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5   # PRD §10 的 MockKeystoneForwarder
NOW=$(cast block latest --field timestamp --rpc-url http://127.0.0.1:8545)
REPORT=$(cast abi-encode "onReport(address,uint64,uint64,uint64,uint16,bytes32)" \
  $V $NOW $((NOW+900)) 1 3000 $(cast keccak "demo-plan-1"))
cast rpc anvil_impersonateAccount $FW --rpc-url http://127.0.0.1:8545
cast rpc anvil_setBalance $FW 0xDE0B6B3A7640000 --rpc-url http://127.0.0.1:8545
cast send $V "onReport(bytes,bytes)" 0x $REPORT --from $FW --unlocked --rpc-url http://127.0.0.1:8545
```

两条硬约束：`MIN_INTERVAL=60s`（两次报告之间要等一个块时间，fork 上用
`cast rpc evm_increaseTime 61 && cast rpc evm_mine`），以及 `planUsed[planHash]`
（同一份计划只能执行一次，重复会 revert `PlanAlreadyExecuted`）。

### 诚实边界（必须原样进根 README §9）

> **demo 里的净值上涨是人为改 feed 价格实现的，不是真实市场波动。**
> 它演示的是「价格变化如何传导到 NAV 与份额价格」，不是「策略的赚钱能力」。
