1: Enforced strict auth-derived identity on attempts/bookmarks and isolated guest sessions.
2: Made sync push fail closed on DB errors, preserved stable queue IDs, and added keyset cursor.
3: Made progress sync idempotent with event tracking and decoded compressed BYTEA during due hydration.
4: Prevented service API key leakage into user data routes and hardened loopback OAuth callbacks.
5: Verified with 80 edge/desktop/extension tests and 149 pytest test cases passing 100%.
