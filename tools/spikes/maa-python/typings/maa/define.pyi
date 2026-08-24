from enum import IntEnum, IntFlag

class LoggingLevelEnum(IntEnum):
    Off: LoggingLevelEnum

class MaaControllerFeatureEnum(IntFlag):
    Null: MaaControllerFeatureEnum

class Rect:
    x: int
    y: int
    w: int
    h: int

    def __init__(self, x: int, y: int, w: int, h: int) -> None: ...

class RecognitionDetail:
    reco_id: int
    hit: bool
    box: Rect | None

class ActionDetail:
    action_id: int
    success: bool

class NodeDetail:
    recognition: RecognitionDetail | None
    action: ActionDetail | None

class TaskDetail:
    nodes: list[NodeDetail]
