# Generated from contracts/diagnostics/rino-diagnostics-v1.schema.json. Do not edit directly.

import json
from typing import Any, Final, cast

_SCHEMA_TEXT: Final[str] = r"""
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.rino.invalid/diagnostics/rino-diagnostics-v1.schema.json",
  "title": "RinoGraphDiagnosticReportV1",
  "description": "Version-one graph validation report. The editor previews validation and the runtime validates authoritatively; both produce this shape with the same stable codes, so a diagnostic the user sees while editing matches the one that blocks a run.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "diagnostics"],
  "properties": {
    "schemaVersion": { "const": 1, "type": "integer" },
    "diagnostics": {
      "type": "array",
      "items": { "$ref": "#/$defs/GraphDiagnosticV1" },
      "maxItems": 2000
    }
  },
  "$defs": {
    "JsonValue": {
      "title": "JsonValue",
      "description": "Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
      "anyOf": [
        { "type": "null" },
        { "type": "boolean" },
        { "type": "integer" },
        { "type": "number" },
        { "type": "string", "maxLength": 65536 },
        {
          "type": "array",
          "items": { "$ref": "#/$defs/JsonValue" },
          "maxItems": 1024
        },
        { "$ref": "#/$defs/JsonObject" }
      ]
    },
    "JsonObject": {
      "title": "JsonObject",
      "type": "object",
      "maxProperties": 256,
      "additionalProperties": { "$ref": "#/$defs/JsonValue" }
    },
    "DiagnosticSeverityV1": {
      "title": "DiagnosticSeverityV1",
      "description": "An error blocks execution. A warning is surfaced but does not block a run.",
      "type": "string",
      "enum": ["error", "warning"]
    },
    "GraphDiagnosticCodeV1": {
      "title": "GraphDiagnosticCodeV1",
      "description": "Stable validation codes. A code is never reused for a different meaning, because the interface navigates and explains failures by code.",
      "type": "string",
      "enum": [
        "GRAPH_DUPLICATE_GRAPH_ID",
        "GRAPH_DUPLICATE_NODE_ID",
        "GRAPH_DUPLICATE_EDGE_ID",
        "GRAPH_ENTRY_GRAPH_MISSING",
        "GRAPH_ENTRY_KIND_INVALID",
        "GRAPH_NON_ENTRY_KIND_INVALID",
        "GRAPH_ENTRY_NODE_MISSING",
        "GRAPH_MULTIPLE_ENTRY_NODES",
        "GRAPH_PURE_DATA_CYCLE",
        "GRAPH_MULTIPLE_PARALLEL_ON_PATH",
        "GRAPH_DUPLICATE_VARIABLE_ID",
        "GRAPH_DUPLICATE_VARIABLE_NAME",
        "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
        "FUNCTION_DUPLICATE_PARAMETER_ID",
        "FUNCTION_DUPLICATE_PORT_ID",
        "FUNCTION_DUPLICATE_PARAMETER_NAME",
        "FUNCTION_PARALLEL_FORBIDDEN",
        "FUNCTION_PARAMETER_PORT_RESERVED",
        "FUNCTION_ENTRY_NODE_MISSING",
        "FUNCTION_MULTIPLE_ENTRY_NODES",
        "FUNCTION_RETURN_NODE_MISSING",
        "FUNCTION_NODE_OUTSIDE_FUNCTION",
        "FUNCTION_CALL_TARGET_MISSING",
        "FUNCTION_CALL_TARGET_NOT_FUNCTION",
        "FUNCTION_RECURSION_FORBIDDEN",
        "FUNCTION_CALL_DEPTH_EXCEEDED",
        "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
        "DOCUMENT_DUPLICATE_ASSET_ID",
        "DOCUMENT_DUPLICATE_ASSET_NAME",
        "NODE_TYPE_UNKNOWN",
        "NODE_TYPE_VERSION_UNSUPPORTED",
        "NODE_TYPE_DEPRECATED",
        "NODE_CAPABILITY_UNAVAILABLE",
        "NODE_INPUT_VALUE_UNKNOWN_PORT",
        "NODE_INPUT_VALUE_NOT_ACCEPTED",
        "NODE_REQUIRED_INPUT_MISSING",
        "NODE_VARIABLE_UNKNOWN",
        "NODE_VARIABLE_TYPE_MISMATCH",
        "EDGE_SELF_CONNECTION",
        "EDGE_SOURCE_NODE_MISSING",
        "EDGE_TARGET_NODE_MISSING",
        "EDGE_SOURCE_PORT_MISSING",
        "EDGE_TARGET_PORT_MISSING",
        "EDGE_DIRECTION_INVALID",
        "EDGE_KIND_MISMATCH",
        "EDGE_TYPE_INCOMPATIBLE",
        "EDGE_CARDINALITY_EXCEEDED"
      ]
    },
    "DocumentLocationV1": {
      "title": "DocumentLocationV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["scope"],
      "properties": {
        "scope": { "const": "document", "type": "string" }
      }
    },
    "GraphLocationV1": {
      "title": "GraphLocationV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["scope", "graphId"],
      "properties": {
        "scope": { "const": "graph", "type": "string" },
        "graphId": { "type": "string", "format": "uuid" }
      }
    },
    "NodeLocationV1": {
      "title": "NodeLocationV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["scope", "graphId", "nodeId"],
      "properties": {
        "scope": { "const": "node", "type": "string" },
        "graphId": { "type": "string", "format": "uuid" },
        "nodeId": { "type": "string", "format": "uuid" }
      }
    },
    "PortLocationV1": {
      "title": "PortLocationV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["scope", "graphId", "nodeId", "portId"],
      "properties": {
        "scope": { "const": "port", "type": "string" },
        "graphId": { "type": "string", "format": "uuid" },
        "nodeId": { "type": "string", "format": "uuid" },
        "portId": { "type": "string", "maxLength": 64 }
      }
    },
    "EdgeLocationV1": {
      "title": "EdgeLocationV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["scope", "graphId", "edgeId"],
      "properties": {
        "scope": { "const": "edge", "type": "string" },
        "graphId": { "type": "string", "format": "uuid" },
        "edgeId": { "type": "string", "format": "uuid" }
      }
    },
    "AssetLocationV1": {
      "title": "AssetLocationV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["scope", "assetId"],
      "properties": {
        "scope": { "const": "asset", "type": "string" },
        "assetId": { "type": "string", "format": "uuid" }
      }
    },
    "DiagnosticLocationV1": {
      "title": "DiagnosticLocationV1",
      "description": "Where the diagnostic applies, so the interface can focus the affected element instead of only naming it.",
      "anyOf": [
        { "$ref": "#/$defs/DocumentLocationV1" },
        { "$ref": "#/$defs/GraphLocationV1" },
        { "$ref": "#/$defs/NodeLocationV1" },
        { "$ref": "#/$defs/PortLocationV1" },
        { "$ref": "#/$defs/EdgeLocationV1" },
        { "$ref": "#/$defs/AssetLocationV1" }
      ]
    },
    "GraphDiagnosticV1": {
      "title": "GraphDiagnosticV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["code", "severity", "location", "messageKey", "parameters"],
      "properties": {
        "code": { "$ref": "#/$defs/GraphDiagnosticCodeV1" },
        "severity": { "$ref": "#/$defs/DiagnosticSeverityV1" },
        "location": { "$ref": "#/$defs/DiagnosticLocationV1" },
        "messageKey": {
          "description": "Localization key. The report carries keys and safe parameters rather than translated text, so a diagnostic produced by the runtime reads in the user's language.",
          "type": "string",
          "pattern": "^[a-z][a-zA-Z0-9]*(?:\\.[a-zA-Z0-9]+)+$",
          "maxLength": 200
        },
        "parameters": {
          "description": "Bounded interpolation values. Never contains project content beyond identifiers and type names.",
          "$ref": "#/$defs/JsonObject"
        }
      }
    }
  }
}
"""

RINO_DIAGNOSTICS_V1_SCHEMA: Final[dict[str, Any]] = cast(
    "dict[str, Any]", json.loads(_SCHEMA_TEXT)
)
