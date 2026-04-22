from __future__ import annotations

from typing import Any

import requests
from requests_oauthlib import OAuth1

from .settings import Settings


class XClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = "https://api.x.com/2"
        self.oauth = OAuth1(
            client_key=settings.x_api_key,
            client_secret=settings.x_api_secret,
            resource_owner_key=settings.x_access_token,
            resource_owner_secret=settings.x_access_token_secret,
        )
        self.session = requests.Session()
        self.session.auth = self.oauth
        if settings.x_bearer_token:
            self.session.headers.update({"Authorization": f"Bearer {settings.x_bearer_token}"})

    def whoami(self) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}/users/me",
            params={"user.fields": "description,public_metrics,verified,created_at"},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def mentions(self, limit: int = 5) -> dict[str, Any]:
        user_id = self.settings.x_user_id or self._resolve_user_id()
        response = self.session.get(
            f"{self.base_url}/users/{user_id}/mentions",
            params={
                "max_results": max(5, min(limit, 100)),
                "tweet.fields": "author_id,created_at,public_metrics,conversation_id",
                "expansions": "author_id",
                "user.fields": "username,name,public_metrics",
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def lookup_users(self, usernames: list[str]) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}/users/by",
            params={
                "usernames": ",".join(usernames),
                "user.fields": "description,public_metrics,verified,created_at",
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def user_tweets(self, user_id: str, limit: int = 5) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}/users/{user_id}/tweets",
            params={
                "max_results": max(5, min(limit, 100)),
                "exclude": "retweets",
                "tweet.fields": "author_id,created_at,public_metrics,conversation_id,referenced_tweets",
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def recent_search(self, query: str, limit: int = 10) -> dict[str, Any]:
        response = self.session.get(
            f"{self.base_url}/tweets/search/recent",
            params={
                "query": query,
                "max_results": max(10, min(limit, 100)),
                "tweet.fields": "author_id,created_at,public_metrics,conversation_id,referenced_tweets",
                "expansions": "author_id",
                "user.fields": "username,name,description,public_metrics,verified",
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def create_post(self, text: str, reply_to_tweet_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"text": text}
        if reply_to_tweet_id:
            payload["reply"] = {"in_reply_to_tweet_id": reply_to_tweet_id}
        response = self.session.post(f"{self.base_url}/tweets", json=payload, timeout=60)
        response.raise_for_status()
        return response.json()

    def follow_user(self, source_user_id: str, target_user_id: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/users/{source_user_id}/following",
            json={"target_user_id": target_user_id},
            timeout=60,
        )
        response.raise_for_status()
        return response.json()

    def _resolve_user_id(self) -> str:
        data = self.whoami()
        user_id = str((data.get("data") or {}).get("id") or "")
        if not user_id:
            raise RuntimeError("could not resolve X user id from /users/me")
        self.settings.x_user_id = user_id
        return user_id
