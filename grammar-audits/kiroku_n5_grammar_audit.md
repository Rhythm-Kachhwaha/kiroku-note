# Kiroku Grammar Audit --- JLPT N5

## Goal

Perform a READ-ONLY accuracy audit of Kiroku's existing grammar
implementation against the 84 reference entries below, sourced from the
JLPT Sensei N5 list supplied by the user.

## Strict rules

-   Do NOT create, insert, update, delete, merge, or otherwise modify
    any Kiroku data.
-   Inspect the current grammar records and their JLPT-level tags only.
-   For each reference entry, determine whether a matching grammar point
    exists and whether its JLPT tag is exactly N5.
-   Match by Japanese grammar form and meaning, allowing harmless
    formatting differences (spaces, full-width/half-width punctuation,
    optional readings, and equivalent romanization).
-   Do not treat entries as equivalent merely because they share a
    particle or similar meaning. Distinguish separate grammar patterns
    where the source lists them separately, such as だろう and でしょう,
    けど and けれども, なくてはいけない and なくてはならない, and のです
    and んです.
-   If a record is a plausible match but meaning or identity is unclear,
    report it as AMBIGUOUS rather than claiming it is correct or
    missing.
-   Do not infer that a point is missing just because a search by
    romanization failed; also search Japanese form and meaning.
-   Do not check or change grammar definitions, examples, or any fields
    other than existence and JLPT tag accuracy.
-   The supplied list is the audit scope. Do not add other N5 grammar
    points that are not in this list.

## Required report

Return: 1. **Summary counts**: total reference entries (84), confirmed
correct, missing, wrong JLPT tag, ambiguous, and any duplicate/identity
concerns. Counts should add up to 84 across the per-entry statuses. 2.
**Detailed findings table** with columns: reference #, grammar point,
expected tag (N5), Kiroku status, current tag if found, and
evidence/notes. - Use only these statuses: CORRECT, MISSING, WRONG_TAG,
AMBIGUOUS. - CORRECT means a suitable matching record exists and is
tagged N5. - MISSING means no matching record exists after checking
form/reading/romanization/meaning. - WRONG_TAG means a suitable matching
record exists but its JLPT tag is not N5. - AMBIGUOUS means the data
does not support a confident determination. 3. **No changes made**
confirmation. 4. If possible, include the record ID or stable identifier
for each found record so a later correction pass can target it
precisely.

## Reference list

| \# \| Romanized reference label \| Japanese form \| Meaning from
  source \|`\n`{=tex}\|---:\|---\|---\|---\|`\n`{=tex}\| 1 \| cha ikenai
  / ja ikenai \| ちゃいけない・じゃいけない \| must not do (spoken
  Japanese) \|`\n`{=tex}\| 2 \| da / desu \| だ / です \| to be (am, is,
  are, were, used to) \|`\n`{=tex}\| 3 \| dake \| だけ \| only; just; as
  much as \~ \|`\n`{=tex}\| 4 \| darou \| だろう \| I think; it seems;
  probably; right? \|`\n`{=tex}\| 5 \| de \| で \| in; at; on; by; with;
  via \~ \|`\n`{=tex}\| 6 \| demo \| でも \| but; however; though \~
  \|`\n`{=tex}\| 7 \| deshou \| でしょう \| I think; it seems; probably;
  right? \|`\n`{=tex}\| 8 \| donna \| どんな \| what kind of; what sort
  of \|`\n`{=tex}\| 9 \| doushite \| どうして \| why; for what reason;
  how \|`\n`{=tex}\| 10 \| douyatte \| どうやって \| how; in what way;
  by what means \|`\n`{=tex}\| 11 \| ga \| が \| subject marker;
  however; but \~ \|`\n`{=tex}\| 12 \| ga arimasu \| があります \| there
  is; is (non-living things) \|`\n`{=tex}\| 13 \| ga hoshii \| がほしい
  \| to want something \|`\n`{=tex}\| 14 \| ga imasu \| がいます /
  がいる \| there is; to be; is (living things) \|`\n`{=tex}\| 15 \| hou
  ga ii \| ほうがいい \| had better; it'd be better to; should \~
  \|`\n`{=tex}\| 16 \| i-adjectives \| い-adjectives（い形容詞） \|
  i-adjectives \|`\n`{=tex}\| 17 \| ichiban \| 一番（いちばん） \| the
  most; the best \|`\n`{=tex}\| 18 \| issho ni \| 一緒に（いっしょに）
  \| together \|`\n`{=tex}\| 19 \| itsumo \| いつも \| always; usually;
  habitually \|`\n`{=tex}\| 20 \| janai / dewa nai \| じゃない・ではない
  \| to not be (am not; is not; are not) \|`\n`{=tex}\| 21 \| ka \| か
  \| question particle \|`\n`{=tex}\| 22 \| ka\~ka \| か～か \| or
  \|`\n`{=tex}\| 23 \| kara \| から \| because; since; from
  \|`\n`{=tex}\| 24 \| kata \| 方（かた） \| the way of doing something;
  how to do \~ \|`\n`{=tex}\| 25 \| kedo \| けど \| but; however;
  although \~ \|`\n`{=tex}\| 26 \| keredo mo \| けれども \| but;
  however; although \~ \|`\n`{=tex}\| 27 \| mada \| まだ \| still; not
  yet \|`\n`{=tex}\| 28 \| mada\~te imasen \| まだ～ていません \| have
  not yet \~ \|`\n`{=tex}\| 29 \| made \| まで \| until; as far as; to
  an extent; even \~ \|`\n`{=tex}\| 30 \| mae ni \| 前に（まえに） \|
  before; in front of \~ \|`\n`{=tex}\| 31 \| masen ka \| ませんか \|
  would you; do you want to; shall we \~ \|`\n`{=tex}\| 32 \| mashou \|
  ましょう \| let's \~; shall we \~ \|`\n`{=tex}\| 33 \| mashouka \|
  ましょうか \| shall I \~; used to offer help to the listener
  \|`\n`{=tex}\| 34 \| mo \| も \| too; also; as well \|`\n`{=tex}\| 35
  \| mou \| もう \| already; anymore; again; other \|`\n`{=tex}\| 36 \|
  na-adjectives \| な-adjectives（な形容詞） \| na-adjectives
  \|`\n`{=tex}\| 37 \| naa \| なあ \| sentence ending particle;
  confirmation; admiration, etc. \|`\n`{=tex}\| 38 \| naide \| ないで \|
  without doing \~; to do \[B\] without doing \[A\] \|`\n`{=tex}\| 39 \|
  naide kudasai \| ないでください \| please don't do \~ \|`\n`{=tex}\|
  40 \| naito ikenai \| ないといけない \| must do; have an obligation to
  do \~ \|`\n`{=tex}\| 41 \| naku temo ii \| なくてもいい \| don't have
  to \|`\n`{=tex}\| 42 \| nakucha \| なくちゃ \| must do; need to; gotta
  do \~ \|`\n`{=tex}\| 43 \| nakute wa ikenai \| なくてはいけない \|
  must do; need to do \|`\n`{=tex}\| 44 \| nakute wa naranai \|
  なくてはならない \| must do; need to do \~ \|`\n`{=tex}\| 45 \| naru
  \| なる \| to become \|`\n`{=tex}\| 46 \| ndesu \| んです \| to
  explain something; show emphasis \|`\n`{=tex}\| 47 \| ne \| ね \|
  isn't it? right? eh? \|`\n`{=tex}\| 48 \| ni \| に \| destination
  particle; in; at; on; to \|`\n`{=tex}\| 49 \| ni iku \|
  に行く（にいく） \| go to do \~ \|`\n`{=tex}\| 50 \| ni suru \| にする
  \| to decide on \|`\n`{=tex}\| 51 \| ni / e \| に / へ \| to
  (indicates direction / destination) \|`\n`{=tex}\| 52 \| no \| の \|
  possessive particle \|`\n`{=tex}\| 53 \| no desu \| のです \| to
  explain something; show emphasis \|`\n`{=tex}\| 54 \| no ga heta \|
  のが下手（のがへた） \| to be bad at doing something \|`\n`{=tex}\| 55
  \| no ga jouzu \| のが上手（のがじょうず） \| to be good at
  \|`\n`{=tex}\| 56 \| no ga suki \| のが好き（のがすき） \| to like
  doing something \|`\n`{=tex}\| 57 \| no naka de \[A\] ga ichiban \|
  の中で\[A\]が一番（のなかで\[A\]がいちばん） \| out of this group,
  \[A\] is best \|`\n`{=tex}\| 58 \| node \| ので \| because of; given
  that; since \~ \|`\n`{=tex}\| 59 \| o / go \| お / ご \| polite
  marker; honorific prefix particle \|`\n`{=tex}\| 60 \| o / wo \| を \|
  object marker particle \|`\n`{=tex}\| 61 \| o kudasai \| をください \|
  please give me \~ \|`\n`{=tex}\| 62 \| shikashi \| しかし \| but;
  however \~ \|`\n`{=tex}\| 63 \| sore kara \| それから \| and; and
  then; after that; since then \|`\n`{=tex}\| 64 \| soshite \| そして \|
  and; and then; thus; and now \~ \|`\n`{=tex}\| 65 \| sugiru \| すぎる
  \| too much \|`\n`{=tex}\| 66 \| ta koto ga aru \| たことがある \| to
  have done something before \|`\n`{=tex}\| 67 \| tai \| たい \| want to
  do something \|`\n`{=tex}\| 68 \| tari\~tari \| たり～たり \| do such
  things as A and B \|`\n`{=tex}\| 69 \| te aru \| てある \| is/has been
  done (resulting state) \|`\n`{=tex}\| 70 \| te iru \| ている \|
  ongoing action or current state \|`\n`{=tex}\| 71 \| te kara \| てから
  \| after doing \~ \|`\n`{=tex}\| 72 \| te kudasai \| てください \|
  please do \|`\n`{=tex}\| 73 \| te wa ikenai \| てはいけない \| must
  not; may not; cannot \|`\n`{=tex}\| 74 \| temo ii desu \| てもいいです
  \| is OK to \~; is alright to \~; may I \~? \|`\n`{=tex}\| 75 \| to \|
  と \| and; with; as; connecting particle \|`\n`{=tex}\| 76 \| toki \|
  時（とき） \| when; at this time \|`\n`{=tex}\| 77 \| totemo \| とても
  \| very; awfully; exceedingly \|`\n`{=tex}\| 78 \| tsumori \| つもり
  \| plan to \~; intend to \~ \|`\n`{=tex}\| 79 \| wa - topic marker \|
  は \| topic marker \|`\n`{=tex}\| 80 \| wa\~yori... desu \|
  は〜より・・・です \| \[Noun-1\] is more \~ than \[Noun-2\]
  \|`\n`{=tex}\| 81 \| wa dou desu ka \| はどうですか \| how about; how
  is \|`\n`{=tex}\| 82 \| ya \| や \| and; or; connecting particle
  \|`\n`{=tex}\| 83 \| yo \| よ \| you know; emphasis (ending particle)
  \|`\n`{=tex}\| 84 \| yori\~hou ga \| より～ほうが \| \[2\] is more
  than \[1\] \|`\n`{=tex}
