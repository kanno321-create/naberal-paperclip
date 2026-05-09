import type { CiliumNetworkPolicyDoc } from "./cilium-network-policy.js";

export interface BuildTenantCiliumInput {
  namespace: string;
  companySlug: string;
  dnsAllowlist: string[];
  egressCidrs: string[];
}

/**
 * Build a per-tenant CiliumNetworkPolicy that intersects with M1's baseline.
 *
 * Cilium evaluates multiple CNPs as an AND: traffic is allowed only when
 * every selecting policy permits it. When this builder returns a CNP, the
 * effective egress for the tenant becomes
 *   M1 baseline ∩ (kube-dns, dnsAllowlist, egressCidrs)
 * — strictly tighter than M1 alone.
 *
 * Returns `null` when both arrays are empty, in which case
 * `ensureTenantNamespace` does not apply a second CNP and the M1 baseline
 * alone governs egress.
 */
export function buildTenantCiliumPolicy(input: BuildTenantCiliumInput): CiliumNetworkPolicyDoc | null {
  if (input.dnsAllowlist.length === 0 && input.egressCidrs.length === 0) return null;

  const egress: CiliumNetworkPolicyDoc["spec"]["egress"] = [];

  // Always preserve kube-dns access. Without this, a dnsAllowlist of
  // ["api.anthropic.com"] would also block DNS resolution for that very
  // host and the agent would fail to resolve any FQDN at all.
  egress.push({
    toEndpoints: [{
      matchLabels: {
        "k8s:io.kubernetes.pod.namespace": "kube-system",
        "k8s:k8s-app": "kube-dns",
      },
    }],
    toPorts: [{
      ports: [{ port: "53", protocol: "ANY" }],
      rules: { dns: [{ matchPattern: "*" }] },
    }],
  });

  if (input.dnsAllowlist.length > 0) {
    egress.push({
      toFQDNs: input.dnsAllowlist.map((dns) =>
        dns.includes("*") ? { matchPattern: dns } : { matchName: dns },
      ),
    });
  }
  if (input.egressCidrs.length > 0) {
    egress.push({ toCIDR: input.egressCidrs });
  }

  return {
    apiVersion: "cilium.io/v2",
    kind: "CiliumNetworkPolicy",
    metadata: {
      name: `paperclip-tenant-${input.companySlug}-restrict`,
      namespace: input.namespace,
    },
    spec: {
      endpointSelector: { matchLabels: { "paperclip.ai/managed-by": "paperclip" } },
      egress,
    },
  };
}
