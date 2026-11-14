# Status
Bridged Python worker to Turso libSQL with TursoQueueAdapter and op_log leases.
Added fallback switch for KIROKU_USE_HTTP_QUEUE and updated requirements.
Verified atomic leases, ack/nack state transitions, and worker processing.
All 18 targeted worker and Turso tests passing cleanly.
