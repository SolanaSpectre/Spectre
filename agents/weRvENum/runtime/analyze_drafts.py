import json
from collections import Counter

data = open("runtime/trend-hunt-test5.txt", encoding="utf-8-sig").read()
parsed = json.loads(data)
drafts = parsed.get("drafts", [])
stats = parsed.get("stats", {})

total = len(drafts)
clean = sum(1 for d in drafts if not d.get("validation_errors"))
errors = [e for d in drafts for e in d.get("validation_errors", [])]
ec = Counter(errors)

print(f"stats: {stats}")
print(f"total drafts: {total}")
print(f"clean (zero errors): {clean}")
print(f"error breakdown: {dict(ec)}")
print()
print("--- CLEAN DRAFTS ---")
for d in drafts:
    if not d.get("validation_errors"):
        ctx = d.get("room_context", "?")
        tone = d.get("primary_tone", "?")
        handle = d.get("author_handle", "?")
        opp = d.get("opportunity_score", 0)
        print(f"[{ctx} / {tone}] @{handle} (opp:{opp})")
        print(d.get("text", ""))
        print()

print("--- SAMPLE WITH ERRORS ---")
shown = 0
for d in drafts:
    if d.get("validation_errors") and shown < 5:
        ctx = d.get("room_context", "?")
        tone = d.get("primary_tone", "?")
        handle = d.get("author_handle", "?")
        errs = d.get("validation_errors", [])
        print(f"[{ctx} / {tone}] @{handle} errors={errs}")
        print(d.get("text", ""))
        print()
        shown += 1
