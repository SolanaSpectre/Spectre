from __future__ import annotations


def categorize_account(user: dict, follow_policy: dict) -> dict:
    description = str(user.get("description") or "").lower()
    categories = []
    category_keywords = follow_policy.get("category_keywords") or {}
    for category, keywords in category_keywords.items():
        hits = [keyword for keyword in keywords if str(keyword).lower() in description]
        if hits:
            categories.append({"category": category, "hits": hits[:3]})
    return {
        "primary_category": categories[0]["category"] if categories else "unclear",
        "categories": categories,
    }


def score_recent_posts(posts: list[dict], follow_policy: dict) -> dict:
    blocked_keywords = [item.lower() for item in follow_policy.get("hard_blocked_post_keywords", [])]
    quality = 0
    bad = 0
    reply_posts = 0
    reasons = []
    for post in posts:
        text = str(post.get("text") or "").lower()
        metrics = post.get("public_metrics") or {}
        likes = float(metrics.get("like_count", 0.0) or 0.0)
        reply_count = float(metrics.get("reply_count", 0.0) or 0.0)
        reposts = float(metrics.get("retweet_count", 0.0) or 0.0)
        if text.startswith("@"):
            reply_posts += 1
        blocked_hit = next((keyword for keyword in blocked_keywords if keyword in text), "")
        if blocked_hit:
            bad += 1
            reasons.append(f"promo-like post: {blocked_hit}")
            continue
        if likes >= 10 or reply_count >= 3 or reposts >= 2:
            quality += 1
    total_posts = len(posts)
    reply_ratio = (reply_posts / total_posts) if total_posts else 0.0
    return {
        "quality_posts": quality,
        "bad_posts": bad,
        "reply_ratio": round(reply_ratio, 3),
        "reasons": reasons[:3],
    }
