export type RequestBoundary = { host: string; protocol: string; local: boolean; secure: boolean };

function hostnameOf(host: string) {
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/, "");
}

function loopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function proxyTrustEnabled() { return process.env.TRIA_TRUST_PROXY === "enabled"; }

export function resolveRequestBoundary(input: {
  host: string | null; directProtocol?: string | null; forwardedHost?: string | null; forwardedProtocol?: string | null;
}, trustProxy = proxyTrustEnabled()): RequestBoundary {
  const directHost = input.host?.split(",")[0]?.trim() ?? "";
  const forwardedHost = input.forwardedHost?.split(",")[0]?.trim() ?? "";
  const forwardedProtocol = input.forwardedProtocol?.split(",")[0]?.trim() ?? "";
  const completeForwarded = Boolean(forwardedHost && forwardedProtocol);
  if (trustProxy && !completeForwarded) return { host: "", protocol: "", local: false, secure: false };
  const useForwarded = trustProxy && completeForwarded;
  const allowedForwardedHosts = new Set((process.env.TRIA_PUBLIC_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (useForwarded && !allowedForwardedHosts.has(forwardedHost.toLowerCase())) return { host: "", protocol: "", local: false, secure: false };
  const host = useForwarded ? forwardedHost : directHost;
  const protocol = (useForwarded ? forwardedProtocol : input.directProtocol || "http").replace(/:$/, "").toLowerCase();
  const configuredLocalHosts = new Set((process.env.TRIA_LOCAL_HOSTS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const local = !useForwarded && (loopback(hostnameOf(host)) || configuredLocalHosts.has(host));
  return { host, protocol, local, secure: useForwarded && protocol === "https" };
}

export function boundaryAllowsRequest(boundary: RequestBoundary) {
  return Boolean(boundary.host) && (boundary.local || boundary.secure);
}
