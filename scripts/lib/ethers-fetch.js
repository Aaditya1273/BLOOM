// ethers v6's default Node HTTP transport hangs on Node >= 26 in this environment (requests time out while
// fetch/https work). Route all ethers HTTP traffic through the platform fetch instead. Safe on older Nodes too.
const { FetchRequest } = require("ethers");

FetchRequest.registerGetUrl(async (req, signal) => {
  const controller = new AbortController();
  if (signal) signal.addListener(() => controller.abort());
  const res = await fetch(req.url, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers)),
    body: req.body ? Buffer.from(req.body) : undefined,
    signal: controller.signal,
  });
  return {
    statusCode: res.status,
    statusMessage: res.statusText,
    headers: Object.fromEntries(res.headers.entries()),
    body: new Uint8Array(await res.arrayBuffer()),
  };
});
