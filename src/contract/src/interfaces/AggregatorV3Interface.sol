// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Chainlink AggregatorV3Interface
/// @notice 只声明金库用得到的部分。Chainlink 官方接口的完整副本，
///         刻意不引入 chainlink 的 npm 包（会带进一整个依赖树）。
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function getRoundData(uint80 _roundId)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
