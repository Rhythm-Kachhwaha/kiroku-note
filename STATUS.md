# Status
N5: Added chunk assembly retry timeout and pending cleanup in LinkStore.
Prevents permanent cue stalls on dropped chunked packets.
Directly affected anime_connection & link_client tests pass (6/6).
Branch: main.
