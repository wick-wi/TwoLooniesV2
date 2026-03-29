"""
Admin API routes.  All endpoints are mounted under /api/admin/* and require
an authenticated user with profiles.is_admin = true.

This module is imported at the bottom of api/index.py and registers its routes
on the shared FastAPI `app` instance.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _require_admin(authorization: str | None) -> str:
    """Verify JWT and confirm the user has is_admin = true.  Returns user_id."""
    from api.index import _get_user_from_token  # noqa: PLC0415 (avoid circular at module level)
    from api.supabase_client import supabase  # noqa: PLC0415

    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        resp = (
            supabase.table("profiles")
            .select("is_admin")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if not resp or not resp.data or not resp.data.get("is_admin"):
            raise HTTPException(status_code=403, detail="Admin access required")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Admin check failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not verify admin status")
    return user_id


def _audit(admin_id: str, action: str, target_type: str | None = None,
           target_id: str | None = None, details: dict | None = None) -> None:
    """Best-effort insert to admin_audit_log."""
    try:
        from api.supabase_client import supabase  # noqa: PLC0415
        if supabase:
            supabase.table("admin_audit_log").insert({
                "admin_id": admin_id,
                "action": action,
                "target_type": target_type,
                "target_id": target_id,
                "details": details,
            }).execute()
    except Exception as e:
        logger.warning("Audit log failed: %s", e)


# ---------------------------------------------------------------------------
# Registration helper
# ---------------------------------------------------------------------------

def register_admin_routes(app) -> None:  # noqa: ANN001
    """Register all admin routes on the FastAPI app instance."""

    # -----------------------------------------------------------------------
    # Public endpoint (no auth required) for system status flags
    # -----------------------------------------------------------------------

    @app.get("/api/system/status")
    def system_status():
        """Public endpoint returning maintenance_mode and other non-sensitive flags."""
        from api.utils.admin_config import get_admin_config_bool  # noqa: PLC0415
        return {
            "maintenance_mode": get_admin_config_bool("maintenance_mode", default=False),
            "loonie_ai_enabled": get_admin_config_bool("loonie_ai_enabled", default=True),
        }

    # -----------------------------------------------------------------------
    # Config endpoints
    # -----------------------------------------------------------------------

    @app.get("/api/admin/config")
    def admin_list_config(authorization: str = Header(None, alias="Authorization")):
        """List all admin config keys and values."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from api.utils.admin_config import ADMIN_CONFIG_WIRED_KEYS  # noqa: PLC0415

        resp = supabase.table("admin_config").select("*").order("key").execute()
        rows = list(resp.data or [])
        for row in rows:
            row["runtime_wired"] = row.get("key") in ADMIN_CONFIG_WIRED_KEYS
        return {"config": rows}

    @app.get("/api/admin/config/{key}")
    def admin_get_config(key: str, authorization: str = Header(None, alias="Authorization")):
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from api.utils.admin_config import ADMIN_CONFIG_WIRED_KEYS  # noqa: PLC0415

        resp = supabase.table("admin_config").select("*").eq("key", key).maybe_single().execute()
        if not resp or not resp.data:
            raise HTTPException(status_code=404, detail=f"Config key '{key}' not found")
        data = dict(resp.data)
        data["runtime_wired"] = key in ADMIN_CONFIG_WIRED_KEYS
        return data

    @app.patch("/api/admin/config/{key}")
    def admin_update_config(
        key: str,
        body: dict = None,
        authorization: str = Header(None, alias="Authorization"),
    ):
        admin_id = _require_admin(authorization)
        if body is None or "value" not in body:
            raise HTTPException(status_code=400, detail="Request body must contain 'value'")
        from api.utils.admin_config import ADMIN_CONFIG_WIRED_KEYS, set_admin_config  # noqa: PLC0415

        set_admin_config(key, body["value"], admin_id)
        return {
            "key": key,
            "value": body["value"],
            "updated": True,
            "runtime_wired": key in ADMIN_CONFIG_WIRED_KEYS,
        }

    # -----------------------------------------------------------------------
    # Prompt versioning endpoints
    # -----------------------------------------------------------------------

    @app.get("/api/admin/prompts")
    def admin_list_prompts(authorization: str = Header(None, alias="Authorization")):
        _require_admin(authorization)
        from api.parsers.prompts import PROMPT_VERSIONS_WIRED_TO_EXTRACTION  # noqa: PLC0415
        from api.supabase_client import supabase  # noqa: PLC0415

        resp = (
            supabase.table("prompt_versions")
            .select("*")
            .order("prompt_key")
            .order("version", desc=True)
            .execute()
        )
        return {
            "prompts": resp.data or [],
            "extraction_runtime_wired": PROMPT_VERSIONS_WIRED_TO_EXTRACTION,
        }

    @app.post("/api/admin/prompts")
    def admin_create_prompt(
        body: dict = None,
        authorization: str = Header(None, alias="Authorization"),
    ):
        admin_id = _require_admin(authorization)
        if not body or not body.get("prompt_key") or not body.get("content"):
            raise HTTPException(status_code=400, detail="prompt_key and content are required")

        from api.supabase_client import supabase  # noqa: PLC0415

        prompt_key = body["prompt_key"]
        # Determine next version number
        existing = (
            supabase.table("prompt_versions")
            .select("version")
            .eq("prompt_key", prompt_key)
            .order("version", desc=True)
            .limit(1)
            .execute()
        )
        next_version = (existing.data[0]["version"] + 1) if existing.data else 1

        row = {
            "prompt_key": prompt_key,
            "content": body["content"],
            "version": next_version,
            "is_active": body.get("is_active", False),
            "notes": body.get("notes"),
            "created_by": admin_id,
        }
        resp = supabase.table("prompt_versions").insert(row).execute()
        _audit(admin_id, "prompt_create", "prompt", prompt_key, {"version": next_version})
        return resp.data[0] if resp.data else row

    @app.patch("/api/admin/prompts/{prompt_id}/activate")
    def admin_activate_prompt(
        prompt_id: str,
        authorization: str = Header(None, alias="Authorization"),
    ):
        admin_id = _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from api.utils.admin_config import invalidate_cache  # noqa: PLC0415

        # Fetch the prompt to know its key
        row_resp = (
            supabase.table("prompt_versions")
            .select("prompt_key, version")
            .eq("id", prompt_id)
            .maybe_single()
            .execute()
        )
        if not row_resp or not row_resp.data:
            raise HTTPException(status_code=404, detail="Prompt version not found")
        prompt_key = row_resp.data["prompt_key"]

        # Deactivate all versions for this key
        supabase.table("prompt_versions").update({"is_active": False}).eq("prompt_key", prompt_key).execute()
        # Activate the selected version
        supabase.table("prompt_versions").update({"is_active": True}).eq("id", prompt_id).execute()

        # Bust cache so next extraction picks it up
        invalidate_cache(f"prompt:{prompt_key}")
        from api.parsers.prompts import PROMPT_VERSIONS_WIRED_TO_EXTRACTION  # noqa: PLC0415

        _audit(admin_id, "prompt_activate", "prompt", prompt_id, {"prompt_key": prompt_key})
        return {
            "activated": True,
            "prompt_id": prompt_id,
            "prompt_key": prompt_key,
            "extraction_runtime_wired": PROMPT_VERSIONS_WIRED_TO_EXTRACTION,
        }

    @app.delete("/api/admin/prompts/{prompt_id}")
    def admin_delete_prompt(
        prompt_id: str,
        authorization: str = Header(None, alias="Authorization"),
    ):
        admin_id = _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        supabase.table("prompt_versions").delete().eq("id", prompt_id).execute()
        _audit(admin_id, "prompt_delete", "prompt", prompt_id)
        return {"deleted": True}

    # -----------------------------------------------------------------------
    # User management endpoints
    # -----------------------------------------------------------------------

    @app.get("/api/admin/users")
    def admin_list_users(
        page: int = 1,
        page_size: int = 20,
        search: str = None,
        authorization: str = Header(None, alias="Authorization"),
    ):
        """Paginated list of users with aggregated counts."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415

        offset = (page - 1) * page_size

        # Fetch from profiles joined with statement/transaction counts
        q = supabase.table("profiles").select("id, display_name, created_at, is_admin")
        if search:
            q = q.ilike("display_name", f"%{search}%")
        profiles_resp = q.order("created_at", desc=True).range(offset, offset + page_size - 1).execute()
        profiles = profiles_resp.data or []

        # Enrich with counts
        enriched = []
        for p in profiles:
            uid = p["id"]
            stmt_count = 0
            tx_count = 0
            try:
                sc = supabase.table("user_statements").select("id", count="exact").eq("user_id", uid).execute()
                stmt_count = sc.count or 0
            except Exception:
                pass
            try:
                tc = supabase.table("transactions").select("id", count="exact").eq("user_id", uid).execute()
                tx_count = tc.count or 0
            except Exception:
                pass
            enriched.append({**p, "statement_count": stmt_count, "transaction_count": tx_count})

        return {"users": enriched, "page": page, "page_size": page_size}

    @app.get("/api/admin/users/{user_id}")
    def admin_get_user(user_id: str, authorization: str = Header(None, alias="Authorization")):
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415

        profile = (
            supabase.table("profiles")
            .select("*")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if not profile or not profile.data:
            raise HTTPException(status_code=404, detail="User not found")

        stmts = (
            supabase.table("user_statements")
            .select("id, filename, start_date, end_date, provider, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        accounts = (
            supabase.table("accounts")
            .select("id, name, account_type, account_subtype, provider")
            .eq("user_id", user_id)
            .execute()
        )
        return {
            "profile": profile.data,
            "statements": stmts.data or [],
            "accounts": accounts.data or [],
        }

    @app.delete("/api/admin/users/{target_user_id}/hard-delete")
    def admin_hard_delete_user(
        target_user_id: str,
        authorization: str = Header(None, alias="Authorization"),
    ):
        """
        GDPR/CCPA hard delete: wipe all data for target_user_id.
        Cascades through storage → transactions/balances/holdings → accounts → profile → auth user.
        """
        admin_id = _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415

        errors: list[str] = []

        # 1. Delete all storage objects for this user
        storage_bucket = "statement-pdfs"
        try:
            import os as _os
            storage_bucket = _os.environ.get("STATEMENT_PDF_BUCKET", "statement-pdfs")
            # List objects under user_id/ prefix
            objects = supabase.storage.from_(storage_bucket).list(target_user_id)
            if objects:
                keys = [f"{target_user_id}/{o['name']}" for o in objects if o.get("name")]
                if keys:
                    supabase.storage.from_(storage_bucket).remove(keys)
        except Exception as e:
            errors.append(f"storage: {e}")
            logger.warning("Hard delete: storage cleanup failed for %s: %s", target_user_id, e)

        # 2. Delete transactions (cascade from accounts handles most, but explicit for safety)
        try:
            supabase.table("transactions").delete().eq("user_id", target_user_id).execute()
        except Exception as e:
            errors.append(f"transactions: {e}")

        # 3. Delete balances and holdings
        for tbl in ("balances", "holdings"):
            try:
                supabase.table(tbl).delete().eq("user_id", target_user_id).execute()
            except Exception as e:
                errors.append(f"{tbl}: {e}")

        # 4. Delete user_statements (cascades to transactions via FK, but already done above)
        try:
            supabase.table("user_statements").delete().eq("user_id", target_user_id).execute()
        except Exception as e:
            errors.append(f"user_statements: {e}")

        # 5. Delete accounts
        try:
            supabase.table("accounts").delete().eq("user_id", target_user_id).execute()
        except Exception as e:
            errors.append(f"accounts: {e}")

        # 6. Delete plaid_items
        try:
            supabase.table("plaid_items").delete().eq("user_id", target_user_id).execute()
        except Exception as e:
            errors.append(f"plaid_items: {e}")

        # 7. Delete profile
        try:
            supabase.table("profiles").delete().eq("id", target_user_id).execute()
        except Exception as e:
            errors.append(f"profiles: {e}")

        # 8. Delete auth user (admin API)
        try:
            supabase.auth.admin.delete_user(target_user_id)
        except Exception as e:
            errors.append(f"auth: {e}")
            logger.warning("Hard delete: auth.admin.delete_user failed for %s: %s", target_user_id, e)

        _audit(admin_id, "user_hard_delete", "user", target_user_id, {
            "errors": errors,
        })
        return {"deleted": True, "user_id": target_user_id, "errors": errors}

    # -----------------------------------------------------------------------
    # Audit log
    # -----------------------------------------------------------------------

    @app.get("/api/admin/audit-log")
    def admin_audit_log(
        page: int = 1,
        page_size: int = 50,
        authorization: str = Header(None, alias="Authorization"),
    ):
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        offset = (page - 1) * page_size
        resp = (
            supabase.table("admin_audit_log")
            .select("*")
            .order("created_at", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        return {"logs": resp.data or [], "page": page, "page_size": page_size}

    # -----------------------------------------------------------------------
    # API key status
    # -----------------------------------------------------------------------

    @app.get("/api/admin/api-key-status")
    def admin_api_key_status(authorization: str = Header(None, alias="Authorization")):
        """Show which API keys are configured (masked), with last-used timestamp."""
        _require_admin(authorization)
        import os as _os  # noqa: PLC0415
        from api.supabase_client import supabase  # noqa: PLC0415

        def _mask(val: str | None) -> str | None:
            if not val:
                return None
            if len(val) <= 8:
                return "****"
            return val[:4] + "..." + val[-4:]

        def _env_raw(name: str) -> str | None:
            """Resolve env value; some rows combine alternate variable names."""
            if name == "SUPABASE_SECRET_KEY":
                return _os.environ.get("SUPABASE_SECRET_KEY") or _os.environ.get("SUPABASE_SERVICE_KEY")
            return _os.environ.get(name)

        # Checklist: variables the FastAPI app (and related modules) actually read via os.environ.
        # Omitted on purpose: REACT_APP_* / NEXT_PUBLIC_* — consumed at CRA/Web build time, not by this Python runtime.
        # QSTASH_URL is rarely needed (SDK default); include if you want parity with Vercel UI.
        _ENV_CHECKLIST: list[tuple[str, str]] = [
            ("AI & extraction", "GOOGLE_API_KEY"),
            ("AI & extraction", "GEMINI_API_KEY"),
            ("AI & extraction", "GEMINI_MODEL_PASS1"),
            ("AI & extraction", "GEMINI_MODEL_PASS2"),
            ("AI & extraction", "STATEMENT_PARSER"),
            ("Supabase (backend)", "SUPABASE_URL"),
            ("Supabase (backend)", "SUPABASE_SECRET_KEY"),
            ("Supabase (backend)", "SUPABASE_JWT_SECRET"),
            ("Plaid", "PLAID_CLIENT_ID"),
            ("Plaid", "PLAID_SECRET"),
            ("Plaid", "PLAID_ENV"),
            ("QStash & callbacks", "QSTASH_TOKEN"),
            ("QStash & callbacks", "QSTASH_URL"),
            ("QStash & callbacks", "QSTASH_CURRENT_SIGNING_KEY"),
            ("QStash & callbacks", "QSTASH_NEXT_SIGNING_KEY"),
            ("QStash & callbacks", "QSTASH_CALLBACK_BASE_URL"),
            ("QStash & callbacks", "APP_PUBLIC_URL"),
            ("QStash & callbacks", "USE_QSTASH"),
            ("Redis / job store", "UPSTASH_REDIS_REST_URL"),
            ("Redis / job store", "UPSTASH_REDIS_REST_TOKEN"),
            ("Redis / job store", "REDIS_URL"),
            ("Docling", "DOCLING_MODE"),
            ("Docling", "DOCLING_SERVICE_URL"),
            ("Docling", "DOCLING_CONVERT_PATH"),
            ("Storage & misc", "STATEMENT_PDF_BUCKET"),
            ("Storage & misc", "ENABLE_PASS3"),
            ("Storage & misc", "CORS_ALLOWED_ORIGINS"),
        ]

        # Last successful Gemini call from extraction_events
        last_used: dict[str, str | None] = {}
        if supabase:
            try:
                ev = (
                    supabase.table("extraction_events")
                    .select("created_at")
                    .eq("status", "success")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                ts = ev.data[0]["created_at"] if ev.data else None
                last_used["GOOGLE_API_KEY"] = ts
                last_used["GEMINI_API_KEY"] = ts
            except Exception:
                pass

        key_rows = []
        for section, name in _ENV_CHECKLIST:
            v = _env_raw(name)
            key_rows.append({
                "section": section,
                "name": name,
                "configured": bool(v and str(v).strip()),
                "masked": _mask(v) if v else None,
                "last_used": last_used.get(name),
            })

        return {"keys": key_rows}

    # -----------------------------------------------------------------------
    # Analytics endpoints
    # -----------------------------------------------------------------------

    @app.get("/api/admin/analytics/extraction-summary")
    def admin_extraction_summary(
        period: str = "7d",
        authorization: str = Header(None, alias="Authorization"),
    ):
        """Daily extraction cost, latency percentiles, error rate."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from datetime import timedelta  # noqa: PLC0415

        days = int(period.replace("d", "").replace("w", "7")) if period else 7
        if period.endswith("w"):
            days = int(period.replace("w", "")) * 7

        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            resp = (
                supabase.table("extraction_events")
                .select("created_at, status, duration_ms, estimated_cost_usd, transaction_count")
                .gte("created_at", since)
                .order("created_at")
                .execute()
            )
            rows = resp.data or []
        except Exception as e:
            logger.error("extraction-summary query failed: %s", e)
            rows = []

        # Aggregate by day
        from collections import defaultdict  # noqa: PLC0415
        by_day: dict[str, dict] = defaultdict(lambda: {
            "date": "", "total": 0, "success": 0, "error": 0,
            "cost_usd": 0.0, "durations": [],
        })

        for r in rows:
            day = (r.get("created_at") or "")[:10]
            d = by_day[day]
            d["date"] = day
            d["total"] += 1
            if r.get("status") == "success":
                d["success"] += 1
            else:
                d["error"] += 1
            d["cost_usd"] = round(d["cost_usd"] + float(r.get("estimated_cost_usd") or 0), 6)
            if r.get("duration_ms") is not None:
                d["durations"].append(r["duration_ms"])

        summary = []
        for day_key in sorted(by_day.keys()):
            d = by_day[day_key]
            durs = sorted(d.pop("durations"))
            n = len(durs)
            def _pct(lst, p):
                if not lst:
                    return None
                idx = int(len(lst) * p / 100)
                return lst[min(idx, len(lst) - 1)]
            summary.append({
                **d,
                "error_rate": round(d["error"] / d["total"], 4) if d["total"] else 0,
                "p50_ms": _pct(durs, 50),
                "p90_ms": _pct(durs, 90),
                "p99_ms": _pct(durs, 99),
            })

        return {"period": period, "days": days, "summary": summary}

    @app.get("/api/admin/analytics/confidence-distribution")
    def admin_confidence_distribution(
        period: str = "30d",
        authorization: str = Header(None, alias="Authorization"),
    ):
        """Histogram of per-transaction confidence scores."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from datetime import timedelta  # noqa: PLC0415

        days = int(period.replace("d", ""))
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            resp = (
                supabase.table("extraction_events")
                .select("confidence_scores")
                .gte("created_at", since)
                .not_.is_("confidence_scores", "null")
                .execute()
            )
            rows = resp.data or []
        except Exception:
            rows = []

        # Flatten all scores
        all_scores: list[float] = []
        for r in rows:
            cs = r.get("confidence_scores") or []
            if isinstance(cs, list):
                all_scores.extend(float(s) for s in cs if s is not None)

        # Build histogram buckets (0.0–0.1, 0.1–0.2, ..., 0.9–1.0)
        buckets = [0] * 10
        for s in all_scores:
            idx = min(int(s * 10), 9)
            buckets[idx] += 1

        histogram = [
            {"range": f"{i/10:.1f}–{(i+1)/10:.1f}", "count": buckets[i]}
            for i in range(10)
        ]
        below_threshold = sum(buckets[:8])  # scores < 0.8
        return {
            "total_scored": len(all_scores),
            "below_threshold": below_threshold,
            "histogram": histogram,
        }

    @app.get("/api/admin/analytics/upload-volume")
    def admin_upload_volume(
        period: str = "30d",
        authorization: str = Header(None, alias="Authorization"),
    ):
        """Daily upload counts and storage usage."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from datetime import timedelta  # noqa: PLC0415
        from collections import defaultdict  # noqa: PLC0415

        days = int(period.replace("d", ""))
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            resp = (
                supabase.table("user_statements")
                .select("created_at")
                .gte("created_at", since)
                .execute()
            )
            rows = resp.data or []
        except Exception:
            rows = []

        by_day: dict[str, int] = defaultdict(int)
        for r in rows:
            day = (r.get("created_at") or "")[:10]
            by_day[day] += 1

        volume = [
            {"date": d, "uploads": by_day[d]}
            for d in sorted(by_day.keys())
        ]
        return {"period": period, "total": len(rows), "volume": volume}

    @app.get("/api/admin/analytics/active-users")
    def admin_active_users(
        period: str = "30d",
        authorization: str = Header(None, alias="Authorization"),
    ):
        """DAU and MAU counts computed from extraction events."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from datetime import timedelta  # noqa: PLC0415
        from collections import defaultdict  # noqa: PLC0415

        days = int(period.replace("d", ""))
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

        try:
            resp = (
                supabase.table("extraction_events")
                .select("user_id, created_at")
                .gte("created_at", since)
                .not_.is_("user_id", "null")
                .execute()
            )
            rows = resp.data or []
        except Exception:
            rows = []

        by_day: dict[str, set] = defaultdict(set)
        mau_users: set[str] = set()
        for r in rows:
            uid = r.get("user_id")
            if not uid:
                continue
            day = (r.get("created_at") or "")[:10]
            by_day[day].add(uid)
            if r.get("created_at", "") >= month_ago:
                mau_users.add(uid)

        dau_series = [
            {"date": d, "dau": len(by_day[d])}
            for d in sorted(by_day.keys())
        ]
        return {
            "period": period,
            "mau": len(mau_users),
            "dau_series": dau_series,
        }

    @app.get("/api/admin/analytics/error-rates")
    def admin_error_rates(
        period: str = "7d",
        authorization: str = Header(None, alias="Authorization"),
    ):
        """API 4xx/5xx error rates by day."""
        _require_admin(authorization)
        from api.supabase_client import supabase  # noqa: PLC0415
        from datetime import timedelta  # noqa: PLC0415
        from collections import defaultdict  # noqa: PLC0415

        days = int(period.replace("d", ""))
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        try:
            resp = (
                supabase.table("api_request_log")
                .select("created_at, status_code, path, duration_ms")
                .gte("created_at", since)
                .execute()
            )
            rows = resp.data or []
        except Exception:
            rows = []

        by_day: dict[str, dict] = defaultdict(lambda: {"date": "", "total": 0, "4xx": 0, "5xx": 0, "durations": []})
        for r in rows:
            day = (r.get("created_at") or "")[:10]
            d = by_day[day]
            d["date"] = day
            d["total"] += 1
            code = r.get("status_code", 0)
            if 400 <= code < 500:
                d["4xx"] += 1
            elif code >= 500:
                d["5xx"] += 1
            if r.get("duration_ms") is not None:
                d["durations"].append(r["duration_ms"])

        result = []
        for day_key in sorted(by_day.keys()):
            d = by_day[day_key]
            durs = sorted(d.pop("durations"))
            result.append({
                **d,
                "error_rate": round((d["4xx"] + d["5xx"]) / d["total"], 4) if d["total"] else 0,
                "p50_ms": durs[len(durs) // 2] if durs else None,
                "p99_ms": durs[int(len(durs) * 0.99)] if durs else None,
            })

        return {"period": period, "days": days, "error_rates": result}

    @app.get("/api/admin/queue-health")
    async def admin_queue_health(authorization: str = Header(None, alias="Authorization")):
        """Live look at pending/processing/failed job counts from Redis."""
        _require_admin(authorization)
        from api.upload_job_redis import job_redis_get  # noqa: PLC0415
        from api.supabase_client import supabase  # noqa: PLC0415

        # Check extraction_events for recent job statuses
        counts = {"pending": 0, "processing": 0, "success": 0, "error": 0}
        try:
            if supabase:
                from datetime import timedelta  # noqa: PLC0415
                since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
                resp = (
                    supabase.table("extraction_events")
                    .select("status")
                    .gte("created_at", since)
                    .execute()
                )
                for r in (resp.data or []):
                    s = r.get("status", "")
                    if s in counts:
                        counts[s] += 1
        except Exception:
            pass

        return {"queue": counts, "source": "extraction_events_last_24h"}

    logger.info("Admin routes registered successfully")
