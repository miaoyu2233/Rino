from maa.define import TaskDetail
from numpy import uint8
from numpy.typing import NDArray

class Job:
    job_id: int
    done: bool
    succeeded: bool

    def wait(self) -> Job: ...

class JobWithResult(Job):
    def wait(self) -> JobWithResult: ...
    def get(self, wait: bool = False) -> NDArray[uint8] | None: ...

class TaskJob(Job):
    def wait(self) -> TaskJob: ...
    def get(self, wait: bool = False) -> TaskDetail | None: ...
