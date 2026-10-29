# Kiroku Grammar Audit --- JLPT N4

## Goal

Perform a READ-ONLY accuracy audit of Kiroku's existing grammar
implementation against the 132 reference entries below, sourced from the
JLPT Sensei N4 list supplied by the user.

## Strict rules

-   Do NOT create, insert, update, delete, merge, or otherwise modify
    any Kiroku data.
-   Inspect the current grammar records and their JLPT-level tags only.
-   For each reference entry, determine whether a matching grammar point
    exists and whether its JLPT tag is exactly N4.
-   Match by Japanese grammar form and meaning, allowing harmless
    formatting differences (spaces, full-width/half-width punctuation,
    optional readings, and equivalent romanization).
-   Do not treat two entries as equivalent merely because their Japanese
    written form is the same. Some forms have distinct meanings and must
    remain distinguishable: のに appears twice with different meanings;
    そうだ appears twice with different meanings. Also keep separate
    variants such as みたいだ / みたいな / みたいに.
-   If a record is a plausible match but meaning or identity is unclear,
    report it as AMBIGUOUS rather than claiming it is correct or
    missing.
-   Do not infer that a point is missing just because a search by
    romanization failed; also search Japanese form and meaning.
-   Do not check or change grammar definitions, examples, or any fields
    other than existence and JLPT tag accuracy.
-   The supplied list is the audit scope. Do not add other N4 grammar
    points that are not in this list.

## Required report

Return: 1. **Summary counts**: total reference entries (132), confirmed
correct, missing, wrong JLPT tag, ambiguous, and any duplicate/identity
concerns. Counts should add up to 132 across the per-entry statuses. 2.
**Detailed findings table** with columns: reference #, grammar point,
expected tag (N4), Kiroku status, current tag if found, and
evidence/notes. - Use only these statuses: CORRECT, MISSING, WRONG_TAG,
AMBIGUOUS. - CORRECT means a suitable matching record exists and is
tagged N4. - MISSING means no matching record exists after checking
form/reading/romanization/meaning. - WRONG_TAG means a suitable matching
record exists but its JLPT tag is not N4. - AMBIGUOUS means the data
does not support a confident determination. 3. **No changes made**
confirmation. 4. If possible, include the record ID or stable identifier
for each found record so a later correction pass can target it
precisely.

## Reference list

| \# \| Romanized reference label \| Japanese form \| Meaning from
  source \|`\n`{=tex}\|---:\|---\|---\|---\|`\n`{=tex}\| 1 \| aida \|
  間（あいだ） \| while; during; between \~ \|`\n`{=tex}\| 2 \| aida ni
  \| 間に（あいだに） \| while; during \~ something happened
  \|`\n`{=tex}\| 3 \| amari\~nai \| あまり～ない \| not very; not much
  \~ \|`\n`{=tex}\| 4 \| ato de \| 後で（あとで） \| after \~; later
  \|`\n`{=tex}\| 5 \| ba \| ば \| conditional form; if \[A\] then \[B\]
  \|`\n`{=tex}\| 6 \| baai wa \| 場合は（ばあいは） \| in the event of;
  in the case that \~ \|`\n`{=tex}\| 7 \| bakari \| ばかり \| only;
  nothing but \~ \|`\n`{=tex}\| 8 \| dake de \| だけで \| just by; just
  by doing \|`\n`{=tex}\| 9 \| dasu \| 出す（だす） \| to begin to; to
  start to; to burst into; ... out \|`\n`{=tex}\| 10 \| de gozaimasu \|
  でございます \| to be (honorific) \|`\n`{=tex}\| 11 \| demo \| でも \|
  ... or something; how about \~ \|`\n`{=tex}\| 12 \| dewa nai ka \|
  ではないか \| right?; isn't it? \|`\n`{=tex}\| 13 \| ga hitsuyou \|
  が必要（がひつよう） \| need; necessary \|`\n`{=tex}\| 14 \| ga suru
  \| がする \| to smell; hear; taste \|`\n`{=tex}\| 15 \| gari \| がり
  \| personality; someone tends to / has a tendency or sensitivity to \~
  \|`\n`{=tex}\| 16 \| garu / gatteiru \| がる / がっている \| to show
  signs of; to appear; to feel or think \~ \|`\n`{=tex}\| 17 \|
  gozaimasu \| ございます \| to be; to exist (polite form of いる /
  ある) \|`\n`{=tex}\| 18 \| hajimeru \| 始める（はじめる） \| to start;
  to begin to \~ \|`\n`{=tex}\| 19 \| hazu da \| はずだ \| it must be;
  it should be (expectation) \|`\n`{=tex}\| 20 \| hazu ga nai \|
  はずがない \| cannot be; impossible \|`\n`{=tex}\| 21 \| hitsuyou ga
  aru \| 必要がある（ひつようがある） \| need to; it is necessary to
  \|`\n`{=tex}\| 22 \| ikou kei - volitional form \|
  意向形（いこうけい） \| volitional form; let's do \~ \|`\n`{=tex}\| 23
  \| irassharu \| いらっしゃる \| to be; to come; to go (polite version)
  \|`\n`{=tex}\| 24 \| itashimasu \| いたします \| to do (polite form of
  する) \|`\n`{=tex}\| 25 \| janai ka \| じゃないか \| right?; isn't
  it?; let's \~; confirmation \|`\n`{=tex}\| 26 \| ka dou ka \| かどうか
  \| whether or not \~ \|`\n`{=tex}\| 27 \| ka shira \| かしら \| I
  wonder (feminine) \|`\n`{=tex}\| 28 \| kai \| かい \| turns a sentence
  into a yes/no question \|`\n`{=tex}\| 29 \| kamo shirenai \|
  かもしれない \| might; perhaps; indicates possibility \|`\n`{=tex}\|
  30 \| kana \| かな \| I wonder; should I? \|`\n`{=tex}\| 31 \| kara
  tsukuru \| から作る（からつくる） \| made from; made with
  \|`\n`{=tex}\| 32 \| kitto \| きっと \| surely; undoubtedly; almost
  certainly; most likely \|`\n`{=tex}\| 33 \| koro / goro \|
  頃（ころ／ごろ） \| around; about; when \|`\n`{=tex}\| 34 \| koto \|
  こと \| verb nominalizer \|`\n`{=tex}\| 35 \| koto ga aru \|
  ことがある \| there are times when \|`\n`{=tex}\| 36 \| koto ga dekiru
  \| ことができる \| can; able to \|`\n`{=tex}\| 37 \| koto ni naru \|
  ことになる \| it has been decided that; it turns out that
  \|`\n`{=tex}\| 38 \| koto ni suru \| ことにする \| to decide on
  \|`\n`{=tex}\| 39 \| ku suru \| くする \| to make something \~
  \|`\n`{=tex}\| 40 \| kyuu ni \| 急に（きゅうに） \| quickly;
  immediately; hastily; suddenly; abruptly; unexpectedly \~
  \|`\n`{=tex}\| 41 \| made ni \| までに \| by; by the time; indicates
  time limit \|`\n`{=tex}\| 42 \| mama \| まま \| as it is; current
  state; without changing \|`\n`{=tex}\| 43 \| matawa \| または \| both;
  or; otherwise; choice between \[A\] or \[B\] \|`\n`{=tex}\| 44 \|
  mitai da \| みたいだ \| like; similar to; resembling \~ \|`\n`{=tex}\|
  45 \| mitai na \| みたいな \| like; similar to \~ \|`\n`{=tex}\| 46 \|
  mitai ni \| みたいに \| like; similar to \~ \|`\n`{=tex}\| 47 \| mo \|
  も \| as many as; as much as; up to; nearly \~ \|`\n`{=tex}\| 48 \| na
  \| な \| don't \~ (order somebody not to do something) \|`\n`{=tex}\|
  49 \| nado \| など \| such as; things like \~ \|`\n`{=tex}\| 50 \|
  nagara \| ながら \| while; during; as; simultaneously \|`\n`{=tex}\|
  51 \| nakanaka\~nai \| なかなか～ない \| not easy to; struggling to;
  not able to \~ \|`\n`{=tex}\| 52 \| nakereba ikenai \|
  なければいけない \| must do something; have to do something
  \|`\n`{=tex}\| 53 \| nakereba naranai \| なければならない \| must do
  something; have to do something \|`\n`{=tex}\| 54 \| nara \| なら \|
  if; in the case that \~ \|`\n`{=tex}\| 55 \| nasai \| なさい \| do
  this (soft/firm command) \|`\n`{=tex}\| 56 \| nasaru \| なさる \| to
  do (honorific) \|`\n`{=tex}\| 57 \| ni ki ga tsuku \|
  に気がつく（にきがつく） \| to notice; to realize \|`\n`{=tex}\| 58 \|
  ni mieru \| に見える（にみえる） \| to look; to seem; to appear
  \|`\n`{=tex}\| 59 \| ni suru \| にする \| to make something \~
  \|`\n`{=tex}\| 60 \| nikui \| にくい \| difficult to do \~
  \|`\n`{=tex}\| 61 \| no naka de \| の中で（のなかで） \| in; among \~
  \|`\n`{=tex}\| 62 \| noni \[although\] \| のに \| although; in spite
  of; even though \~ \|`\n`{=tex}\| 63 \| noni \[in order to\] \| のに
  \| to (do something); in order to \~ \|`\n`{=tex}\| 64 \| nowa\~da \|
  のは～だ \| \[A\] is \[B\]; the reason for \[A\] is \[B\]
  \|`\n`{=tex}\| 65 \| o\~kudasai \| お～ください \| please do \~
  (honorific) \|`\n`{=tex}\| 66 \| o\~ni naru \| お～になる \| to do
  (honorific) \|`\n`{=tex}\| 67 \| oki ni \| おきに \| repeated at
  intervals; every \~ \|`\n`{=tex}\| 68 \| owaru \| 終わる（おわる） \|
  to finish; to end \~ \|`\n`{=tex}\| 69 \| rareru \| られる \|
  potential form; ability or inability to do something \|`\n`{=tex}\| 70
  \| rashii \| らしい \| it seems like; I heard; apparently \~
  \|`\n`{=tex}\| 71 \| sa \| さ \| -ness; nominalizer for adjective
  \|`\n`{=tex}\| 72 \| sakki \| さっき \| some time ago; just now
  \|`\n`{=tex}\| 73 \| saserareru \| させられる \| causative-passive; to
  be made to do something \|`\n`{=tex}\| 74 \| saseru \| させる \|
  causative form; to make / let somebody do something \|`\n`{=tex}\| 75
  \| sasete kudasai \| させてください \| please let me do \|`\n`{=tex}\|
  76 \| sasuga \| さすが \| as one would expect; as is to be expected;
  even \~ \|`\n`{=tex}\| 77 \| shi \| し \| and; and what's more \~
  (emphasis) \|`\n`{=tex}\| 78 \| sonna ni \| そんなに \| so much; so;
  like that \|`\n`{=tex}\| 79 \| sore demo \| それでも \| but still; and
  yet; even so \~ \|`\n`{=tex}\| 80 \| sore ni \| それに \| besides; in
  addition; also; moreover \~ \|`\n`{=tex}\| 81 \| sou da \[1: hearsay\]
  \| そうだ \| I heard that; it is said that \~ \|`\n`{=tex}\| 82 \| sou
  da \[2: appearance\] \| そうだ \| looks like; appears like; seeming \~
  \|`\n`{=tex}\| 83 \| sou ni / sou na \| そうに / そうな \| seems like;
  looks like \~ \|`\n`{=tex}\| 84 \| ta bakari \| たばかり \| just
  finished; something just occurred \|`\n`{=tex}\| 85 \| ta tokoro \|
  たところ \| just finished doing; was just doing \|`\n`{=tex}\| 86 \|
  tadoushi & jidoushi \| 他動詞 & 自動詞（たどうし & じどうし） \|
  transitive and intransitive verbs \|`\n`{=tex}\| 87 \| tagaru \|
  たがる \| wants to do \~ (third person) \|`\n`{=tex}\| 88 \| tara \|
  たら \| if; after; when \~ \|`\n`{=tex}\| 89 \| tara dou \| たらどう
  \| why don't you; how about \~ (used to give advice) \|`\n`{=tex}\| 90
  \| tara ii desu ka \| たらいいですか \| what should I do?; speaker
  seeking instructions from listener \|`\n`{=tex}\| 91 \| te / de \| て
  / で \| conjunctive particle; so; because of \[A\], \[B\]...
  \|`\n`{=tex}\| 92 \| te ageru \| てあげる \| to do for; to do a favor
  \|`\n`{=tex}\| 93 \| te hoshii \| てほしい \| I want you to; need you
  to \~ \|`\n`{=tex}\| 94 \| te iku \| ていく \| to start; to continue;
  to go on \|`\n`{=tex}\| 95 \| te ita \| ていた \| was doing something
  (past continuous) \|`\n`{=tex}\| 96 \| te itadakemasen ka \|
  ていただけませんか \| could you please \~ \|`\n`{=tex}\| 97 \| te
  kureru \| てくれる \| to do a favor; do something for someone
  \|`\n`{=tex}\| 98 \| te kuru \| てくる \| to do... and come back; to
  become; to continue; to start \~ \|`\n`{=tex}\| 99 \| te miru \|
  てみる \| try doing \|`\n`{=tex}\| 100 \| te morau \| てもらう \| to
  get somebody to do something \|`\n`{=tex}\| 101 \| te oku \| ておく \|
  to do something in advance \|`\n`{=tex}\| 102 \| te shimau / chau \|
  てしまう / ちゃう \| to do something by accident; to finish completely
  \|`\n`{=tex}\| 103 \| te sumimasen \| てすみません \| I'm sorry for
  \|`\n`{=tex}\| 104 \| te yaru \| てやる \| to do for; to do a favor
  (casual) \|`\n`{=tex}\| 105 \| te yokatta \| てよかった \| I'm glad
  that \~ \|`\n`{=tex}\| 106 \| teiru tokoro \| ているところ \| in the
  process of doing \|`\n`{=tex}\| 107 \| temo \| ても \| even; even if;
  even though \~ \|`\n`{=tex}\| 108 \| to \[whenever\] \| と \| whenever
  \[A\] happens, \[B\] also happens \|`\n`{=tex}\| 109 \| to ittemo ii
  \| と言ってもいい（といってもいい） \| you could say; one might say;
  I'd say \~ \|`\n`{=tex}\| 110 \| to iu \| という \| called; named;
  that \~ \|`\n`{=tex}\| 111 \| to iu koto \| ということ \| convert
  phrase into noun \|`\n`{=tex}\| 112 \| to iwarete iru \|
  と言われている（といわれている） \| it is said that \~ \|`\n`{=tex}\|
  113 \| to kiita \| と聞いた（ときいた） \| I heard... \|`\n`{=tex}\|
  114 \| to omou \| と思う（とおもう） \| to think...; I think...; you
  think... \|`\n`{=tex}\| 115 \| toka\~toka \| とか～とか \| among other
  things; such as; like \~ \|`\n`{=tex}\| 116 \| tokoro \| ところ \|
  just about to; on the verge of doing something \|`\n`{=tex}\| 117 \|
  tsuzukeru \| 続ける（つづける） \| continue to; keen on \~
  \|`\n`{=tex}\| 118 \| tte \| って \| named; called \~ \|`\n`{=tex}\|
  119 \| ukemi kei \| 受身形（うけみけい） \| passive form; passive
  voice \|`\n`{=tex}\| 120 \| wa\~ga... wa \| は〜が... は \| \[A\] but
  \[B\]; however; comparison \|`\n`{=tex}\| 121 \| yasui \| やすい \|
  easy to; likely to; prone to; have a tendency to \~ \|`\n`{=tex}\| 122
  \| yatto \| やっと \| at last; finally; barely; narrowly \~
  \|`\n`{=tex}\| 123 \| yori \| より \| than; rather than; more than \~
  \|`\n`{=tex}\| 124 \| yotei da \| 予定だ（よていだ） \| plan to;
  intend to \|`\n`{=tex}\| 125 \| you da \| ようだ \| appears; seems;
  looks as if \~ \|`\n`{=tex}\| 126 \| you ni / you na \| ように /
  ような \| like; as; similar to \~ \|`\n`{=tex}\| 127 \| you ni naru \|
  ようになる \| to reach the point that; to come to be that; to turn
  into \~ \|`\n`{=tex}\| 128 \| you ni suru \| ようにする \| to try to;
  to make sure that \~ \|`\n`{=tex}\| 129 \| you to omou \|
  ようと思う（ようとおもう） \| thinking of doing; planning to \~
  \|`\n`{=tex}\| 130 \| zehi \| ぜひ \| by all means; certainly;
  definitely \~ \|`\n`{=tex}\| 131 \| zenzen\~nai \|
  全然～ない（ぜんぜん～ない） \| (not) at all \|`\n`{=tex}\| 132 \|
  zurai \| づらい \| difficult to do \~ \|`\n`{=tex}
