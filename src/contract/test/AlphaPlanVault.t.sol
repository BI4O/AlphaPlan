// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";

import {AlphaPlanVault} from "../src/AlphaPlanVault.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockRouter} from "./mocks/MockRouter.sol";

/// @dev 把 internal pure 的换算函数暴露出来，供 A7 边界单测直接调用。
contract AlphaPlanVaultHarness is AlphaPlanVault {
    constructor(
        IERC20 asset_,
        IERC20 weth_,
        AggregatorV3Interface ethUsdFeed_,
        ISwapRouter router_,
        uint24 poolFee_,
        address feeRecipient_,
        address forwarder_,
        address owner_
    )
        AlphaPlanVault(
            asset_, weth_, ethUsdFeed_, router_, poolFee_, feeRecipient_, forwarder_, owner_
        )
    {}

    /// @dev `usdcValueOfWeth` 按 PLAN P1 保持 internal pure；这里只做测试可见的转发。
    function usdcValueOfWethExposed(uint256 wethAmount, uint256 price) public pure returns (uint256) {
        return usdcValueOfWeth(wethAmount, price);
    }
}

contract AlphaPlanVaultTest is Test {
    AlphaPlanVaultHarness internal vault;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockFeed internal feed;
    MockRouter internal router;

    address internal constant OWNER = address(0xA11CE);
    address internal constant FEE_RECIPIENT = address(0xFEE);
    address internal constant FORWARDER = address(0xF0);
    address internal constant ALICE = address(0xA1);

    uint256 internal constant PRICE = 2000e8; // ETH/USD, 8dec
    uint24 internal constant POOL_FEE = 3000;
    /// @dev 后端默认 validitySeconds（PRD §5：由 cron 周期 600s 推出）
    uint64 internal constant BACKEND_VALIDITY_SECONDS = 900;

    uint256 internal constant BPS = 10_000;

    // ------------------------------------------------------------------
    // 夹具
    // ------------------------------------------------------------------

    function setUp() public {
        // 先定时间再部署：MockFeed 的 updatedAt 取部署时的 block.timestamp
        vm.warp(1_700_000_000);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        feed = new MockFeed(8, int256(PRICE));
        router = new MockRouter(address(usdc), address(weth), PRICE);

        vault = new AlphaPlanVaultHarness(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            AggregatorV3Interface(address(feed)),
            ISwapRouter(address(router)),
            POOL_FEE,
            FEE_RECIPIENT,
            FORWARDER,
            OWNER
        );

        // router 的对手盘流动性
        weth.mint(address(router), 1_000e18);
        usdc.mint(address(router), 1_000_000e6);

        // 初始 100 USDC 入金（1:1）
        usdc.mint(ALICE, 1_000e6);
        vm.startPrank(ALICE);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100e6, ALICE);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------------

    function _report(
        address vaultAddr,
        uint64 asOf,
        uint64 validUntil,
        uint64 nonce,
        uint16 target,
        bytes32 planHash
    ) internal pure returns (bytes memory) {
        return abi.encode(vaultAddr, asOf, validUntil, nonce, target, planHash);
    }

    /// @dev asOf == now、validUntil == now + 900 的合法报告
    function _okReport(uint16 target, uint64 nonce, bytes32 planHash) internal view returns (bytes memory) {
        return _report(
            address(vault),
            uint64(block.timestamp),
            uint64(block.timestamp) + BACKEND_VALIDITY_SECONDS,
            nonce,
            target,
            planHash
        );
    }

    function _submit(bytes memory report) internal {
        vm.prank(FORWARDER);
        vault.onReport("", report);
    }

    function _expectRevertOnSubmit(bytes memory report, bytes memory err) internal {
        vm.prank(FORWARDER);
        vm.expectRevert(err);
        vault.onReport("", report);
    }

    /// @dev 时间前进并刷新 feed（否则陈旧检查先炸）
    function _advance(uint256 secs) internal {
        vm.warp(block.timestamp + secs);
        feed.setAnswer(int256(PRICE));
    }

    function _mintWethToVault(uint256 amount) internal {
        weth.mint(address(vault), amount);
    }

    // ==================================================================
    // 部署与初始化
    // ==================================================================

    function test_Deployment() public view {
        assertEq(vault.asset(), address(usdc), "asset");
        assertEq(vault.decimals(), 6, "decimals == USDC");
        assertEq(vault.name(), "AlphaPlan USDC");
        assertEq(vault.symbol(), "apUSDC");

        assertEq(address(vault.WETH()), address(weth));
        assertEq(address(vault.ETH_USD_FEED()), address(feed));
        assertEq(address(vault.ROUTER()), address(router));
        assertEq(vault.POOL_FEE(), POOL_FEE);
        assertEq(vault.FEE_RECIPIENT(), FEE_RECIPIENT);

        assertEq(vault.owner(), OWNER);
        assertEq(vault.forwarder(), FORWARDER);
        assertFalse(vault.paused());
        assertEq(vault.lastNonce(), 0);
        assertEq(vault.lastExecutedAt(), 0);
        assertEq(vault.lastTargetWethBps(), 0);
        assertEq(vault.lastPlanHash(), bytes32(0));
        assertEq(vault.lastFeeAccrual(), uint64(block.timestamp));
        assertFalse(vault.planUsed(bytes32(uint256(1))));
    }

    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(AlphaPlanVault.ZeroAddress.selector);
        new AlphaPlanVault(
            IERC20(address(0)),
            IERC20(address(weth)),
            AggregatorV3Interface(address(feed)),
            ISwapRouter(address(router)),
            POOL_FEE,
            FEE_RECIPIENT,
            FORWARDER,
            OWNER
        );

        vm.expectRevert(AlphaPlanVault.ZeroAddress.selector);
        new AlphaPlanVault(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            AggregatorV3Interface(address(feed)),
            ISwapRouter(address(router)),
            POOL_FEE,
            FEE_RECIPIENT,
            FORWARDER,
            address(0)
        );
    }

    // ==================================================================
    // A13 常量与 PRD §5 一致（不含 4000）
    // ==================================================================

    function test_A13_ConstantsMatchPRD() public view {
        assertEq(vault.MAX_WETH_BPS(), 6000, "MAX_WETH_BPS");
        assertEq(vault.TOLERANCE_BPS(), 300, "TOLERANCE_BPS");
        assertEq(vault.MAX_SWAP_BPS(), 5000, "MAX_SWAP_BPS");
        assertEq(vault.SLIPPAGE_BPS(), 50, "SLIPPAGE_BPS");
        assertEq(vault.MIN_INTERVAL(), 60, "MIN_INTERVAL");
        assertEq(vault.MAX_PLAN_AGE(), 3600, "MAX_PLAN_AGE");
        assertEq(vault.FEE_BPS_PER_PERIOD(), 10, "FEE_BPS_PER_PERIOD");
        assertEq(vault.FEE_PERIOD(), 30 days, "FEE_PERIOD");
        // A16：feed 陈旧阈值必须 ≥ 1h
        assertEq(vault.MAX_FEED_STALENESS(), 1 hours, "MAX_FEED_STALENESS");
    }

    // ==================================================================
    // A7 精度换算：usdcValueOfWeth = weth * price / 1e20
    // ==================================================================

    function test_A7_UsdcValueOfWeth_ZeroWeth() public view {
        assertEq(vault.usdcValueOfWethExposed(0, PRICE), 0);
    }

    function test_A7_UsdcValueOfWeth_ZeroPrice() public view {
        assertEq(vault.usdcValueOfWethExposed(1e18, 0), 0);
    }

    function test_A7_UsdcValueOfWeth_PlanExample() public view {
        // PLAN P1 第 2 步：0.04 WETH @ 2000e8 → 80e6
        assertEq(vault.usdcValueOfWethExposed(0.04e18, PRICE), 80e6);
        // 少一个 1e2 就是 100 倍误差
        assertEq(vault.usdcValueOfWethExposed(1e18, PRICE), 2000e6);
    }

    function test_A7_UsdcValueOfWeth_LargeValue() public view {
        // 1e6 WETH（1e24 wei）@ $10,000（1e12）→ 1e16 = 10,000,000,000 USDC
        assertEq(vault.usdcValueOfWethExposed(1e24, 1e12), 1e16);
    }

    function test_A7_UsdcValueOfWeth_TruncatesBelowOneUsdcWei() public view {
        // 1 wei WETH @ $2000 → 2e-12 USDC → 向下取整为 0
        assertEq(vault.usdcValueOfWethExposed(1, PRICE), 0);
    }

    // ==================================================================
    // totalAssets / feed 陈旧（A16）
    // ==================================================================

    function test_TotalAssets_UsdcPlusWeth() public {
        _mintWethToVault(0.04e18);
        assertEq(vault.totalAssets(), 180e6, "100e6 + 0.04e18*2000e8/1e20");
    }

    function test_TotalAssets_RevertsWhenFeedStale() public {
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.StalePrice.selector, 1 hours + 1));
        vault.totalAssets();
    }

    function test_TotalAssets_StalenessBoundaryIsInclusive() public {
        vm.warp(block.timestamp + 1 hours);
        _mintWethToVault(0.04e18);
        assertEq(vault.totalAssets(), 180e6);
    }

    function test_TotalAssets_RevertsOnNonPositivePrice() public {
        feed.setAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.InvalidPrice.selector, int256(0)));
        vault.totalAssets();

        feed.setAnswer(-1);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.InvalidPrice.selector, int256(-1)));
        vault.totalAssets();
    }

    function test_TotalAssets_RevertsOnIncompleteRound() public {
        // answeredInRound < roundId
        feed.setRoundData(5, int256(PRICE), block.timestamp, 4);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.InvalidPrice.selector, int256(PRICE)));
        vault.totalAssets();

        // roundId == 0
        feed.setRoundData(0, int256(PRICE), block.timestamp, 0);
        vm.expectRevert(abi.encodeWithSelector(AlphaPlanVault.InvalidPrice.selector, int256(PRICE)));
        vault.totalAssets();
    }

    // ==================================================================
    // deposit / redeem
    // ==================================================================

    function test_DepositRedeemOneToOne() public {
        vm.startPrank(ALICE);
        uint256 shares = vault.deposit(10e6, ALICE);
        assertEq(shares, 10e6, unicode"初始 1:1");

        uint256 assets = vault.redeem(shares, ALICE, ALICE);
        assertEq(assets, 10e6, unicode"赎回同额");
        vm.stopPrank();

        assertEq(usdc.balanceOf(ALICE), 900e6, unicode"回到入金前的余额");
        assertEq(vault.totalSupply(), 100e6);
    }

    function test_RedeemMoreAfterPriceAppreciation() public {
        _mintWethToVault(0.1e18); // nav = 300e6
        // ERC4626 的虚拟偏移（supply+1 / assets+1）会吃掉 1 wei，用近似断言
        assertApproxEqAbs(vault.previewRedeem(10e6), 30e6, 2, unicode"涨价前 3.0 USDC/份额");

        feed.setAnswer(int256(3000e8)); // 0.1 WETH 值 300e6 → nav = 400e6
        assertApproxEqAbs(vault.previewRedeem(10e6), 40e6, 2, unicode"涨价后 4.0 USDC/份额");

        vm.prank(ALICE);
        uint256 assets = vault.redeem(10e6, ALICE, ALICE);
        assertApproxEqAbs(assets, 40e6, 2);
        assertGt(assets, 30e6, unicode"赎回金额随 NAV 上升");
    }

    // A11：pause 只停策略，不停赎回
    function test_A11_RedeemWorksWhenPaused_AndOnReportReverts() public {
        vm.prank(OWNER);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(ALICE);
        uint256 assets = vault.redeem(100e6, ALICE, ALICE);
        assertEq(assets, 100e6, unicode"paused 下 redeem 仍然成功");

        bytes memory report = _okReport(3000, 1, bytes32("p1"));
        _expectRevertOnSubmit(report, abi.encodeWithSelector(AlphaPlanVault.Paused.selector));

        vm.prank(OWNER);
        vault.unpause();
        _submit(report);
        assertEq(vault.lastNonce(), 1);
    }

    // ==================================================================
    // currentWethBps
    // ==================================================================

    function test_CurrentWethBps_AllCash() public view {
        assertEq(vault.currentWethBps(), 0);
    }

    function test_CurrentWethBps_AllWeth() public {
        // 空份额、只有 WETH：nav 全部来自 WETH
        AlphaPlanVaultHarness fresh = _deployFreshVault();
        weth.mint(address(fresh), 0.05e18);
        assertEq(fresh.currentWethBps(), BPS);
    }

    function test_CurrentWethBps_EmptyVaultDoesNotPanic() public {
        AlphaPlanVaultHarness fresh = _deployFreshVault();
        assertEq(fresh.currentWethBps(), 0);
    }

    function test_CurrentWethBps_Mixed() public {
        _mintWethToVault(0.04e18); // 80 / 180 = 44.44%
        assertEq(vault.currentWethBps(), 4444);
    }

    // 观测值不受仓位上限约束：WETH 涨价后可以 > 6000（PLAN P1 第 4 步）
    function test_CurrentWethBps_CanExceedMaxAfterPriceRise() public {
        _mintWethToVault(0.1e18); // 200 / 300 = 66.6%
        uint16 bps = vault.currentWethBps();
        assertGt(bps, vault.MAX_WETH_BPS(), unicode"观测值可以超过 6000");
        assertEq(bps, 6666);
    }

    // ==================================================================
    // A5 / A5b / A5c：onReport 的 11 条校验
    // ==================================================================

    // 1. sender
    function test_A5_01_RevertsWhenSenderNotForwarder() public {
        bytes memory report = _okReport(3000, 1, bytes32("p1"));
        vm.expectRevert(AlphaPlanVault.NotForwarder.selector);
        vault.onReport("", report);

        vm.prank(ALICE);
        vm.expectRevert(AlphaPlanVault.NotForwarder.selector);
        vault.onReport("", report);
    }

    // 2. vault
    function test_A5_02_RevertsWhenVaultMismatch() public {
        bytes memory report =
            _report(address(0xBEEF), uint64(block.timestamp), uint64(block.timestamp) + 900, 1, 3000, bytes32("p1"));
        _expectRevertOnSubmit(report, abi.encodeWithSelector(AlphaPlanVault.WrongVault.selector));
    }

    // 3. paused
    function test_A5_03_RevertsWhenPaused() public {
        vm.prank(OWNER);
        vault.pause();
        bytes memory report = _okReport(3000, 1, bytes32("p1"));
        _expectRevertOnSubmit(report, abi.encodeWithSelector(AlphaPlanVault.Paused.selector));
    }

    // 4. MIN_INTERVAL
    function test_A5_04_RevertsWhenTooFrequent() public {
        _submit(_okReport(3000, 1, bytes32("p1")));
        uint64 nextAllowedAt = vault.lastExecutedAt() + vault.MIN_INTERVAL();

        bytes memory second = _okReport(3000, 2, bytes32("p2"));
        _expectRevertOnSubmit(second, abi.encodeWithSelector(AlphaPlanVault.TooSoon.selector, nextAllowedAt));

        // 满 60s 后同一份报告可以通过
        vm.warp(nextAllowedAt);
        feed.setAnswer(int256(PRICE));
        _submit(second);
        assertEq(vault.lastNonce(), 2);
    }

    // 5. asOf 不能是未来
    function test_A5_05_RevertsWhenAsOfInFuture() public {
        uint64 asOf = uint64(block.timestamp) + 1;
        bytes memory report =
            _report(address(vault), asOf, uint64(block.timestamp) + 900, 1, 3000, bytes32("p1"));
        _expectRevertOnSubmit(report, abi.encodeWithSelector(AlphaPlanVault.PlanFromFuture.selector, asOf));
    }

    // 6. asOf 不能过旧（MAX_PLAN_AGE）
    function test_A5_06_RevertsWhenPlanTooOld() public {
        uint64 asOf = uint64(block.timestamp) - vault.MAX_PLAN_AGE() - 1;
        bytes memory report =
            _report(address(vault), asOf, uint64(block.timestamp) + 900, 1, 3000, bytes32("p1"));
        _expectRevertOnSubmit(
            report, abi.encodeWithSelector(AlphaPlanVault.PlanTooOld.selector, uint256(vault.MAX_PLAN_AGE()) + 1)
        );
    }

    // 7. validUntil 未过期
    function test_A5_07_RevertsWhenExpired() public {
        uint64 validUntil = uint64(block.timestamp) - 1;
        bytes memory report = _report(address(vault), uint64(block.timestamp), validUntil, 1, 3000, bytes32("p1"));
        _expectRevertOnSubmit(report, abi.encodeWithSelector(AlphaPlanVault.Expired.selector, validUntil));
    }

    // 8. nonce 连续
    function test_A5_08_RevertsWhenNonceNotSequential() public {
        _expectRevertOnSubmit(
            _okReport(3000, 5, bytes32("p1")), abi.encodeWithSelector(AlphaPlanVault.BadNonce.selector, 1, 5)
        );
        _expectRevertOnSubmit(
            _okReport(3000, 0, bytes32("p1")), abi.encodeWithSelector(AlphaPlanVault.BadNonce.selector, 1, 0)
        );

        _submit(_okReport(3000, 1, bytes32("p1")));
        _advance(60);
        _expectRevertOnSubmit(
            _okReport(3000, 3, bytes32("p2")), abi.encodeWithSelector(AlphaPlanVault.BadNonce.selector, 2, 3)
        );
    }

    // 9. targetWethBps <= 6000（越界即拒，不夹取）
    function test_A5_09_RevertsWhenTargetAboveMax() public {
        _expectRevertOnSubmit(
            _okReport(6001, 1, bytes32("p1")),
            abi.encodeWithSelector(AlphaPlanVault.TargetAboveMax.selector, 6001)
        );
        _expectRevertOnSubmit(
            _okReport(type(uint16).max, 1, bytes32("p1")),
            abi.encodeWithSelector(AlphaPlanVault.TargetAboveMax.selector, type(uint16).max)
        );
    }

    // 10. planUsed：同一份计划第二次 → revert
    function test_A5_10_RevertsWhenPlanAlreadyUsed() public {
        bytes32 planHash = keccak256("plan-1");
        _submit(_okReport(3000, 1, planHash));
        assertTrue(vault.planUsed(planHash));

        _advance(60); // nonce 与 asOf 都新鲜，只剩 planUsed 能拦
        _expectRevertOnSubmit(
            _okReport(3000, 2, planHash),
            abi.encodeWithSelector(AlphaPlanVault.PlanAlreadyExecuted.selector, planHash)
        );
    }

    // 11. 容差不交易：接受、留痕、不动仓位
    function test_A5_11_TolerancePathRecordsWithoutTrading() public {
        _mintWethToVault(0.04e18); // actual 4444 bps
        bytes32 planHash = keccak256("plan-tolerance");
        bytes memory report = _okReport(4500, 1, planHash); // 偏离 56 bps ≤ 300

        bytes32 reportHash = keccak256(report);
        vm.expectEmit(true, true, true, true, address(vault));
        // (reportHash, planHash, asOf, validUntil, target, actual, nonce)
        emit AlphaPlanVault.PlanRecorded(
            reportHash, planHash, uint64(block.timestamp), uint64(block.timestamp) + BACKEND_VALIDITY_SECONDS, 4500, 4444, 1
        );
        _submit(report);

        assertEq(router.callCount(), 0, unicode"容差内不得调用 router");
        assertEq(vault.lastNonce(), 1, unicode"容差路径仍然消耗 nonce");
        assertTrue(vault.planUsed(planHash), unicode"容差路径仍然置 planUsed");
        assertEq(vault.lastTargetWethBps(), 4500);
        assertEq(vault.lastPlanHash(), planHash);
        assertEq(vault.currentWethBps(), 4444, unicode"仓位未变");
    }

    // ==================================================================
    // A5c：asOf 边界（闭区间）
    // ==================================================================

    function test_A5c_AsOfNowIsAccepted() public {
        bytes memory report = _report(
            address(vault), uint64(block.timestamp), uint64(block.timestamp) + 900, 1, 3000, bytes32("p1")
        );
        _submit(report);
        assertEq(vault.lastNonce(), 1);
    }

    function test_A5c_AsOfExactlyMaxPlanAgeIsAccepted() public {
        uint64 asOf = uint64(block.timestamp) - vault.MAX_PLAN_AGE();
        bytes memory report = _report(address(vault), asOf, uint64(block.timestamp) + 900, 1, 3000, bytes32("p1"));
        _submit(report);
        assertEq(vault.lastNonce(), 1);
    }

    function test_A5c_AsOfMaxPlanAgePlusOneReverts() public {
        uint64 asOf = uint64(block.timestamp) - vault.MAX_PLAN_AGE() - 1;
        bytes memory report = _report(address(vault), asOf, uint64(block.timestamp) + 900, 1, 3000, bytes32("p1"));
        _expectRevertOnSubmit(
            report, abi.encodeWithSelector(AlphaPlanVault.PlanTooOld.selector, uint256(vault.MAX_PLAN_AGE()) + 1)
        );
    }

    // MAX_PLAN_AGE >= validitySeconds，否则合法计划会在有效期内被判过旧
    function test_A5c_MaxPlanAgeCoversBackendValidity() public view {
        assertGe(vault.MAX_PLAN_AGE(), BACKEND_VALIDITY_SECONDS, unicode"MAX_PLAN_AGE 必须 >= validitySeconds(900)");
    }

    // ==================================================================
    // A5b：planUsed 幂等
    // ==================================================================

    function test_A5b_PlanUsedSetOnTradePath() public {
        bytes32 planHash = keccak256("plan-trade");
        _submit(_okReport(3000, 1, planHash));
        assertTrue(vault.planUsed(planHash));
        assertGt(router.callCount(), 0, unicode"这条路径真的交易了");
    }

    function test_A5b_PlanUsedSetOnTolerancePath() public {
        _mintWethToVault(0.04e18);
        bytes32 planHash = keccak256("plan-tolerance-2");
        _submit(_okReport(4400, 1, planHash));
        assertEq(router.callCount(), 0);
        assertTrue(vault.planUsed(planHash), unicode"容差路径也必须置 planUsed");
    }

    function test_A5b_RejectedAttemptDoesNotAdvanceState() public {
        bytes32 goodPlan = keccak256("plan-good");
        _submit(_okReport(3000, 1, goodPlan));
        uint64 nonceAfter = vault.lastNonce();
        uint64 executedAtAfter = vault.lastExecutedAt();

        _advance(60);

        // 被 target 上限拒绝
        _expectRevertOnSubmit(
            _okReport(6001, 2, keccak256("plan-bad")),
            abi.encodeWithSelector(AlphaPlanVault.TargetAboveMax.selector, 6001)
        );
        assertEq(vault.lastNonce(), nonceAfter, unicode"被拒后 lastNonce 不推进");
        assertEq(vault.lastExecutedAt(), executedAtAfter, unicode"被拒后 lastExecutedAt 不推进");
        assertFalse(vault.planUsed(keccak256("plan-bad")), unicode"被拒的计划不得置 planUsed");

        // 被 planUsed 拒绝
        _expectRevertOnSubmit(
            _okReport(3000, 2, goodPlan),
            abi.encodeWithSelector(AlphaPlanVault.PlanAlreadyExecuted.selector, goodPlan)
        );
        assertEq(vault.lastNonce(), nonceAfter, unicode"被 planUsed 拒绝后 lastNonce 不推进");
        assertEq(vault.lastExecutedAt(), executedAtAfter);
    }

    // ==================================================================
    // A6：容差路径反重放（router 零调用 + nonce 已推进 + 事件已发）
    // ==================================================================

    function test_A6_TolerancePathEmitsAndConsumesNonce() public {
        _mintWethToVault(0.04e18); // actual 4444
        bytes32 planHash = keccak256("plan-a6");
        bytes memory report = _okReport(4300, 1, planHash); // 偏离 144 bps

        vm.recordLogs();
        _submit(report);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(router.callCount(), 0, unicode"router 零调用");
        assertEq(vault.lastNonce(), 1, "lastNonce +1");
        assertEq(vault.lastExecutedAt(), uint64(block.timestamp));
        assertEq(logs.length, 1, unicode"恰好一条事件");
        assertEq(logs[0].topics[0], AlphaPlanVault.PlanRecorded.selector);
        assertEq(logs[0].topics.length, 3, unicode"reportHash + planHash 都 indexed");
        assertEq(logs[0].topics[1], keccak256(report));
        assertEq(logs[0].topics[2], planHash);

        // 同一份报告再报一次：nonce 先拦，planUsed 也拦
        _advance(60);
        _expectRevertOnSubmit(
            _okReport(4300, 1, planHash), abi.encodeWithSelector(AlphaPlanVault.BadNonce.selector, 2, 1)
        );
        _expectRevertOnSubmit(
            _okReport(4300, 2, planHash),
            abi.encodeWithSelector(AlphaPlanVault.PlanAlreadyExecuted.selector, planHash)
        );
    }

    // ==================================================================
    // A8：swap 方向与 minOut
    // ==================================================================

    function test_A8_BuyUsesUsdcTokenInAndExactMinOut() public {
        // 全现金，actual 0 → 目标 3000
        bytes32 planHash = keccak256("plan-buy");
        _submit(_okReport(3000, 1, planHash));

        assertEq(router.callCount(), 1);
        MockRouter.Call memory c = router.lastCall();

        assertEq(c.tokenIn, address(usdc), unicode"买入 tokenIn == USDC");
        assertEq(c.tokenOut, address(weth));
        assertEq(c.fee, POOL_FEE);
        assertEq(c.recipient, address(vault));
        assertEq(c.sqrtPriceLimitX96, 0);
        assertEq(c.amountIn, 30e6, "30% of 100e6 NAV");

        // expectedWethOut = 30e6 * 1e20 / 2000e8 = 0.015e18
        uint256 expectedWethOut = 30e6 * 1e20 / PRICE;
        assertEq(expectedWethOut, 0.015e18);
        // minOut 恰好 = expected * (10000 - 50) / 10000，没有任何额外打折
        assertEq(c.amountOutMinimum, expectedWethOut * (BPS - 50) / BPS);
        assertEq(c.amountOutMinimum, 14_925_000_000_000_000);

        assertEq(weth.balanceOf(address(vault)), 0.015e18, unicode"router 真的给了 WETH");
        assertEq(usdc.balanceOf(address(vault)), 70e6);
    }

    function test_A8_SellUsesWethTokenInAndExactMinOut() public {
        _mintWethToVault(0.1e18); // nav 300e6, actual 6666
        _submit(_okReport(0, 1, keccak256("plan-sell")));

        assertEq(router.callCount(), 1);
        MockRouter.Call memory c = router.lastCall();

        assertEq(c.tokenIn, address(weth), unicode"卖出 tokenIn == WETH");
        assertEq(c.tokenOut, address(usdc));
        assertEq(c.amountIn, 0.075e18, unicode"50% NAV 上限 → 150e6/2000");

        uint256 expectedUsdcOut = 0.075e18 * PRICE / 1e20;
        assertEq(expectedUsdcOut, 150e6);
        assertEq(c.amountOutMinimum, expectedUsdcOut * (BPS - 50) / BPS);
        assertEq(c.amountOutMinimum, 149_250_000);
    }

    function test_A8_RouterUnderfillReverts() public {
        // 成交价差 1%（> SLIPPAGE_BPS 50bps）→ router 自己就拒
        router.setRateBps(9900);
        bytes memory report = _okReport(3000, 1, keccak256("plan-slip"));
        vm.prank(FORWARDER);
        vm.expectRevert();
        vault.onReport("", report);
    }

    // ==================================================================
    // A9：仓位上限截断（不夹取、不可复用）
    // ==================================================================

    function test_A9_TargetAboveMaxIsRejectedNotClamped() public {
        _expectRevertOnSubmit(
            _okReport(6001, 1, keccak256("plan-over")),
            abi.encodeWithSelector(AlphaPlanVault.TargetAboveMax.selector, 6001)
        );
        assertEq(vault.lastNonce(), 0, unicode"reject 而非夹取：状态未动");
        assertEq(router.callCount(), 0);
    }

    function test_A9_SwapCappedByMaxSwapBps() public {
        // NAV 1000 USDC 全现金，目标 6000 → 需要 600，但单次上限 50% = 500
        vm.startPrank(ALICE);
        vault.deposit(900e6, ALICE);
        vm.stopPrank();
        assertEq(vault.totalAssets(), 1000e6);

        bytes32 planHash = keccak256("plan-cap");
        bytes memory report = _okReport(6000, 1, planHash);
        bytes32 reportHash = keccak256(report);

        vm.expectEmit(true, true, true, true, address(vault));
        emit AlphaPlanVault.PlanExecuted(
            reportHash, planHash, uint64(block.timestamp), uint64(block.timestamp) + BACKEND_VALIDITY_SECONDS, 6000, 5000, 500e6, 0, 1
        );
        _submit(report);

        MockRouter.Call memory c = router.lastCall();
        assertEq(c.amountIn, 500e6, unicode"被 MAX_SWAP_BPS 截断到 500");
        assertEq(usdc.balanceOf(address(vault)), 500e6, unicode"买入后现金 500（50% NAV）");
        assertEq(vault.currentWethBps(), 5000, unicode"截断后仓位 5000，未到 6000");
        assertTrue(vault.planUsed(planHash));

        // 截断后不能用同一份计划补完（planUsed 已置位）
        _advance(60);
        _expectRevertOnSubmit(
            _okReport(6000, 2, planHash),
            abi.encodeWithSelector(AlphaPlanVault.PlanAlreadyExecuted.selector, planHash)
        );

        // 必须出一份新计划才能继续往上调
        _submit(_okReport(6000, 2, keccak256("plan-cap-2")));
        assertGt(vault.currentWethBps(), 5000);
    }

    // ==================================================================
    // A10：费率
    // ==================================================================

    function test_A10_FeeAccruesOnePeriod() public {
        assertEq(vault.balanceOf(FEE_RECIPIENT), 0);

        _advance(30 days);
        vault.accrueFee();

        // 0.1% of supply（1:1 金库，nav == supply）
        assertEq(vault.balanceOf(FEE_RECIPIENT), 100_000, "100e6 * 0.1%");
        assertEq(vault.lastFeeAccrual(), uint64(block.timestamp));
    }

    function test_A10_SameBlockNoDoubleAccrual() public {
        _advance(30 days);
        vault.accrueFee();
        uint256 afterFirst = vault.balanceOf(FEE_RECIPIENT);
        uint64 accrualAfterFirst = vault.lastFeeAccrual();

        vault.accrueFee(); // 同一区块
        assertEq(vault.balanceOf(FEE_RECIPIENT), afterFirst, unicode"同区块不重复累计");
        assertEq(vault.lastFeeAccrual(), accrualAfterFirst);

        // 差 1 秒不满一期，也不累计
        vm.warp(block.timestamp + 30 days - 1);
        feed.setAnswer(int256(PRICE));
        vault.accrueFee();
        assertEq(vault.balanceOf(FEE_RECIPIENT), afterFirst, unicode"不足一期不累计");
    }

    function test_A10_MultiPeriodIsLinearInOneCall() public {
        // 两条完全相同的金库：A 一次性补 3 期，B 分三次
        AlphaPlanVaultHarness a = _deployFreshVault();
        AlphaPlanVaultHarness b = _deployFreshVault();
        _seed(a, 100e6);
        _seed(b, 100e6);

        // B：三次 +30d
        for (uint256 i; i < 3; i++) {
            _advance(30 days);
            b.accrueFee();
        }
        uint256 feeThree = b.balanceOf(FEE_RECIPIENT);

        // A：一次性 +90d（A 的 lastFeeAccrual 还停在 90 天前）
        a.accrueFee();
        uint256 feeSingle = a.balanceOf(FEE_RECIPIENT);

        // 补收 3 期，不是只收一期
        assertEq(feeSingle, 300_000, "3 * 100e6 * 0.1%");

        // 不复利是**近似**不是恒等式：1.003000 vs 1.001^3 = 1.003003，
        // 相对差 ≈ 3.0e-6，所以断言用相对误差 ≤ 1e-5，不断言严格相等。
        uint256 growthSingle = (100e6 + feeSingle) * 1e18 / 100e6;
        uint256 growthThree = (100e6 + feeThree) * 1e18 / 100e6;
        assertApproxEqRel(growthSingle, growthThree, 0.00001e18, unicode"增长因子相对差 ≤ 1e-5");
    }

    function test_A10_RemainderIsRetained() public {
        // +45d → 1 期，余 15d
        _advance(45 days);
        vault.accrueFee();
        assertEq(vault.balanceOf(FEE_RECIPIENT), 100_000, unicode"第 1 期 = supply 的 0.1%");
        uint64 afterFirst = vault.lastFeeAccrual();

        uint256 supplyBefore = vault.totalSupply();

        // 再 +45d → 余数 15d + 45d = 60d → 2 期，累计 3 期
        _advance(45 days);
        vault.accrueFee();

        // 「余数保留」的判据：计费窗口推进了 2 期（不是 1 期，也不是 0 期）
        assertEq(vault.lastFeeAccrual(), afterFirst + 2 * vault.FEE_PERIOD(), unicode"余数保留：累计 3 期而非 2 期");

        // 每期计提恰为 supply 的 0.1%（绝对 feeShares 会因 supply 变大而等比变大）；
        // 第 2 次调用补 2 期，换算时带 ERC4626 的 +1 虚拟偏移，最多差 2 wei
        uint256 feeShares = vault.balanceOf(FEE_RECIPIENT) - 100_000;
        assertApproxEqAbs(feeShares, supplyBefore * 10 * 2 / 10_000, 2, unicode"2 期 = supply × 0.1% × 2");
    }

    /// @dev PLAN P1 第 11 步最后一条：期内存入让 totalSupply 变大，绝对 feeShares
    ///      等比变大是正确的（新资金也享用了同期管理）；不变的是老持有人的稀释比例。
    function test_A10_DilutionIsPointOnePercentPerPeriodWithNewDeposit() public {
        // 期内新存入 100e6：supply 从 100e6 变 200e6
        _advance(15 days);
        _seed(vault, 100e6);
        assertEq(vault.totalSupply(), 200e6);

        _advance(15 days);
        uint256 supplyBefore = vault.totalSupply();
        vault.accrueFee();

        uint256 feeShares = vault.balanceOf(FEE_RECIPIENT);
        // 绝对费用变大：200e6 × 0.1% = 200_000，而不是只有老资金那 100_000
        assertEq(feeShares, 200_000, unicode"绝对 feeShares 随 supply 等比变大");
        assertEq(feeShares, supplyBefore * 10 / 10_000, unicode"每期 supply 的 0.1%");

        // 老持有人被稀释的比例：feeShares / (supplyBefore + feeShares) ≈ 0.1%
        uint256 dilution = feeShares * 1e18 / (supplyBefore + feeShares);
        assertApproxEqRel(dilution, 0.001e18, 0.002e18, unicode"稀释比例 ≈ 0.1%");
    }

    function test_A10_FeeBasisIsSupplyNotAssets() public {
        // 金库里有 WETH 时 nav != supply，但费率按 supply 计（0.1% 份额）
        _mintWethToVault(0.04e18); // nav 180e6, supply 100e6
        _advance(30 days);
        vault.accrueFee();

        uint256 shares = vault.balanceOf(FEE_RECIPIENT);
        // feeAssets = 180e6*0.1% = 180_000；shares = 180_000*(100e6+1)/(180e6+1)
        assertApproxEqAbs(shares, 100_000, 2, unicode"≈0.1% of supply");
        assertGt(shares, 99_000);
    }

    // ==================================================================
    // A12 补充：owner 权限面
    // ==================================================================

    function test_A12_OwnerPowersAreOnlyPauseUnpauseAndForwarder() public {
        // 非 owner 三条全部拒绝
        vm.startPrank(ALICE);
        vm.expectRevert(AlphaPlanVault.NotOwner.selector);
        vault.pause();
        vm.expectRevert(AlphaPlanVault.NotOwner.selector);
        vault.unpause();
        vm.expectRevert(AlphaPlanVault.NotOwner.selector);
        vault.setForwarder(ALICE);
        vm.stopPrank();

        // owner 也改不了费率/收款人/依赖：这些只有 getter
        vm.startPrank(OWNER);
        vault.setForwarder(address(0x1234));
        assertEq(vault.forwarder(), address(0x1234));
        vault.pause();
        assertTrue(vault.paused());
        vault.unpause();
        assertFalse(vault.paused());
        vm.stopPrank();

        // owner 无法把金库资产转走：没有这样的函数，pause 也不影响赎回
        assertEq(vault.FEE_RECIPIENT(), FEE_RECIPIENT);
        assertEq(vault.FEE_BPS_PER_PERIOD(), 10);
    }

    function test_A12_SetForwarderRejectsZero() public {
        vm.prank(OWNER);
        vm.expectRevert(AlphaPlanVault.ZeroAddress.selector);
        vault.setForwarder(address(0));
    }

    // ==================================================================
    // A14：事件签名
    // ==================================================================

    function test_A14_EventSignatures() public pure {
        assertEq(
            AlphaPlanVault.PlanExecuted.selector,
            keccak256("PlanExecuted(bytes32,bytes32,uint64,uint64,uint16,uint16,uint256,uint256,uint64)"),
            "PlanExecuted topic0"
        );
        assertEq(
            AlphaPlanVault.PlanRecorded.selector,
            keccak256("PlanRecorded(bytes32,bytes32,uint64,uint64,uint16,uint16,uint64)"),
            "PlanRecorded topic0"
        );
    }

    function test_A14_TradePathEmitsPlanExecutedWithBothHashesIndexed() public {
        bytes32 planHash = keccak256("plan-event");
        bytes memory report = _okReport(3000, 1, planHash);

        vm.recordLogs();
        _submit(report);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        // 交易路径还会产生 ERC20 的 Approval / Transfer 日志（本次共 4 条），
        // 所以不能按下标取，必须挑出 PlanExecuted 那一条。
        Vm.Log memory ev;
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == AlphaPlanVault.PlanExecuted.selector) {
                ev = logs[i];
                found = true;
            }
        }
        assertTrue(found, unicode"必须发出 PlanExecuted");
        assertEq(ev.topics.length, 3, unicode"reportHash 与 planHash 都 indexed");
        assertEq(ev.topics[1], keccak256(report));
        assertEq(ev.topics[2], planHash);

        (uint64 asOf, uint64 validUntil, uint16 target, uint16 actual, uint256 usdcIn, uint256 wethIn, uint64 nonce) =
            abi.decode(ev.data, (uint64, uint64, uint16, uint16, uint256, uint256, uint64));
        assertEq(asOf, uint64(block.timestamp), unicode"事件的 asOf == 报告里的 asOf");
        assertEq(validUntil, asOf + BACKEND_VALIDITY_SECONDS, unicode"validUntil == asOf + validitySeconds");
        assertEq(target, 3000);
        assertEq(actual, 3000, unicode"成交后仓位达到目标");
        assertEq(usdcIn, 30e6);
        assertEq(wethIn, 0);
        assertEq(nonce, 1);
    }

    /// @dev 在已记录的日志里找指定 topic0 的那一条
    function _logByTopic(bytes32 topic0) internal returns (Vm.Log memory ev) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == topic0) {
                ev = logs[i];
                found = true;
            }
        }
        assertTrue(found, unicode"没找到目标事件");
    }

    // 事件里必须带报告自己的 asOf / validUntil（不是 block.timestamp），
    // 否则前端 E4-②/E4-③ 在链上无数据可校。
    function test_A14_PlanExecutedCarriesReportAsOfAndValidUntil() public {
        uint64 asOf = uint64(block.timestamp) - 300;
        uint64 validUntil = asOf + BACKEND_VALIDITY_SECONDS;
        bytes memory report =
            _report(address(vault), asOf, validUntil, 1, 3000, keccak256("plan-asof-trade"));

        vm.recordLogs();
        _submit(report);
        Vm.Log memory ev = _logByTopic(AlphaPlanVault.PlanExecuted.selector);

        (uint64 evAsOf, uint64 evValidUntil,,,,,) =
            abi.decode(ev.data, (uint64, uint64, uint16, uint16, uint256, uint256, uint64));
        assertEq(evAsOf, asOf, unicode"事件 asOf == 报告 asOf");
        assertEq(evValidUntil, validUntil, unicode"事件 validUntil == 报告 validUntil");
        assertEq(evValidUntil, evAsOf + BACKEND_VALIDITY_SECONDS, unicode"asOf + validitySeconds(900)");
        assertNotEq(evAsOf, uint64(block.timestamp), unicode"带的是报告 asOf，不是 now");
    }

    function test_A14_PlanRecordedCarriesReportAsOfAndValidUntil() public {
        _mintWethToVault(0.04e18); // actual 4444 bps，目标 4500 → 容差内
        uint64 asOf = uint64(block.timestamp) - 300;
        uint64 validUntil = asOf + BACKEND_VALIDITY_SECONDS;
        bytes memory report =
            _report(address(vault), asOf, validUntil, 1, 4500, keccak256("plan-asof-record"));

        vm.recordLogs();
        _submit(report);
        Vm.Log memory ev = _logByTopic(AlphaPlanVault.PlanRecorded.selector);

        (uint64 evAsOf, uint64 evValidUntil, uint16 target, uint16 actual, uint64 nonce) =
            abi.decode(ev.data, (uint64, uint64, uint16, uint16, uint64));
        assertEq(evAsOf, asOf, unicode"容差路径也带 asOf");
        assertEq(evValidUntil, validUntil, unicode"容差路径也带 validUntil");
        assertEq(evValidUntil, evAsOf + BACKEND_VALIDITY_SECONDS, unicode"asOf + validitySeconds(900)");
        assertEq(target, 4500);
        assertEq(actual, 4444);
        assertEq(nonce, 1);
        assertEq(router.callCount(), 0, unicode"容差路径不交易");
    }

    // ==================================================================
    // A15：报告 ABI（6 字段，含 asOf）
    // ==================================================================

    function test_A15_ReportAbiOrder() public {
        // 正确顺序 (address,uint64,uint64,uint64,uint16,bytes32) → 通过
        bytes memory ok = abi.encode(
            address(vault), uint64(block.timestamp), uint64(block.timestamp) + 900, uint64(1), uint16(3000), keccak256("p")
        );
        _submit(ok);
        assertEq(vault.lastNonce(), 1);

        // 错位：把 nonce 放进第一槽 → 第一槽解成 address 不是本合约
        bytes memory wrong = abi.encode(
            uint64(2), uint64(block.timestamp), uint64(block.timestamp) + 900, uint64(2), uint16(3000), keccak256("q")
        );
        _expectRevertOnSubmit(wrong, abi.encodeWithSelector(AlphaPlanVault.WrongVault.selector));
    }

    // ==================================================================
    // 其他：lastPlan 视图
    // ==================================================================

    function test_LastPlanView() public {
        bytes32 planHash = keccak256("plan-view");
        _submit(_okReport(3000, 1, planHash));
        (bytes32 h, uint16 target, uint64 nonce) = vault.lastPlan();
        assertEq(h, planHash);
        assertEq(target, 3000);
        assertEq(nonce, 1);
    }

    // ==================================================================
    // A11b / A11c / A11d / A11e：赎回时自动卖 WETH
    // ==================================================================

    function test_A11b_EnoughCashNeverTouchesRouter() public {
        vm.recordLogs();
        vm.prank(ALICE);
        vault.redeem(50e6, ALICE, ALICE);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(router.callCount(), 0, unicode"现金够时绝不碰 router");
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != AlphaPlanVault.LiquiditySold.selector, unicode"不应发 LiquiditySold");
        }
    }

    function test_A11b_AutoSellsExactlyShortfall() public {
        _mintWethToVault(0.04e18); // nav 180e6, actual 4444 bps
        uint256 assets = vault.previewRedeem(60e6);
        assertApproxEqAbs(assets, 108e6, 1, unicode"≈108 USDC");
        uint256 shortfall = assets - usdc.balanceOf(address(vault));
        assertApproxEqAbs(shortfall, 8e6, 1);

        vm.recordLogs();
        vm.prank(ALICE);
        uint256 got = vault.redeem(60e6, ALICE, ALICE);

        assertEq(got, assets, unicode"用户拿到 previewRedeem 承诺的数量");
        assertEq(router.callCount(), 1, unicode"只需卖一次");
        MockRouter.Call memory c = router.lastCall();
        assertEq(c.tokenIn, address(weth));
        assertEq(c.tokenOut, address(usdc));
        // amountIn == ceilDiv(shortfall * 1e20, price)，不多卖一 wei
        assertEq(c.amountIn, (shortfall * 1e20 + PRICE - 1) / PRICE, unicode"ceilDiv(shortfall*1e20, price)");
        assertEq(usdc.balanceOf(address(vault)), 0, unicode"卖出后金库 USDC 恰好清零（不留零头）");

        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory ev;
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == AlphaPlanVault.LiquiditySold.selector) {
                ev = logs[i];
                found = true;
            }
        }
        assertTrue(found, unicode"必须发 LiquiditySold");
        assertEq(ev.topics[1], bytes32(uint256(uint160(ALICE))), unicode"forHolder indexed");
        (uint256 wethIn, uint256 usdcOut, uint256 shares, uint64 ts) =
            abi.decode(ev.data, (uint256, uint256, uint256, uint64));
        assertEq(wethIn, c.amountIn);
        assertEq(usdcOut, shortfall, unicode"proceeds 恰 == shortfall");
        assertEq(shares, 60e6);
        assertEq(ts, uint64(block.timestamp));
    }

    function test_A11e_MinOutIsExactWithSlippageBps() public {
        _mintWethToVault(0.04e18);
        vm.prank(ALICE);
        vault.redeem(60e6, ALICE, ALICE);

        MockRouter.Call memory c = router.lastCall();
        uint256 expectedOut = c.amountIn * PRICE / 1e20;
        assertEq(c.amountOutMinimum, expectedOut * (BPS - 50) / BPS, unicode"精确到取整方向");
    }

    function test_A11e_AmountOutEqualToMinOutStillSucceeds() public {
        _mintWethToVault(0.04e18);
        // 成交价恰好等于 minOut（滑点用满 50bps）
        router.setRateBps(9950);

        vm.prank(ALICE);
        vault.redeem(60e6, ALICE, ALICE);
        assertLe(usdc.balanceOf(address(vault)), 1, unicode"补卖后仍然凑齐，不留零头");
        assertGt(router.callCount(), 1, unicode"第一笔正好等于 minOut，需要补卖差额");
    }

    function test_A11e_PoolUnderfillsMinOutReverts() public {
        _mintWethToVault(0.04e18);
        router.setRateBps(9800); // 2% > SLIPPAGE_BPS 50bps → 第一笔就低于 minOut
        vm.prank(ALICE);
        vm.expectPartialRevert(MockRouter.InsufficientOutput.selector);
        vault.redeem(60e6, ALICE, ALICE);
    }

    function test_A11d_RevertsWithCustomErrorWhenWethCannotCover() public {
        _mintWethToVault(0.04e18); // cash 100e6 + WETH 80e6 = nav 180e6
        uint256 assets = vault.previewRedeem(100e6);
        uint256 cash = usdc.balanceOf(address(vault));
        uint256 wethValue = 80e6;
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(AlphaPlanVault.InsufficientLiquidity.selector, assets, cash, wethValue)
        );
        vault.redeem(100e6, ALICE, ALICE);
    }

    // A11g：卖光 WETH 也不够时，预检必须在下单**之前**拦住，一个 swap 都不能发生
    function test_A11g_NoSwapWhenWethCannotCover() public {
        _mintWethToVault(0.04e18); // 现金 100e6 + WETH 值 80e6 → nav 180e6

        uint256 assets = vault.previewRedeem(100e6); // ≈179,999,999
        uint256 cash = usdc.balanceOf(address(vault)); // 100e6
        uint256 wethValue = 80e6;
        uint256 realizable = wethValue * (BPS - 50) / BPS; // 79.6e6
        assertLt(cash + realizable, assets, unicode"前置：卖光也不够");

        uint256 supplyBefore = vault.totalSupply();
        uint256 sharesBefore = vault.balanceOf(ALICE);
        uint256 wethBefore = weth.balanceOf(address(vault));

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(AlphaPlanVault.InsufficientLiquidity.selector, assets, cash, wethValue)
        );
        vault.redeem(100e6, ALICE, ALICE);

        assertEq(router.callCount(), 0, unicode"预检在 for 循环之前：不白跑 swap");
        assertEq(vault.totalSupply(), supplyBefore, unicode"份额未销毁");
        assertEq(vault.balanceOf(ALICE), sharesBefore, unicode"用户份额不变");
        assertEq(weth.balanceOf(address(vault)), wethBefore, unicode"WETH 未动");
    }

    function test_A11b_WithdrawPathAlsoAutoSells() public {
        _mintWethToVault(0.04e18);
        uint256 cashBefore = usdc.balanceOf(address(vault));
        vm.prank(ALICE);
        vault.withdraw(108e6, ALICE, ALICE);
        assertEq(usdc.balanceOf(address(vault)), 0);
        assertGt(router.callCount(), 0, unicode"withdraw 也走自动卖币");
        assertGt(cashBefore, 0);
    }

    function test_A11_PausedAutoSellStillWorks() public {
        _mintWethToVault(0.04e18);
        vm.prank(OWNER);
        vault.pause();

        vm.prank(ALICE);
        uint256 got = vault.redeem(60e6, ALICE, ALICE);
        assertApproxEqAbs(got, 108e6, 1, unicode"paused 下自动卖币赎回仍然成功");
        assertEq(router.callCount(), 1);
    }

    // A11c：视图保守回退到「现金能覆盖的部分」
    function test_A11c_MaxWithdrawAndMaxRedeemCappedByCash() public {
        _mintWethToVault(0.04e18); // nav 180e6，现金 100e6
        assertEq(vault.maxWithdraw(ALICE), 100e6, unicode"maxWithdraw = 现金");
        uint256 maxShares = vault.maxRedeem(ALICE);
        assertEq(maxShares, vault.convertToShares(100e6));
        assertLt(maxShares, vault.balanceOf(ALICE), unicode"不等于全部份额");

        // 视图形状：现金为 0 时返回 0，不 revert
        vm.prank(ALICE);
        vault.redeem(maxShares, ALICE, ALICE);
        uint256 left = usdc.balanceOf(address(vault));
        assertLe(left, 2, unicode"只可能剩换算 dust");
        assertEq(vault.maxWithdraw(ALICE), left, unicode"maxWithdraw 退回到剩余现金");
        assertLe(vault.maxRedeem(ALICE), 1, unicode"只剩 dust 能换");
    }

    // A9b：target == 0 是清仓（不留 dust），之后全额赎回不需要再卖币
    function test_A9b_TargetZeroLiquidatesEverythingThenFullRedeem() public {
        _mintWethToVault(0.04e18); // nav 180e6, actual 4444
        _submit(_okReport(0, 1, keccak256("plan-flat")));

        assertEq(weth.balanceOf(address(vault)), 0, unicode"清仓不留 dust");
        assertEq(vault.currentWethBps(), 0);
        uint256 cash = usdc.balanceOf(address(vault));
        uint256 nav = vault.totalAssets();
        assertEq(cash, nav, unicode"现金 == NAV");

        uint256 callsBefore = router.callCount();
        uint256 promised = vault.previewRedeem(100e6);
        vm.prank(ALICE);
        uint256 got = vault.redeem(100e6, ALICE, ALICE);
        assertEq(got, promised, unicode"全额赎回（按 previewRedeem 的口径）");
        assertEq(router.callCount(), callsBefore, unicode"清仓后赎回不需要再卖币");
        assertLe(usdc.balanceOf(address(vault)), 1, unicode"只可能是 ERC4626 的 1 单位 dust");
    }

    // A9c：清仓时把 50% 上限罚下的 dust 一并卖掉，否则全额赎回会差几个最小单位
    function test_A9c_FlatPlanSweepsDustSoFullRedeemWorks() public {
        // 现金 100e6 + 0.0501 WETH → nav 200.2e6，actual = 5004 bps > MAX_SWAP_BPS
        _mintWethToVault(0.0501e18);
        assertGt(vault.currentWethBps(), vault.MAX_SWAP_BPS());

        _submit(_okReport(0, 1, keccak256("plan-flat-dust")));
        assertEq(weth.balanceOf(address(vault)), 0, unicode"dust 被一并卖掉");

        uint256 promised = vault.previewRedeem(100e6);
        vm.prank(ALICE);
        uint256 got = vault.redeem(100e6, ALICE, ALICE);
        assertEq(got, promised, unicode"清仓后全额赎回成功");
        assertLe(usdc.balanceOf(address(vault)), 2, unicode"只可能剩换算 dust");
    }

    // ==================================================================
    // 工具：全新空金库
    // ==================================================================

    /// @dev 给一个金库入 100e6（1:1）
    function _seed(AlphaPlanVaultHarness v, uint256 amount) internal {
        usdc.mint(ALICE, amount);
        vm.startPrank(ALICE);
        usdc.approve(address(v), type(uint256).max);
        v.deposit(amount, ALICE);
        vm.stopPrank();
    }

    function _deployFreshVault() internal returns (AlphaPlanVaultHarness fresh) {
        fresh = new AlphaPlanVaultHarness(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            AggregatorV3Interface(address(feed)),
            ISwapRouter(address(router)),
            POOL_FEE,
            FEE_RECIPIENT,
            FORWARDER,
            OWNER
        );
    }
}

