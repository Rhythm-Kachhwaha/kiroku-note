1: Hardened extension-auth module with 13 scenarios and frozen-extension-auth tag.
2: Enforced CSRF state integrity and one-time consumption during OAuth exchange.
3: Added VALIDATE_CLOUD_AUTH in background worker with fail-closed token purge on 401.
4: Preserved separate sidepanel modules; guaranteed consistent session across storage keys.
5: Validated direct token parameters against /auth/me before persisting session credentials.
