"""Job state Redis: Upstash REST on Vercel when env is set, else redis-py TCP (e.g. local Docker)."""
from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_upstash_client: Any = None
_tcp_client: Any = None


def _upstash_rest_configured() -> bool:
    url = (os.getenv("UPSTASH_REDIS_REST_URL") or "").strip()
    token = (os.getenv("UPSTASH_REDIS_REST_TOKEN") or "").strip()
    return bool(url and token)


def _get_clients() -> tuple[Any | None, Any | None]:
    """Returns (upstash_async_redis_or_none, redis_asyncio_or_none)."""
    global _upstash_client, _tcp_client
    if _upstash_rest_configured():
        if _upstash_client is None:
            from upstash_redis.asyncio import Redis

            _upstash_client = Redis(
                url=os.environ["UPSTASH_REDIS_REST_URL"].strip(),
                token=os.environ["UPSTASH_REDIS_REST_TOKEN"].strip(),
            )
        return _upstash_client, None
    if _tcp_client is None:
        import redis.asyncio as redis

        redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
        _tcp_client = redis.from_url(redis_url, decode_responses=True)
    return None, _tcp_client


async def job_redis_setex(key: str, seconds: int, value: str) -> None:
    upstash, tcp = _get_clients()
    if upstash is not None:
        await upstash.setex(key, seconds, value)
    else:
        await tcp.setex(key, seconds, value)


async def job_redis_get(key: str) -> str | None:
    upstash, tcp = _get_clients()
    if upstash is not None:
        data = await upstash.get(key)
    else:
        data = await tcp.get(key)
    if data is None:
        return None
    if isinstance(data, bytes):
        return data.decode("utf-8")
    return str(data)
