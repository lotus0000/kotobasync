import re
import unicodedata

# Hiragana, prolonged sound mark, voicing marks, middle dot and spaces.
_HIRAGANA_READING = re.compile(r"^[ぁ-ゖ゙-゜ー・ ]+$")


def normalize_surface(s: str) -> str:
    return unicodedata.normalize("NFKC", s).strip()


def is_hiragana_reading(s: str) -> bool:
    return bool(_HIRAGANA_READING.match(s))
