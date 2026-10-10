"""Lookup of the available engines by id. Engines are created lazily."""

from __future__ import annotations

from collections.abc import Callable

from .base import Engine


def _dummy() -> Engine:
    from .dummy import DummyEngine

    return DummyEngine()


def _triposr() -> Engine:
    from .triposr import TripoSREngine

    return TripoSREngine()


def _triposg() -> Engine:
    from .triposg import TripoSGEngine

    return TripoSGEngine()


_FACTORIES: dict[str, Callable[[], Engine]] = {
    "dummy": _dummy,
    "triposr": _triposr,
    "triposg": _triposg,
}

DEFAULT_ENGINE = "triposr"


def engine_ids() -> list[str]:
    return list(_FACTORIES)


def get_engine(engine_id: str) -> Engine:
    try:
        return _FACTORIES[engine_id]()
    except KeyError:
        raise ValueError(f"Unknown engine {engine_id!r}, available: {engine_ids()}") from None
