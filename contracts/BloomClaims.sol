// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IBloomAssetRegistry} from "./interfaces/IBloomAssetRegistry.sol";

/// @title BloomClaims
/// @notice Claim-link escrow: send a supported asset to someone who does not have a Bloom account yet.
///
///  The claim link only carries a random public `claimId` (generated off-chain with a CSPRNG). Knowing the id is
///  NOT enough to claim: either the sender bound the claim to a recipient address, or the recipient must present
///  an EIP-712 `ClaimAuthorization` signed by the Bloom claim authority after it verified the recipient out of band.
///  No secret or key is ever placed in a URL. Claims are single-use and expire; expired funds return to the sender.
contract BloomClaims is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant AUTH_TYPEHASH =
        keccak256("ClaimAuthorization(bytes32 claimId,address recipient,uint256 amount,uint64 deadline)");
    uint64 public constant MAX_CLAIM_DURATION = 30 days;

    enum Status {
        None,
        Open,
        Claimed,
        Expired,
        Cancelled
    }

    struct Claim {
        address sender;
        address token;
        uint256 amount;
        address recipient; // 0 => claim authority must authorise the recipient
        uint64 expiry;
        Status status;
    }

    IBloomAssetRegistry public immutable registry;
    address public claimAuthority;
    mapping(bytes32 => Claim) public claims;

    event ClaimCreated(
        bytes32 indexed claimId, address indexed sender, address token, uint256 amount, address recipient, uint64 expiry
    );
    event ClaimClaimed(bytes32 indexed claimId, address indexed recipient, address token, uint256 amount);
    event ClaimExpired(bytes32 indexed claimId, address indexed sender, uint256 amount);
    event ClaimCancelled(bytes32 indexed claimId, address indexed sender, uint256 amount);
    event ClaimAuthorityUpdated(address authority);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidClaimId();
    error ClaimExists(bytes32 claimId);
    error InvalidExpiry();
    error NotOpen(bytes32 claimId, Status status);
    error ClaimHasExpired(bytes32 claimId);
    error NotExpired(bytes32 claimId);
    error AmountMismatch(uint256 expected, uint256 provided);
    error WrongRecipient();
    error Unauthorized();
    error AuthorizationExpired();
    error TransferAmountMismatch(uint256 expected, uint256 received);

    constructor(IBloomAssetRegistry registry_, address claimAuthority_, address owner_)
        Ownable(owner_)
        EIP712("BloomClaims", "1")
    {
        if (address(registry_) == address(0) || claimAuthority_ == address(0)) revert ZeroAddress();
        registry = registry_;
        claimAuthority = claimAuthority_;
        emit ClaimAuthorityUpdated(claimAuthority_);
    }

    function setClaimAuthority(address authority) external onlyOwner {
        if (authority == address(0)) revert ZeroAddress();
        claimAuthority = authority;
        emit ClaimAuthorityUpdated(authority);
    }

    function createClaim(bytes32 claimId, address token, uint256 amount, address recipient, uint64 expiry)
        external
        nonReentrant
    {
        if (claimId == bytes32(0)) revert InvalidClaimId();
        if (claims[claimId].status != Status.None) revert ClaimExists(claimId);
        if (amount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_CLAIM_DURATION) revert InvalidExpiry();
        registry.requireSupported(token, IBloomAssetRegistry.AssetKind.NONE);

        claims[claimId] = Claim(msg.sender, token, amount, recipient, expiry, Status.Open);
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (received != amount) revert TransferAmountMismatch(amount, received);
        emit ClaimCreated(claimId, msg.sender, token, amount, recipient, expiry);
    }

    function authorizationDigest(bytes32 claimId, address recipient, uint256 amount, uint64 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(AUTH_TYPEHASH, claimId, recipient, amount, deadline)));
    }

    /// @param authorization EIP-712 signature by `claimAuthority`; ignored for recipient-bound claims.
    function claim(bytes32 claimId, address recipient, uint256 amount, uint64 deadline, bytes calldata authorization)
        external
        nonReentrant
    {
        Claim storage c = claims[claimId];
        if (c.status != Status.Open) revert NotOpen(claimId, c.status);
        if (block.timestamp > c.expiry) revert ClaimHasExpired(claimId);
        if (amount != c.amount) revert AmountMismatch(c.amount, amount);
        if (recipient == address(0)) revert ZeroAddress();

        if (c.recipient != address(0)) {
            if (recipient != c.recipient || msg.sender != c.recipient) revert WrongRecipient();
        } else {
            if (block.timestamp > deadline) revert AuthorizationExpired();
            (address signer, ECDSA.RecoverError err,) =
                ECDSA.tryRecover(authorizationDigest(claimId, recipient, amount, deadline), authorization);
            if (err != ECDSA.RecoverError.NoError || signer != claimAuthority) revert Unauthorized();
        }

        c.status = Status.Claimed;
        IERC20(c.token).safeTransfer(recipient, amount);
        emit ClaimClaimed(claimId, recipient, c.token, amount);
    }

    /// @notice Return an expired, unclaimed claim to its sender. Callable by anyone; funds only go to the sender.
    function refundExpired(bytes32 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        if (c.status != Status.Open) revert NotOpen(claimId, c.status);
        if (block.timestamp <= c.expiry) revert NotExpired(claimId);
        c.status = Status.Expired;
        IERC20(c.token).safeTransfer(c.sender, c.amount);
        emit ClaimExpired(claimId, c.sender, c.amount);
    }

    function cancel(bytes32 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        if (c.status != Status.Open) revert NotOpen(claimId, c.status);
        if (msg.sender != c.sender) revert Unauthorized();
        c.status = Status.Cancelled;
        IERC20(c.token).safeTransfer(c.sender, c.amount);
        emit ClaimCancelled(claimId, c.sender, c.amount);
    }
}
