class JDirectHit:
    def __init__(
        self,
        roi: bool | str | tuple[int, int, int, int] = (0, 0, 0, 0),
        roi_offset: tuple[int, int, int, int] = (0, 0, 0, 0),
    ) -> None: ...

class JOCR:
    def __init__(
        self,
        expected: list[str] | None = None,
        roi: bool | str | tuple[int, int, int, int] = (0, 0, 0, 0),
        roi_offset: tuple[int, int, int, int] = (0, 0, 0, 0),
        threshold: float = 0.3,
        replace: list[list[str]] | None = None,
        order_by: str = "Horizontal",
        index: int = 0,
        only_rec: bool = False,
        model: str = "",
        color_filter: str = "",
    ) -> None: ...

class JClick:
    def __init__(
        self,
        target: bool | str | tuple[int, int, int, int] = True,
        target_offset: tuple[int, int, int, int] = (0, 0, 0, 0),
        contact: int = 0,
        pressure: int = 1,
    ) -> None: ...
