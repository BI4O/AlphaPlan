// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Uniswap V3 SwapRouter02 的最小接口
/// @notice 只声明金库用到的 `exactInputSingle`。Base Sepolia 上部署的是
///         SwapRouter02（`0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`），
///         它的 `ExactInputSingleParams` **没有 deadline 字段** —— 这是与
///         初代 SwapRouter 的唯一差别，多写一个字段会算错 selector。
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
