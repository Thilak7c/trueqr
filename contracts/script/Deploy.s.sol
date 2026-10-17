// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {QRRegistry} from "../src/QRRegistry.sol";

contract Deploy is Script {
    function run() external returns (QRRegistry reg) {
        require(block.chainid == 97, "testnet only");
        address[] memory registrars = new address[](1);
        registrars[0] = vm.envAddress("RELAYER_ADDRESS");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        reg = new QRRegistry(vm.envAddress("SENTINEL_ADDRESS"), registrars);
        vm.stopBroadcast();
        console.log("QRRegistry", address(reg));
        console.log("deployBlock", reg.deployBlock());
    }
}
