# Third-party notices

## SudachiPy

SudachiPy is pinned by `backend/requirements.txt` to `>=0.7,<0.8`.
It is distributed under the Apache License 2.0. The package source and
license text are available from the SudachiPy distribution.

## Sudachi dictionaries

`sudachidict_small==20261015` and `sudachidict_core==20261015` are pinned
for reproducible Windows packaging. These exact wheel distributions include
Apache-2.0 license files. The underlying UniDic resources retain the UniDic
BSD 3-Clause attribution and terms where applicable; the installed wheel
license files are authoritative for redistribution.

## mecab-ipadic-NEologd acknowledgments

Sudachi's dictionary lineage and Japanese lexical resources acknowledge
mecab-ipadic-NEologd contributors. Kiroku Note does not bundle NEologd or
copy its database contents.

## R2 dictionary decision

The small dictionary is the default. On the 150-case R1 corpus, all cases
were still marked `needs_owner_review`, so no quality winner can be claimed.
The available benchmark measured small at 4,743 ms and 507,477 peak bytes,
versus core at 9,980 ms and 1,095,476 peak bytes; installed dictionary data
was 115,306,807 bytes versus 202,236,214 bytes. Small therefore wins the
current size/startup trade-off without treating unreviewed quality as
authoritative.
