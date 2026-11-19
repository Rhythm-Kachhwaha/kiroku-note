1: Hardened token revocation, shortcut tokens, and auth codes with durable Turso backing.
2: Resolved user_op_log schema drift with error column migration and non-fatal queue nack.
3: Eliminated silent progress sync loss, unbounded batch payloads, and pull cursor starvation.
4: Secured OAuth flow by omitting JWT from redirect URLs and enforcing single-use durable exchange.
5: Tenant-scoped queue worker, dead-lettered corrupt payloads, and escaped HTML sinks.
