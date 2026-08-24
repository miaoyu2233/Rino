from pathlib import Path

from maa.job import Job

class Resource:
    loaded: bool

    def __init__(self) -> None: ...
    def post_pipeline(self, path: Path | str) -> Job: ...
    def post_ocr_model(self, path: Path | str) -> Job: ...
