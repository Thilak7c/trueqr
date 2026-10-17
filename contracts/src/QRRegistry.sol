// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Fingerprint registry for hawker DuitNow QRs. Stores keccak256(qr text) only, never the QR itself.
contract QRRegistry {
    struct Stall {
        address registrar;
        bytes32 qrHash;
        string name;
        int32 latE6;
        int32 lngE6;
        string photoURI;
        string lang;
        uint64 registeredAt;
        bool active;
    }

    uint256 public immutable deployBlock;
    address public immutable agent;
    mapping(address => bool) public registrars;
    uint256 public nextStallId = 1;
    mapping(uint256 => Stall) internal stalls;
    mapping(bytes32 => uint256) public stallByQr;
    mapping(bytes32 => bool) public blacklisted;

    event StallRegistered(uint256 indexed id, bytes32 indexed qrHash, int32 latE6, int32 lngE6, string name);
    event QrUpdated(uint256 indexed id, bytes32 oldHash, bytes32 newHash);
    event MismatchReported(uint256 indexed stallId, bytes32 indexed scannedQrHash, address reporter);
    event Blacklisted(bytes32 indexed qrHash, string reason);
    event BlacklistRemoved(bytes32 indexed qrHash, string reason);

    error NotRegistrar();
    error NotAgent();
    error NotStallRegistrar();
    error NoSuchStall();
    error QrTaken();
    error QrBlacklisted();

    modifier onlyRegistrar() {
        if (!registrars[msg.sender]) revert NotRegistrar();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier onlyStallRegistrar(uint256 id) {
        if (stalls[id].registrar == address(0)) revert NoSuchStall();
        if (stalls[id].registrar != msg.sender) revert NotStallRegistrar();
        _;
    }

    constructor(address agent_, address[] memory registrars_) {
        deployBlock = block.number;
        agent = agent_;
        for (uint256 i; i < registrars_.length; i++) registrars[registrars_[i]] = true;
    }

    function registerStall(
        bytes32 qrHash,
        string calldata name,
        int32 latE6,
        int32 lngE6,
        string calldata photoURI,
        string calldata lang
    ) external onlyRegistrar returns (uint256 id) {
        _checkFree(qrHash);
        id = nextStallId++;
        stalls[id] = Stall(msg.sender, qrHash, name, latE6, lngE6, photoURI, lang, uint64(block.timestamp), true);
        stallByQr[qrHash] = id;
        emit StallRegistered(id, qrHash, latE6, lngE6, name);
    }

    function updateQr(uint256 id, bytes32 newHash) external onlyStallRegistrar(id) {
        _checkFree(newHash);
        bytes32 oldHash = stalls[id].qrHash;
        delete stallByQr[oldHash];
        stalls[id].qrHash = newHash;
        if (stalls[id].active) stallByQr[newHash] = id;
        emit QrUpdated(id, oldHash, newHash);
    }

    /// @dev Also frees the QR hash so a deactivated stall no longer vouches for it.
    function deactivate(uint256 id) external onlyStallRegistrar(id) {
        stalls[id].active = false;
        delete stallByQr[stalls[id].qrHash];
    }

    function reportMismatch(uint256 stallId, bytes32 scannedQrHash) external onlyRegistrar {
        if (stalls[stallId].registrar == address(0)) revert NoSuchStall();
        emit MismatchReported(stallId, scannedQrHash, msg.sender);
    }

    function confirmBlacklist(bytes32 qrHash, string calldata reason) external onlyAgent {
        blacklisted[qrHash] = true;
        emit Blacklisted(qrHash, reason);
    }

    function removeBlacklist(bytes32 qrHash, string calldata reason) external onlyAgent {
        blacklisted[qrHash] = false;
        emit BlacklistRemoved(qrHash, reason);
    }

    function getStall(uint256 id) external view returns (Stall memory) {
        return stalls[id];
    }

    function _checkFree(bytes32 qrHash) internal view {
        if (stallByQr[qrHash] != 0) revert QrTaken();
        if (blacklisted[qrHash]) revert QrBlacklisted();
    }
}
