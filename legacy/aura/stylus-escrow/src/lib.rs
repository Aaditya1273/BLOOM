#![cfg_attr(not(feature = "export-abi"), no_main)]
#![cfg_attr(not(feature = "export-abi"), no_std)]
extern crate alloc;

use alloc::{vec, vec::Vec};
use alloy_primitives::{Address, U256};
use stylus_sdk::{alloy_sol_types::sol, prelude::*, storage::StorageAddress};

sol! {
    event CrossChainSettlementRequested(uint256 indexed order_id, address indexed owner, uint256 collateral, bool is_long, uint256 leverage, uint256 asset_hash);
    event OrderPlaced(uint256 indexed order_id, address indexed owner);
    event OrderCancelled(uint256 indexed order_id, address indexed owner);
}

sol_interface! {
    interface IERC20 {
        function transferFrom(address from, address to, uint256 amount) external;
        function transfer(address to, uint256 amount) external;
    }
    interface IOrderBook {
        function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256);
        function get_order(uint256 order_id) external view returns (address, uint256, bool, uint256, uint256, uint256, uint256, uint256);
        function cancel_order(uint256 order_id, address caller) external returns (bool);
        function mark_executed(uint256 order_id) external returns (bool);
    }
}

#[storage]
#[entrypoint]
pub struct AuraCrossChainEscrow {
    ausd: StorageAddress,
    orderbook: StorageAddress,
    keeper: StorageAddress,
    owner: StorageAddress,
}

#[public]
impl AuraCrossChainEscrow {
    pub fn init(&mut self, ausd: Address, orderbook: Address, keeper: Address) -> Result<(), Vec<u8>> {
        if self.owner.get() != Address::ZERO {
            return Err(b"Already initialized".to_vec());
        }
        self.owner.set(self.vm().msg_sender());
        self.ausd.set(ausd);
        self.orderbook.set(orderbook);
        self.keeper.set(keeper);
        Ok(())
    }

    #[selector(name = "placeLimitOrder")]
    pub fn place_limit_order(&mut self, asset_hash: U256, is_long: bool, collateral: U256, leverage: U256, limit_price: U256) -> Result<U256, Vec<u8>> {
        let caller = self.vm().msg_sender();
        let my_addr = self.vm().contract_address();
        
        let ausd = IERC20::new(self.ausd.get());
        
        let call = Call::new_mutating(&mut *self);
        ausd.transfer_from(self.vm(), call, caller, my_addr, collateral).map_err(|_| b"transfer_from call failed".to_vec())?;

        let orderbook = IOrderBook::new(self.orderbook.get());
        let call2 = Call::new_mutating(&mut *self);
        let order_id = orderbook.store_order(self.vm(), call2, caller, asset_hash, is_long, collateral, leverage, limit_price).map_err(|_| b"store_order call failed".to_vec())?;

        if order_id == U256::MAX {
            return Err(b"OrderBook rejected order".to_vec());
        }

        Ok(order_id)
    }

    #[selector(name = "cancelOrder")]
    pub fn cancel_order(&mut self, order_id: U256, caller: Address) -> Result<(), Vec<u8>> {
        let msg_sender = self.vm().msg_sender();
        if msg_sender != caller {
            return Err(b"Not caller".to_vec());
        }

        let orderbook = IOrderBook::new(self.orderbook.get());
        
        let (owner_addr, _, _, collateral, _, _, _, _) = orderbook.get_order(self.vm(), Call::new(), order_id).map_err(|_| b"get_order failed".to_vec())?;
        if msg_sender != owner_addr {
            return Err(b"Not owner".to_vec());
        }

        let call = Call::new_mutating(&mut *self);
        let cancel_ok = orderbook.cancel_order(self.vm(), call, order_id, msg_sender).map_err(|_| b"OrderBook cancel call failed".to_vec())?;
        if !cancel_ok {
            return Err(b"OrderBook cancel failed".to_vec());
        }

        let ausd = IERC20::new(self.ausd.get());
        let call2 = Call::new_mutating(&mut *self);
        ausd.transfer(self.vm(), call2, msg_sender, collateral).map_err(|_| b"Refund call failed".to_vec())?;

        self.vm().log(OrderCancelled {
            order_id,
            owner: msg_sender,
        });

        Ok(())
    }

    #[selector(name = "execute_and_bridge")]
    pub fn execute_and_bridge(&mut self, order_id: U256) -> Result<(), Vec<u8>> {
        let msg_sender = self.vm().msg_sender();
        let keeper = self.keeper.get();
        let owner = self.owner.get();

        if msg_sender != keeper && msg_sender != owner {
            return Err(b"Only keeper or owner".to_vec());
        }

        let orderbook = IOrderBook::new(self.orderbook.get());
        let (owner_addr, _, is_long, collateral, leverage, _, _, _) = orderbook.get_order(self.vm(), Call::new(), order_id).map_err(|_| b"get_order failed".to_vec())?;

        let call = Call::new_mutating(&mut *self);
        let mark_ok = orderbook.mark_executed(self.vm(), call, order_id).map_err(|_| b"mark_executed call failed".to_vec())?;
        if !mark_ok {
            return Err(b"OrderBook mark_executed failed".to_vec());
        }

        let ausd = IERC20::new(self.ausd.get());
        let call2 = Call::new_mutating(&mut *self);
        ausd.transfer(self.vm(), call2, keeper, collateral).map_err(|_| b"Transfer to keeper call failed".to_vec())?;

        self.vm().log(CrossChainSettlementRequested {
            order_id,
            owner: owner_addr,
            collateral,
            is_long,
            leverage,
            asset_hash: U256::ZERO,
        });

        Ok(())
    }
}
