# Generated from contracts/graph/rino-graph-v1.schema.json. Do not edit directly.

import json
from typing import Any, Final, cast

_SCHEMA_TEXT: Final[str] = r"""
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.rino.invalid/graph/rino-graph-v1.schema.json",
  "title": "RinoProjectDocumentV1",
  "description": "Version-one Rino project document: the persisted, executable form of a project's graphs and assets.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "documentId",
    "metadata",
    "entryGraphId",
    "graphs",
    "assets",
    "requiredCapabilities"
  ],
  "properties": {
    "schemaVersion": { "const": 1, "type": "integer" },
    "documentId": { "type": "string", "format": "uuid" },
    "metadata": { "$ref": "#/$defs/ProjectMetadataV1" },
    "entryGraphId": { "type": "string", "format": "uuid" },
    "graphs": {
      "type": "array",
      "items": { "$ref": "#/$defs/GraphV1" },
      "maxItems": 64
    },
    "variables": {
      "description": "Project-scoped variable definitions shared by every graph, including function graphs.",
      "type": "array",
      "items": { "$ref": "#/$defs/VariableDefinitionV1" },
      "maxItems": 128
    },
    "assets": {
      "type": "array",
      "items": { "$ref": "#/$defs/ImageAssetV1" },
      "maxItems": 2000
    },
    "requiredCapabilities": {
      "type": "array",
      "items": { "$ref": "#/$defs/CapabilityKeyV1" },
      "maxItems": 64
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
    "NodeTypeKeyV1": {
      "title": "NodeTypeKeyV1",
      "description": "A stable namespaced node definition key such as core.logic.numberCompare.",
      "type": "string",
      "pattern": "^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
      "maxLength": 128
    },
    "PortIdV1": {
      "title": "PortIdV1",
      "description": "A port identifier that is stable across saves for one node definition version.",
      "type": "string",
      "pattern": "^[a-z][a-zA-Z0-9]*$",
      "maxLength": 64
    },
    "CapabilityKeyV1": {
      "title": "CapabilityKeyV1",
      "type": "string",
      "pattern": "^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
      "maxLength": 128
    },
    "ProjectMetadataV1": {
      "title": "ProjectMetadataV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "createdAt", "updatedAt"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 200 },
        "licenseIdentifier": {
          "description": "The project-wide SPDX expression or LicenseRef identifier inherited by every exported package.",
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$"
        },
        "createdAt": { "type": "string", "format": "date-time" },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "EditorPositionV1": {
      "title": "EditorPositionV1",
      "description": "Editor-space coordinates. Bounded so a corrupted document cannot place a node beyond any reachable viewport.",
      "type": "object",
      "additionalProperties": false,
      "required": ["x", "y"],
      "properties": {
        "x": { "type": "number", "minimum": -1000000, "maximum": 1000000 },
        "y": { "type": "number", "minimum": -1000000, "maximum": 1000000 }
      }
    },
    "RepeatHintV1": {
      "title": "RepeatHintV1",
      "description": "Presentation-only hint attached to a direct execution edge. The edge remains the runtime authority.",
      "type": "object",
      "additionalProperties": false,
      "required": ["hintId", "edgeId", "position"],
      "properties": {
        "hintId": { "type": "string", "format": "uuid" },
        "edgeId": { "type": "string", "format": "uuid" },
        "position": { "$ref": "#/$defs/EditorPositionV1" }
      }
    },
    "EditorSizeV1": {
      "title": "EditorSizeV1",
      "description": "Editor-space dimensions for presentation-only regions such as comments.",
      "type": "object",
      "additionalProperties": false,
      "required": ["width", "height"],
      "properties": {
        "width": { "type": "number", "minimum": 160, "maximum": 100000 },
        "height": { "type": "number", "minimum": 80, "maximum": 100000 }
      }
    },
    "NodeV1": {
      "title": "NodeV1",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "nodeId",
        "typeKey",
        "typeVersion",
        "position",
        "properties",
        "inputValues"
      ],
      "properties": {
        "nodeId": { "type": "string", "format": "uuid" },
        "typeKey": { "$ref": "#/$defs/NodeTypeKeyV1" },
        "typeVersion": { "type": "integer", "minimum": 1, "maximum": 1000 },
        "displayAlias": {
          "description": "Optional authoring note shown beside the localized title. Presentation metadata only; it never changes execution identity.",
          "type": "string",
          "maxLength": 80
        },
        "position": { "$ref": "#/$defs/EditorPositionV1" },
        "properties": { "$ref": "#/$defs/JsonObject" },
        "inputValues": {
          "description": "Literal fallbacks for configurable data inputs that carry no incoming edge. Keys are port identifiers. Their validity is checked against the node definition's declared ports rather than by a key pattern here, because matching a declared port is the rule that matters and a pattern would only weakly approximate it.",
          "type": "object",
          "maxProperties": 64,
          "additionalProperties": { "$ref": "#/$defs/JsonValue" }
        },
        "dynamicPortState": {
          "description": "Present only for node definitions that declare dynamic ports.",
          "$ref": "#/$defs/JsonObject"
        },
        "disabled": { "type": "boolean" },
        "breakpoint": { "type": "boolean" }
      }
    },
    "EdgeKindV1": {
      "title": "EdgeKindV1",
      "type": "string",
      "enum": ["execution", "data"]
    },
    "EdgeV1": {
      "title": "EdgeV1",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "edgeId",
        "edgeKind",
        "sourceNodeId",
        "sourcePortId",
        "targetNodeId",
        "targetPortId"
      ],
      "properties": {
        "edgeId": { "type": "string", "format": "uuid" },
        "edgeKind": { "$ref": "#/$defs/EdgeKindV1" },
        "sourceNodeId": { "type": "string", "format": "uuid" },
        "sourcePortId": { "$ref": "#/$defs/PortIdV1" },
        "targetNodeId": { "type": "string", "format": "uuid" },
        "targetPortId": { "$ref": "#/$defs/PortIdV1" }
      }
    },
    "GraphCommentV1": {
      "title": "GraphCommentV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["commentId", "text", "position"],
      "properties": {
        "commentId": { "type": "string", "format": "uuid" },
        "text": { "type": "string", "maxLength": 2000 },
        "position": { "$ref": "#/$defs/EditorPositionV1" },
        "size": { "$ref": "#/$defs/EditorSizeV1" }
      }
    },
    "WorkflowGroupKindV1": {
      "title": "WorkflowGroupKindV1",
      "type": "string",
      "enum": ["imageRecognition", "textRecognition"]
    },
    "WorkflowGroupMemberV1": {
      "title": "WorkflowGroupMemberV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["role", "nodeId"],
      "properties": {
        "role": {
          "type": "string",
          "pattern": "^[a-z][a-zA-Z0-9]*$",
          "maxLength": 64
        },
        "nodeId": { "type": "string", "format": "uuid" }
      }
    },
    "WorkflowGroupPortV1": {
      "title": "WorkflowGroupPortV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["proxyPortId", "nodeId", "portId", "labelKey"],
      "properties": {
        "proxyPortId": { "$ref": "#/$defs/PortIdV1" },
        "nodeId": { "type": "string", "format": "uuid" },
        "portId": { "$ref": "#/$defs/PortIdV1" },
        "labelKey": {
          "type": "string",
          "pattern": "^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
          "maxLength": 160
        }
      }
    },
    "WorkflowGroupV1": {
      "title": "WorkflowGroupV1",
      "description": "Authoring-only grouping of ordinary executable nodes. Group metadata never changes runtime semantics.",
      "type": "object",
      "additionalProperties": false,
      "required": ["groupId", "kind", "members", "exposedPorts", "collapsed"],
      "properties": {
        "groupId": { "type": "string", "format": "uuid" },
        "kind": { "$ref": "#/$defs/WorkflowGroupKindV1" },
        "members": {
          "type": "array",
          "items": { "$ref": "#/$defs/WorkflowGroupMemberV1" },
          "minItems": 1,
          "maxItems": 32
        },
        "exposedPorts": {
          "type": "array",
          "items": { "$ref": "#/$defs/WorkflowGroupPortV1" },
          "maxItems": 32
        },
        "collapsed": { "type": "boolean" }
      }
    },
    "GraphEditorMetadataV1": {
      "title": "GraphEditorMetadataV1",
      "description": "Presentation state that must never affect execution.",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "comments": {
          "type": "array",
          "items": { "$ref": "#/$defs/GraphCommentV1" },
          "maxItems": 500
        },
        "workflowGroups": {
          "type": "array",
          "items": { "$ref": "#/$defs/WorkflowGroupV1" },
          "maxItems": 500
        },
        "repeatHints": {
          "type": "array",
          "items": { "$ref": "#/$defs/RepeatHintV1" },
          "maxItems": 500
        }
      }
    },
    "GraphKindV1": {
      "title": "GraphKindV1",
      "type": "string",
      "enum": ["entry", "function"]
    },
    "VariableValueKindV1": {
      "title": "VariableValueKindV1",
      "type": "string",
      "enum": ["bool", "number", "string", "point", "rect", "imageRef"]
    },
    "VariableDefinitionV1": {
      "title": "VariableDefinitionV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["variableId", "name", "valueKind", "persistent"],
      "properties": {
        "variableId": { "type": "string", "format": "uuid" },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": ".*\\S.*"
        },
        "valueKind": { "$ref": "#/$defs/VariableValueKindV1" },
        "persistent": { "type": "boolean" }
      }
    },
    "FunctionParameterV1": {
      "title": "FunctionParameterV1",
      "description": "One typed function boundary parameter. parameterId is editor identity; portId is the stable graph boundary port.",
      "type": "object",
      "additionalProperties": false,
      "required": ["parameterId", "portId", "name", "valueKind"],
      "properties": {
        "parameterId": { "type": "string", "format": "uuid" },
        "portId": { "$ref": "#/$defs/PortIdV1" },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": ".*\\S.*"
        },
        "valueKind": { "$ref": "#/$defs/VariableValueKindV1" }
      }
    },
    "FunctionSignatureV1": {
      "title": "FunctionSignatureV1",
      "description": "The author-ordered typed boundary of a function graph.",
      "type": "object",
      "additionalProperties": false,
      "required": ["inputs", "outputs"],
      "properties": {
        "inputs": {
          "type": "array",
          "items": { "$ref": "#/$defs/FunctionParameterV1" },
          "maxItems": 16
        },
        "outputs": {
          "type": "array",
          "items": { "$ref": "#/$defs/FunctionParameterV1" },
          "maxItems": 16
        }
      }
    },
    "GraphV1": {
      "title": "GraphV1",
      "type": "object",
      "additionalProperties": false,
      "required": ["graphId", "name", "kind", "nodes", "edges"],
      "properties": {
        "graphId": { "type": "string", "format": "uuid" },
        "name": { "type": "string", "minLength": 1, "maxLength": 200 },
        "kind": { "$ref": "#/$defs/GraphKindV1" },
        "functionSignature": { "$ref": "#/$defs/FunctionSignatureV1" },
        "variables": {
          "type": "array",
          "items": { "$ref": "#/$defs/VariableDefinitionV1" },
          "maxItems": 128
        },
        "nodes": {
          "type": "array",
          "items": { "$ref": "#/$defs/NodeV1" },
          "maxItems": 5000
        },
        "edges": {
          "type": "array",
          "items": { "$ref": "#/$defs/EdgeV1" },
          "maxItems": 10000
        },
        "editorMetadata": { "$ref": "#/$defs/GraphEditorMetadataV1" }
      },
      "if": {
        "properties": { "kind": { "const": "function" } }
      },
      "then": {
        "properties": { "functionSignature": {} },
        "required": ["functionSignature"]
      },
      "else": {
        "if": {
          "properties": { "kind": { "const": "entry" } }
        },
        "then": {
          "properties": { "functionSignature": {} },
          "not": { "required": ["functionSignature"] }
        }
      }
    },
    "CoordinateSpaceV1": {
      "title": "CoordinateSpaceV1",
      "description": "The pixel space a captured image and any region derived from it belong to. Comparing coordinates across spaces is a validation error, not a silent conversion.",
      "type": "object",
      "additionalProperties": false,
      "required": ["spaceId", "width", "height"],
      "properties": {
        "spaceId": { "type": "string", "minLength": 1, "maxLength": 128 },
        "width": { "type": "integer", "minimum": 1, "maximum": 65536 },
        "height": { "type": "integer", "minimum": 1, "maximum": 65536 }
      }
    },
    "AssetSourceKindV1": {
      "title": "AssetSourceKindV1",
      "type": "string",
      "enum": ["deviceCapture", "regionCapture", "importedFile"]
    },
    "ImageAssetV1": {
      "title": "ImageAssetV1",
      "description": "One stored image. Graph references target assetId, so renaming an asset never breaks a node.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "assetId",
        "displayName",
        "contentHash",
        "mediaType",
        "byteLength",
        "coordinateSpace",
        "sourceKind",
        "createdAt"
      ],
      "properties": {
        "assetId": { "type": "string", "format": "uuid" },
        "displayName": {
          "description": "Persistent unique name. New captures use INSTALLATIONCODE_visible-name_ordinal; the editor hides the installation code and ordinal in user-facing labels. Legacy unqualified names remain valid.",
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "contentHash": {
          "description": "Lowercase SHA-256 of the stored bytes, so identical content can share one object.",
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "mediaType": { "type": "string", "enum": ["image/png"] },
        "byteLength": { "type": "integer", "minimum": 1, "maximum": 268435456 },
        "coordinateSpace": { "$ref": "#/$defs/CoordinateSpaceV1" },
        "sourceKind": { "$ref": "#/$defs/AssetSourceKindV1" },
        "createdAt": { "type": "string", "format": "date-time" }
      }
    },
    "GraphFileNameV1": {
      "title": "GraphFileNameV1",
      "description": "The name of one graph file inside the project's graphs directory. The pattern is deliberately narrower than the operating system allows: the editor allocates these names itself, so a project file can never direct a write outside the graphs directory or onto a reserved device name.",
      "type": "string",
      "pattern": "^[a-z0-9](?:[a-z0-9-]{0,62})\\.rino\\.graph\\.json$",
      "maxLength": 80
    },
    "ProjectGraphFileV1": {
      "title": "ProjectGraphFileV1",
      "description": "The manifest's record of where one graph is stored. The manifest is the authority: a graph file present on disk but absent here is not part of the project.",
      "type": "object",
      "additionalProperties": false,
      "required": ["graphId", "fileName"],
      "properties": {
        "graphId": { "type": "string", "format": "uuid" },
        "fileName": { "$ref": "#/$defs/GraphFileNameV1" }
      }
    },
    "ProjectManifestV1": {
      "title": "ProjectManifestV1",
      "description": "The persisted project.rino.json at a project root. It carries everything a project document holds except the graphs themselves, which live in their own files so one graph edit rewrites one file.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schemaVersion",
        "documentId",
        "metadata",
        "entryGraphId",
        "graphs",
        "assets",
        "requiredCapabilities"
      ],
      "properties": {
        "schemaVersion": { "const": 1, "type": "integer" },
        "documentId": { "type": "string", "format": "uuid" },
        "metadata": { "$ref": "#/$defs/ProjectMetadataV1" },
        "entryGraphId": { "type": "string", "format": "uuid" },
        "graphs": {
          "type": "array",
          "items": { "$ref": "#/$defs/ProjectGraphFileV1" },
          "maxItems": 64
        },
        "variables": {
          "description": "Project-scoped variable definitions shared by every graph, including function graphs.",
          "type": "array",
          "items": { "$ref": "#/$defs/VariableDefinitionV1" },
          "maxItems": 128
        },
        "assets": {
          "type": "array",
          "items": { "$ref": "#/$defs/ImageAssetV1" },
          "maxItems": 2000
        },
        "requiredCapabilities": {
          "type": "array",
          "items": { "$ref": "#/$defs/CapabilityKeyV1" },
          "maxItems": 64
        }
      }
    },
    "GraphDocumentV1": {
      "title": "GraphDocumentV1",
      "description": "One persisted graphs/*.rino.graph.json file. documentId repeats the owning project's identifier so a graph file copied into another project is rejected instead of silently adopted.",
      "type": "object",
      "additionalProperties": false,
      "required": ["schemaVersion", "documentId", "graph"],
      "properties": {
        "schemaVersion": { "const": 1, "type": "integer" },
        "documentId": { "type": "string", "format": "uuid" },
        "graph": { "$ref": "#/$defs/GraphV1" }
      }
    }
  }
}
"""

RINO_GRAPH_V1_SCHEMA: Final[dict[str, Any]] = cast(
    "dict[str, Any]", json.loads(_SCHEMA_TEXT)
)
