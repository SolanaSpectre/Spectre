from __future__ import annotations

from .follow_enrichment import categorize_account, score_recent_posts


def score_follow_candidate(user: dict, follow_policy: dict, recent_posts: list[dict] | None = None) -> dict:
    username = str(user.get("username") or "")
    description = str(user.get("description") or "").lower()
    metrics = user.get("public_metrics") or {}
    followers = float(metrics.get("followers_count", 0.0) or 0.0)
    following = float(metrics.get("following_count", 0.0) or 0.0)
    tweets = float(metrics.get("tweet_count", 0.0) or 0.0)

    preferred_keywords = [item.lower() for item in follow_policy.get("preferred_keywords", [])]
    blocked_keywords = [item.lower() for item in follow_policy.get("blocked_keywords", [])]
    boosts = {item.lower() for item in follow_policy.get("boost_usernames", [])}
    min_quality_posts = int(follow_policy.get("min_quality_posts", 1) or 1)
    max_bad_posts = int(follow_policy.get("max_bad_posts", 1) or 1)
    max_reply_ratio = float(follow_policy.get("max_reply_ratio", 0.8) or 0.8)

    reasons = []
    score = 0.0

    if username.lower() in boosts:
        score += 15.0
        reasons.append("boosted account")

    keyword_hits = [item for item in preferred_keywords if item in description]
    blocked_hits = [item for item in blocked_keywords if item in description]
    if keyword_hits:
        score += min(14.0, 4.0 + (2.0 * len(keyword_hits)))
        reasons.append(f"profile keywords: {', '.join(keyword_hits[:3])}")
    if blocked_hits:
        score -= 30.0
        reasons.append(f"blocked keywords: {', '.join(blocked_hits[:2])}")

    if followers >= 10000:
        score += 10.0
        reasons.append("meaningful follower base")
    elif followers >= 1000:
        score += 6.0
        reasons.append("decent follower base")

    if 100 <= following <= 5000:
        score += 4.0
        reasons.append("active network")

    if tweets >= 1000:
        score += 5.0
        reasons.append("active account history")
    elif tweets >= 200:
        score += 2.0

    if following > 0 and followers / max(following, 1.0) >= 1.5:
        score += 4.0
        reasons.append("solid follower ratio")

    category = categorize_account(user, follow_policy)
    if category["primary_category"] != "unclear":
        score += 5.0
        reasons.append(f"category: {category['primary_category']}")

    post_quality = {"quality_posts": 0, "bad_posts": 0, "reasons": []}
    if recent_posts is not None:
        post_quality = score_recent_posts(recent_posts, follow_policy)
        if post_quality["quality_posts"] >= min_quality_posts:
            score += 8.0
            reasons.append("recent posts show signal")
        if post_quality["bad_posts"] > 0:
            score -= min(18.0, post_quality["bad_posts"] * 6.0)
            reasons.extend(post_quality["reasons"])
        if post_quality["bad_posts"] > max_bad_posts:
            score -= 15.0
            reasons.append("too many promo-like recent posts")
        if post_quality.get("reply_ratio", 0.0) > max_reply_ratio:
            score -= 10.0
            reasons.append("too reply-heavy recently")

    return {
        "username": username,
        "name": str(user.get("name") or ""),
        "id": str(user.get("id") or ""),
        "description": str(user.get("description") or ""),
        "score": round(score, 2),
        "reasons": reasons,
        "public_metrics": metrics,
        "category": category,
        "post_quality": post_quality,
    }


def select_follow_candidates(users: list[dict], follow_policy: dict, posts_by_user_id: dict[str, list[dict]] | None = None) -> list[dict]:
    min_score = float(follow_policy.get("min_follow_score", 30.0) or 30.0)
    max_candidates = int(follow_policy.get("max_candidates", 20) or 20)
    posts_by_user_id = posts_by_user_id or {}
    ranked = [score_follow_candidate(user, follow_policy, posts_by_user_id.get(str(user.get("id") or ""), [])) for user in users]
    ranked.sort(key=lambda item: item["score"], reverse=True)
    qualified = [item for item in ranked if item["score"] >= min_score]
    if qualified:
        return qualified[:max_candidates]
    return ranked[: min(10, max_candidates)]
