// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/accounts/SimpleAccount.sol";
import "@account-abstraction/contracts/utils/Exec.sol";
import "./IAuraGuardrail.sol";

contract AuraAccount is SimpleAccount {
    IAuraGuardrail public guardrail;
    address public aiAgent;

    error NotAuthorized();
    error GuardrailRejected();

    constructor(IEntryPoint anEntryPoint) SimpleAccount(anEntryPoint) {}

    function setGuardrail(IAuraGuardrail _guardrail) external onlyOwner {
        guardrail = _guardrail;
    }

    function setAiAgent(address _aiAgent) external onlyOwner {
        aiAgent = _aiAgent;
    }

    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external {
        _onlyOwner();
        _executeBatch(dest, value, func);
    }

    /**
     * @dev L'Agent IA peut appeler cette fonction pour exécuter un batch de transactions
     * si l'utilisateur l'a autorisé préalablement via setAiAgent.
     */
    function executeBatchByAgent(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external {
        if (msg.sender != aiAgent) revert NotAuthorized();
        
        for (uint256 i = 0; i < dest.length; i++) {
            if (address(guardrail) != address(0)) {
                if (!guardrail.checkTransaction(dest[i], value[i], func[i])) {
                    revert GuardrailRejected();
                }
            }
            _callWithIndex(i, dest[i], value[i], func[i]);
        }
    }

    function _executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) internal {
        require(dest.length == value.length && dest.length == func.length, "wrong array lengths");
        for (uint256 i = 0; i < dest.length; i++) {
            _callWithIndex(i, dest[i], value[i], func[i]);
        }
    }

    function _callWithIndex(uint256 index, address target, uint256 value, bytes memory data) internal {
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) {
            if (result.length == 0) revert("Call failed without reason");
            assembly {
                // We add the index to the beginning of the revert reason if possible
                // But for now, let's just propagate the raw error to see it in the explorer
                revert(add(result, 32), mload(result))
            }
        }
    }

    function executeByAgent(address dest, uint256 value, bytes calldata func) external {
        if (msg.sender != aiAgent) revert NotAuthorized();
        
        if (address(guardrail) != address(0)) {
            if (!guardrail.checkTransaction(dest, value, func)) {
                revert GuardrailRejected();
            }
        }

        bool ok = Exec.call(dest, value, func, gasleft());
        if (!ok) {
            Exec.revertWithReturnData();
        }
    }
}
