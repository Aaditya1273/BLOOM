// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AuraAccount.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract AuraFactory {
    address public implementation;
    mapping(address => address) public accounts;

    event AccountCreated(address indexed owner, address account, uint256 initialFunding);

    constructor(IEntryPoint _entryPoint) {
        implementation = address(new AuraAccount(_entryPoint));
    }

    /**
     * @dev Deploie un compte pour l'owner et le finance avec l'ETH envoyé.
     */
    function createAccount(address owner) external payable returns (address) {
        require(accounts[owner] == address(0), "Account already exists");
        
        // Utilisation de la signature pour eviter les problemes d'heritage de selector
        bytes memory initData = abi.encodeWithSignature("initialize(address)", owner);
        ERC1967Proxy proxy = new ERC1967Proxy(implementation, initData);
        address accountAddr = address(proxy);
        
        accounts[owner] = accountAddr;

        // Envoi des fonds initiaux au nouveau compte
        if (msg.value > 0) {
            (bool success, ) = payable(accountAddr).call{value: msg.value}("");
            require(success, "Funding failed");
        }

        emit AccountCreated(owner, accountAddr, msg.value);
        return accountAddr;
    }

    function getAccount(address owner) external view returns (address) {
        return accounts[owner];
    }
}
