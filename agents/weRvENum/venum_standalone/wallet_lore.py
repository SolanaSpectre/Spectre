from __future__ import annotations

from .persona import PersonaEngine


def classify_wallet_entry(entry: dict) -> dict:
    name = str(entry.get("display_name") or entry.get("username") or "trader").lower()
    username = str(entry.get("username") or "").lower()
    profit = float(entry.get("sol_profit", 0.0) or 0.0)
    winrate = float(entry.get("winrate", 0.0) or 0.0)
    wins = int(entry.get("wins", 0) or 0)
    losses = int(entry.get("losses", 0) or 0)
    total = wins + losses

    if any(token in f"{name} {username}" for token in ["spood", "spider", "web"]):
        return {
            "archetype": "spoodee_trade",
            "reason": "spider-coded trader identity triggered rivalry lane",
        }

    if profit >= 100 and winrate >= 0.50:
        return {
            "archetype": "clean_win",
            "reason": "big profit with solid winrate",
        }

    if profit >= 60 and winrate < 0.45:
        return {
            "archetype": "ugly_win",
            "reason": "large profit despite messy hit rate",
        }

    if profit >= 25 and total <= 12:
        return {
            "archetype": "hero_call",
            "reason": "meaningful profit on limited attempts",
        }

    if profit <= 5 and winrate < 0.40:
        return {
            "archetype": "bad_hand",
            "reason": "weak profit and weak winrate",
        }

    return {
        "archetype": "mixed_hand",
        "reason": "decent result but not a clean story",
    }


def wallet_reaction_candidates(entry: dict) -> list[str]:
    name = str(entry.get("display_name") or entry.get("username") or "trader")
    profit = float(entry.get("sol_profit", 0.0) or 0.0)
    winrate = float(entry.get("winrate", 0.0) or 0.0)
    wins = int(entry.get("wins", 0) or 0)
    losses = int(entry.get("losses", 0) or 0)
    verdict = classify_wallet_entry(entry)
    archetype = verdict["archetype"]

    if archetype == "clean_win":
        drafts = [
            f"{wins} up {losses} down\n\nstill walk out grene",
            f"{name.lower()} hit clean today\n\n{profit:.0f} sol not accident",
            "good hand no panic\n\nchart got respected",
        ]
    elif archetype == "ugly_win":
        drafts = [
            f"{wins} up {losses} down\n\nstill rob room somehow",
            f"{name.lower()} trade ugly\n\nbag still fat",
            "bad hand good exit\n\nsame crooked miracle",
        ]
    elif archetype == "hero_call":
        drafts = [
            f"{wins} hits only\n\nhero hand today",
            f"{name.lower()} saw it early\n\nroom still sleepy",
            "few swings big bite\n\nclean thief work",
        ]
    elif archetype == "bad_hand":
        drafts = [
            f"{name.lower()} fight chart\n\nchart win agen",
            f"{wins} right {losses} wrong\n\nspoodee math",
            "bad hand costume on\n\nsame loss page",
        ]
    elif archetype == "spoodee_trade":
        drafts = [
            "spoodee trade ledger open\n\nweb hand shaky",
            f"{wins} up {losses} down\n\nspoodee count funny",
            f"{name.lower()} do web math\n\nwe not impressed",
        ]
    else:
        drafts = [
            f"{name.lower()} got sum touch\n\nnot magic jus timing",
            "clean hand in spots\n\nmess in spots too",
            f"{profit:.0f} sol say sumtin\n\nchart told em early",
        ]

    seen = []
    for draft in drafts:
        if draft not in seen:
            seen.append(draft)
    return seen[:3]


def choose_wallet_reaction(entry: dict, persona: PersonaEngine) -> dict:
    verdict = classify_wallet_entry(entry)
    best = None
    best_score = float("-inf")
    evaluations = []
    for text in wallet_reaction_candidates(entry):
        errors = persona.validate(text)
        score = 30.0
        if errors:
            score -= 30.0
        if len(text) <= 120:
            score += 6.0
        if any(token in text.lower() for token in ["same every day", "agen", "grene", "timing", "chart", "spoodee"]):
            score += 5.0
        evaluations.append({"text": text, "validation_errors": errors, "score": score})
        if score > best_score:
            best_score = score
            best = evaluations[-1]
    return {"classification": verdict, "best": best, "all": evaluations}
