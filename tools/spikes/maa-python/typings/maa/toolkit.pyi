from pathlib import Path

class AdbDevice:
    name: str
    adb_path: Path
    address: str
    screencap_methods: int
    input_methods: int
    config: dict[str, object]

class Toolkit:
    @staticmethod
    def init_option(
        user_path: Path | str,
        default_config: dict[str, object] = {},
    ) -> bool: ...
    @staticmethod
    def find_adb_devices(
        specified_adb: Path | str | None = None,
    ) -> list[AdbDevice]: ...
