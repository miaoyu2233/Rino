//! Cross-language acceptance for persisted graphs and runtime recovery.
//!
//! The test launches the real Python protocol service through the Rust supervisor while
//! injecting the deterministic backend through the runtime's testable construction API.
//! No fake-backend switch is added to the production executable.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::print_stderr,
    reason = "an integration test reports failures by panicking and skips on stderr"
)]

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use rino_desktop_lib::project::{ProjectFile, ProjectFileSet, ProjectWorkspace};
use rino_desktop_lib::sidecar::{
    ForwardedDiagnostic, ForwardedEvent, SidecarLaunch, SidecarSupervisor, SupervisorState,
};
use serde_json::{Value, json};

const DESKTOP_VERSION: &str = "0.1.0";
const DOCUMENT_ID: &str = "61000000-0000-4000-8000-000000000001";
const GRAPH_ID: &str = "61000000-0000-4000-8000-000000000002";
const START_ID: &str = "61000000-0000-4000-8000-000000000010";
const CAPTURE_ID: &str = "61000000-0000-4000-8000-000000000011";
const OCR_ID: &str = "61000000-0000-4000-8000-000000000012";
const PARSE_ID: &str = "61000000-0000-4000-8000-000000000013";
const COMPARE_ID: &str = "61000000-0000-4000-8000-000000000014";
const BRANCH_ID: &str = "61000000-0000-4000-8000-000000000015";
const CLICK_ID: &str = "61000000-0000-4000-8000-000000000016";
const LOWER_LOG_ID: &str = "61000000-0000-4000-8000-000000000017";
const INVALID_LOG_ID: &str = "61000000-0000-4000-8000-000000000018";
const DELAY_ID: &str = "61000000-0000-4000-8000-000000000019";

const FAKE_RUNTIME_SCRIPT: &str = r#"
import sys

from rino_runtime.__main__ import run
from rino_runtime.backends.fake import FakeAutomationBackend, FakeAutomationScenario
from rino_runtime.diagnostics import DiagnosticLog
from rino_runtime.nodes import RuntimeOcrCandidate, RuntimeRect, build_phase_4_fake_backend_registry

backend = FakeAutomationBackend(FakeAutomationScenario(candidates=(
    RuntimeOcrCandidate(
        text="41",
        confidence=0.98,
        rect=RuntimeRect(x=100, y=200, width=80, height=40),
    ),
)))
diagnostics = DiagnosticLog()
try:
    exit_code = run(
        sys.stdin.buffer,
        sys.stdout.buffer,
        diagnostics,
        registry=build_phase_4_fake_backend_registry(backend),
    )
finally:
    diagnostics.close()
raise SystemExit(exit_code)
"#;

struct TemporaryRoot {
    path: PathBuf,
}

impl TemporaryRoot {
    fn create() -> Result<Self, Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "rino-cross-language-gate-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    fn child(&self, name: &str) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let path = self.path.join(name);
        fs::create_dir_all(&path)?;
        Ok(path)
    }
}

impl Drop for TemporaryRoot {
    fn drop(&mut self) {
        let _ignored = fs::remove_dir_all(&self.path);
    }
}

struct RuntimeHarness {
    supervisor: SidecarSupervisor,
    events: Receiver<ForwardedEvent>,
    #[expect(
        dead_code,
        reason = "kept alive so the runtime diagnostic channel remains connected"
    )]
    diagnostics: Receiver<ForwardedDiagnostic>,
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn workspace_interpreter() -> Option<PathBuf> {
    let interpreter = if cfg!(windows) {
        repository_root().join(".venv/Scripts/python.exe")
    } else {
        repository_root().join(".venv/bin/python")
    };
    interpreter.is_file().then_some(interpreter)
}

fn runtime_harness() -> Option<RuntimeHarness> {
    let launch = SidecarLaunch::new(
        workspace_interpreter()?,
        vec![
            OsString::from("-I"),
            OsString::from("-c"),
            OsString::from(FAKE_RUNTIME_SCRIPT),
        ],
    )
    .ok()?;
    let (event_sender, events) = channel();
    let (diagnostic_sender, diagnostics) = channel();
    Some(RuntimeHarness {
        supervisor: SidecarSupervisor::new(
            launch,
            DESKTOP_VERSION.to_owned(),
            event_sender,
            diagnostic_sender,
        ),
        events,
        diagnostics,
    })
}

fn node(node_id: &str, type_key: &str, properties: &Value, input_values: &Value) -> Value {
    json!({
        "nodeId": node_id,
        "typeKey": type_key,
        "typeVersion": 1,
        "position": {"x": 0, "y": 0},
        "properties": properties,
        "inputValues": input_values,
    })
}

fn edge(
    number: u64,
    edge_kind: &str,
    source_node_id: &str,
    source_port_id: &str,
    target_node_id: &str,
    target_port_id: &str,
) -> Value {
    json!({
        "edgeId": format!("62000000-0000-4000-8000-{number:012}"),
        "edgeKind": edge_kind,
        "sourceNodeId": source_node_id,
        "sourcePortId": source_port_id,
        "targetNodeId": target_node_id,
        "targetPortId": target_port_id,
    })
}

fn numeric_graph() -> Value {
    json!({
        "graphId": GRAPH_ID,
        "name": "Numeric recognition",
        "kind": "entry",
        "nodes": [
            node(START_ID, "core.flow.start", &json!({}), &json!({})),
            node(CAPTURE_ID, "automation.captureScreen", &json!({}), &json!({})),
            node(OCR_ID, "vision.ocr", &json!({}), &json!({})),
            node(PARSE_ID, "text.parseNumber", &json!({}), &json!({})),
            node(
                COMPARE_ID,
                "core.logic.numberCompare",
                &json!({"operator": "greaterThan"}),
                &json!({"right": 40}),
            ),
            node(BRANCH_ID, "core.logic.branch", &json!({}), &json!({})),
            node(CLICK_ID, "automation.clickRectCenter", &json!({}), &json!({})),
            node(
                LOWER_LOG_ID,
                "core.diagnostic.log",
                &json!({}),
                &json!({"message": "The recognized value did not exceed the threshold."}),
            ),
            node(
                INVALID_LOG_ID,
                "core.diagnostic.log",
                &json!({}),
                &json!({"message": "The recognized value was not a finite number."}),
            ),
        ],
        "edges": [
            edge(1, "execution", START_ID, "next", CAPTURE_ID, "run"),
            edge(2, "execution", CAPTURE_ID, "next", OCR_ID, "run"),
            edge(3, "execution", OCR_ID, "next", PARSE_ID, "run"),
            edge(4, "execution", PARSE_ID, "parsed", BRANCH_ID, "run"),
            edge(5, "execution", PARSE_ID, "invalid", INVALID_LOG_ID, "run"),
            edge(6, "execution", BRANCH_ID, "whenTrue", CLICK_ID, "run"),
            edge(7, "execution", BRANCH_ID, "whenFalse", LOWER_LOG_ID, "run"),
            edge(8, "data", CAPTURE_ID, "image", OCR_ID, "image"),
            edge(9, "data", OCR_ID, "bestText", PARSE_ID, "text"),
            edge(10, "data", PARSE_ID, "number", COMPARE_ID, "left"),
            edge(11, "data", COMPARE_ID, "result", BRANCH_ID, "condition"),
            edge(12, "data", OCR_ID, "bestRect", CLICK_ID, "rect"),
        ],
    })
}

fn document(graph: &Value) -> Value {
    json!({
        "schemaVersion": 1,
        "documentId": DOCUMENT_ID,
        "metadata": {
            "name": "Cross-language gate",
            "createdAt": "2026-07-29T00:00:00Z",
            "updatedAt": "2026-07-29T00:00:00Z",
        },
        "entryGraphId": GRAPH_ID,
        "graphs": [graph],
        "assets": [],
        "requiredCapabilities": [],
    })
}

fn persisted_files(graph: &Value) -> Result<ProjectFileSet, serde_json::Error> {
    let graph_document = json!({
        "schemaVersion": 1,
        "documentId": DOCUMENT_ID,
        "graph": graph,
    });
    let manifest = json!({
        "schemaVersion": 1,
        "documentId": DOCUMENT_ID,
        "metadata": {
            "name": "Cross-language gate",
            "createdAt": "2026-07-29T00:00:00Z",
            "updatedAt": "2026-07-29T00:00:00Z",
        },
        "entryGraphId": GRAPH_ID,
        "graphs": [{"graphId": GRAPH_ID, "fileName": "main.rino.graph.json"}],
        "assets": [],
        "requiredCapabilities": [],
    });
    Ok(ProjectFileSet {
        manifest: serde_json::to_string_pretty(&manifest)?,
        graphs: vec![ProjectFile {
            file_name: "main.rino.graph.json".to_owned(),
            contents: serde_json::to_string_pretty(&graph_document)?,
        }],
    })
}

fn assemble_runtime_document(files: &ProjectFileSet) -> Result<Value, Box<dyn std::error::Error>> {
    let mut document: Value = serde_json::from_str(&files.manifest)?;
    let graph_file = files
        .graphs
        .first()
        .ok_or("the reopened project did not contain its graph")?;
    let graph_document: Value = serde_json::from_str(&graph_file.contents)?;
    document["graphs"] = json!([graph_document["graph"].clone()]);
    Ok(document)
}

fn collect_run_events(
    events: &Receiver<ForwardedEvent>,
    generation: u64,
    run_id: &str,
) -> Vec<ForwardedEvent> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut collected = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        assert!(
            !remaining.is_zero(),
            "the graph run did not reach a terminal state"
        );
        let event = events
            .recv_timeout(remaining)
            .expect("the runtime event stream ended before the graph run");
        if event.run_id.as_deref() != Some(run_id) {
            continue;
        }
        assert_eq!(event.generation, generation);
        let terminal = event.message_type == "run.stateChanged"
            && matches!(
                event.payload.get("state").and_then(Value::as_str),
                Some("succeeded" | "failed" | "cancelled")
            );
        collected.push(event);
        if terminal {
            return collected;
        }
    }
}

fn run_graph(
    harness: &mut RuntimeHarness,
    generation: u64,
    runtime_document: &Value,
) -> Vec<ForwardedEvent> {
    let result = harness
        .supervisor
        .request(
            "run.start",
            json!({
                "document": runtime_document,
                "graphId": GRAPH_ID,
                "deviceKey": "fake-device",
            }),
            Duration::from_secs(10),
        )
        .expect("the reopened graph should start");
    let run_id = result
        .get("runId")
        .and_then(Value::as_str)
        .expect("run.start should return a run identifier");
    collect_run_events(&harness.events, generation, run_id)
}

fn completed_node_ids(events: &[ForwardedEvent]) -> Vec<&str> {
    events
        .iter()
        .filter(|event| {
            event.message_type == "node.stateChanged"
                && event.payload.get("state").and_then(Value::as_str) == Some("succeeded")
        })
        .filter_map(|event| event.node_id.as_deref())
        .collect()
}

fn assert_successful_numeric_run(events: &[ForwardedEvent]) {
    let terminal = events.last().expect("the run should emit a terminal event");
    assert_eq!(terminal.message_type, "run.stateChanged");
    assert_eq!(terminal.payload.get("state"), Some(&json!("succeeded")));

    let completed = completed_node_ids(events);
    for expected in [
        START_ID, CAPTURE_ID, OCR_ID, PARSE_ID, COMPARE_ID, BRANCH_ID, CLICK_ID,
    ] {
        assert!(
            completed.contains(&expected),
            "node {expected} did not complete"
        );
    }
    assert!(!completed.contains(&LOWER_LOG_ID));
    assert!(!completed.contains(&INVALID_LOG_ID));
    assert_eq!(
        completed
            .iter()
            .filter(|node_id| **node_id == CLICK_ID)
            .count(),
        1,
        "one run must dispatch the click node exactly once",
    );
}

#[test]
fn a_saved_graph_reopens_runs_and_recovers_across_a_sidecar_restart()
-> Result<(), Box<dyn std::error::Error>> {
    let Some(mut harness) = runtime_harness() else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return Ok(());
    };
    let temporary = TemporaryRoot::create()?;
    let project_root = temporary.child("project")?;
    let recovery_root = temporary.child("recovery")?;
    let mut workspace = ProjectWorkspace::new(recovery_root);
    let graph = numeric_graph();
    let files = persisted_files(&graph)?;

    workspace.choose_location(&project_root)?;
    workspace.create(&files)?;
    let reopened = workspace.open(&project_root.join("project.rino.json"))?;
    let runtime_document = assemble_runtime_document(&reopened.files)?;

    let started = harness
        .supervisor
        .start()
        .expect("the persisted-workflow runtime should start");
    assert_eq!(started.state, SupervisorState::Ready);
    assert_eq!(started.generation, 1);
    let validation = harness
        .supervisor
        .request(
            "graph.validate",
            json!({"document": runtime_document.clone()}),
            Duration::from_secs(10),
        )
        .expect("the reopened document should cross the runtime validation boundary");
    assert_eq!(validation.get("executable"), Some(&json!(true)));

    let first = run_graph(&mut harness, 1, &runtime_document);
    assert_successful_numeric_run(&first);

    let restarted = harness
        .supervisor
        .restart(false)
        .expect("the runtime should restart after the first completed run");
    assert_eq!(restarted.state, SupervisorState::Ready);
    assert_eq!(restarted.generation, 2);
    let second = run_graph(&mut harness, 2, &runtime_document);
    assert_successful_numeric_run(&second);
    assert_eq!(completed_node_ids(&first), completed_node_ids(&second));

    harness.supervisor.shutdown();
    Ok(())
}

#[test]
fn a_cross_process_run_cancels_idempotently() {
    let Some(mut harness) = runtime_harness() else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the fake runtime should start");
    let delayed_graph = json!({
        "graphId": GRAPH_ID,
        "name": "Cancellation",
        "kind": "entry",
        "nodes": [
            node(START_ID, "core.flow.start", &json!({}), &json!({})),
            node(
                DELAY_ID,
                "core.time.delay",
                &json!({}),
                &json!({"durationMilliseconds": 60_000}),
            ),
        ],
        "edges": [edge(20, "execution", START_ID, "next", DELAY_ID, "run")],
    });
    let delayed_document = document(&delayed_graph);
    let started = harness
        .supervisor
        .request(
            "run.start",
            json!({"document": delayed_document, "graphId": GRAPH_ID}),
            Duration::from_secs(10),
        )
        .expect("the delayed graph should start");
    let run_id = started
        .get("runId")
        .and_then(Value::as_str)
        .expect("run.start should return a run identifier")
        .to_owned();

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let event = harness
            .events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("the delay node did not enter the running state");
        if event.run_id.as_deref() == Some(&run_id)
            && event.node_id.as_deref() == Some(DELAY_ID)
            && event.payload.get("state").and_then(Value::as_str) == Some("running")
        {
            break;
        }
    }

    let first_cancel = harness
        .supervisor
        .request(
            "run.cancel",
            json!({"runId": run_id}),
            Duration::from_secs(10),
        )
        .expect("the active run should accept cancellation");
    assert_eq!(first_cancel.get("alreadyRequested"), Some(&json!(false)));
    let terminal = collect_run_events(&harness.events, 1, &run_id);
    assert_eq!(
        terminal.last().and_then(|event| event.payload.get("state")),
        Some(&json!("cancelled")),
    );

    let repeated = harness
        .supervisor
        .request(
            "run.cancel",
            json!({"runId": run_id}),
            Duration::from_secs(10),
        )
        .expect("repeated cancellation should be idempotent");
    assert_eq!(repeated.get("alreadyRequested"), Some(&json!(true)));
    assert_eq!(repeated.get("state"), Some(&json!("cancelled")));

    harness.supervisor.shutdown();
}
