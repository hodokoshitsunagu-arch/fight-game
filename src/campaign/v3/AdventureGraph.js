export function analyzeAdventureGraph(adventurePackage) {
  const nodes = adventurePackage?.graph?.nodes ?? [];
  const edges = adventurePackage?.graph?.edges ?? [];
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    const destinations = outgoing.get(edge.from) ?? [];
    destinations.push(edge);
    outgoing.set(edge.from, destinations);
    const origins = incoming.get(edge.to) ?? [];
    origins.push(edge);
    incoming.set(edge.to, origins);
  }

  const reachable = new Set();
  const pending = adventurePackage?.graph?.startNodeId
    ? [adventurePackage.graph.startNodeId]
    : [];
  while (pending.length) {
    const nodeId = pending.pop();
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    pending.push(...(outgoing.get(nodeId) ?? []).map((edge) => edge.to));
  }

  const canReachFinal = new Set();
  const reversePending = nodes
    .filter((node) => node.segment === 'final-reasoning')
    .map((node) => node.id);
  while (reversePending.length) {
    const nodeId = reversePending.pop();
    if (canReachFinal.has(nodeId)) continue;
    canReachFinal.add(nodeId);
    reversePending.push(...(incoming.get(nodeId) ?? []).map((edge) => edge.from));
  }

  return { nodes, edges, outgoing, incoming, reachable, canReachFinal };
}
