"""Hard constants and helpers for all doctrine-era film modules."""
from __future__ import annotations

from dataclasses import dataclass

W, H, FPS = 1080, 1920, 30
SAFE_LEFT, SAFE_RIGHT = 90, 990
SAFE_TOP, SAFE_BOTTOM, HARD_FLOOR = 250, 1590, 1610
RIGHT_RAIL_START_Y, RIGHT_RAIL_CLEAR = 1150, 130


@dataclass(frozen=True)
class Box:
    left: int
    top: int
    right: int
    bottom: int
    label: str = "element"


def in_safe_core(box: Box) -> bool:
    return SAFE_LEFT <= box.left and box.right <= SAFE_RIGHT and SAFE_TOP <= box.top and box.bottom <= SAFE_BOTTOM


def assert_safe(box: Box) -> None:
    if not in_safe_core(box):
        raise ValueError(
            f"{box.label} violates safe core x{SAFE_LEFT}-{SAFE_RIGHT}, y{SAFE_TOP}-{SAFE_BOTTOM}: "
            f"received x{box.left}-{box.right}, y{box.top}-{box.bottom}"
        )
    if box.bottom > HARD_FLOOR:
        raise ValueError(f"{box.label} crosses the hard floor at y={HARD_FLOOR}")
    if box.top >= RIGHT_RAIL_START_Y and box.right > W - RIGHT_RAIL_CLEAR:
        raise ValueError(f"{box.label} enters the right icon rail")


def clock_lands_on_cta(value_at_cta: float, final_value: float, tolerance: float = 1e-6) -> bool:
    """Use this check in an episode's planning test before render."""
    return abs(value_at_cta - final_value) <= tolerance
