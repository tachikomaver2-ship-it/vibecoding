"""鉴权与轻量加密工具。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

SECRET = os.environ.get("HARNESS_SECRET") or "agentloop-harness-dev-secret"
PBKDF_ROUNDS = 120_000
SESSION_TTL = 7 * 24 * 3600


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF_ROUNDS)
    return f"pbkdf2${PBKDF_ROUNDS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(dk.hex(), digest)
    except (ValueError, AttributeError):
        return False


def _sign(payload: str) -> str:
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue_session(user_id: int) -> str:
    payload = f"{user_id}.{int(time.time()) + SESSION_TTL}"
    raw = f"{payload}.{_sign(payload)}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def read_session(token: str) -> int | None:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        uid, exp, sig = raw.split(".")
        if not hmac.compare_digest(sig, _sign(f"{uid}.{exp}")):
            return None
        if int(exp) < time.time():
            return None
        return int(uid)
    except (ValueError, UnicodeDecodeError, base64.binascii.Error):
        return None


def new_api_token() -> str:
    return "hnx_" + secrets.token_urlsafe(24)


def mask(value: str, keep: int = 4) -> str:
    if not value:
        return ""
    return value[:keep] + "…" + value[-2:] if len(value) > keep + 2 else "…"


def encrypt_local(plain: str) -> str:
    """本地演示用的可逆混淆（生产请换成 KMS/密钥管理）。"""
    if not plain:
        return ""
    key = hashlib.sha256(SECRET.encode()).digest()
    data = plain.encode()
    out = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    return "enc:" + base64.urlsafe_b64encode(out).decode()


def decrypt_local(cipher: str) -> str:
    if not cipher:
        return ""
    if not cipher.startswith("enc:"):
        return cipher
    try:
        key = hashlib.sha256(SECRET.encode()).digest()
        data = base64.urlsafe_b64decode(cipher[4:].encode())
        return bytes(b ^ key[i % len(key)] for i, b in enumerate(data)).decode()
    except (ValueError, UnicodeDecodeError, base64.binascii.Error):
        return ""
