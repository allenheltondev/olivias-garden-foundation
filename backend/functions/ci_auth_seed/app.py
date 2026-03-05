import base64
import json
import os
import secrets
import string
from typing import Dict, Optional
from urllib.parse import unquote, urlparse

import boto3
import pg8000.native
from botocore.exceptions import ClientError

USER_POOL_ID = os.environ["USER_POOL_ID"]
USER_POOL_CLIENT_ID = os.environ["USER_POOL_CLIENT_ID"]
DATABASE_URL = os.environ["DATABASE_URL"]
cognito = boto3.client("cognito-idp")


def _random_suffix() -> str:
    return secrets.token_hex(4)


def _strong_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return (
        secrets.choice(string.ascii_uppercase)
        + secrets.choice(string.ascii_lowercase)
        + secrets.choice(string.digits)
        + secrets.choice("!@#$%^&*")
        + "".join(secrets.choice(alphabet) for _ in range(16))
    )


def _decode_sub_from_jwt(id_token: str) -> str:
    payload_segment = id_token.split(".")[1]
    padding = "=" * (-len(payload_segment) % 4)
    payload_json = base64.urlsafe_b64decode(payload_segment + padding).decode("utf-8")
    payload = json.loads(payload_json)
    sub = payload.get("sub")
    if not sub:
        raise RuntimeError("Unable to decode user sub from id token")
    return sub


def _db_connection_from_url(url: str) -> pg8000.native.Connection:
    parsed = urlparse(url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise RuntimeError("DATABASE_URL must use postgres/postgresql scheme")

    return pg8000.native.Connection(
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        host=parsed.hostname or "",
        port=parsed.port or 5432,
        database=(parsed.path or "").lstrip("/"),
        ssl_context=True,
    )


def _upsert_subscription_tier(
    conn: pg8000.native.Connection,
    user_id: str,
    email: str,
    tier: str,
    subscription_status: str,
) -> None:
    premium_expires_sql: Optional[str]
    if tier == "premium":
        premium_expires_sql = "now() + interval '365 days'"
    else:
        premium_expires_sql = "null"

    conn.run(
        f"""
        insert into users (
          id,
          email,
          display_name,
          is_verified,
          tier,
          subscription_status,
          premium_expires_at
        )
        values (
          :user_id,
          :email,
          :display_name,
          true,
          :tier,
          :subscription_status,
          {premium_expires_sql}
        )
        on conflict (id) do update
        set email = excluded.email,
            display_name = excluded.display_name,
            is_verified = true,
            tier = excluded.tier,
            subscription_status = excluded.subscription_status,
            premium_expires_at = excluded.premium_expires_at,
            updated_at = now(),
            deleted_at = null
        """,
        user_id=user_id,
        email=email,
        display_name=f"CI {tier.title()} User",
        tier=tier,
        subscription_status=subscription_status,
    )


def _create_and_sign_in_user(user_label: str) -> Dict[str, str]:
    for _ in range(5):
        suffix = _random_suffix()
        email = f"ci+{user_label}-{suffix}@example.com"
        password = _strong_password()

        try:
            cognito.admin_create_user(
                UserPoolId=USER_POOL_ID,
                Username=email,
                MessageAction="SUPPRESS",
                UserAttributes=[
                    {"Name": "email", "Value": email},
                    {"Name": "email_verified", "Value": "true"},
                ],
            )
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "UsernameExistsException":
                continue
            raise

        cognito.admin_set_user_password(
            UserPoolId=USER_POOL_ID,
            Username=email,
            Password=password,
            Permanent=True,
        )

        auth_response = cognito.admin_initiate_auth(
            UserPoolId=USER_POOL_ID,
            ClientId=USER_POOL_CLIENT_ID,
            AuthFlow="ADMIN_USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        )

        tokens = auth_response["AuthenticationResult"]
        return {
            "email": email,
            "access_token": tokens["AccessToken"],
            "id_token": tokens["IdToken"],
            "refresh_token": tokens["RefreshToken"],
        }

    raise RuntimeError(f"Failed to create a unique Cognito user for label '{user_label}'")


def handler(_event, _context):
    grower_free = _create_and_sign_in_user("grower-free")
    grower_premium = _create_and_sign_in_user("grower-premium")
    gatherer = _create_and_sign_in_user("gatherer")

    conn = _db_connection_from_url(DATABASE_URL)
    try:
        _upsert_subscription_tier(
            conn,
            user_id=_decode_sub_from_jwt(grower_free["id_token"]),
            email=grower_free["email"],
            tier="free",
            subscription_status="none",
        )
        _upsert_subscription_tier(
            conn,
            user_id=_decode_sub_from_jwt(grower_premium["id_token"]),
            email=grower_premium["email"],
            tier="premium",
            subscription_status="active",
        )
        _upsert_subscription_tier(
            conn,
            user_id=_decode_sub_from_jwt(gatherer["id_token"]),
            email=gatherer["email"],
            tier="free",
            subscription_status="none",
        )
    finally:
        conn.close()

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(
            {
                "grower": grower_premium,
                "grower_free": grower_free,
                "grower_premium": grower_premium,
                "gatherer": gatherer,
            }
        ),
    }
