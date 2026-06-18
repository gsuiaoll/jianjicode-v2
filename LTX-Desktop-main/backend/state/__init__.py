"""State package exports."""

from state.deps import get_state_service, init_state_service, set_state_service_for_tests
from state.app_state_types import AppState


def __getattr__(name: str):
    if name in ("AppHandler", "build_initial_state"):
        from app_handler import AppHandler, build_initial_state  # noqa: F811  # lazy to break circular imports
        return {"AppHandler": AppHandler, "build_initial_state": build_initial_state}[name]
    if name == "RuntimeConfig":
        from runtime_config.runtime_config import RuntimeConfig
        return RuntimeConfig
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "AppState",
    "AppHandler",
    "RuntimeConfig",
    "build_initial_state",
    "get_state_service",
    "init_state_service",
    "set_state_service_for_tests",
]
