// ESM port of scripts/lib/ethers-fetch.js. ethers v6's default Node HTTP transport hangs on Node >= 26 here
// while fetch works. Call installFetchTransport(FetchRequest) with the ethers instance each package uses
// (backend and reporter each have their own node_modules/ethers).
type FetchRequestLike = { registerGetUrl: (fn: (req: any, signal?: any) => Promise<any>) => void };

export function installFetchTransport(FetchRequest: FetchRequestLike): void {
  FetchRequest.registerGetUrl(async (req: any, signal?: any) => {
    const controller = new AbortController();
    if (signal) signal.addListener(() => controller.abort());
    const res = await fetch(req.url, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers)) as Record<string, string>,
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
}
