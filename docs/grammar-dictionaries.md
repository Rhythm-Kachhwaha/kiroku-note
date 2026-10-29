# Grammar dictionaries

Kiroku's bundled grammar index (Tier 0) works offline and supplies matching,
JLPT levels, and short English explanations. A designated Yomitan grammar
dictionary (Tier 1) is optional enrichment; it never replaces the local
index and is only queried when a sentence is analyzed.

## Setup

1. Install Yomitan in Chromium/Brave.
2. Import a Japanese grammar dictionary through Yomitan's settings.
3. Open Kiroku **Settings → Grammar Settings**, enter the dictionary name,
   and choose **Test Grammar Setup**.

Open conversion projects and personal grammar notes can be useful sources.
Check the source package's licence and redistribution terms before importing
or sharing a dictionary. Some third-party grammar dictionaries include
vocabulary, idioms, or duplicate entries; Kiroku treats their results as
supporting context rather than authoritative matches.

The basic-particle filter hides standalone particles by default while retaining
compound points. Enable **Show Basic Particles** only when a sentence-level
particle review is desired.
