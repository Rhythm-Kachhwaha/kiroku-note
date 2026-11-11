"""Pre-compiled conceptual reference seeds for foundational Japanese grammar points.

Covers core hubs:
- Particles: は (c_n5_point_21), が (c_n5_point_22), に (c_n5_point_24), で (c_n5_point_26)
- Giving/Receiving: てあげる (c_n4_point_13), てくれる (c_n4_point_14), てもらう (c_n4_point_15)
- Conditionals: と (c_n5_point_9), ば (c_n4_point_37), たら (c_n4_point_38), なら (c_n4_point_39)
- Conjectures/Evidentials: そうだ appearance (c_n4_souda_appearance), そうだ hearsay (c_n4_souda_hearsay), らしい conjecture (c_n4_rashii_conjecture), らしい typical (c_n3_rashii_typical), ようだ (c_n4_point_24)
"""
from __future__ import annotations

from typing import Any
from app.study.acquisition.parsers.tofugu_parser import (
    CommonPitfall,
    FormationRule,
    GrammarEnrichment,
    NuanceContrast,
)

CORE_ENRICHMENT_SEEDS: list[dict[str, Any]] = [
    # 1. は (c_n5_point_21)
    {
        "concept_id": "c_n5_point_21",
        "big_picture_concept": "Marks the topic or context boundary of the sentence ('as for X...'). It sets up the stage so everything that follows provides new commentary or description about X.",
        "formation_rules": [
            {"structure": "Noun + は", "description": "Attaches to nouns or noun phrases to designate the conversational topic."},
            {"structure": "Particle + は", "description": "Can combine with particles (e.g. には, では) to topicalize locations, times, or means."}
        ],
        "common_pitfalls": [
            {"misconception": "Thinking は always marks the grammatical subject.", "correction": "は marks the conversational topic. The grammatical subject can be a different entity marked by が or omitted.", "explanation": "In '象は鼻が長い', the topic is 'elephants', but the grammatical subject of 'is long' is 'noses'."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "が", "difference": "は highlights the predicate (new information about the topic), whereas が highlights the subject itself (exhaustive listing or new subject).", "when_to_use_this": "When introducing a known theme or stating general facts.", "when_to_use_target": "When identifying 'who' or 'which one' did the action."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' stroke='currentColor' fill='none'/><text x='50' y='55' text-anchor='middle'>TOPIC</text></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/particle-wa/",
    },
    # 2. が (c_n5_point_22)
    {
        "concept_id": "c_n5_point_22",
        "big_picture_concept": "Marks the grammatical subject as a focused spotlight. It announces brand-new information in the narrative or designates an exact item out of a group ('it is X that...').",
        "formation_rules": [
            {"structure": "Noun + が", "description": "Marks the subject performing an action, existing (いる/ある), or having an attribute (好き/上手)."}
        ],
        "common_pitfalls": [
            {"misconception": "Using は inside subordinate relative clauses.", "correction": "Subordinate clauses (e.g. relative clauses, conditional clauses) almost always use が for their internal subject.", "explanation": "Say '彼が買った本', never '彼は買った本'."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "は", "difference": "が acts like a laser pointer on the actor, while は acts like a frame around the discussion topic.", "when_to_use_this": "When answering 'who' questions or introducing an unexpected phenomenon.", "when_to_use_target": "When discussing qualities of a pre-established topic."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><polygon points='50,15 90,85 10,85' stroke='currentColor' fill='none'/><text x='50' y='65' text-anchor='middle'>SUBJECT</text></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/particle-ga/",
    },
    # 3. に (c_n5_point_24)
    {
        "concept_id": "c_n5_point_24",
        "big_picture_concept": "Marks a specific destination, precise target point in time, or recipient of an action. It represents a single pinpoint coordinate in space, time, or purpose.",
        "formation_rules": [
            {"structure": "Time Noun + に", "description": "Marks a specific numerical clock time, day, or calendar point."},
            {"structure": "Destination Noun + に + 行く/来る", "description": "Marks the arrival endpoint of movement."}
        ],
        "common_pitfalls": [
            {"misconception": "Adding に to relative time words like 今日 (today), 明日 (tomorrow), or 毎日 (every day).", "correction": "Relative time words do not take に.", "explanation": "Only specific points in time (7時に, 日曜日に) take に."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "で", "difference": "に marks the destination or location of existence (いる/ある), while で marks the venue where an active dynamic action takes place.", "when_to_use_this": "When something exists at or moves into a point.", "when_to_use_target": "When an event or activity occurs inside a location."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='10' fill='currentColor'/><line x1='10' y1='50' x2='40' y2='50' stroke='currentColor' stroke-width='2'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/particle-ni/",
    },
    # 4. で (c_n5_point_26)
    {
        "concept_id": "c_n5_point_26",
        "big_picture_concept": "Marks the context, scope, tool, means, or venue of an event ('by means of', 'within the boundaries of').",
        "formation_rules": [
            {"structure": "Location + で + Verb", "description": "Specifies the setting where an active event unfolds."},
            {"structure": "Tool / Transport + で", "description": "Indicates the instrument or transportation mode used."}
        ],
        "common_pitfalls": [
            {"misconception": "Using で with verbs of stationary existence like いる/ある.", "correction": "Use に for static existence; use で only when an activity takes place.", "explanation": "公園に猫がいる (the cat is in the park), but 公園で走る (run in the park)."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "に", "difference": "で defines the operational arena or means; に pinpoints the arrival target or resting state.", "when_to_use_this": "When describing actions performed using tools or within locations.", "when_to_use_target": "When describing entering or staying at a location."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><rect x='20' y='20' width='60' height='60' stroke='currentColor' fill='none'/><text x='50' y='55' text-anchor='middle'>SCOPE</text></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/particle-de/",
    },
    # 5. てあげる (c_n4_point_13)
    {
        "concept_id": "c_n4_point_13",
        "big_picture_concept": "Doing a favor for someone else ('do something for their benefit'). The psychological vector of gratitude/action flows outward from the speaker to others.",
        "formation_rules": [
            {"structure": "Verb [て-form] + あげる", "description": "Used when the speaker (or in-group) does a favor for someone else."}
        ],
        "common_pitfalls": [
            {"misconception": "Saying てあげる directly to a superior or stranger when offering help.", "correction": "てあげる can sound patronizing ('I am doing you a favor'). Use ましょうか or polite indirect phrases with superiors.", "explanation": "Reserve direct てあげる for close peers, family, pets, or third-person benevolence."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "てくれる", "difference": "てあげる moves outward (speaker -> other), whereas てくれる moves inward (other -> speaker with gratitude).", "when_to_use_this": "When you do a beneficial deed for someone else.", "when_to_use_target": "When someone kindly does a deed for you."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><line x1='20' y1='50' x2='80' y2='50' stroke='currentColor' stroke-width='4'/><polygon points='80,45 90,50 80,55' fill='currentColor'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/te-ageru/",
    },
    # 6. てくれる (c_n4_point_14)
    {
        "concept_id": "c_n4_point_14",
        "big_picture_concept": "Someone else does a kind favor for me (or my in-group). The speaker receives the psychological benefit with warmth and gratitude.",
        "formation_rules": [
            {"structure": "Verb [て-form] + くれる", "description": "Subject is the benefactor; receiver is the speaker (marked by に)."}
        ],
        "common_pitfalls": [
            {"misconception": "Using てくれる when the speaker is the one doing the favor.", "correction": "The speaker cannot be the subject of くれる.", "explanation": "If I am doing the action for you, use てあげる."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "てもらう", "difference": "てくれる has the benefactor as grammatical subject ('they gave me the favor'); てもらう has the recipient as subject ('I received their favor').", "when_to_use_this": "When emphasizing the other person's spontaneous generosity.", "when_to_use_target": "When emphasizing that you requested or arranged the assistance."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><line x1='80' y1='50' x2='20' y2='50' stroke='currentColor' stroke-width='4'/><polygon points='20,45 10,50 20,55' fill='currentColor'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/te-kureru/",
    },
    # 7. てもらう (c_n4_point_15)
    {
        "concept_id": "c_n4_point_15",
        "big_picture_concept": "To have someone do something for oneself ('receive the action of doing from someone'). The speaker takes the initiative to ask or accept the favor.",
        "formation_rules": [
            {"structure": "Verb [て-form] + もらう", "description": "The speaker is the subject; the helper/doer is marked by に."}
        ],
        "common_pitfalls": [
            {"misconception": "Marking the doer with を or は.", "correction": "The person performing the requested action must be marked by に.", "explanation": "先生に教えてもらった (I had my teacher teach me)."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "てくれる", "difference": "てもらう implies the recipient asked or initiated the arrangement; てくれる focuses on the helper's spontaneous kindness.", "when_to_use_this": "When stating that you got someone to do an errand or service for you.", "when_to_use_target": "When someone offered assistance out of goodwill."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><rect x='20' y='30' width='60' height='40' stroke='currentColor' fill='none'/><text x='50' y='55' text-anchor='middle'>RECEIVE</text></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/te-morau/",
    },
    # 8. と conditional (c_n5_point_9)
    {
        "concept_id": "c_n5_point_9",
        "big_picture_concept": "Natural, inevitable, mechanical condition ('whenever A happens, B automatically follows'). Like flipping a switch or a law of nature.",
        "formation_rules": [
            {"structure": "Verb [dictionary form] + と", "description": "Directly follow dictionary or plain present form of verbs/adjectives."}
        ],
        "common_pitfalls": [
            {"misconception": "Using と when the consequence is a personal wish, request, command, or permission.", "correction": "Clause B cannot express speaker's volition (〜てください, 〜たい, 〜つもり).", "explanation": "Because と is mechanical/inevitable, deliberate human requests do not fit."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "たら", "difference": "と is strictly inevitable/mechanical; たら is versatile and happily permits requests, suggestions, and one-off future conditions.", "when_to_use_this": "Giving road directions ('turn right and you will see...') or scientific natural laws.", "when_to_use_target": "When planning actions or making requests contingent on a future event."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><circle cx='30' cy='50' r='15'/><line x1='45' y1='50' x2='70' y2='50' stroke='currentColor' stroke-width='2'/><circle cx='85' cy='50' r='15'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/conditional-form-to/",
    },
    # 9. ば conditional (c_n4_point_37)
    {
        "concept_id": "c_n4_point_37",
        "big_picture_concept": "Hypothetical condition emphasizing the necessary premise ('if condition A is satisfied, then B becomes true'). Often used for general truths and logical requirements.",
        "formation_rules": [
            {"structure": "Verb [ば-form]", "description": "Replace final -u sound with -えば (e.g. 飲めば, 行けば)."},
            {"structure": "い-Adj -> ければ", "description": "Replace い with ければ (e.g. 安ければ)."},
            {"structure": "Noun / な-Adj + であれば / ならば", "description": "Use であれば or なら(ば)."}
        ],
        "common_pitfalls": [
            {"misconception": "Using ば with two active volitional verbs for a past specific event.", "correction": "ば cannot describe a sequence of two past actions performed by choice.", "explanation": "Use たら for sequence in the past."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "たら", "difference": "ば emphasizes hypothetical logical necessity ('only if'), while たら emphasizes temporal sequence ('once/when A happens').", "when_to_use_this": "Formulas, advice, general rules, and proverb-like conditionals.", "when_to_use_target": "Conversational day-to-day scenarios and concrete future events."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><path d='M20,50 Q50,20 80,50' stroke='currentColor' fill='none' stroke-width='3'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/conditional-form-ba/",
    },
    # 10. たら conditional (c_n4_point_38)
    {
        "concept_id": "c_n4_point_38",
        "big_picture_concept": "Temporal sequence condition ('once/after A happens, then B'). The most versatile, conversational, and natural conditional in spoken Japanese.",
        "formation_rules": [
            {"structure": "Verb [た-form] + ら", "description": "Past plain form plus ら (e.g. 食べたら, 行ったら)."},
            {"structure": "い-Adj [かった] + ら", "description": "Past form plus ら (e.g. 寒かったら)."},
            {"structure": "Noun / な-Adj [だった] + ら", "description": "Noun/na-adj past form plus ら (e.g. 暇だったら)."}
        ],
        "common_pitfalls": [
            {"misconception": "Assuming たら only means hypothetical 'if'.", "correction": "たら often functions as 'when' or 'upon doing' when the condition is certain to happen.", "explanation": "家に帰ったら (when I get home), not necessarily 'if'."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "と", "difference": "たら allows requests, invitations, and volitional decisions in the following clause; と prohibits them.", "when_to_use_this": "Any everyday scenario where you plan to do something after another event finishes.", "when_to_use_target": "Automatic machines and natural mechanical outcomes."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><circle cx='25' cy='50' r='10'/><path d='M35,50 L70,50' stroke='currentColor'/><circle cx='80' cy='50' r='10'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/conditional-form-tara/",
    },
    # 11. なら conditional (c_n4_point_39)
    {
        "concept_id": "c_n4_point_39",
        "big_picture_concept": "Contextual condition ('if it is the case that...', 'speaking of X, then...'). Reacts to information just brought up by the conversational partner.",
        "formation_rules": [
            {"structure": "Noun + なら", "description": "Directly attaches to nouns without particles (e.g. 日本なら)."},
            {"structure": "Verb / Adj [plain] + なら(ば)", "description": "Attaches to plain form predicates."}
        ],
        "common_pitfalls": [
            {"misconception": "Assuming the condition must occur before the consequence in time.", "correction": "なら uniquely allows the consequence to happen BEFORE the condition.", "explanation": "日本に行くなら、カメラを買っておきなさい (if you're going to Japan, buy a camera beforehand!)."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "たら", "difference": "たら requires event A to finish before event B happens; なら allows event B to prepare for or precede event A.", "when_to_use_this": "Giving recommendations based on what someone just stated ('If you want sushi, go there!').", "when_to_use_target": "Chronological after-the-fact sequences."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><text x='50' y='55' text-anchor='middle'>CONTEXT IF</text></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/conditional-form-nara/",
    },
    # 12. そうだ appearance (c_n4_souda_appearance)
    {
        "concept_id": "c_n4_souda_appearance",
        "big_picture_concept": "Immediate sensory conjecture based on direct visual evidence ('looks like', 'seems on the verge of'). Intuitive gut assessment of physical appearance.",
        "formation_rules": [
            {"structure": "Verb [stem] + そうだ", "description": "Drop ます from verb stem (e.g. 降りそうだ = looks like it's going to rain)."},
            {"structure": "い-Adj [stem] + そうだ", "description": "Drop い from adjective (e.g. 美味しそうだ = looks delicious). Note: いい -> よさそうだ."}
        ],
        "common_pitfalls": [
            {"misconception": "Attaching appearance そうだ to plain dictionary verbs.", "correction": "Plain dictionary form + そうだ means hearsay ('I heard that...'). Drop ます for appearance.", "explanation": "降るそうだ = I heard it will rain; 降りそうだ = It looks like rain!"}
        ],
        "nuance_contrasts": [
            {"target_pattern": "そうだ(hearsay)", "difference": "Appearance uses verb stem/adjective stem; hearsay attaches to complete plain form sentences.", "when_to_use_this": "When looking at an object or sky and forming an immediate visual impression.", "when_to_use_target": "When relaying what someone said on the news or in conversation."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='35' stroke='currentColor' fill='none'/><circle cx='50' cy='50' r='10' fill='currentColor'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/souda-looks-like/",
    },
    # 13. そうだ hearsay (c_n4_souda_hearsay)
    {
        "concept_id": "c_n4_souda_hearsay",
        "big_picture_concept": "Reporting hearsay without personal distortion ('I heard that...', 'according to reports...'). Acts as an objective courier of external information.",
        "formation_rules": [
            {"structure": "Plain Form + そうだ", "description": "Attaches directly to regular plain form sentences (verbs, adjectives, noun + だ)."}
        ],
        "common_pitfalls": [
            {"misconception": "Forgetting だ when attaching to nouns or な-adjectives.", "correction": "Requires だ (e.g. 明日は雨だそうだ, 元気だそうだ).", "explanation": "Omitting だ causes grammatical invalidity."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "らしい", "difference": "そうだ hearsay reports raw information objectively; らしい implies the speaker has inferred a conclusion based on rumor or indirect clues.", "when_to_use_this": "When strictly quoting third-party reports or announcements.", "when_to_use_target": "When expressing your own educated guess based on what you heard."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><path d='M30,30 L70,30 L80,50 L70,70 L30,70 Z' stroke='currentColor' fill='none'/><text x='50' y='55' text-anchor='middle'>HEARSAY</text></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/souda-hearsay/",
    },
    # 14. らしい conjecture (c_n4_rashii_conjecture)
    {
        "concept_id": "c_n4_rashii_conjecture",
        "big_picture_concept": "Conjecture based on indirect evidence, hearsay, or rumors ('it seems that', 'apparently'). The speaker deduces a likely reality from ambient signals.",
        "formation_rules": [
            {"structure": "Plain Form / Noun + らしい", "description": "Attaches directly to plain verbs, adjectives, or bare nouns without だ."}
        ],
        "common_pitfalls": [
            {"misconception": "Adding だ between a noun and らしい.", "correction": "Do NOT add だ. It attaches directly to the bare noun (e.g. 雨らしい, not 雨だらしい).", "explanation": "だ is forbidden before らしい."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "ようだ", "difference": "ようだ is based on direct personal observation/sensory feel; らしい is based on external reports, indirect circumstances, or hearsay.", "when_to_use_this": "When stating what seems to be true based on what other people are saying.", "when_to_use_target": "When inferring from your own direct sensory observations."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' stroke-dasharray='4,4' stroke='currentColor' fill='none'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/rashii/",
    },
    # 15. らしい typical (c_n3_rashii_typical)
    {
        "concept_id": "c_n3_rashii_typical",
        "big_picture_concept": "Expressing that something embodies the quintessence or prototypical nature of that category ('manly', 'childlike', 'typical of spring').",
        "formation_rules": [
            {"structure": "Noun + らしい", "description": "Attaches directly to a noun to form an adjective meaning 'embodying typical characteristics of X'."}
        ],
        "common_pitfalls": [
            {"misconception": "Confusing prototypical らしい with resemblance みたい.", "correction": "らしい requires the subject to ACTUALLY be a member of that category.", "explanation": "子供らしい behavior from an actual child means acting delightfully like a child; a grown adult acting childish uses 子供っぽい, not 子供らしい."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "っぽい", "difference": "らしい expresses positive/ideal prototypical traits of genuine members; っぽい expresses superficial or negative resemblance (even if not a member).", "when_to_use_this": "When praising someone for behaving appropriately to their role.", "when_to_use_target": "When pointing out childishness or superficial likeness."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><polygon points='50,10 63,38 93,38 68,57 78,86 50,68 22,86 32,57 7,38 37,38' stroke='currentColor' fill='none'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/rashii-typical/",
    },
    # 16. ようだ (c_n4_point_24)
    {
        "concept_id": "c_n4_point_24",
        "big_picture_concept": "Sensory resemblance or subjective deduction ('it appears that', 'feels like'). The speaker observes clues firsthand and reaches a thoughtful deduction.",
        "formation_rules": [
            {"structure": "Verb / い-Adj [plain] + ようだ", "description": "Direct attachment to plain forms."},
            {"structure": "な-Adj + な + ようだ", "description": "Retains な connector (e.g. 静かなようだ)."},
            {"structure": "Noun + の + ようだ", "description": "Requires の connector (e.g. 先生のようだ)."}
        ],
        "common_pitfalls": [
            {"misconception": "Attaching directly to nouns without の.", "correction": "Always use Noun + の + ようだ.", "explanation": "夢のようだ, not 夢ようだ."}
        ],
        "nuance_contrasts": [
            {"target_pattern": "そうだ(appearance)", "difference": "そうだ is an instant visceral glance ('it's gonna fall!'); ようだ is a reasoned deduction based on visual/sensory evidence.", "when_to_use_this": "When reasoning from clues (e.g. wet umbrellas indicate it was raining outside).", "when_to_use_target": "When catching something in real-time about to change."}
        ],
        "visual_anchor_svg": "<svg viewBox='0 0 100 100'><ellipse cx='50' cy='50' rx='40' ry='25' stroke='currentColor' fill='none'/><circle cx='50' cy='50' r='8'/></svg>",
        "source_url": "https://www.tofugu.com/japanese-grammar/youda/",
    },
]
