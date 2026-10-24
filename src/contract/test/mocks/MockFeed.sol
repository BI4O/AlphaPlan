// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

/// @notice 可控的 Chainlink feed。默认一条新鲜、已应答的 round。
contract MockFeed is AggregatorV3Interface {
    uint8 public immutable override decimals;
    string public override description = "MOCK / USD";

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _answeredInRound;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        _roundId = 1;
        _answeredInRound = 1;
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    /// @notice 换价并把 round 推进到当前区块时间（= 刷新新鲜度）
    function setAnswer(int256 answer_) external {
        _roundId += 1;
        _answeredInRound = _roundId;
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    /// @notice 换价但**不**刷新时间戳，用来构造"陈旧"场景
    function setAnswerKeepingTimestamp(int256 answer_) external {
        _answer = answer_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    function setRoundData(uint80 roundId_, int256 answer_, uint256 updatedAt_, uint80 answeredInRound_)
        external
    {
        _roundId = roundId_;
        _answer = answer_;
        _updatedAt = updatedAt_;
        _answeredInRound = answeredInRound_;
    }

    function getRoundData(uint80)
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _answeredInRound);
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _answeredInRound);
    }

    function version() external pure returns (uint256) {
        return 4;
    }
}
