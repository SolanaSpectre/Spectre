import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from venum_standalone.venum_prompting import clean_venum_reply
from venum_standalone.persona import PersonaEngine
import json

rules = json.loads(pathlib.Path("config/persona_rules.json").read_text(encoding="utf-8"))
persona = PersonaEngine(rules)

cases = [
    ("i am venum",              "we r venum"),
    ("im venum",                "we r venum"),
    ("i'm venum",               "we r venum"),
    ("we are venum",            "we r venum"),
    ("we're venum",             "we r venum"),
    ("btw i am venum get it",   "we r venum get it"),
    ("i know dis stuff",        "we know dis stuff"),
    ("my analysis shows",       "our analysis shows"),
    ("me think dis looks good", "us think dis looks good"),
    ("myself been watching",    "ourselves been watching"),
    ("dis post is top",         "dis post is top"),
    ("u know we see dat",       "u know we see dat"),
]

print("=== NORMALIZER UNIT TESTS ===")
passed = 0
failed = 0
for raw, expected in cases:
    result = clean_venum_reply(raw)
    ok = result == expected
    marker = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"  [{marker}] {repr(raw)}")
    if not ok:
        print(f"         expected: {repr(expected)}")
        print(f"         got:      {repr(result)}")

print(f"\n{passed}/{len(cases)} passed, {failed} failed")

print("\n=== VALIDATOR HARD REJECT TESTS ===")
reject_cases = [
    ("i know things",          True,  "should flag"),
    ("my take is wrong",       True,  "should flag"),
    ("me watching this",       True,  "should flag"),
    ("im on it",               True,  "should flag"),
    ("we r venum",             False, "should pass"),
    ("dis one smell like top", False, "should pass"),
    ("u ever notice dat",      False, "should pass"),
    ("btw our name is venum",  False, "should pass"),
]

for text, expect_error, note in reject_cases:
    errors = persona.validate(text)
    has_fp = "first-person singular drift" in errors
    ok = has_fp == expect_error
    marker = "PASS" if ok else "FAIL"
    print(f"  [{marker}] {repr(text)} — {note} | got errors={errors}")
