// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";

/// @title AlphaPlanVault
/// @notice USDC/WETH 的 ERC-4626 金库。仓位由 CRE 报告驱动，但报告的权力被
///         写死的常量封住：最多 60% 风险资产、单次最多换 50% NAV、
///         最小成交量由 oracle 价推出、越界即 revert（不静默夹取）。
/// @dev 权限面刻意做到最小：
///      - owner 只能 `pause` / `unpause` / `setForwarder`，**没有** 费率、常量、
///        收款人 setter，没有代理/升级，也没有任何能把金库资产转给 owner 的函数。
///      - `redeem` 不受 `paused` 影响（PRD §3.5）。
///      - `onReport` 只认 `forwarder`，报告里的价格一律不采信。
contract AlphaPlanVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // 常量：写死，无 setter，不可升级（PRD §3.2 / §5）
    // ---------------------------------------------------------------------

    /// @notice 风险资产上限 60% —— **唯一**的仓位上限
    uint16 public constant MAX_WETH_BPS = 6000;
    /// @notice 偏离目标 3% 以内不交易
    uint16 public constant TOLERANCE_BPS = 300;
    /// @notice 单次报告最多换掉 50% 的 NAV
    uint16 public constant MAX_SWAP_BPS = 5000;
    /// @notice 最小成交量由 oracle 价推出，报告不携带价格
    uint16 public constant SLIPPAGE_BPS = 50;
    /// @notice 两次执行的最小间隔
    uint64 public constant MIN_INTERVAL = 60;
    /// @notice 计划自 `asOf` 起的最长可执行时限（兜底；主约束是 `validUntil`）
    uint64 public constant MAX_PLAN_AGE = 3600;
    /// @notice 管理费 0.1% / 期
    uint16 public constant FEE_BPS_PER_PERIOD = 10;
    /// @notice 计费周期 30 天
    uint64 public constant FEE_PERIOD = 30 days;

    /// @notice feed 陈旧阈值。实测 Base Sepolia ETH/USD 心跳约 16 分钟，
    ///         任何 ≤15min 的阈值会让 `totalAssets()` 现场 revert（PLAN R6 / ACCEPTANCE A16）。
    uint64 public constant MAX_FEED_STALENESS = 1 hours;

    // ---------------------------------------------------------------------
    // 不可变依赖
    // ---------------------------------------------------------------------

    IERC20 public immutable WETH;
    AggregatorV3Interface public immutable ETH_USD_FEED;
    ISwapRouter public immutable ROUTER;
    uint24 public immutable POOL_FEE;
    address public immutable FEE_RECIPIENT;

    // ---------------------------------------------------------------------
    // 状态
    // ---------------------------------------------------------------------

    /// @notice CRE forwarder（mock ↔ prod 由 owner 切换）
    address public forwarder;
    /// @notice 只停策略，不停赎回
    bool public paused;

    uint64 public lastNonce;
    uint64 public lastExecutedAt;
    uint16 public lastTargetWethBps;
    bytes32 public lastPlanHash;
    uint64 public lastFeeAccrual;
    /// @notice 一份计划至多执行一次。`nonce` 防报告层重放/乱序，
    ///         这里防同一份计划跨 cron 周期被重复执行（PRD §5 第 10 条）。
    mapping(bytes32 planHash => bool used) public planUsed;

    /// @notice 唯一权限主体。没有 transferOwnership / renounceOwnership：
    ///         它们只会多出两条 onlyOwner 路径，换不来任何安全（ACCEPTANCE A12）。
    address public owner;

    // ---------------------------------------------------------------------
    // 事件与错误
    // ---------------------------------------------------------------------

    /// @dev topic0 == keccak256(
    ///      "PlanExecuted(bytes32,bytes32,uint64,uint64,uint16,uint16,uint256,uint256,uint64)")
    ///      asOf / validUntil 上链是为了让前端徽章能在**链上**重建
    ///      `plan.asOf == report.asOf` 与 `plan.asOf + validitySeconds == report.validUntil`
    ///      两条断言（E4-② / E4-③）—— 否则审计者得先拥有本地报告字节才能验。
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

    /// @dev 接受但未交易：偏离在容差内，或被仓位上限截断到 0（PRD §5）。
    ///      topic0 == keccak256("PlanRecorded(bytes32,bytes32,uint64,uint64,uint16,uint16,uint64)")
    event PlanRecorded(
        bytes32 indexed reportHash,
        bytes32 indexed planHash,
        uint64 asOf,
        uint64 validUntil,
        uint16 targetWethBps,
        uint16 actualWethBps,
        uint64 nonce
    );

    /// @dev 赎回触发的流动性调整：现金不足时自动卖出 WETH。
    ///      这不是投资决策（没有计划文件），是**流动性管理**，所以用独立事件，
    ///      前端据此把它和 PlanExecuted / PlanRecorded 区分展示 ——
    ///      否则「每笔交易先有计划」的叙事会被这一笔无计划的卖单打破。
    event LiquiditySold(
        address indexed forHolder, uint256 wethIn, uint256 usdcOut, uint256 shares, uint64 timestamp
    );

    error ZeroAddress();
    error NotOwner();
    error NotForwarder();
    error WrongVault();
    error Paused();
    error TooSoon(uint64 nextAllowedAt);
    error PlanFromFuture(uint64 asOf);
    error PlanTooOld(uint256 age);
    error Expired(uint64 validUntil);
    error BadNonce(uint64 expected, uint64 got);
    error TargetAboveMax(uint16 targetWethBps);
    error PlanAlreadyExecuted(bytes32 planHash);
    error InsufficientLiquidity(uint256 required, uint256 cashAvailable, uint256 wethValue);
    error InvalidPrice(int256 answer);
    error StalePrice(uint256 age);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ---------------------------------------------------------------------
    // 构造
    // ---------------------------------------------------------------------

    constructor(
        IERC20 asset_,
        IERC20 weth_,
        AggregatorV3Interface ethUsdFeed_,
        ISwapRouter router_,
        uint24 poolFee_,
        address feeRecipient_,
        address forwarder_,
        address owner_
    ) ERC4626(asset_) ERC20("AlphaPlan USDC", "apUSDC") {
        if (
            address(asset_) == address(0) || address(weth_) == address(0)
                || address(ethUsdFeed_) == address(0) || address(router_) == address(0)
                || feeRecipient_ == address(0) || forwarder_ == address(0) || owner_ == address(0)
        ) revert ZeroAddress();

        WETH = weth_;
        ETH_USD_FEED = ethUsdFeed_;
        ROUTER = router_;
        POOL_FEE = poolFee_;
        FEE_RECIPIENT = feeRecipient_;
        forwarder = forwarder_;
        owner = owner_;
        lastFeeAccrual = uint64(block.timestamp);
    }

    // ---------------------------------------------------------------------
    // 视图
    // ---------------------------------------------------------------------

    /// @notice USDC 余额 + WETH 余额按 Chainlink ETH/USD 实时估值。
    /// @dev feed 陈旧/非正/未应答即 revert（fail-closed），绝不拿旧价算 NAV。
    function totalAssets() public view override returns (uint256) {
        return _totalAssets(ethPrice());
    }

    /// @notice 当前 ETH/USD 价格（8 位小数），带 round 完整性 + 新鲜度校验
    function ethPrice() public view returns (uint256) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            ETH_USD_FEED.latestRoundData();

        if (answer <= 0) revert InvalidPrice(answer);
        if (roundId == 0 || answeredInRound < roundId) revert InvalidPrice(answer);
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidPrice(answer);

        uint256 age = block.timestamp - updatedAt;
        if (age > MAX_FEED_STALENESS) revert StalePrice(age);

        return uint256(answer);
    }

    /// @notice WETH 占总资产的比例（bps）。空金库返回 0，不 panic。
    /// @dev 这是**观测值**，不受 `MAX_WETH_BPS` 约束：WETH 涨价可以把它推过 6000，
    ///      此时金库处于偏离 mandate 状态，直到下一份计划把它拉回来（PRD §3.2）。
    function currentWethBps() public view returns (uint16) {
        uint256 price = ethPrice();
        uint256 nav = _totalAssets(price);
        if (nav == 0) return 0;

        uint256 wethValue = usdcValueOfWeth(WETH.balanceOf(address(this)), price);
        if (wethValue == 0) return 0;

        uint256 bps = wethValue * BPS / nav;
        if (bps > BPS) bps = BPS; // 数学上不可达，留作 uint16 上界保护
        return uint16(bps);
    }

    /// @notice ERC-4626 视图保守回退：只承诺「现金能覆盖的部分」。
    /// @dev 超出现金的部分**仍然可以 redeem**（`_withdraw` 会自动卖 WETH），
    ///      但视图不替它承诺成功 —— 返回一个会 revert 的数字是最糟的体验。
    /// @dev 注意**不能**调 `super.maxWithdraw`：OZ 的实现是
    ///      `previewRedeem(maxRedeem(owner))`，而 `maxRedeem` 已被我们改成
    ///      「现金上限」，会互相递归成一团错数字。这里直接按份额价折算。
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        uint256 owed = _convertToAssets(balanceOf(owner_), Math.Rounding.Floor);
        return cash < owed ? cash : owed;
    }

    /// @notice 同 `maxWithdraw`，按当前份额价格折算成份额
    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        uint256 sharesForCash = _convertToShares(cash, Math.Rounding.Floor);
        uint256 held = balanceOf(owner_);
        return sharesForCash < held ? sharesForCash : held;
    }

    /// @notice (lastPlanHash, lastTargetWethBps, lastNonce)
    function lastPlan() external view returns (bytes32, uint16, uint64) {
        return (lastPlanHash, lastTargetWethBps, lastNonce);
    }

    /// @notice WETH 数量 → USDC 价值。WETH 18dec、feed 8dec → USDC 6dec。
    /// @dev 唯一允许的换算口径（PLAN P1「精度」）。price == 0 时返回 0；
    ///      溢出在 0.8 下直接 revert，属于 fail-closed。
    function usdcValueOfWeth(uint256 wethAmount, uint256 price) internal pure virtual returns (uint256) {
        return wethAmount * price / WETH_PRICE_SCALE;
    }

    // ---------------------------------------------------------------------
    // 核心：CRE 报告
    // ---------------------------------------------------------------------

    /// @notice CRE forwarder 写入报告并执行（或不执行）再平衡。
    /// @dev 校验顺序严格按 PRD §5 的 11 条，任一失败即 revert，全部 fail-closed。
    ///      第 11 条（偏离在容差内）**仍然消耗 nonce、仍然置 planUsed、仍然发事件** ——
    ///      否则同一份报告/计划可被重放。
    function onReport(bytes calldata /* metadata */, bytes calldata report) external nonReentrant {
        // 1. sender
        if (msg.sender != forwarder) revert NotForwarder();

        (address vault, uint64 asOf, uint64 validUntil, uint64 nonce, uint16 targetWethBps, bytes32 planHash) =
            abi.decode(report, (address, uint64, uint64, uint64, uint16, bytes32));

        // 2..10
        _validate(vault, asOf, validUntil, nonce, targetWethBps, planHash);

        // —— effects 先于 interactions：被拒时上面任何一条都不会推进 lastNonce ——
        lastNonce = nonce;
        lastExecutedAt = uint64(block.timestamp);
        lastTargetWethBps = targetWethBps;
        lastPlanHash = planHash;
        planUsed[planHash] = true;

        _executeAndEmit(keccak256(report), planHash, asOf, validUntil, targetWethBps, nonce);
    }

    /// @dev PRD §5 的第 2–10 条。顺序即文档顺序，任一失败即 revert。
    function _validate(
        address vault_,
        uint64 asOf,
        uint64 validUntil,
        uint64 nonce,
        uint16 targetWethBps,
        bytes32 planHash
    ) internal view {
        // 2. vault
        if (vault_ != address(this)) revert WrongVault();
        // 3. paused
        if (paused) revert Paused();
        // 4. MIN_INTERVAL
        uint64 nextAllowedAt = lastExecutedAt + MIN_INTERVAL;
        if (block.timestamp < nextAllowedAt) revert TooSoon(nextAllowedAt);
        // 5. asOf 不能是未来（上界闭区间：asOf == now 通过）
        if (asOf > block.timestamp) revert PlanFromFuture(asOf);
        // 6. 计划年龄（下界闭区间：now - asOf == MAX_PLAN_AGE 通过）
        uint256 age = block.timestamp - asOf;
        if (age > MAX_PLAN_AGE) revert PlanTooOld(age);
        // 7. validUntil 未过期（主约束）
        if (validUntil < block.timestamp) revert Expired(validUntil);
        // 8. nonce 连续
        uint64 expectedNonce = lastNonce + 1;
        if (nonce != expectedNonce) revert BadNonce(expectedNonce, nonce);
        // 9. 仓位上限：越界即拒，不静默夹取
        if (targetWethBps > MAX_WETH_BPS) revert TargetAboveMax(targetWethBps);
        // 10. 同一份计划至多执行一次
        if (planUsed[planHash]) revert PlanAlreadyExecuted(planHash);
    }

    /// @dev 第 11 条：偏离 ≤ TOLERANCE_BPS 只记录不交易；交易量为 0 时同样只记录。
    function _executeAndEmit(
        bytes32 reportHash,
        bytes32 planHash,
        uint64 asOf,
        uint64 validUntil,
        uint16 targetWethBps,
        uint64 nonce
    ) internal {
        uint16 before = currentWethBps();
        uint16 drift = before > targetWethBps ? before - targetWethBps : targetWethBps - before;

        if (drift > TOLERANCE_BPS) {
            (uint256 usdcIn, uint256 wethIn, bool traded) = _rebalance(before, targetWethBps);
            if (traded) {
                emit PlanExecuted(
                    reportHash, planHash, asOf, validUntil, targetWethBps, currentWethBps(), usdcIn, wethIn, nonce
                );
                return;
            }
        }

        // 容差内，或调仓量被上限/余额截断到 0：接受、留痕、不动仓位
        emit PlanRecorded(reportHash, planHash, asOf, validUntil, targetWethBps, currentWethBps(), nonce);
    }

    // ---------------------------------------------------------------------
    // 内部：再平衡
    // ---------------------------------------------------------------------

    /// @dev 目标仓位 → 换多少（受 MAX_SWAP_BPS 与真实余额截断）→ oracle 价推 minOut → 调 router。
    /// @return usdcIn 本次投入的 USDC（卖出方向为 0）
    /// @return wethIn 本次卖出的 WETH（买入方向为 0）
    /// @return traded 是否真的调用了 router
    function _rebalance(uint16 currentBps, uint16 targetBps)
        internal
        returns (uint256 usdcIn, uint256 wethIn, bool traded)
    {
        uint256 price = ethPrice();
        uint256 nav = _totalAssets(price);
        if (nav == 0) return (0, 0, false);

        uint16 deltaBps = targetBps > currentBps ? targetBps - currentBps : currentBps - targetBps;
        uint256 notional = nav * deltaBps / BPS; // 要搬动的 USDC 价值
        uint256 cap = nav * MAX_SWAP_BPS / BPS; // 单次上限 50% NAV
        if (notional > cap) notional = cap;
        if (notional == 0) return (0, 0, false);

        if (targetBps > currentBps) {
            // 买入：USDC → WETH
            uint256 cash = IERC20(asset()).balanceOf(address(this));
            usdcIn = notional < cash ? notional : cash;
            if (usdcIn == 0) return (0, 0, false);

            uint256 expectedOut = usdcIn * WETH_PRICE_SCALE / price;
            uint256 minOut = expectedOut * (BPS - SLIPPAGE_BPS) / BPS;

            _swap(asset(), address(WETH), usdcIn, minOut);
            traded = true;
        } else {
            // 卖出：WETH → USDC
            uint256 wethBalance = WETH.balanceOf(address(this));
            uint256 wethToSell = notional * WETH_PRICE_SCALE / price;
            if (targetBps == 0) {
                // 目标 0 就是清仓：按 notional 折算会因两次向下取整留下 dust。
                // 两种情况直接全卖：整仓不超单次上限，或卖完上限后剩下的只是 dust。
                uint256 remainder = wethBalance > wethToSell ? wethBalance - wethToSell : 0;
                if (
                    usdcValueOfWeth(wethBalance, price) <= cap
                        || usdcValueOfWeth(remainder, price) < DUST_USDC
                ) {
                    wethToSell = wethBalance;
                }
            }
            if (wethToSell > wethBalance) wethToSell = wethBalance;
            if (wethToSell == 0) return (0, 0, false);
            wethIn = wethToSell;

            uint256 expectedOut = usdcValueOfWeth(wethToSell, price);
            uint256 minOut = expectedOut * (BPS - SLIPPAGE_BPS) / BPS;

            _swap(address(WETH), asset(), wethToSell, minOut);
            traded = true;
        }
    }

    // ---------------------------------------------------------------------
    // 赎回：现金不足时自动卖 WETH
    // ---------------------------------------------------------------------

    /// @dev 去掉 OZ 的 `shares > maxRedeem(owner)` / `assets > maxWithdraw(owner)` 前置检查。
    ///      这是必需的：上面两个视图按 PRD 只承诺「现金能覆盖的部分」，而现金之外的
    ///      部分由 `_withdraw` 自动卖 WETH 补足。如果保留检查，自动卖币那条路径
    ///      永远走不到（会先 revert `ERC4626ExceededMaxRedeem`）。
    ///      真正的兜底在 `_withdraw`：卖光也不够时 revert `InsufficientLiquidity`。
    function redeem(uint256 shares, address receiver, address owner_) public override returns (uint256) {
        uint256 assets = previewRedeem(shares);
        _withdraw(msg.sender, receiver, owner_, assets, shares);
        return assets;
    }

    /// @notice 同 `redeem`：跳过 `maxWithdraw` 的保守上限
    function withdraw(uint256 assets, address receiver, address owner_) public override returns (uint256) {
        uint256 shares = previewWithdraw(assets);
        _withdraw(msg.sender, receiver, owner_, assets, shares);
        return shares;
    }

    /// @dev 所有赎回路径（`redeem` / `withdraw`）最终都走这里。
    ///      先保证柜台上有足够 USDC，再走 OZ 的转账逻辑 —— 这样
    ///      「赎回即时完成，不用等基金经理卖资产」在合约层成立。
    ///      **没有 whenNotPaused**：暂停策略不影响赎回，包括自动卖 WETH 那条路径。
    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        _ensureLiquidity(assets, owner_, shares);
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @dev 现金够就什么都不做（**绝不碰 router**）；不够就卖「刚好够」的 WETH。
    function _ensureLiquidity(uint256 assets, address forHolder, uint256 shares) internal {
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        if (cash >= assets) return;

        uint256 price = ethPrice();
        uint256 wethValue = usdcValueOfWeth(WETH.balanceOf(address(this)), price);
        uint256 realizable = wethValue * (BPS - SLIPPAGE_BPS) / BPS;
        // 卖光也不够：直接给自定义 error，不要白跑一笔 swap 再裸 revert
        if (cash + realizable < assets) revert InsufficientLiquidity(assets, cash, wethValue);

        uint256 wethSold;
        uint256 usdcOut;

        // 理论上一次就够（amountIn 用 ceil）。池子的手续费/滑点会让实际到账略少，
        // 所以最多再补卖 3 次**差额**（几何收敛，不会多卖）。
        for (uint256 i; i < 4; i++) {
            cash = IERC20(asset()).balanceOf(address(this));
            if (cash >= assets) break;

            uint256 deficit = assets - cash;
            // 第 1 笔按 oracle 价 ceilDiv（正好够，不多卖）；补卖的那几笔按
            // SLIPPAGE_BPS 放大，否则「滑点用满」时永远差最后一个最小单位。
            uint256 amountIn;
            if (i == 0) {
                // 第 1 笔：正好按 oracle 价 ceilDiv，不多卖
                amountIn = (deficit * WETH_PRICE_SCALE + price - 1) / price;
            } else {
                // 补卖：按 SLIPPAGE_BPS 放大，并且多要 2 个最小单位，
                // 否则 1 个 USDC 单位的缺口会因为两层 floor 永远卖不出来。
                uint256 want = deficit + 2;
                amountIn = (want * BPS * WETH_PRICE_SCALE + (BPS - SLIPPAGE_BPS) * price - 1)
                    / ((BPS - SLIPPAGE_BPS) * price);
            }
            uint256 wethBalance = WETH.balanceOf(address(this));
            if (amountIn > wethBalance) amountIn = wethBalance;
            if (amountIn == 0) break;

            uint256 expectedOut = usdcValueOfWeth(amountIn, price);
            uint256 minOut = expectedOut * (BPS - SLIPPAGE_BPS) / BPS;

            _swap(address(WETH), asset(), amountIn, minOut);

            uint256 received = IERC20(asset()).balanceOf(address(this)) - cash;
            wethSold += amountIn;
            usdcOut += received;
        }

        uint256 finalCash = IERC20(asset()).balanceOf(address(this));
        if (finalCash < assets) {
            revert InsufficientLiquidity(assets, finalCash, usdcValueOfWeth(WETH.balanceOf(address(this)), price));
        }

        emit LiquiditySold(forHolder, wethSold, usdcOut, shares, uint64(block.timestamp));
    }

    /// @dev 唯一的下单出口。买入（onReport）、卖出（onReport）、赎回补现金都走这里。
    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal {
        IERC20(tokenIn).forceApprove(address(ROUTER), amountIn);
        ROUTER.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: POOL_FEE,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // ---------------------------------------------------------------------
    // 费率：常量，无 setter
    // ---------------------------------------------------------------------

    /// @notice 每满 30 天，按 0.1%/期 铸份额给 feeRecipient。任何人可调。
    /// @dev 多周期**线性补收**（3 期 = 0.3%，不是 0.1%，也不是复利）；
    ///      不足一期的余数保留在 `lastFeeAccrual` 里，下次继续累计。
    function accrueFee() external nonReentrant {
        uint64 last = lastFeeAccrual;
        if (last == 0) {
            lastFeeAccrual = uint64(block.timestamp);
            return;
        }

        uint64 elapsed = uint64(block.timestamp) - last;
        if (elapsed < FEE_PERIOD) return;

        uint64 periods = elapsed / FEE_PERIOD;
        lastFeeAccrual = last + periods * FEE_PERIOD; // 余数保留

        uint256 supply = totalSupply();
        if (supply == 0) return;

        uint256 feeAssets = totalAssets() * FEE_BPS_PER_PERIOD * periods / BPS;
        uint256 shares = _convertToShares(feeAssets, Math.Rounding.Floor);
        if (shares != 0) _mint(FEE_RECIPIENT, shares);
    }

    // ---------------------------------------------------------------------
    // 唯一 owner 权限：三条，都不影响赎回
    // ---------------------------------------------------------------------

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    function setForwarder(address newForwarder) external onlyOwner {
        if (newForwarder == address(0)) revert ZeroAddress();
        forwarder = newForwarder;
    }

    // ---------------------------------------------------------------------
    // 内部
    // ---------------------------------------------------------------------

    uint256 private constant BPS = 10_000;
    /// @dev 低于 1 USDC 的 WETH 残留视为 dust。清仓（target == 0）时一并卖掉：
    ///      dust 留在仓位里会让「清仓后全额赎回」差几个最小单位而 revert（实测踩过），
    ///      而它小到对风险敞口没有意义。
    uint256 private constant DUST_USDC = 1e6;
    /// @dev WETH 18dec / feed 8dec / USDC 6dec → 10 ** (18 + 8 - 6)
    uint256 private constant WETH_PRICE_SCALE = 1e20;

    function _totalAssets(uint256 price) internal view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + usdcValueOfWeth(WETH.balanceOf(address(this)), price);
    }
}
