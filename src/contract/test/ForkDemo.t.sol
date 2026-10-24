// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AlphaPlanVault} from "../src/AlphaPlanVault.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";

interface IUniV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

/// @title ForkDemoTest
/// @notice demo 全流程的**真链**回归测试。跑在 Base Sepolia fork 上：
///         真 USDC、真 WETH、真 Uniswap V3 SwapRouter02、真池子。
///         只有 oracle 是被 `MockAggregator` 覆盖的 —— 因为真 feed 在合约上下文里
///         调用 `latestRoundData()` 会 revert `"No access"`（README「四条实测事实」第 1 条）。
///
///         运行：
///           cd src/contract
///           forge test --match-contract ForkDemoTest --fork-url https://sepolia.base.org -vv
///
///         它把 demo 里每一处会被点到的交互钉住：
///           01 部署 + 入金 20 USDC
///           02 CRE 报告 → 真 swap 买入（target 3000bps）
///           03 抬价 → NAV / 份额价上涨
///           04 抬价后买、卖两个方向都还能成交（现场最易翻车处）
///           05 反证：只抬 oracle 不抬池子 → 卖方向必须 revert
///           06 容差内报告 → 不交易、仍发 PlanRecorded、仍消耗 nonce
///           07 现金够时赎回 → 池子完全没被碰
///           08 现金不够时赎回 → 自动卖 WETH（真池子成交）
///           09 清仓（target=0）→ dust 归一 → 全额赎回
///           10 反重放：同 planHash / 同 nonce 都被拒，状态不推进
contract ForkDemoTest is Test {
    // —— Base Sepolia 实测地址（docs/PRD.md §10）——
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant ETH_USD_FEED = 0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3;
    address constant SWAP_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    address constant POOL = 0x46880b404CD35c165EDdefF7421019F8dD25F4Ad;
    address constant MOCK_FORWARDER = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
    address constant ANVIL_ACCOUNT0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    uint24 constant POOL_FEE = 3000;
    uint256 constant BPS = 10_000;
    /// @dev 池子手续费 0.3%：任何"换成现金"的操作都会少一点，容差取 1%
    uint256 constant FEE_TOLERANCE_BPS = 100;

    /// @dev 抬价目标。这两个数是**实测过**的（script/demo-bump-price.sh 跑出来的），
    ///      不是算出来的 —— tick 与 sqrtPriceX96 必须成对且一致，
    ///      而 demo 只用到这一个档位，所以直接固化，不在 Solidity 里重算对数。
    uint256 constant BUMP_PRICE_8DEC = 4000e8;
    int24 constant BUMP_TICK = 193380;
    uint160 constant BUMP_SQRT_PRICE_X96 = 1252745881365729737177065691545600;

    AlphaPlanVault vault;
    address feeRecipient = address(0xFEE);
    address vaultOwner = address(0x000000000000000000000000000000000000bEEF);

    address trader;
    uint256 planSeq;

    bool forkReady;

    function setUp() public {
        // 没在 fork 上跑（普通 `forge test`）→ 跳过整套，不判失败。
        // 这些用例必须连真链状态才有意义，用 mock 跑等于自欺。
        if (block.chainid != 84532 || POOL.code.length == 0) {
            forkReady = false;
            vm.skip(true);
            return;
        }
        forkReady = true;

        // 用 MockAggregator 覆盖真 feed，初始价 = 池子现货价（否则 50bps 容差会拒掉第一笔）
        MockAggregator impl = new MockAggregator(int256(_poolSpotPrice()), 8);
        vm.etch(ETH_USD_FEED, address(impl).code);
        _writeFeed(_poolSpotPrice(), block.timestamp);

        vault = new AlphaPlanVault(
            IERC20(USDC),
            IERC20(WETH),
            AggregatorV3Interface(ETH_USD_FEED),
            ISwapRouter(SWAP_ROUTER),
            POOL_FEE,
            feeRecipient,
            MOCK_FORWARDER,
            vaultOwner
        );

        trader = _findUsdcHolder(20e6);
        vm.prank(trader);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        vm.prank(trader);
        vault.deposit(20e6, trader);
    }

    // ==================================================================
    // 01 部署 + 入金
    // ==================================================================

    function test_Fork_01_DepositAndNav() public {
        _requireFork();
        assertEq(vault.asset(), USDC);
        assertEq(vault.decimals(), 6);
        assertEq(vault.totalSupply(), 20e6);
        assertApproxEqAbs(vault.totalAssets(), 20e6, 1, "NAV ~= 20 USDC");
        assertEq(vault.currentWethBps(), 0, "all cash");
        assertEq(vault.maxRedeem(trader), 20e6);
    }

    // ==================================================================
    // 02 报告 → 真 swap 买入
    // ==================================================================

    function test_Fork_02_ReportBuysOnRealPool() public {
        _requireFork();
        uint256 cashBefore = IERC20(USDC).balanceOf(address(vault));

        vm.recordLogs();
        _onReport(3000);

        assertEq(vault.lastNonce(), 1);
        assertGt(IERC20(WETH).balanceOf(address(vault)), 0, "real pool gave WETH");
        assertLt(IERC20(USDC).balanceOf(address(vault)), cashBefore, "spent USDC");
        // 30% 仓位；真实成交后差的就是池子 0.3% 手续费
        assertApproxEqAbs(vault.currentWethBps(), 3000, 30, "position ~30%");

        (bytes32 topic0, uint64 asOf, uint64 validUntil, uint16 target) = _lastPlanEvent();
        assertEq(topic0, AlphaPlanVault.PlanExecuted.selector, "this path trades");
        assertEq(target, 3000);
        assertEq(validUntil, asOf + 900, "validUntil == asOf + validitySeconds");
    }

    // ==================================================================
    // 03 抬价 → NAV 上涨
    // ==================================================================

    function test_Fork_03_BumpPriceRaisesNav() public {
        _requireFork();
        _onReport(3000);

        uint256 navBefore = vault.totalAssets();
        uint256 shareBefore = vault.convertToAssets(1e6);

        _bumpPrice(true);

        uint256 navAfter = vault.totalAssets();
        uint256 shareAfter = vault.convertToAssets(1e6);

        assertGt(navAfter, navBefore, "NAV up");
        assertGt(shareAfter, shareBefore, "share worth more");

        // 只有 ~30% 在 WETH 里，所以 ~8% 的币价涨幅对应 ~2.x% 的净值涨幅
        uint256 navPct = (navAfter - navBefore) * BPS / navBefore;
        assertGt(navPct, 150, "NAV at least +1.5%");
        assertLt(navPct, 400, "NAV far less than price move (only 30% deployed)");
    }

    // ==================================================================
    // 04 抬价后两个方向仍能成交
    // ==================================================================

    function test_Fork_04_AfterBumpBothDirectionsStillSwap() public {
        _requireFork();
        _onReport(3000); // buy
        _bumpPrice(true);

        // 卖方向：清仓
        assertGt(IERC20(WETH).balanceOf(address(vault)), 0);
        _onReport(0);
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0, "flat, dust included");
        assertGt(IERC20(USDC).balanceOf(address(vault)), 19e6, "cash back");

        // 买方向：再买回来
        _onReport(2000);
        assertGt(IERC20(WETH).balanceOf(address(vault)), 0, "buy still works after bump");
        assertApproxEqAbs(vault.currentWethBps(), 2000, 40);
    }

    // ==================================================================
    // 05 反证：只抬 oracle 不抬池子 → 卖方向 revert
    // ==================================================================

    function test_Fork_05_OracleOnlyBumpMakesSellRevert() public {
        _requireFork();
        _onReport(3000);

        _bumpPrice(false); // 只改 oracle

        bytes memory report = _report(uint64(block.timestamp), 0, _nextNonce(), keccak256("oracle-only"));
        vm.prank(MOCK_FORWARDER);
        vm.expectRevert();
        vault.onReport("", report);

        assertGt(IERC20(WETH).balanceOf(address(vault)), 0, "position untouched");
        assertEq(vault.lastNonce(), 1, "rejected -> nonce not advanced");
    }

    // ==================================================================
    // 06 容差路径
    // ==================================================================

    function test_Fork_06_TolerancePathDoesNotTouchPool() public {
        _requireFork();
        _onReport(3000); // actual ~2993

        uint256 wethBefore = IERC20(WETH).balanceOf(address(vault));
        uint160 sqrtBefore = _slot0Sqrt();

        vm.recordLogs();
        _onReport(2800); // drift 193bps <= 300

        assertEq(IERC20(WETH).balanceOf(address(vault)), wethBefore, "position untouched");
        assertEq(_slot0Sqrt(), sqrtBefore, "pool untouched");
        assertEq(vault.lastNonce(), 2, "nonce still consumed");

        (bytes32 topic0,,,) = _lastPlanEvent();
        assertEq(topic0, AlphaPlanVault.PlanRecorded.selector, "recorded, not executed");
    }

    // ==================================================================
    // 07 现金够 → 赎回不碰池子
    // ==================================================================

    function test_Fork_07_RedeemWithEnoughCash() public {
        _requireFork();
        _onReport(3000); // cash 14e6

        uint256 expected = vault.previewRedeem(10e6);
        assertLe(expected, IERC20(USDC).balanceOf(address(vault)), "premise: cash covers it");
        uint160 sqrtBefore = _slot0Sqrt();

        vm.prank(trader);
        uint256 got = vault.redeem(10e6, trader, trader);

        assertEq(got, expected);
        assertEq(_slot0Sqrt(), sqrtBefore, "pool completely untouched");
    }

    // ==================================================================
    // 08 现金不够 → 自动卖 WETH
    // ==================================================================

    function test_Fork_08_RedeemAutoSellsWeth() public {
        _requireFork();
        _onReport(3000); // cash 14e6, WETH ~6 USDC

        uint256 shares = 18e6;
        uint256 expected = vault.previewRedeem(shares);
        uint256 cash = IERC20(USDC).balanceOf(address(vault));
        assertGt(expected, cash, "premise: cash insufficient");

        vm.recordLogs();
        vm.prank(trader);
        uint256 got = vault.redeem(shares, trader, trader);

        assertEq(got, expected, "paid == previewRedeem at call time");
        assertTrue(_sawLiquiditySold(), "LiquiditySold emitted");
        // 池子 0.3% 手续费：实际到账只允许差手续费级别
        assertGe(got * BPS, expected * (BPS - FEE_TOLERANCE_BPS), "only fee-level loss");
    }

    // ==================================================================
    // 09 清仓 + 全额赎回
    // ==================================================================

    function test_Fork_09_FlatThenFullRedeem() public {
        _requireFork();
        _onReport(3000);
        _onReport(0);
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0, "flat, no dust");

        uint256 supply = vault.totalSupply();
        uint256 promised = vault.previewRedeem(supply);
        uint256 cash = IERC20(USDC).balanceOf(address(vault));
        assertEq(promised, cash, "after flat, cash == NAV per share");

        vm.prank(trader);
        uint256 got = vault.redeem(supply, trader, trader);

        assertEq(got, promised, "full redeem needs no extra sell");
        assertLe(IERC20(USDC).balanceOf(address(vault)), 2, "only rounding dust");
        assertEq(IERC20(WETH).balanceOf(address(vault)), 0);
    }

    // ==================================================================
    // 10 反重放
    // ==================================================================

    function test_Fork_10_ReplayIsRejected() public {
        _requireFork();
        bytes32 planHash = keccak256("fork-replay");
        _onReportHashed(3000, planHash);
        assertTrue(vault.planUsed(planHash));

        vm.warp(block.timestamp + 61);
        _writeFeed(_poolSpotPrice(), block.timestamp);

        // 同 planHash 新 nonce → PlanAlreadyExecuted
        bytes memory again = _report(uint64(block.timestamp), 3000, _nextNonce(), planHash);
        vm.prank(MOCK_FORWARDER);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.PlanAlreadyExecuted.selector, planHash));
        vault.onReport("", again);

        // 同 nonce（已用掉的 1）→ BadNonce
        bytes memory oldNonce = _report(uint64(block.timestamp), 3000, 1, keccak256("fork-replay-2"));
        vm.prank(MOCK_FORWARDER);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.BadNonce.selector, 2, 1));
        vault.onReport("", oldNonce);

        assertEq(vault.lastNonce(), 1, "rejections never advance nonce");
    }

    // ==================================================================
    // 工具
    // ==================================================================

    function _requireFork() internal view {
        if (!forkReady) revert("needs fork: forge test --fork-url https://sepolia.base.org");
    }

    /// @dev USDC(6) 是 token0、WETH(18) 是 token1。
    ///      p_raw = (sqrtP/2^96)^2 = token1_raw / token0_raw
    ///      USDC per WETH = 1e12 / p_raw → 8 位小数为 1e20 / p_raw
    function _poolSpotPrice() internal view returns (uint256) {
        uint160 sqrtP = _slot0Sqrt();
        if (sqrtP == 0) return 0;
        // 1e20 * 2^192 / sqrtP^2，分两步做避免中间值溢出（每步误差 < 1 个最小单位）
        uint256 a = Math.mulDiv(1e20, 1 << 96, sqrtP);
        return Math.mulDiv(a, 1 << 96, sqrtP);
    }

    function _slot0Sqrt() internal view returns (uint160 sqrtP) {
        (sqrtP,,,,,,) = IUniV3Pool(POOL).slot0();
    }

    function _writeFeed(uint256 price, uint256 updatedAt) internal {
        // MockAggregator: slot0=answer, slot1=decimals, slot2=updatedAt
        vm.store(ETH_USD_FEED, bytes32(uint256(0)), bytes32(price));
        vm.store(ETH_USD_FEED, bytes32(uint256(1)), bytes32(uint256(8)));
        vm.store(ETH_USD_FEED, bytes32(uint256(2)), bytes32(updatedAt));
    }

    /// @dev 抬价：oracle 必改；池子可选（复刻 demo-bump-price.sh 的语义）
    function _bumpPrice(bool alsoPool) internal {
        _writeFeed(BUMP_PRICE_8DEC, block.timestamp);
        if (!alsoPool) return;

        (,, uint16 oi, uint16 oc, uint16 ocn, uint8 fp, bool unlocked) = IUniV3Pool(POOL).slot0();
        bytes32 packed = bytes32(
            uint256(BUMP_SQRT_PRICE_X96) | (uint256(uint24(BUMP_TICK)) << 160) | (uint256(oi) << 184)
                | (uint256(oc) << 200) | (uint256(ocn) << 216) | (uint256(fp) << 232)
                | (uint256(unlocked ? 1 : 0) << 240)
        );
        vm.store(POOL, bytes32(uint256(0)), packed);
    }

    function _nextNonce() internal view returns (uint64) {
        return vault.lastNonce() + 1;
    }

    function _report(uint64 asOf, uint16 target, uint64 n, bytes32 planHash)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(address(vault), asOf, asOf + 900, n, target, planHash);
    }

    function _onReport(uint16 target) internal {
        _onReportHashed(target, keccak256(abi.encode("fork-plan", target, planSeq++)));
    }

    function _onReportHashed(uint16 target, bytes32 planHash) internal {
        _waitMinInterval();
        bytes memory report = _report(uint64(block.timestamp), target, _nextNonce(), planHash);
        vm.prank(MOCK_FORWARDER);
        vault.onReport("", report);
    }

    /// @dev 两次报告至少隔 MIN_INTERVAL(60s)，同时刷新 feed 时间戳否则会判陈旧。
    ///      这就是 demo 里"等一分钟再下一条计划"的等价动作。
    function _waitMinInterval() internal {
        uint64 next = vault.lastExecutedAt() + vault.MIN_INTERVAL();
        if (block.timestamp < next) {
            vm.warp(next);
        }
        _writeFeed(vault.ethPrice(), block.timestamp);
    }

    /// @dev 取最后一条 PlanExecuted / PlanRecorded 的 (topic0, asOf, validUntil, target)
    function _lastPlanEvent() internal returns (bytes32 topic0, uint64 asOf, uint64 validUntil, uint16 target) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; i++) {
            bytes32 t = logs[i].topics[0];
            if (t != AlphaPlanVault.PlanExecuted.selector && t != AlphaPlanVault.PlanRecorded.selector) continue;
            topic0 = t;
            if (t == AlphaPlanVault.PlanExecuted.selector) {
                (asOf, validUntil, target,,,) = abi.decode(logs[i].data, (uint64, uint64, uint16, uint16, uint256, uint256));
            } else {
                (asOf, validUntil, target,,) = abi.decode(logs[i].data, (uint64, uint64, uint16, uint16, uint64));
            }
            found = true;
        }
        assertTrue(found, "no PlanExecuted/PlanRecorded emitted");
    }

    function _sawLiquiditySold() internal returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == AlphaPlanVault.LiquiditySold.selector) return true;
        }
        return false;
    }

    function _findUsdcHolder(uint256 need) internal view returns (address) {
        address[2] memory candidates = [ANVIL_ACCOUNT0, POOL];
        for (uint256 i; i < candidates.length; i++) {
            if (IERC20(USDC).balanceOf(candidates[i]) >= need) return candidates[i];
        }
        revert("no USDC holder on this fork; try another --fork-block-number");
    }
}
