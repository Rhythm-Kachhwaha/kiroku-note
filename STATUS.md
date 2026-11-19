1: Added tombstone deletion table to prevent card resurrection.
2: Preserved 5 omitted card columns & enabled update sync pushing.
3: Batched Turso transactions & bounded episode cache to 20 LRU.
4: Made review state and logs atomic with db_session rollback blocks.
5: Serialized extension card queues & added SQLite engine PRAGMAs.