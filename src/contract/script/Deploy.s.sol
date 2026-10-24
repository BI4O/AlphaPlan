// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AlphaPlanVault} from "../src/AlphaPlanVault.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";

/// @notice P4：部署 AlphaPlanVault。
/// @dev 地址全部来自 `docs/PRD.md` §10 的 Base Sepolia 实测表（chainId 84532）。
///      anvil 用 `--fork-url https://sepolia.base.org` 时 chainId 也是 84532，
///      所以同一份脚本在 fork 和真链上都能跑，不需要改地址。
///
///      用法（fork，不花 gas）：
///        anvil --fork-url https://sepolia.base.org --port 8545
///        forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 \
///          --broadcast --private-key <anvil 默认 account0 私钥>
///
///      可选环境变量（都有默认值，默认即可跑）：
///        DEPLOYER       部署者地址，默认 = `msg.sender`
///        VAULT_OWNER    合约 owner，默认 = DEPLOYER
///        FEE_RECIPIENT  管理费收款地址，默认 = DEPLOYER
///        FORWARDER      CRE forwarder，默认 = MockKeystoneForwarder（PRD §10）
///
///      **私钥不进仓库**：只用 `--private-key` / keystore 传，脚本里不读私钥。
contract Deploy is Script {
    // —— Base Sepolia 实测地址（PRD §10）——
    address internal constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant ETH_USD_FEED = 0xa24A68DD788e1D7eb4CA517765CFb2b7e217e7a3;
    address internal constant SWAP_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;
    /// @dev PRD §10：mock forwarder（`--broadcast` 走它；生产换成 0xF8344CFd…）
    address internal constant MOCK_KEYSTONE_FORWARDER = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;

    /// @dev PRD §10：USDC/WETH 3000 池更深，默认用它
    uint24 internal constant POOL_FEE = 3000;

    function run() external returns (AlphaPlanVault vault) {
        address deployer = vm.envOr("DEPLOYER", msg.sender);
        address vaultOwner = vm.envOr("VAULT_OWNER", deployer);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address forwarder = vm.envOr("FORWARDER", MOCK_KEYSTONE_FORWARDER);

        console.log("deployer (msg.sender)", deployer);
        console.log("tx.origin", tx.origin);
        console.log("chainId", block.chainid);

        vm.startBroadcast();
        vault = new AlphaPlanVault(
            IERC20(USDC),
            IERC20(WETH),
            AggregatorV3Interface(ETH_USD_FEED),
            ISwapRouter(SWAP_ROUTER),
            POOL_FEE,
            feeRecipient,
            forwarder,
            vaultOwner
        );
        vm.stopBroadcast();

        console.log("VAULT", address(vault));
        console.log("DEPLOY_BLOCK", block.number);
    }
}
