// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "../../src/interfaces/ISwapRouter.sol";

/// @notice 可控的 Uniswap V3 SwapRouter02。
///         它**真的搬钱**（按 oracle 价 × rateBps 成交，成交价不足 minOut 就 revert），
///         所以测试里"买入后现金还剩多少"是真实余额，不是记账。
contract MockRouter is ISwapRouter {
    struct Call {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    address public immutable USDC;
    address public immutable WETH;

    /// @notice 8 位小数的 ETH/USD，和合约用的是同一个价
    uint256 public price;
    /// @notice 相对 oracle 价的成交比例，10_000 = 平价（默认）
    uint256 public rateBps = 10_000;
    /// @notice 强制 revert，用来测"router 挂了"的路径
    bool public forceRevert;

    Call[] private _calls;

    error InsufficientOutput(uint256 amountOut, uint256 amountOutMinimum);

    constructor(address usdc_, address weth_, uint256 price_) {
        USDC = usdc_;
        WETH = weth_;
        price = price_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function setRateBps(uint256 rateBps_) external {
        rateBps = rateBps_;
    }

    function setForceRevert(bool v) external {
        forceRevert = v;
    }

    function callCount() external view returns (uint256) {
        return _calls.length;
    }

    function callAt(uint256 i) external view returns (Call memory) {
        return _calls[i];
    }

    function lastCall() external view returns (Call memory) {
        return _calls[_calls.length - 1];
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        _calls.push(
            Call({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: params.fee,
                recipient: params.recipient,
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMinimum,
                sqrtPriceLimitX96: params.sqrtPriceLimitX96
            })
        );

        require(!forceRevert, "MockRouter: forced revert");

        // 与合约同一套精度口径：USDC 6dec / WETH 18dec / price 8dec
        uint256 expected = params.tokenIn == USDC
            ? params.amountIn * 1e20 / price
            : params.amountIn * price / 1e20;

        amountOut = expected * rateBps / 10_000;
        if (amountOut < params.amountOutMinimum) {
            revert InsufficientOutput(amountOut, params.amountOutMinimum);
        }

        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}
