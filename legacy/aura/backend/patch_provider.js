const originalFetch = global.fetch;

const rpcQueue = [];
let isProcessingRpc = false;

async function processRpcQueue() {
    if (isProcessingRpc) return;
    isProcessingRpc = true;
    while (rpcQueue.length > 0) {
        const { url, options, resolve, reject } = rpcQueue.shift();
        try {
            const res = await originalFetch(url, options);
            resolve(res);
        } catch (err) {
            reject(err);
        }
        // Wait 500ms between requests to avoid 429 rate limits on free RPCs
        await new Promise(r => setTimeout(r, 500));
    }
    isProcessingRpc = false;
}

global.fetch = async function(url, options) {
    let urlString = "";
    if (typeof url === 'string') urlString = url;
    else if (url && url.url) urlString = url.url;

    // Check if it's the Robinhood RPC or any QuickNode RPC
    if (urlString.includes("robinhood.com") || urlString.includes("quiknode") || urlString.includes("quicknode")) {
        return new Promise((resolve, reject) => {
            rpcQueue.push({ url, options, resolve, reject });
            processRpcQueue();
        });
    }

    return originalFetch(url, options);
};

// Patch ethers JsonRpcProvider to use staticNetwork and slow polling.
// This completely eliminates the "failed to detect network" spam
// because ethers won't need to call eth_chainId on every instantiation.
const { ethers } = require("ethers");
if (ethers && ethers.JsonRpcProvider) {
    const OriginalJsonRpcProvider = ethers.JsonRpcProvider;
    ethers.JsonRpcProvider = class extends OriginalJsonRpcProvider {
        constructor(url, network, options) {
            // If it's a Robinhood testnet URL, use static network (chain 46630)
            const urlStr = typeof url === 'string' ? url : (url?.url || '');
            if (urlStr.includes("robinhood.com")) {
                const robinhoodNetwork = ethers.Network.from(46630);
                super(url, robinhoodNetwork, { ...options, staticNetwork: robinhoodNetwork });
            } else {
                super(url, network, options);
            }
            this.pollingInterval = 60000;
        }
    };
}

module.exports = true;

