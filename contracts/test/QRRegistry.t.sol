// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {QRRegistry} from "../src/QRRegistry.sol";

contract QRRegistryTest is Test {
    QRRegistry reg;
    address agent = makeAddr("sentinel");
    address relayer = makeAddr("relayer");
    address relayer2 = makeAddr("relayer2");
    address rando = makeAddr("rando");
    bytes32 constant H1 = keccak256("qr-one");
    bytes32 constant H2 = keccak256("qr-two");
    bytes32 constant H3 = keccak256("qr-three");

    event StallRegistered(uint256 indexed id, bytes32 indexed qrHash, int32 latE6, int32 lngE6, string name);
    event QrUpdated(uint256 indexed id, bytes32 oldHash, bytes32 newHash);
    event MismatchReported(uint256 indexed stallId, bytes32 indexed scannedQrHash, address reporter);
    event Blacklisted(bytes32 indexed qrHash, string reason);
    event BlacklistRemoved(bytes32 indexed qrHash, string reason);

    function setUp() public {
        vm.roll(42);
        address[] memory rs = new address[](2);
        rs[0] = relayer;
        rs[1] = relayer2;
        reg = new QRRegistry(agent, rs);
    }

    function _register(bytes32 h) internal returns (uint256) {
        vm.prank(relayer);
        return reg.registerStall(h, "Mak Cik Nasi Lemak", 3_139_000, 101_686_000, "https://x/p.jpg", "ms");
    }

    // --- constructor / IDs ---

    function test_constructor() public view {
        assertEq(reg.deployBlock(), 42);
        assertEq(reg.agent(), agent);
        assertTrue(reg.registrars(relayer));
        assertTrue(reg.registrars(relayer2));
        assertFalse(reg.registrars(rando));
        assertEq(reg.nextStallId(), 1);
    }

    function test_idsStartAtOne() public {
        assertEq(_register(H1), 1);
        assertEq(_register(H2), 2);
        assertEq(reg.stallByQr(H1), 1);
        assertEq(reg.stallByQr(H3), 0);
    }

    function test_registerStoresStall() public {
        vm.warp(1_700_000_000);
        uint256 id = _register(H1);
        QRRegistry.Stall memory s = reg.getStall(id);
        assertEq(s.registrar, relayer);
        assertEq(s.qrHash, H1);
        assertEq(s.name, "Mak Cik Nasi Lemak");
        assertEq(s.latE6, 3_139_000);
        assertEq(s.lngE6, 101_686_000);
        assertEq(s.photoURI, "https://x/p.jpg");
        assertEq(s.lang, "ms");
        assertEq(s.registeredAt, 1_700_000_000);
        assertTrue(s.active);
    }

    function test_negativeCoords() public {
        vm.prank(relayer);
        uint256 id = reg.registerStall(H1, "S", -33_868_800, -151_209_300, "", "en");
        assertEq(reg.getStall(id).latE6, -33_868_800);
        assertEq(reg.getStall(id).lngE6, -151_209_300);
    }

    // --- register rules ---

    function test_duplicateHashReverts() public {
        _register(H1);
        vm.prank(relayer2);
        vm.expectRevert(QRRegistry.QrTaken.selector);
        reg.registerStall(H1, "Copy", 0, 0, "", "en");
    }

    function test_blacklistedHashCantRegister() public {
        vm.prank(agent);
        reg.confirmBlacklist(H1, "scam");
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.QrBlacklisted.selector);
        reg.registerStall(H1, "S", 0, 0, "", "en");
    }

    // --- updateQr / deactivate ---

    function test_updateQrMovesStallByQr() public {
        uint256 id = _register(H1);
        vm.expectEmit(true, false, false, true);
        emit QrUpdated(id, H1, H2);
        vm.prank(relayer);
        reg.updateQr(id, H2);
        assertEq(reg.stallByQr(H1), 0);
        assertEq(reg.stallByQr(H2), id);
        assertEq(reg.getStall(id).qrHash, H2);
        // old hash is free again
        assertEq(_register(H1), 2);
    }

    function test_updateQrRejectsTakenOrBlacklisted() public {
        uint256 id = _register(H1);
        _register(H2);
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.QrTaken.selector);
        reg.updateQr(id, H2);

        vm.prank(agent);
        reg.confirmBlacklist(H3, "scam");
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.QrBlacklisted.selector);
        reg.updateQr(id, H3);
    }

    function test_deactivate() public {
        uint256 id = _register(H1);
        vm.prank(relayer);
        reg.deactivate(id);
        assertFalse(reg.getStall(id).active);
        assertEq(reg.stallByQr(H1), 0);
    }

    function test_updateQrOnDeactivatedStallDoesNotRelink() public {
        uint256 id = _register(H1);
        vm.startPrank(relayer);
        reg.deactivate(id);
        reg.updateQr(id, H2);
        vm.stopPrank();
        assertEq(reg.stallByQr(H2), 0);
    }

    // --- access control on every write ---

    function test_registerOnlyRegistrar() public {
        vm.prank(rando);
        vm.expectRevert(QRRegistry.NotRegistrar.selector);
        reg.registerStall(H1, "S", 0, 0, "", "en");
        vm.prank(agent);
        vm.expectRevert(QRRegistry.NotRegistrar.selector);
        reg.registerStall(H1, "S", 0, 0, "", "en");
    }

    function test_updateQrOnlyStallRegistrar() public {
        uint256 id = _register(H1);
        vm.prank(relayer2); // a registrar, but not this stall's
        vm.expectRevert(QRRegistry.NotStallRegistrar.selector);
        reg.updateQr(id, H2);
        vm.prank(rando);
        vm.expectRevert(QRRegistry.NotStallRegistrar.selector);
        reg.updateQr(id, H2);
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.NoSuchStall.selector);
        reg.updateQr(99, H2);
    }

    function test_deactivateOnlyStallRegistrar() public {
        uint256 id = _register(H1);
        vm.prank(relayer2);
        vm.expectRevert(QRRegistry.NotStallRegistrar.selector);
        reg.deactivate(id);
        vm.prank(rando);
        vm.expectRevert(QRRegistry.NotStallRegistrar.selector);
        reg.deactivate(id);
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.NoSuchStall.selector);
        reg.deactivate(99);
    }

    function test_reportMismatchOnlyRegistrar() public {
        uint256 id = _register(H1);
        vm.prank(rando);
        vm.expectRevert(QRRegistry.NotRegistrar.selector);
        reg.reportMismatch(id, H2);
    }

    function test_reportMismatchStallMustExist() public {
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.NoSuchStall.selector);
        reg.reportMismatch(1, H2);
    }

    function test_confirmBlacklistOnlyAgent() public {
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.NotAgent.selector);
        reg.confirmBlacklist(H1, "x");
        vm.prank(rando);
        vm.expectRevert(QRRegistry.NotAgent.selector);
        reg.confirmBlacklist(H1, "x");
    }

    function test_removeBlacklistOnlyAgent() public {
        vm.prank(relayer);
        vm.expectRevert(QRRegistry.NotAgent.selector);
        reg.removeBlacklist(H1, "x");
    }

    // --- events ---

    function test_eventStallRegistered() public {
        vm.expectEmit(true, true, false, true);
        emit StallRegistered(1, H1, 3_139_000, 101_686_000, "Mak Cik Nasi Lemak");
        _register(H1);
    }

    function test_eventMismatchReported() public {
        uint256 id = _register(H1);
        vm.expectEmit(true, true, false, true);
        emit MismatchReported(id, H2, relayer2);
        vm.prank(relayer2);
        reg.reportMismatch(id, H2);
    }

    function test_blacklistRoundTripAndEvents() public {
        vm.expectEmit(true, false, false, true);
        emit Blacklisted(H1, "Owner family confirmed not their QR at stall 1");
        vm.prank(agent);
        reg.confirmBlacklist(H1, "Owner family confirmed not their QR at stall 1");
        assertTrue(reg.blacklisted(H1));

        vm.expectEmit(true, false, false, true);
        emit BlacklistRemoved(H1, "owner appeal");
        vm.prank(agent);
        reg.removeBlacklist(H1, "owner appeal");
        assertFalse(reg.blacklisted(H1));
        // reversible: can register again
        assertEq(_register(H1), 1);
    }
}
