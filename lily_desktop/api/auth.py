from __future__ import annotations

import logging
import time

from warrant_lite import WarrantLite

from core.constants import COGNITO_CLIENT_ID, COGNITO_REGION, COGNITO_USER_POOL_ID

logger = logging.getLogger(__name__)


class CognitoAuth:
    """Cognito SRP認証でJWTトークンを取得・管理する"""

    def __init__(self, email: str, password: str):
        self._email = email
        self._password = password
        self._id_token: str | None = None
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expires_at: float = 0

    @property
    def is_configured(self) -> bool:
        return bool(self._email and self._password)

    async def get_id_token(self) -> str:
        if self._id_token and time.time() < self._expires_at:
            return self._id_token
        await self._authenticate()
        assert self._id_token is not None
        return self._id_token

    async def _authenticate(self) -> None:
        import asyncio

        loop = asyncio.get_event_loop()
        tokens = await loop.run_in_executor(None, self._srp_auth)
        self._id_token = tokens["AuthenticationResult"]["IdToken"]
        self._access_token = tokens["AuthenticationResult"]["AccessToken"]
        self._refresh_token = tokens["AuthenticationResult"].get("RefreshToken", self._refresh_token)
        # IdTokenは60分有効、50分で更新
        self._expires_at = time.time() + 50 * 60
        logger.info("Cognito認証成功")

    def _srp_auth(self) -> dict:
        wl = WarrantLite(
            username=self._email,
            password=self._password,
            pool_id=COGNITO_USER_POOL_ID,
            client_id=COGNITO_CLIENT_ID,
            client=self._get_boto_client(),
        )
        return wl.authenticate_user()

    def _get_boto_client(self):
        import boto3

        return boto3.client("cognito-idp", region_name=COGNITO_REGION)
