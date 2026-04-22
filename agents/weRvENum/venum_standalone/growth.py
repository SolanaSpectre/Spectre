from __future__ import annotations

from math import log10

from .models import Topic


class GrowthEngine:
    def __init__(self, policy: dict) -> None:
        self.policy = policy
        self.allowed_domains = [item.lower() for item in policy.get("allowed_domains", [])]
        self.forbidden_domains = [item.lower() for item in policy.get("forbidden_domains", [])]
        self.weights = policy.get("score_weights", {})

    def score_topic(self, topic: Topic, memory_seen: bool) -> tuple[float, list[str]]:
        text = topic.combined_text.lower()
        relevance = self._relevance_score(text, topic.tags)
        freshness = self._freshness_score(topic.age_hours)
        conversation = self._conversation_score(topic.metrics)
        novelty = 10.0 if not memory_seen else 0.0

        score = (
            relevance * float(self.weights.get("relevance", 0.34))
            + freshness * float(self.weights.get("freshness", 0.24))
            + conversation * float(self.weights.get("conversation", 0.22))
            + novelty * float(self.weights.get("novelty", 0.20))
        ) * 10.0

        rationale = [
            f"relevance {relevance:.1f}/10",
            f"freshness {freshness:.1f}/10",
            f"conversation {conversation:.1f}/10",
            "novel" if novelty > 0 else "already touched recently",
        ]
        return round(score, 2), rationale

    def _relevance_score(self, text: str, tags: list[str]) -> float:
        if any(domain in text for domain in self.forbidden_domains):
            return 0.0
        hits = 0
        for domain in self.allowed_domains:
            if domain in text:
                hits += 2
        for tag in tags:
            if any(domain in tag for domain in self.allowed_domains):
                hits += 1
        return min(10.0, 2.0 + hits)

    def _freshness_score(self, age_hours: float) -> float:
        if age_hours <= 0.5:
            return 10.0
        if age_hours <= 2:
            return 8.0
        if age_hours <= 6:
            return 6.0
        if age_hours <= 12:
            return 4.0
        return 2.0

    def _conversation_score(self, metrics: dict[str, float]) -> float:
        likes = float(metrics.get("likes", 0.0))
        replies = float(metrics.get("replies", 0.0))
        reposts = float(metrics.get("reposts", 0.0))
        quotes = float(metrics.get("quotes", 0.0))
        total = likes + (replies * 2.0) + (quotes * 2.5) + (reposts * 1.5)
        return min(10.0, log10(total + 1.0) * 2.6)
