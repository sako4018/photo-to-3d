"""One error type for the server: what happened, what to do about it, and the HTTP status."""

from __future__ import annotations


class AppError(Exception):
    def __init__(self, message: str, hint: str = "", status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.status = status

    def as_dict(self) -> dict[str, str]:
        return {"error": self.message, "hint": self.hint}
