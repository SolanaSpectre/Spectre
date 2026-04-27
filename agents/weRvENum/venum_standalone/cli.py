from __future__ import annotations

import argparse
import json
from pathlib import Path

from .config_loader import load_json, load_topics
from .follow_logic import score_follow_candidate, select_follow_candidates
from .growth import GrowthEngine
from .kolscan import fetch_kolscan_leaderboard_entries, fetch_kolscan_usernames, merge_tracked_accounts
from .memory import MemoryStore
from .ollama_client import OllamaClient
from .narrative_brief import build_narrative_brief, write_brief
from .paths import config_file, runtime_file
from .persona import PersonaEngine
from .pipeline import build_candidates
from .rick_context_bridge import DEFAULT_RICK_CONTEXT, source_window_from_rick_context, topics_from_rick_context
from .settings import load_settings
from .venum_prompting import reply_prompt_for_mode, spoodee_post_prompt, venum_system_prompt
from .x_client import XClient
from .engagement_logic import classify_room_context, choose_engagement_type, detect_narrative_relevance, select_tone, should_suppress
from .x_integration import choose_best_candidate, filter_replyable_mentions, filter_replyable_search, filter_replyable_timelines, score_trend_opportunity, topics_from_mentions, topics_from_search, topics_from_timelines, topics_from_trending
from .wallet_lore import choose_wallet_reaction
from .x_budget import XBudgetExceeded
from .lore import can_post_spoodee_today, load_lore_memory, record_spoodee_post, should_inject_spoodee, spoodee_post_candidates


DEFAULT_TOPICS = config_file("example_topics.json")
DEFAULT_PERSONA = config_file("persona_rules.json")
DEFAULT_POLICY = config_file("growth_policy.json")
DEFAULT_ATTENTION_POLICY = config_file("attention_policy.json")
DEFAULT_TRACKED_ACCOUNTS = config_file("tracked_accounts.json")
DEFAULT_FOLLOW_POLICY = config_file("follow_policy.json")
DEFAULT_ENGAGEMENT_TARGETS = config_file("engagement_targets.json")
DEFAULT_MEMORY = runtime_file("memory.json")
DEFAULT_BRIEF = runtime_file("spectre_narrative_brief_latest.json")
DEFAULT_RICK_BRIEF = runtime_file("spectre_narrative_brief_rick_latest.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Standalone Venum X draft and persona tools.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sample = subparsers.add_parser("sample", help="Generate draft output using example topics.")
    _add_common(sample)

    draft = subparsers.add_parser("draft", help="Generate candidates from a topic JSON file.")
    _add_common(draft)
    draft.add_argument("--topics", default=str(DEFAULT_TOPICS), help="Path to topic JSON file.")

    brief = subparsers.add_parser("spectre-brief", help="Build a structured narrative brief for Spectre from topic inputs.")
    brief.add_argument("--topics", default=str(DEFAULT_TOPICS), help="Path to topic JSON file.")
    brief.add_argument("--source-window", default="manual venum sweep", help="Human-readable description of the source sweep.")
    brief.add_argument("--write", default=str(DEFAULT_BRIEF), help="Optional output path for the generated brief JSON. Use '-' to skip writing.")

    brief_rick = subparsers.add_parser("spectre-brief-rick", help="Build a structured narrative brief for Spectre from a Rick context snapshot.")
    brief_rick.add_argument("--rick-context", default=str(DEFAULT_RICK_CONTEXT), help="Path to Rick context JSON file.")
    brief_rick.add_argument("--write", default=str(DEFAULT_RICK_BRIEF), help="Optional output path for the generated brief JSON. Use '-' to skip writing.")

    lint = subparsers.add_parser("lint", help="Check one draft against the persona canon.")
    lint.add_argument("--text", required=True, help="Draft text to validate.")
    lint.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")

    whoami = subparsers.add_parser("whoami", help="Fetch current X account profile using local credentials.")
    whoami.add_argument("--env-file", default="", help="Optional path to .env file.")

    budget_status = subparsers.add_parser("x-budget-status", help="Show Venum's local daily X API budget ledger.")
    budget_status.add_argument("--env-file", default="", help="Optional path to .env file.")

    mentions = subparsers.add_parser("mentions", help="Fetch mentions from X.")
    mentions.add_argument("--env-file", default="", help="Optional path to .env file.")
    mentions.add_argument("--limit", type=int, default=5)

    x_draft = subparsers.add_parser("x-draft-replies", help="Generate Venum replies for live mentions.")
    x_draft.add_argument("--env-file", default="", help="Optional path to .env file.")
    x_draft.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    x_draft.add_argument("--attention-policy", default=str(DEFAULT_ATTENTION_POLICY), help="Path to attention policy JSON.")
    x_draft.add_argument("--limit", type=int, default=5)
    x_draft.add_argument("--max-drafts", type=int, default=3, help="Maximum reply drafts to generate after triage.")
    x_draft.add_argument("--show-all-candidates", action="store_true", help="Include all generated candidates and ranking details.")

    x_post = subparsers.add_parser("x-post", help="Create a live or dry-run X post.")
    x_post.add_argument("--env-file", default="", help="Optional path to .env file.")
    x_post.add_argument("--text", required=True, help="Text to post.")
    x_post.add_argument("--reply-to", default="", help="Optional tweet id to reply to.")

    lore_post = subparsers.add_parser("spoodee-post", help="Generate an occasional spoodee hate post.")
    lore_post.add_argument("--env-file", default="", help="Optional path to .env file.")
    lore_post.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    lore_post.add_argument("--attention-policy", default=str(DEFAULT_ATTENTION_POLICY), help="Path to attention policy JSON.")
    lore_post.add_argument("--post-live", action="store_true", help="Actually post if dry run is disabled.")

    tracked_timeline = subparsers.add_parser("tracked-timeline", help="Fetch posts from tracked accounts.")
    tracked_timeline.add_argument("--env-file", default="", help="Optional path to .env file.")
    tracked_timeline.add_argument("--tracked-accounts", default=str(DEFAULT_TRACKED_ACCOUNTS), help="Path to tracked accounts JSON.")
    tracked_timeline.add_argument("--limit", type=int, default=5, help="Total accounts to inspect.")
    tracked_timeline.add_argument("--per-account", type=int, default=3, help="Posts to fetch per account.")

    tracked_draft = subparsers.add_parser("tracked-draft-replies", help="Generate Venum replies for tracked-account posts.")
    tracked_draft.add_argument("--env-file", default="", help="Optional path to .env file.")
    tracked_draft.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    tracked_draft.add_argument("--attention-policy", default=str(DEFAULT_ATTENTION_POLICY), help="Path to attention policy JSON.")
    tracked_draft.add_argument("--tracked-accounts", default=str(DEFAULT_TRACKED_ACCOUNTS), help="Path to tracked accounts JSON.")
    tracked_draft.add_argument("--limit", type=int, default=5, help="Total accounts to inspect.")
    tracked_draft.add_argument("--per-account", type=int, default=3, help="Posts to fetch per account.")
    tracked_draft.add_argument("--max-drafts", type=int, default=3, help="Maximum reply drafts to generate after triage.")
    tracked_draft.add_argument("--show-all-candidates", action="store_true", help="Include all generated candidates and ranking details.")

    kolscan = subparsers.add_parser("kolscan-bootstrap", help="Bootstrap tracked accounts from the KOLscan leaderboard.")
    kolscan.add_argument("--top", type=int, default=20, help="How many unique X usernames to pull.")
    kolscan.add_argument("--tracked-accounts", default=str(DEFAULT_TRACKED_ACCOUNTS), help="Path to tracked accounts JSON.")
    kolscan.add_argument("--write", action="store_true", help="Write the merged usernames into the tracked accounts file.")

    leaderboard = subparsers.add_parser("kolscan-leaderboard", help="Fetch parsed KOLscan leaderboard entries.")
    leaderboard.add_argument("--top", type=int, default=10, help="How many entries to return.")

    wallet_reaction = subparsers.add_parser("wallet-reaction", help="Generate a playful wallet reaction post from KOLscan leaderboard data.")
    wallet_reaction.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    wallet_reaction.add_argument("--rank", type=int, default=1, help="Leaderboard rank to react to.")
    wallet_reaction.add_argument("--top", type=int, default=20, help="How many entries to inspect from the leaderboard.")

    follow_candidates = subparsers.add_parser("follow-candidates", help="Show curated important-account follow candidates.")
    follow_candidates.add_argument("--env-file", default="", help="Optional path to .env file.")
    follow_candidates.add_argument("--top", type=int, default=20, help="How many KOLscan usernames to inspect.")
    follow_candidates.add_argument("--follow-policy", default=str(DEFAULT_FOLLOW_POLICY), help="Path to follow policy JSON.")

    follow_account = subparsers.add_parser("follow-account", help="Follow a specific account by username.")
    follow_account.add_argument("--env-file", default="", help="Optional path to .env file.")
    follow_account.add_argument("--username", required=True, help="X username to follow.")
    follow_account.add_argument("--follow-policy", default=str(DEFAULT_FOLLOW_POLICY), help="Path to follow policy JSON.")

    search_openings = subparsers.add_parser("search-openings", help="Fetch search-based engagement openings.")
    search_openings.add_argument("--env-file", default="", help="Optional path to .env file.")
    search_openings.add_argument("--engagement-targets", default=str(DEFAULT_ENGAGEMENT_TARGETS), help="Path to engagement targets JSON.")
    search_openings.add_argument("--limit", type=int, default=10, help="Posts per query.")
    search_openings.add_argument("--max-queries", type=int, default=3, help="Maximum search queries to spend X API reads on.")

    search_draft = subparsers.add_parser("search-draft-replies", help="Generate Venum replies for search-based openings.")
    search_draft.add_argument("--env-file", default="", help="Optional path to .env file.")
    search_draft.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    search_draft.add_argument("--attention-policy", default=str(DEFAULT_ATTENTION_POLICY), help="Path to attention policy JSON.")
    search_draft.add_argument("--engagement-targets", default=str(DEFAULT_ENGAGEMENT_TARGETS), help="Path to engagement targets JSON.")
    search_draft.add_argument("--limit", type=int, default=10, help="Posts per query.")
    search_draft.add_argument("--max-queries", type=int, default=3, help="Maximum search queries to spend X API reads on.")
    search_draft.add_argument("--max-drafts", type=int, default=3, help="Maximum reply drafts to generate after triage.")
    search_draft.add_argument("--show-all-candidates", action="store_true", help="Include all generated candidates and ranking details.")

    trend_hunt = subparsers.add_parser("trend-hunt", help="Hunt trending topics and generate room-aware Venum reply drafts.")
    trend_hunt.add_argument("--env-file", default="", help="Optional path to .env file.")
    trend_hunt.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    trend_hunt.add_argument("--attention-policy", default=str(DEFAULT_ATTENTION_POLICY), help="Path to attention policy JSON.")
    trend_hunt.add_argument("--engagement-targets", default=str(DEFAULT_ENGAGEMENT_TARGETS), help="Path to engagement targets JSON.")
    trend_hunt.add_argument("--memory", default=str(DEFAULT_MEMORY), help="Path to memory JSON.")
    trend_hunt.add_argument("--limit", type=int, default=15, help="Posts per search query.")
    trend_hunt.add_argument("--max-queries", type=int, default=4, help="Maximum search queries to spend X API reads on.")
    trend_hunt.add_argument("--max-drafts", type=int, default=5, help="Maximum reply drafts to generate after triage.")
    trend_hunt.add_argument("--min-opportunity-score", type=float, default=30.0, help="Minimum trend opportunity score to draft.")
    trend_hunt.add_argument("--show-all-candidates", action="store_true", help="Include all generated candidates and ranking details.")
    trend_hunt.add_argument("--remember", action="store_true", help="Persist accepted engagements into memory after drafting.")
    return parser


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--persona", default=str(DEFAULT_PERSONA), help="Path to persona rules JSON.")
    parser.add_argument("--policy", default=str(DEFAULT_POLICY), help="Path to growth policy JSON.")
    parser.add_argument("--memory", default=str(DEFAULT_MEMORY), help="Path to memory JSON.")
    parser.add_argument("--kind", choices=["reply", "original", "both"], default="both")
    parser.add_argument("--limit", type=int, default=6)
    parser.add_argument("--remember", action="store_true", help="Persist accepted candidates into memory.")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "lint":
        persona = PersonaEngine(load_json(Path(args.persona)))
        errors = persona.validate(args.text)
        payload = {"valid": not errors, "errors": errors}
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "spectre-brief":
        topics = load_topics(Path(args.topics))
        brief = build_narrative_brief(topics, source_window=args.source_window)
        if str(args.write).strip() != "-":
            write_brief(brief, Path(args.write))
        print(json.dumps(brief, indent=2))
        return 0

    if args.command == "spectre-brief-rick":
        topics, payload = topics_from_rick_context(Path(args.rick_context))
        brief = build_narrative_brief(topics, source_window=source_window_from_rick_context(payload))
        if str(args.write).strip() != "-":
            write_brief(brief, Path(args.write))
        print(json.dumps(brief, indent=2))
        return 0

    if args.command == "kolscan-bootstrap":
        usernames = fetch_kolscan_usernames(limit=args.top)
        payload = {"usernames": usernames}
        if args.write:
            merged = merge_tracked_accounts(Path(args.tracked_accounts), usernames)
            payload["tracked_accounts"] = merged
        print(json.dumps(payload, indent=2))
        return 0

    if args.command == "kolscan-leaderboard":
        entries = fetch_kolscan_leaderboard_entries(limit=args.top)
        print(json.dumps(entries, indent=2))
        return 0

    if args.command == "wallet-reaction":
        entries = fetch_kolscan_leaderboard_entries(limit=max(args.top, args.rank))
        match = next((item for item in entries if int(item.get("rank", 0)) == args.rank), None)
        if not match:
            print(json.dumps({"error": f"no leaderboard entry found for rank {args.rank}"}, indent=2))
            return 0
        persona = PersonaEngine(load_json(Path(args.persona)))
        decision = choose_wallet_reaction(match, persona)
        print(json.dumps({"entry": match, **decision}, indent=2))
        return 0

    if args.command in {"follow-candidates", "follow-account"}:
        settings = load_settings(Path(args.env_file) if getattr(args, "env_file", "") else None)
        x_client = XClient(settings)
        follow_policy = load_json(Path(args.follow_policy))

        if args.command == "follow-candidates":
            usernames = fetch_kolscan_usernames(limit=args.top)
            payload = x_client.lookup_users(usernames)
            users = payload.get("data") or []
            posts_by_user_id = {}
            for user in users:
                user_id = str(user.get("id") or "")
                try:
                    timeline = x_client.user_tweets(user_id, limit=5)
                    posts_by_user_id[user_id] = timeline.get("data") or []
                except XBudgetExceeded:
                    posts_by_user_id[user_id] = []
                    break
                except Exception:
                    posts_by_user_id[user_id] = []
            candidates = select_follow_candidates(users, follow_policy, posts_by_user_id)
            print(json.dumps({"candidates": candidates, "x_budget": x_client.budget_status()}, indent=2))
            return 0

        payload = x_client.lookup_users([args.username])
        users = payload.get("data") or []
        if not users:
            print(json.dumps({"error": f"username not found: {args.username}"}, indent=2))
            return 0
        user = users[0]
        posts = []
        try:
            timeline = x_client.user_tweets(str(user.get("id") or ""), limit=5)
            posts = timeline.get("data") or []
        except Exception:
            posts = []
        candidate = score_follow_candidate(user, follow_policy, posts)
        if settings.venum_dry_run:
            print(json.dumps({"dry_run": True, "candidate": candidate, "x_budget": x_client.budget_status()}, indent=2))
            return 0
        source_user_id = settings.x_user_id or str((x_client.whoami().get("data") or {}).get("id") or "")
        result = x_client.follow_user(source_user_id=source_user_id, target_user_id=candidate["id"])
        print(json.dumps({"dry_run": False, "candidate": candidate, "result": result, "x_budget": x_client.budget_status()}, indent=2))
        return 0

    if args.command in {"search-openings", "search-draft-replies"}:
        settings = load_settings(Path(args.env_file) if getattr(args, "env_file", "") else None)
        x_client = XClient(settings)
        targets = load_json(Path(args.engagement_targets))
        queries = targets.get("search_queries") or []
        payloads = []
        budget_skips = []
        for row in queries[: max(0, args.max_queries)]:
            query = str(row.get("query") or "").strip()
            if not query:
                continue
            try:
                payload = x_client.recent_search(query=query, limit=args.limit)
                payloads.append(payload)
            except XBudgetExceeded as exc:
                budget_skips.append({"query": row.get("name") or query, "reason": str(exc)})
                break
            except Exception:
                continue
        topics = topics_from_search(payloads)

        if args.command == "search-openings":
            rendered = [
                {
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "text": topic.text,
                    "tags": topic.tags,
                    "metrics": topic.metrics,
                }
                for topic in topics
            ]
            print(json.dumps({"openings": rendered, "budget_skips": budget_skips, "x_budget": x_client.budget_status()}, indent=2))
            return 0

        persona = PersonaEngine(load_json(Path(args.persona)))
        rules = load_json(Path(args.persona))
        attention_policy = load_json(Path(args.attention_policy))
        ollama = OllamaClient(settings)
        replyable, skipped = filter_replyable_search(topics, attention_policy)
        rendered = []
        for item in replyable[: max(0, args.max_drafts)]:
            topic = item["topic"]
            variants = []
            for mode in ["sharp", "funny", "ominous"]:
                reply_text = ollama.chat(
                    system_prompt=venum_system_prompt(rules),
                    user_prompt=reply_prompt_for_mode(topic, mode),
                )
                if reply_text.strip().lower() == "skip":
                    continue
                variants.append(reply_text.strip())
            if not variants:
                skipped.append(
                    {
                        "topic_id": topic.topic_id,
                        "author_handle": topic.author_handle,
                        "reason": "model_skip",
                        "score": 0.0,
                        "signals": item["signals"],
                        "text": topic.text,
                    }
                )
                continue
            decision = choose_best_candidate(topic, variants, persona)
            best = decision["best"] or {"text": "", "validation_errors": [], "score": 0.0, "echoed_terms": []}
            rendered_item = {
                "topic_id": topic.topic_id,
                "author_handle": topic.author_handle,
                "triage_score": item["score"],
                "signals": item["signals"],
                "source_text": topic.text,
                "text": best["text"],
                "validation_errors": best["validation_errors"],
                "selection_score": best["score"],
                "echoed_terms": best["echoed_terms"],
                "rationale": [f"reply to @{topic.author_handle}", item["reason"]],
            }
            if args.show_all_candidates:
                rendered_item["all_candidates"] = decision["all"]
            rendered.append(rendered_item)
        print(json.dumps({"drafts": rendered, "skipped": skipped, "budget_skips": budget_skips, "x_budget": x_client.budget_status()}, indent=2))
        return 0

    if args.command in {"whoami", "x-budget-status", "mentions", "x-draft-replies", "x-post", "spoodee-post", "tracked-timeline", "tracked-draft-replies"}:
        settings = load_settings(Path(args.env_file) if getattr(args, "env_file", "") else None)
        x_client = XClient(settings)

        if args.command == "x-budget-status":
            print(json.dumps(x_client.budget_status(), indent=2))
            return 0

        if args.command == "whoami":
            print(json.dumps({"profile": x_client.whoami(), "x_budget": x_client.budget_status()}, indent=2))
            return 0

        if args.command == "mentions":
            print(json.dumps({"mentions": x_client.mentions(limit=args.limit), "x_budget": x_client.budget_status()}, indent=2))
            return 0

        if args.command == "x-draft-replies":
            persona = PersonaEngine(load_json(Path(args.persona)))
            ollama = OllamaClient(settings)
            payload = x_client.mentions(limit=args.limit)
            topics = topics_from_mentions(payload)
            rules = load_json(Path(args.persona))
            attention_policy = load_json(Path(args.attention_policy))
            replyable, skipped = filter_replyable_mentions(topics, attention_policy)
            rendered = []
            for item in replyable[: max(0, args.max_drafts)]:
                topic = item["topic"]
                variants = []
                for mode in ["sharp", "funny", "ominous"]:
                    reply_text = ollama.chat(
                        system_prompt=venum_system_prompt(rules),
                        user_prompt=reply_prompt_for_mode(topic, mode),
                    )
                    if reply_text.strip().lower() == "skip":
                        continue
                    variants.append(reply_text.strip())
                if not variants:
                    skipped.append(
                        {
                            "topic_id": topic.topic_id,
                            "author_handle": topic.author_handle,
                            "reason": "model_skip",
                            "score": 0.0,
                            "signals": item["signals"],
                            "text": topic.text,
                        }
                    )
                    continue
                decision = choose_best_candidate(topic, variants, persona)
                best = decision["best"] or {"text": "", "validation_errors": [], "score": 0.0, "echoed_terms": []}
                rendered_item = {
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "triage_score": item["score"],
                    "signals": item["signals"],
                    "text": best["text"],
                    "validation_errors": best["validation_errors"],
                    "selection_score": best["score"],
                    "echoed_terms": best["echoed_terms"],
                    "rationale": [f"reply to @{topic.author_handle}", item["reason"]],
                }
                if args.show_all_candidates:
                    rendered_item["all_candidates"] = decision["all"]
                rendered.append(
                    {
                        **rendered_item,
                    }
                )
            print(json.dumps({"drafts": rendered, "skipped": skipped, "x_budget": x_client.budget_status()}, indent=2))
            return 0

        if args.command == "x-post":
            if settings.venum_dry_run:
                print(
                    json.dumps(
                        {
                            "dry_run": True,
                            "text": args.text,
                            "reply_to": args.reply_to or None,
                            "x_budget": x_client.budget_status(),
                        },
                        indent=2,
                    )
                )
                return 0
            print(json.dumps({"post": x_client.create_post(text=args.text, reply_to_tweet_id=args.reply_to or None), "x_budget": x_client.budget_status()}, indent=2))
            return 0

        if args.command == "spoodee-post":
            persona_rules = load_json(Path(args.persona))
            attention_policy = load_json(Path(args.attention_policy))
            persona = PersonaEngine(persona_rules)
            ollama = OllamaClient(settings)
            lore_memory = load_lore_memory()

            if not can_post_spoodee_today(attention_policy, lore_memory):
                print(json.dumps({"allowed": False, "reason": "daily_lore_limit_reached"}, indent=2))
                return 0

            variants = list(spoodee_post_candidates(persona_rules))
            if should_inject_spoodee(attention_policy, lore_memory, seed_hint="manual"):
                generated = ollama.chat(
                    system_prompt=venum_system_prompt(persona_rules),
                    user_prompt=spoodee_post_prompt(persona_rules),
                ).strip()
                if generated:
                    variants.insert(0, generated)

            decision = choose_best_candidate(
                topic=type("LoreTopic", (), {"topic_id": "spoodee-lore", "author_handle": "spoodee", "text": "spoodee rivalry old grudge web lie", "title": "", "tags": [], "metrics": {}})(),
                candidates=variants,
                persona=persona,
            )
            best = decision["best"] or {"text": "", "validation_errors": [], "score": 0.0, "echoed_terms": []}
            payload = {
                "allowed": True,
                "text": best["text"],
                "validation_errors": best["validation_errors"],
                "selection_score": best["score"],
            }
            if settings.venum_dry_run or not args.post_live:
                payload["dry_run"] = True
                if args.post_live and settings.venum_dry_run:
                    payload["note"] = "set VENUM_DRY_RUN=false to allow live lore posting"
                payload["x_budget"] = x_client.budget_status()
                print(json.dumps(payload, indent=2))
                return 0

            result = x_client.create_post(text=best["text"])
            record_spoodee_post(best["text"])
            print(json.dumps({"post_result": result, **payload, "dry_run": False, "x_budget": x_client.budget_status()}, indent=2))
            return 0

        if args.command == "tracked-timeline":
            tracked = load_json(Path(args.tracked_accounts))
            usernames = [str(item.get("username") or "").strip() for item in (tracked.get("accounts") or []) if str(item.get("username") or "").strip()]
            usernames = usernames[: args.limit]
            users = x_client.lookup_users(usernames)
            timeline_payloads = []
            for user in users.get("data") or []:
                timeline_payloads.append(x_client.user_tweets(str(user.get("id") or ""), limit=args.per_account))
            topics = topics_from_timelines(users, timeline_payloads)
            rendered = [
                {
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "text": topic.text,
                    "tags": topic.tags,
                    "metrics": topic.metrics,
                }
                for topic in topics
            ]
            print(json.dumps({"timeline": rendered, "x_budget": x_client.budget_status()}, indent=2))
            return 0

        if args.command == "tracked-draft-replies":
            persona = PersonaEngine(load_json(Path(args.persona)))
            rules = load_json(Path(args.persona))
            attention_policy = load_json(Path(args.attention_policy))
            tracked = load_json(Path(args.tracked_accounts))
            ollama = OllamaClient(settings)
            usernames = [str(item.get("username") or "").strip() for item in (tracked.get("accounts") or []) if str(item.get("username") or "").strip()]
            usernames = usernames[: args.limit]
            users = x_client.lookup_users(usernames)
            timeline_payloads = []
            for user in users.get("data") or []:
                timeline_payloads.append(x_client.user_tweets(str(user.get("id") or ""), limit=args.per_account))
            topics = topics_from_timelines(users, timeline_payloads)
            replyable, skipped = filter_replyable_timelines(topics, attention_policy)
            rendered = []
            for item in replyable[: max(0, args.max_drafts)]:
                topic = item["topic"]
                variants = []
                for mode in ["sharp", "funny", "ominous"]:
                    reply_text = ollama.chat(
                        system_prompt=venum_system_prompt(rules),
                        user_prompt=reply_prompt_for_mode(topic, mode),
                    )
                    if reply_text.strip().lower() == "skip":
                        continue
                    variants.append(reply_text.strip())
                if not variants:
                    skipped.append(
                        {
                            "topic_id": topic.topic_id,
                            "author_handle": topic.author_handle,
                            "reason": "model_skip",
                            "score": 0.0,
                            "signals": item["signals"],
                            "text": topic.text,
                        }
                    )
                    continue
                decision = choose_best_candidate(topic, variants, persona)
                best = decision["best"] or {"text": "", "validation_errors": [], "score": 0.0, "echoed_terms": []}
                rendered_item = {
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "triage_score": item["score"],
                    "signals": item["signals"],
                    "source_text": topic.text,
                    "text": best["text"],
                    "validation_errors": best["validation_errors"],
                    "selection_score": best["score"],
                    "echoed_terms": best["echoed_terms"],
                    "rationale": [f"reply to @{topic.author_handle}", item["reason"]],
                }
                if args.show_all_candidates:
                    rendered_item["all_candidates"] = decision["all"]
                rendered.append(rendered_item)
            print(json.dumps({"drafts": rendered, "skipped": skipped, "x_budget": x_client.budget_status()}, indent=2))
            return 0

    if args.command == "trend-hunt":
        settings = load_settings(Path(args.env_file) if getattr(args, "env_file", "") else None)
        x_client = XClient(settings)
        persona = PersonaEngine(load_json(Path(args.persona)))
        rules = load_json(Path(args.persona))
        attention_policy = load_json(Path(args.attention_policy))
        targets = load_json(Path(args.engagement_targets))
        memory = MemoryStore(Path(args.memory))
        ollama = OllamaClient(settings)
        min_score = float(args.min_opportunity_score)

        # Fetch all search queries, applying per-query weight multipliers
        queries = targets.get("search_queries") or []
        all_topics: list = []
        budget_skips = []
        for row in queries[: max(0, args.max_queries)]:
            query = str(row.get("query") or "").strip()
            if not query:
                continue
            weight = float(row.get("weight") or 1.0)
            try:
                payload = x_client.recent_search(query=query, limit=args.limit)
                bucket_topics = topics_from_trending([payload], weight_multiplier=weight)
                all_topics.extend(bucket_topics)
            except XBudgetExceeded as exc:
                budget_skips.append({"query": row.get("name") or query, "reason": str(exc)})
                break
            except Exception:
                continue

        # Deduplicate by topic_id
        seen_ids: set = set()
        unique_topics = []
        for t in all_topics:
            if t.topic_id and t.topic_id not in seen_ids:
                seen_ids.add(t.topic_id)
                unique_topics.append(t)

        # Score every topic and filter below threshold
        scored = []
        suppressed = []
        for topic in unique_topics:
            opp_score = score_trend_opportunity(topic, attention_policy)
            if opp_score < min_score:
                suppressed.append({
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "reason": "below_opportunity_threshold",
                    "opportunity_score": opp_score,
                    "text": topic.text,
                })
                continue

            # Room context + engagement decision
            room_context = classify_room_context(topic, attention_policy)
            engagement_type = choose_engagement_type(topic, room_context, memory, attention_policy)
            if engagement_type == "silence":
                suppressed.append({
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "reason": "engagement_suppressed",
                    "room_context": room_context,
                    "opportunity_score": opp_score,
                    "text": topic.text,
                })
                continue

            scored.append({
                "topic": topic,
                "opportunity_score": opp_score,
                "room_context": room_context,
                "engagement_type": engagement_type,
            })

        # Sort by opportunity score descending
        scored.sort(key=lambda item: item["opportunity_score"], reverse=True)

        rendered = []
        for item in scored[: max(0, args.max_drafts)]:
            topic = item["topic"]
            room_context = item["room_context"]
            engagement_type = item["engagement_type"]

            # Select tone based on room context
            primary_tone = select_tone(room_context, topic)

            # Generate 3 variants: primary tone + two supporting modes
            tone_order = [primary_tone]
            for fallback in ["sharp", "funny", "ominous", "roast"]:
                if fallback not in tone_order:
                    tone_order.append(fallback)
                if len(tone_order) >= 3:
                    break

            variants = []
            for mode in tone_order:
                try:
                    reply_text = ollama.chat(
                        system_prompt=venum_system_prompt(rules),
                        user_prompt=reply_prompt_for_mode(topic, mode),
                    )
                    if reply_text.strip().lower() != "skip":
                        variants.append(reply_text.strip())
                except Exception:
                    continue

            if not variants:
                suppressed.append({
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "reason": "model_skip",
                    "room_context": room_context,
                    "opportunity_score": item["opportunity_score"],
                    "text": topic.text,
                })
                continue

            decision = choose_best_candidate(topic, variants, persona)
            best = decision["best"] or {"text": "", "validation_errors": [], "score": 0.0, "echoed_terms": []}

            rendered_item = {
                "topic_id": topic.topic_id,
                "author_handle": topic.author_handle,
                "opportunity_score": item["opportunity_score"],
                "room_context": room_context,
                "engagement_type": engagement_type,
                "primary_tone": primary_tone,
                "source_text": topic.text,
                "text": best["text"],
                "validation_errors": best["validation_errors"],
                "selection_score": best["score"],
                "echoed_terms": best["echoed_terms"],
                "narrative_relevant": detect_narrative_relevance(topic),
                "age_hours": round(topic.age_hours, 2),
                "metrics": topic.metrics,
            }
            if args.show_all_candidates:
                rendered_item["all_candidates"] = decision["all"]
            rendered.append(rendered_item)

            if args.remember and not best["validation_errors"]:
                memory.remember(topic.topic_id, best["text"].strip().lower())
                memory.remember_engagement(
                    topic_id=topic.topic_id,
                    author_handle=topic.author_handle,
                    engagement_type=engagement_type,
                    tone=primary_tone,
                )

        if args.remember:
            memory.save()

        print(json.dumps({
            "drafts": rendered,
            "suppressed": suppressed,
            "stats": {
                "total_fetched": len(unique_topics),
                "above_threshold": len(scored),
                "drafted": len(rendered),
                "suppressed": len(suppressed),
            },
            "budget_skips": budget_skips,
            "x_budget": x_client.budget_status(),
        }, indent=2))
        return 0

    topics_path = Path(getattr(args, "topics", DEFAULT_TOPICS))
    topics = load_topics(topics_path)
    persona = PersonaEngine(load_json(Path(args.persona)))
    growth = GrowthEngine(load_json(Path(args.policy)))
    memory = MemoryStore(Path(args.memory))

    candidates = build_candidates(
        topics=topics,
        growth=growth,
        persona=persona,
        memory=memory,
        kind=args.kind,
        limit=args.limit,
    )

    rendered = []
    for item in candidates:
        rendered.append(
            {
                "type": item.candidate_type,
                "topic_id": item.topic_id,
                "score": item.score,
                "text": item.text,
                "validation_errors": item.validation_errors,
                "rationale": item.rationale,
            }
        )

    print(json.dumps(rendered, indent=2))

    if args.remember:
        for item in candidates:
            if not item.validation_errors:
                memory.remember(item.topic_id, item.text.strip().lower())
        memory.save()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
