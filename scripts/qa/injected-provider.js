// QA-only: MetaMask-compatible EIP-1193 provider (+ EIP-6963 announcement) backed by injected-wallet.mjs.
(() => {
  const URL = "http://127.0.0.1:8787";
  const listeners = {};
  const emit = (e, v) => (listeners[e] || []).forEach((f) => f(v));
  async function request({ method, params }) {
    const r = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
    const j = await r.json();
    if (j.error) {
      const err = new Error(j.error.message);
      err.code = j.error.code;
      throw err;
    }
    if (method === "wallet_switchEthereumChain") emit("chainChanged", params[0].chainId);
    if (method === "eth_requestAccounts") emit("accountsChanged", j.result);
    return j.result;
  }
  const provider = {
    isMetaMask: true,
    request,
    on: (e, f) => ((listeners[e] = listeners[e] || []).push(f), provider),
    removeListener: (e, f) => ((listeners[e] = (listeners[e] || []).filter((x) => x !== f)), provider),
  };
  window.ethereum = provider;
  window.__qaWalletEmit = emit; // QA: simulate the user changing network/account inside the wallet
  const info = {
    uuid: "3f1f1c55-6a1f-4c1b-9d57-bloomqa00001",
    name: "Bloom QA Wallet",
    rdns: "io.bloom.qawallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23F3A6B8'/%3E%3C/svg%3E",
  };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
