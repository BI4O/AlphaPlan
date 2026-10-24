// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @title MockAggregator
/// @notice demo 用的可控 ETH/USD feed。**不参与单元测试**（那些用 test/mocks/MockFeed.sol）。
/// @dev 存在理由（实测，不是猜）：Base Sepolia 的 ETH/USD feed 在
///      **合约上下文**里调用 `latestRoundData()` 会 revert `"No access"`
///      （直接 `cast call --from <某地址>` 能读到值，但由合约内部发起就失败）。
///      金库的 NAV 必须在合约里算，所以 demo 用 `anvil_setCode` 把这个 mock 的
///      runtime bytecode 塞到真 feed 地址上，让金库能读到价格。
///
///      存储布局刻意固定成下面前三个 slot，方便 `anvil_setStorageAt`：
///        slot 0 = int256  answer      （8 位小数）
///        slot 1 = uint8   decimals
///        slot 2 = uint256 updatedAt
///        slot 3 = int256  answer24h   （24h 前的价格，也 8 位小数）
///        slot 4 = uint256 updatedAt24h（24h 前的 round 时间戳）
///      前三个 slot 的语义不变（向后兼容既有脚本）；新增的两条只用于让
///      `getRoundData(0)` 能答出一个「24 小时前」的 round —— 后端要算 24h 涨跌幅，
///      否则计划永远是 degraded:true（PRD §7.2 的定义）。
///      所以**不要重排状态变量，也不要给它们加前置变量**。
///
///      round id 语义：最新 round 用一个**大于 1** 的合成 id，这样后端的二分
///      搜索（lo = latest - window, hi = latest - 1）才有搜索空间。
///      若 latest 返回 1，则 hi = 0 < lo = 1，循环根本不跑，永远拿不到 24h 前。
///
///      改价三步（script/demo-bump-price.sh 就是这三步）：
///        1. anvil_setStorageAt <feed> 0x00..00 <answer>
///        2. anvil_setStorageAt <feed> 0x00..02 <block.timestamp>   ← 必须同步，否则陈旧检查 revert
///        （decimals 只在首次 setCode 时写一次）
contract MockAggregator is AggregatorV3Interface {
    int256 private _answer; // slot 0
    uint8 private _decimals; // slot 1
    uint256 private _updatedAt; // slot 2
    int256 private _answer24h; // slot 3 — round 0 的价格（24h 前）
    uint256 private _updatedAt24h; // slot 4 — round 0 的时间戳（24h 前）

    /// @dev Synthetic ids: real aggregators start near 1 and grow with every
    ///      update, giving callers a monotonic (roundId -> updatedAt) mapping to
    ///      binary-search over. A mock that always answers round 1 has no history
    ///      to search, so we publish ids in a range wide enough for the backend's
    ///      5000-round window and split it at the 24h point.
    uint80 private constant LATEST_ROUND_ID = 5000;
    uint80 private constant HISTORY_ROUND_ID = 4000;

    constructor(int256 answer_, uint8 decimals_) {
        _answer = answer_;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
        // Round 0 defaults to "unknown": a zero timestamp makes the backend treat
        // it as pruned, which is the honest state until demo-up.sh writes a real
        // 24h history point.
        _answer24h = 0;
        _updatedAt24h = 0;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external pure override returns (string memory) {
        return "MOCK / USD (demo)";
    }

    function version() external pure override returns (uint256) {
        return 4;
    }

    function latestAnswer() external view returns (int256) {
        return _answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return _updatedAt;
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (LATEST_ROUND_ID, _answer, _updatedAt, _updatedAt, LATEST_ROUND_ID);
    }

    /// @dev Round ids at or below `HISTORY_ROUND_ID` answer with the synthetic
    ///      "24h ago" point; ids above it answer with the latest point. That gives
    ///      the backend's binary search a monotonic (roundId -> updatedAt) mapping
    ///      to converge on, which is exactly what a real aggregator provides.
    ///
    ///      A zero `_updatedAt24h` means "no history": we revert the way a pruned
    ///      round does, so the backend falls back to its cache instead of inventing
    ///      a change percentage.
    function getRoundData(uint80 roundId_)
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        if (roundId_ <= HISTORY_ROUND_ID) {
            require(_updatedAt24h != 0, "No data present");
            return (roundId_, _answer24h, _updatedAt24h, _updatedAt24h, roundId_);
        }
        return (roundId_, _answer, _updatedAt, _updatedAt, roundId_);
    }
}
