"""Lookup of the available engines by id. Engines are created lazily."""

from __future__ import annotations

from collections.abc import Callable

from .base import Engine


def _dummy() -> Engine:
    from .dummy import DummyEngine

    return DummyEngine()


def _triposg() -> Engine:
    from .triposg import TripoSGEngine

    return TripoSGEngine()


_FACTORIES: dict[str, Callable[[], Engine]] = {
    "dummy": _dummy,
    "triposg": _triposg,
}

DEFAULT_ENGINE = "triposg"

# Engines that were removed, and what takes their place (projects saved with them still work).
RETIRED = {"triposr": "triposg"}
# Which way is up in the raw.glb that a removed engine left in a project folder.
RETIRED_UP_AXIS = {"triposr": "z"}


def engine_ids() -> list[str]:
    return list(_FACTORIES)


def get_engine(engine_id: str) -> Engine:
    engine_id = RETIRED.get(engine_id, engine_id)
    try:
        return _FACTORIES[engine_id]()
    except KeyError:
        raise ValueError(f"Unknown engine {engine_id!r}, available: {engine_ids()}") from None


def raw_up_axis(engine_id: str) -> str:
    """Up axis of a raw mesh made by `engine_id`, also for engines that were removed."""
    return RETIRED_UP_AXIS.get(engine_id) or get_engine(engine_id).up_axis
