import type {
  NodeDefinitionV1,
  PortDefinitionV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";

/** Connection cardinality derived from a port's direction and kind.
 *
 * The rule lives here rather than on each port definition so a single definition cannot
 * declare a cardinality that contradicts the graph model: a data input carries one value,
 * a data output may feed many consumers, an execution input may be reached from several
 * places, and an execution output continues to one successor unless the node declares
 * ordered fan-out.
 */
export function maximumConnections(port: PortDefinitionV1): number {
  if (port.portKind === "data") {
    return port.direction === "input" ? 1 : Number.POSITIVE_INFINITY;
  }
  if (port.direction === "input") {
    return Number.POSITIVE_INFINITY;
  }
  return port.allowsFanOut === true ? Number.POSITIVE_INFINITY : 1;
}

/** One node definition with its ports indexed for lookup. */
export interface IndexedNodeDefinition {
  definition: NodeDefinitionV1;
  ports: ReadonlyMap<string, PortDefinitionV1>;
}

/** A registry snapshot prepared for repeated validation lookups. */
export class NodeRegistryIndex {
  private readonly definitions: ReadonlyMap<string, IndexedNodeDefinition>;

  constructor(snapshot: RinoNodeRegistrySnapshotV1) {
    const definitions = new Map<string, IndexedNodeDefinition>();
    for (const definition of snapshot.definitions) {
      const ports = new Map<string, PortDefinitionV1>();
      for (const port of definition.ports) {
        ports.set(port.portId, port);
      }
      definitions.set(definition.typeKey, { definition, ports });
    }
    this.definitions = definitions;
  }

  find(typeKey: string): IndexedNodeDefinition | undefined {
    return this.definitions.get(typeKey);
  }

  has(typeKey: string): boolean {
    return this.definitions.has(typeKey);
  }
}
