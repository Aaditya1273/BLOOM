# Manual MetaMask QA (Robinhood Chain Testnet)

Automated browser QA used a scripted EIP-1193 test wallet, not the MetaMask extension. This checklist is the manual
pass with real MetaMask. Record the result of each row; a release note may only say "MetaMask QA passed" after it is done.

## Setup

1. Start the stack against testnet (or use the hosted URLs):
   `BLOOM_DEPLOYMENT=robinhood-testnet npm --prefix backend start` and `npm --prefix frontend run dev` → http://localhost:3000
2. MetaMask: a fresh account with a little Robinhood testnet ETH (faucets in DEPLOYMENT.md). Do **not** add the network
   in advance; Bloom should offer it (chain 46630, RPC `https://rpc.testnet.chain.robinhood.com`, explorer
   `https://explorer.testnet.chain.robinhood.com`).
3. To test the admin demo controls, put that MetaMask address in the backend's `ADMIN_ADDRESSES` and restart it.

## Flows

| # | Step | Expected |
| --- | --- | --- |
| 1 | Landing → **Try Bloom** → MetaMask | MetaMask asks to connect |
| 2 | MetaMask on Ethereum mainnet | Bloom asks MetaMask to add/switch to Robinhood Chain Testnet |
| 3 | Approve the switch | MetaMask shows an EIP-712 "BloomLogin" signature (wallet, app `bloom-api`, uri, chainId 46630, nonce) |
| 4 | Sign | App unlocks at /home; nav shows your address |
| 5 | Reload the page | Still signed in, **no** second signature |
| 6 | Get test USDG | 1,000 USDG appears (no MetaMask prompt; the backend sponsors it) |
| 7 | Save → $100 | MetaMask transaction(s); "Done · $100.00 is now in savings" |
| 8 | Goals → "Save $500 for my laptop." → Preview → Put your goal on autopilot | Two MetaMask transactions (create, activate); goal shows **Active** |
| 9 | Chat → "Send Sarah $5 of QQQ." → Confirm | No MetaMask prompt (the agent acts within the goal policy); "Sent successfully" |
| 10 | Risk | AAPL/NVDA/QQQ/SPY: price, freshness, halt, corporate action, deviation, max LTV. **No demo controls** for a normal user |
| 11 | Activity | Save, goal created, agent switched on, QQQ bought and sent |
| 12 | Wallet menu → Disconnect | Back to the landing page; /home redirects to the landing page |
| 13 | (Admin wallet) Risk → Simulate HALT → Reset | HALTED · Borrowing Disabled · Max LTV 0%, then NORMAL |

## Error handling

| Case | How | Expected message |
| --- | --- | --- |
| Rejected signature | Reject the BloomLogin signature | "You declined the sign-in request in your wallet." + Try again |
| Rejected network switch | Reject the switch in step 2 or before a Save | "You cancelled the request in your wallet." |
| Rejected transaction | Reject a Save transaction | "You cancelled the request in your wallet." |
| Insufficient balance | Save more than your cash | "Not enough USDG: you have X and need Y." |
| Insufficient gas | Use an account with 0 ETH, then Save | "Your wallet needs a little testnet ETH on Robinhood Chain for gas." |
| Wrong network | Switch MetaMask to another network, then Save | Bloom asks MetaMask to switch back before sending anything |
| Backend restarted | Restart the backend, then click around | One new sign-in prompt, no errors |

Also check the browser console: there must be no uncaught errors (browser logs of expected 4xx responses are fine).

## Result

| Date | MetaMask version | Browser | Tester | Result / notes |
| --- | --- | --- | --- | --- |
| | | | | |
