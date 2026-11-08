# Anime Mode E2E Test Harness

Runs end-to-end scenarios against a real running backend subprocess and real Chrome browser with the unpacked extension loaded.

## Running Scenarios
From repository root:
`npm.cmd --prefix tools/anime_e2e run e2e -- e01`
Or directly:
`python tools/anime_e2e/run_e2e.py e01`

To run all scenarios:
`python tools/anime_e2e/run_e2e.py all`

