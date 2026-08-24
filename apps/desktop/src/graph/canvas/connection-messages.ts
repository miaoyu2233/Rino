import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import type { ConnectionRejectionReason } from "../connection-rules";

/** One sentence for every reason a connection can be refused.
 *
 * Declared as a total record so a reason added to the connection rules is a compile error
 * until it has text, and the user can never be shown a bare code.
 */
export const connectionRejectionKeys: Record<
  ConnectionRejectionReason,
  LocalizationKey
> = {
  nodeMissing: "graph.connection.rejected.nodeMissing",
  portMissing: "graph.connection.rejected.portMissing",
  portDirectionMismatch: "graph.connection.rejected.portDirectionMismatch",
  portKindMismatch: "graph.connection.rejected.portKindMismatch",
  typeIncompatible: "graph.connection.rejected.typeIncompatible",
  selfConnection: "graph.connection.rejected.selfConnection",
  duplicateConnection: "graph.connection.rejected.duplicateConnection",
  wouldCreateDataCycle: "graph.connection.rejected.wouldCreateDataCycle",
  wouldCreateMultipleParallelOnPath:
    "graph.connection.rejected.wouldCreateMultipleParallelOnPath",
};
