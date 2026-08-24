from maa.controller import Controller
from maa.define import ActionDetail, LoggingLevelEnum, RecognitionDetail, Rect
from maa.job import Job, TaskJob
from maa.pipeline import JClick, JDirectHit
from maa.resource import Resource
from numpy import uint8
from numpy.typing import NDArray

class TaskerEventSink:
    def on_raw_notification(
        self,
        tasker: Tasker,
        msg: str,
        details: dict[str, object],
    ) -> None: ...

class Tasker:
    inited: bool
    running: bool

    def __init__(self) -> None: ...
    def add_sink(self, sink: TaskerEventSink) -> int | None: ...
    def remove_sink(self, sink_id: int) -> None: ...
    def bind(self, resource: Resource, controller: Controller) -> bool: ...
    def post_recognition(
        self,
        reco_type: str,
        reco_param: JDirectHit,
        image: NDArray[uint8],
    ) -> TaskJob: ...
    def post_action(
        self,
        action_type: str,
        action_param: JClick,
        box: Rect,
        reco_detail: str = "",
    ) -> TaskJob: ...
    def post_task(
        self,
        entry: str,
        pipeline_override: dict[str, object] = {},
    ) -> TaskJob: ...
    def post_stop(self) -> Job: ...
    def get_recognition_detail(self, reco_id: int) -> RecognitionDetail | None: ...
    def get_action_detail(self, action_id: int) -> ActionDetail | None: ...
    @staticmethod
    def set_debug_mode(debug_mode: bool) -> bool: ...
    @staticmethod
    def set_save_draw(save_draw: bool) -> bool: ...
    @staticmethod
    def set_save_on_error(save_on_error: bool) -> bool: ...
    @staticmethod
    def set_stdout_level(level: LoggingLevelEnum) -> bool: ...
