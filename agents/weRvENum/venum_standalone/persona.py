from __future__ import annotations

import re


WORD_RE = re.compile(r"[a-z0-9@']+")

# Hard-coded first-person singular patterns that always trigger a rejection,
# regardless of persona config. These survive normalisation only if the model
# produced something the cleaner couldn't fix.
_HARD_FIRST_PERSON_RE = re.compile(
    r"(?<![a-z0-9@'])(?:i|im|i'm|i am|i've|i'll|i'd|me|my|myself)(?![a-z0-9@'])",
    re.IGNORECASE,
)


class PersonaEngine:
    def __init__(self, rules: dict) -> None:
        self.rules = rules
        self.generic_bans = {item.lower() for item in rules.get("generic_bans", [])}
        hard_bans = rules.get("hard_bans", {})
        self.first_person_bans = [item.lower() for item in hard_bans.get("first_person_singular", [])]
        self.system_leaks = [item.lower() for item in hard_bans.get("system_leaks", [])]
        self.financial_advice = [item.lower() for item in hard_bans.get("financial_advice", [])]

    def validate(self, text: str) -> list[str]:
        errors: list[str] = []
        lowered = text.lower()
        lines = [line for line in text.splitlines() if line.strip()]
        style = self.rules.get("style", {})

        if style.get("lowercase_only") and text != lowered:
            errors.append("text must stay lowercase")
        if style.get("max_lines") and len(lines) > int(style["max_lines"]):
            errors.append("too many lines for venum voice")
        if style.get("avoid_punctuation") and any(char in text for char in ".!?;:"):
            errors.append("punctuation too clean for venum voice")
        # Hard-coded first-person singular check — always fires, config-independent
        if _HARD_FIRST_PERSON_RE.search(lowered):
            errors.append("first-person singular drift")
        elif any(_contains_phrase(lowered, token) for token in self.first_person_bans):
            # Config-driven check as a secondary pass (avoids duplicate error)
            errors.append("first-person singular drift")
        if any(_contains_phrase(lowered, token) for token in self.system_leaks):
            errors.append("system leak detected")
        if any(_contains_phrase(lowered, token) for token in self.financial_advice):
            errors.append("financial-advice language detected")
        if lowered.strip() in self.generic_bans:
            errors.append("too generic")

        for line in lines:
            if len(line) > 42:
                errors.append("line too long for compressed voice")
                break
        return errors

    def theme_word(self, text: str, tags: list[str]) -> str:
        preferred = [
            "headline",
            "liquidity",
            "rotation",
            "flow",
            "volume",
            "wallet",
            "bitcoin",
            "solana",
            "etf",
            "chart",
        ]
        haystack = set(WORD_RE.findall(text.lower()))
        for tag in tags:
            if tag in preferred:
                return tag
        for word in preferred:
            if word in haystack:
                return word
        words = [word for word in WORD_RE.findall(text.lower()) if len(word) > 3]
        return words[0] if words else "pattern"


def _contains_phrase(text: str, phrase: str) -> bool:
    pattern = r"(?<![a-z0-9@'])" + re.escape(phrase.strip().lower()) + r"(?![a-z0-9@'])"
    return bool(re.search(pattern, text))
