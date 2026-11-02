"""
Automated Verification Suite for Liquid Spring Bottom Dock Navigation Pill
Tests:
A. Travel test, Home -> Study at 1280x800 (1000ms sample, independent edges, stretch >= 8px, right overshoot <= 25px, left overshoot <= 8px, settling 450-1000ms)
B. Short hop test, Home -> Vocab (under 700ms, >= 6 intermediate positions, width >= 24px)
C. Leftward test, Study -> Home (mirror of A: stretch >= 8px, leading left overshoot <= 25px, trailing right overshoot <= 8px)
D. Rapid-click continuity (Vocab @0ms, Kanji @60ms, Study @120ms, Home @180ms; no single frame jump > 25% dock width, width >= 24px, rests on Home)
E. Reduced motion (prefers-reduced-motion: reduce; >= 3 intermediate positions, completes <= 350ms, no stretch)
F. Regression checks: same DOM node identity survives, at-rest alignment within 1px across all 6 tabs at 500x750 and 1280x800
"""

import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
INDEX_PATH = REPO_ROOT / "desktop" / "src" / "index.html"
INDEX_URL = INDEX_PATH.resolve().as_uri()

def run_tests():
    print(f"Loading {INDEX_URL} in Playwright Chromium...")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"]
        )

        # =====================================================================
        # TEST F: Regression checks from previous work
        # =====================================================================
        print("\n--- TEST F1: DOM Node Identity (No Re-render) ---")
        context_f = browser.new_context(viewport={"width": 1280, "height": 800})
        page_f = context_f.new_page()
        page_f.goto(INDEX_URL)
        page_f.wait_for_selector("#bottom-dock")
        page_f.wait_for_timeout(300)

        no_rerender_result = page_f.evaluate("""() => {
            const pillBefore = document.getElementById('nav-spring-pill');
            pillBefore.__surviveTag = 'tagged-original-node-' + Date.now();

            const vocab = document.querySelector('.nav-tab-item[data-tab="vocab"]');
            vocab.click();
            const pillAfterVocab = document.getElementById('nav-spring-pill');
            const survivedVocab = (pillBefore === pillAfterVocab) && (pillAfterVocab.__surviveTag === pillBefore.__surviveTag);

            const study = document.querySelector('.nav-tab-item[data-tab="study"]');
            study.click();
            const pillAfterStudy = document.getElementById('nav-spring-pill');
            const survivedStudy = (pillBefore === pillAfterStudy) && (pillAfterStudy.__surviveTag === pillBefore.__surviveTag);

            return {
                survivedVocab,
                survivedStudy,
                tagMatch: pillAfterStudy.__surviveTag === pillBefore.__surviveTag
            };
        }""")
        print(f"Test F1 result: {no_rerender_result}")
        assert no_rerender_result["survivedVocab"], "Pill DOM node must survive Vocab tab change"
        assert no_rerender_result["survivedStudy"], "Pill DOM node must survive Study tab change"
        assert no_rerender_result["tagMatch"], "Pill custom property tag must match original node"
        print("PASS: Test F1 - Pill DOM element survives tab navigation without re-render.")
        context_f.close()

        print("\n--- TEST F2: Alignment across 6 tabs at 500x750 and 1280x800 ---")
        tabs = ['home', 'vocab', 'grammar', 'kanji', 'test', 'study']
        viewports = [
            ("Compact (500x750)", {"width": 500, "height": 750}),
            ("Expanded (1280x800)", {"width": 1280, "height": 800})
        ]

        for vp_name, vp_dims in viewports:
            print(f"\nChecking {vp_name}...")
            context_vp = browser.new_context(viewport=vp_dims)
            page_vp = context_vp.new_page()
            page_vp.goto(INDEX_URL)
            page_vp.wait_for_selector("#bottom-dock")
            page_vp.wait_for_timeout(500)

            for tab_id in tabs:
                page_vp.evaluate(f"""() => {{
                    const tab = document.querySelector('.nav-tab-item[data-tab="{tab_id}"]');
                    tab.click();
                }}""")
                page_vp.wait_for_timeout(800)  # Settle liquid spring

                diff = page_vp.evaluate(f"""() => {{
                    const pill = document.getElementById('nav-spring-pill');
                    const tab = document.querySelector('.nav-tab-item[data-tab="{tab_id}"]');
                    const pRect = pill.getBoundingClientRect();
                    const tRect = tab.getBoundingClientRect();
                    return {{
                        tab: '{tab_id}',
                        pillLeft: Math.round(pRect.left * 100) / 100,
                        tabLeft: Math.round(tRect.left * 100) / 100,
                        diffLeft: Math.abs(pRect.left - tRect.left),
                        pillWidth: Math.round(pRect.width * 100) / 100,
                        tabWidth: Math.round(tRect.width * 100) / 100,
                        diffWidth: Math.abs(pRect.width - tRect.width)
                    }};
                }}""")
                print(f"[{vp_name}] Tab '{tab_id}': Pill Left={diff['pillLeft']} Tab Left={diff['tabLeft']} (diff={diff['diffLeft']:.2f}px), Pill Width={diff['pillWidth']} Tab Width={diff['tabWidth']} (diff={diff['diffWidth']:.2f}px)")
                assert diff['diffLeft'] <= 1.0, f"Pill left misalignment on {tab_id} in {vp_name}: {diff['diffLeft']}px > 1.0px"
                assert diff['diffWidth'] <= 1.0, f"Pill width misalignment on {tab_id} in {vp_name}: {diff['diffWidth']}px > 1.0px"

            context_vp.close()
        print("PASS: Test F2 - Pill perfectly aligned with active tab across all 6 tabs at both resolutions.")

        # =====================================================================
        # TEST A: Travel test, Home -> Study at 1280x800
        # =====================================================================
        print("\n--- TEST A: Liquid Spring Slide Travel (Home -> Study at 1280x800) ---")
        context_a = browser.new_context(viewport={"width": 1280, "height": 800})
        page_a = context_a.new_page()
        page_a.goto(INDEX_URL)
        page_a.wait_for_selector("#bottom-dock")
        page_a.wait_for_timeout(500)

        # Sample for 1000ms
        samples_a = page_a.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const target = document.querySelector('.nav-tab-item[data-tab="study"]');
                const samples = [];
                const startTime = performance.now();

                const r0 = pill.getBoundingClientRect();
                samples.push({
                    t: 0,
                    left: Math.round(r0.left * 10) / 10,
                    width: Math.round(r0.width * 10) / 10,
                    right: Math.round((r0.left + r0.width) * 10) / 10
                });

                target.click();

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10,
                        width: Math.round(rect.width * 10) / 10,
                        right: Math.round((rect.left + rect.width) * 10) / 10
                    });
                    if (now - startTime < 1000) {
                        requestAnimationFrame(onFrame);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        dock_study_info = page_a.evaluate("""() => {
            const study = document.querySelector('.nav-tab-item[data-tab="study"]');
            const rect = study.getBoundingClientRect();
            return {
                studyLeft: Math.round(rect.left * 10) / 10,
                studyWidth: Math.round(rect.width * 10) / 10,
                studyRight: Math.round((rect.left + rect.width) * 10) / 10
            };
        }""")

        start_x_a = samples_a[0]["left"]
        start_w_a = samples_a[0]["width"]
        final_x_a = samples_a[-1]["left"]
        final_w_a = samples_a[-1]["width"]
        target_x_a = dock_study_info['studyLeft']
        target_w_a = dock_study_info['studyWidth']
        target_r_a = dock_study_info['studyRight']

        print(f"Sample count: {len(samples_a)}")
        print(f"Start: Left={start_x_a}px, Width={start_w_a}px | Target Study: Left={target_x_a}px, Width={target_w_a}px, Right={target_r_a}px")

        print("\nRaw Sampled Trajectory (Home -> Study):")
        step_a = max(1, len(samples_a) // 18)
        for i in range(0, len(samples_a), step_a):
            s = samples_a[i]
            print(f"  Frame {i:2d} | t={s['t']:4d}ms | pill.left={s['left']:6.1f}px | pill.width={s['width']:5.1f}px | pill.right={s['right']:6.1f}px")
        if (len(samples_a) - 1) % step_a != 0:
            s = samples_a[-1]
            print(f"  Frame {len(samples_a)-1:2d} | t={s['t']:4d}ms | pill.left={s['left']:6.1f}px | pill.width={s['width']:5.1f}px | pill.right={s['right']:6.1f}px")

        # 1. At least 12 distinct intermediate left positions
        intermediates_a = [s["left"] for s in samples_a[1:-1] if s["left"] != start_x_a and s["left"] != final_x_a]
        distinct_a = len(set(intermediates_a))
        print(f"Distinct intermediate left positions: {distinct_a} (required >= 12)")
        assert distinct_a >= 12, f"Expected >= 12 distinct positions, got {distinct_a}"

        # 2. First sample after click is not already final x
        assert samples_a[1]["left"] != final_x_a, "First sample after click must NOT already be final x"

        # 3. STRETCH: max(width) exceeds max(startWidth, endWidth) by at least 8px
        max_w_a = max(s["width"] for s in samples_a)
        base_w_a = max(start_w_a, target_w_a)
        stretch_a = max_w_a - base_w_a
        print(f"Max width during travel: {max_w_a:.1f}px (base={base_w_a:.1f}px, stretch={stretch_a:.1f}px, required >= 8px)")
        assert stretch_a >= 8.0, f"Pill stretch {stretch_a:.1f}px is less than 8px"

        # 4. Width returns to target tab's width within 1px at rest
        assert abs(final_w_a - target_w_a) <= 1.0, f"Final width {final_w_a} not within 1px of target {target_w_a}"

        # 5. Final left equals target tab left within 1px
        assert abs(final_x_a - target_x_a) <= 1.0, f"Final left {final_x_a} not within 1px of target {target_x_a}"

        # 6. Overshoots: right edge overshoot <= 25px, left edge overshoot <= 8px
        max_r_a = max(s["right"] for s in samples_a)
        right_overshoot_a = max(0.0, max_r_a - target_r_a)
        max_l_a = max(s["left"] for s in samples_a)
        left_overshoot_a = max(0.0, max_l_a - target_x_a)
        print(f"Right edge max: {max_r_a:.1f}px (target={target_r_a:.1f}px, overshoot={right_overshoot_a:.1f}px, max allowed: 25px)")
        print(f"Left edge max: {max_l_a:.1f}px (target={target_x_a:.1f}px, overshoot={left_overshoot_a:.1f}px, max allowed: 8px)")
        assert right_overshoot_a <= 25.0, f"Right edge overshoot {right_overshoot_a:.1f}px > 25px"
        assert left_overshoot_a <= 8.0, f"Left edge overshoot {left_overshoot_a:.1f}px > 8px"

        # 7. Settling time: last frame where |left - final| > 1px is between 450ms and 1000ms
        last_unsettled_idx = 0
        for i, s in enumerate(samples_a):
            if abs(s["left"] - final_x_a) > 1.0:
                last_unsettled_idx = i
        settling_time_a = samples_a[last_unsettled_idx]["t"]
        print(f"Settling time (last frame with |left - final| > 1px): {settling_time_a}ms (allowed: 450ms - 1000ms)")
        assert 450 <= settling_time_a <= 1000, f"Settling time {settling_time_a}ms not between 450ms and 1000ms"

        print("PASS: Test A - Liquid Spring travel (Home -> Study) verified.")
        context_a.close()

        # =====================================================================
        # TEST B: Short hop test, Home -> Vocab
        # =====================================================================
        print("\n--- TEST B: Short Hop (Home -> Vocab) ---")
        context_b = browser.new_context(viewport={"width": 1280, "height": 800})
        page_b = context_b.new_page()
        page_b.goto(INDEX_URL)
        page_b.wait_for_selector("#bottom-dock")
        page_b.wait_for_timeout(500)

        samples_b = page_b.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const target = document.querySelector('.nav-tab-item[data-tab="vocab"]');
                const samples = [];
                const startTime = performance.now();

                const r0 = pill.getBoundingClientRect();
                samples.push({
                    t: 0,
                    left: Math.round(r0.left * 10) / 10,
                    width: Math.round(r0.width * 10) / 10
                });

                target.click();

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10,
                        width: Math.round(rect.width * 10) / 10
                    });
                    if (now - startTime < 700) {
                        requestAnimationFrame(onFrame);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        start_x_b = samples_b[0]["left"]
        final_x_b = samples_b[-1]["left"]
        intermediates_b = [s["left"] for s in samples_b[1:-1] if s["left"] != start_x_b and s["left"] != final_x_b]
        distinct_b = len(set(intermediates_b))
        min_w_b = min(s["width"] for s in samples_b)

        last_unsettled_b = 0
        for i, s in enumerate(samples_b):
            if abs(s["left"] - final_x_b) > 1.0:
                last_unsettled_b = i
        settling_time_b = samples_b[last_unsettled_b]["t"]

        print(f"Short Hop distinct intermediates: {distinct_b} (required >= 6)")
        print(f"Short Hop settling time: {settling_time_b}ms (required < 700ms)")
        print(f"Short Hop min width: {min_w_b:.1f}px (required >= 24px)")

        assert distinct_b >= 6, f"Expected >= 6 intermediates on short hop, got {distinct_b}"
        assert settling_time_b < 700, f"Expected short hop to settle < 700ms, got {settling_time_b}ms"
        assert min_w_b >= 24.0, f"Short hop width dipped below 24px: {min_w_b}px"

        print("PASS: Test B - Short Hop (Home -> Vocab) verified.")
        context_b.close()

        # =====================================================================
        # TEST C: Leftward test, Study -> Home
        # =====================================================================
        print("\n--- TEST C: Leftward Motion (Study -> Home) ---")
        context_c = browser.new_context(viewport={"width": 1280, "height": 800})
        page_c = context_c.new_page()
        page_c.goto(INDEX_URL)
        page_c.wait_for_selector("#bottom-dock")
        page_c.wait_for_timeout(500)

        # First navigate to Study and settle
        page_c.evaluate("() => document.querySelector('.nav-tab-item[data-tab=\"study\"]').click()")
        page_c.wait_for_timeout(800)

        # Now sample moving Study -> Home for 1000ms
        samples_c = page_c.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const target = document.querySelector('.nav-tab-item[data-tab="home"]');
                const samples = [];
                const startTime = performance.now();

                const r0 = pill.getBoundingClientRect();
                samples.push({
                    t: 0,
                    left: Math.round(r0.left * 10) / 10,
                    width: Math.round(r0.width * 10) / 10,
                    right: Math.round((r0.left + r0.width) * 10) / 10
                });

                target.click();

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10,
                        width: Math.round(rect.width * 10) / 10,
                        right: Math.round((rect.left + rect.width) * 10) / 10
                    });
                    if (now - startTime < 1000) {
                        requestAnimationFrame(onFrame);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        dock_home_info = page_c.evaluate("""() => {
            const home = document.querySelector('.nav-tab-item[data-tab="home"]');
            const rect = home.getBoundingClientRect();
            return {
                homeLeft: Math.round(rect.left * 10) / 10,
                homeWidth: Math.round(rect.width * 10) / 10,
                homeRight: Math.round((rect.left + rect.width) * 10) / 10
            };
        }""")

        start_x_c = samples_c[0]["left"]
        start_w_c = samples_c[0]["width"]
        final_x_c = samples_c[-1]["left"]
        final_w_c = samples_c[-1]["width"]
        target_x_c = dock_home_info['homeLeft']
        target_w_c = dock_home_info['homeWidth']
        target_r_c = dock_home_info['homeRight']

        intermediates_c = [s["left"] for s in samples_c[1:-1] if s["left"] != start_x_c and s["left"] != final_x_c]
        distinct_c = len(set(intermediates_c))
        max_w_c = max(s["width"] for s in samples_c)
        base_w_c = max(start_w_c, target_w_c)
        stretch_c = max_w_c - base_w_c

        # Leftward overshoots:
        # Leading edge is LEFT: overshoot is how far it went to the left past target_x_c
        min_l_c = min(s["left"] for s in samples_c)
        lead_overshoot_c = max(0.0, target_x_c - min_l_c)
        # Trailing edge is RIGHT: overshoot is how far it went past target_r_c
        min_r_c = min(s["right"] for s in samples_c)
        trail_overshoot_c = max(0.0, target_r_c - min_r_c)

        # Trailing edge settling time (mirror of A: in C moving left, trailing edge is RIGHT)
        last_unsettled_c = 0
        final_r_c = samples_c[-1]["right"]
        for i, s in enumerate(samples_c):
            if abs(s["right"] - final_r_c) > 1.0 or abs(s["left"] - final_x_c) > 1.0:
                last_unsettled_c = i
        settling_time_c = samples_c[last_unsettled_c]["t"]

        print(f"Leftward distinct positions: {distinct_c} (required >= 12)")
        print(f"Leftward stretch: {stretch_c:.1f}px (required >= 8px)")
        print(f"Leftward leading edge overshoot: {lead_overshoot_c:.1f}px (max 25px)")
        print(f"Leftward trailing edge overshoot: {trail_overshoot_c:.1f}px (max 8px)")
        print(f"Leftward settling time: {settling_time_c}ms (allowed: 450ms - 1000ms)")
        print(f"Leftward final left diff: {abs(final_x_c - target_x_c):.2f}px, width diff: {abs(final_w_c - target_w_c):.2f}px")

        assert distinct_c >= 12, f"Expected >= 12 positions, got {distinct_c}"
        assert samples_c[1]["left"] != final_x_c, "First sample after click must NOT already be final x"
        assert stretch_c >= 8.0, f"Leftward stretch {stretch_c:.1f}px is less than 8px"
        assert abs(final_w_c - target_w_c) <= 1.0, "Final width must match target width within 1px"
        assert abs(final_x_c - target_x_c) <= 1.0, "Final left must match target left within 1px"
        assert lead_overshoot_c <= 25.0, f"Leftward leading edge overshoot {lead_overshoot_c:.1f}px > 25px"
        assert trail_overshoot_c <= 8.0, f"Leftward trailing edge overshoot {trail_overshoot_c:.1f}px > 8px"
        assert 450 <= settling_time_c <= 1000, f"Settling time {settling_time_c}ms not in 450-1000ms"

        print("PASS: Test C - Leftward motion (Study -> Home) verified.")
        context_c.close()

        # =====================================================================
        # TEST D: Rapid-click continuity (Vocab @0, Kanji @60, Study @120, Home @180)
        # =====================================================================
        print("\n--- TEST D: Rapid Clicks (Vocab @0ms, Kanji @60ms, Study @120ms, Home @180ms) ---")
        context_d = browser.new_context(viewport={"width": 1280, "height": 800})
        page_d = context_d.new_page()
        page_d.goto(INDEX_URL)
        page_d.wait_for_selector("#bottom-dock")
        page_d.wait_for_timeout(500)

        rapid_d = page_d.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const dock = document.getElementById('bottom-dock');
                const dockWidth = dock.getBoundingClientRect().width;
                const tabVocab = document.querySelector('.nav-tab-item[data-tab="vocab"]');
                const tabKanji = document.querySelector('.nav-tab-item[data-tab="kanji"]');
                const tabStudy = document.querySelector('.nav-tab-item[data-tab="study"]');
                const tabHome = document.querySelector('.nav-tab-item[data-tab="home"]');

                const samples = [];
                const startTime = performance.now();

                // Rapid sequence
                tabVocab.click();
                setTimeout(() => tabKanji.click(), 60);
                setTimeout(() => tabStudy.click(), 120);
                setTimeout(() => tabHome.click(), 180);

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10,
                        width: Math.round(rect.width * 10) / 10
                    });
                    if (now - startTime < 1200) {
                        requestAnimationFrame(onFrame);
                    } else {
                        let maxJump = 0;
                        let minW = 9999;
                        for (let i = 1; i < samples.length; i++) {
                            const jump = Math.abs(samples[i].left - samples[i-1].left);
                            if (jump > maxJump) maxJump = jump;
                        }
                        for (let s of samples) {
                            if (s.width < minW) minW = s.width;
                        }
                        resolve({
                            samples,
                            dockWidth,
                            maxJump,
                            maxJumpRatio: maxJump / dockWidth,
                            minWidth: minW,
                            finalLeft: samples[samples.length - 1].left,
                            finalWidth: samples[samples.length - 1].width
                        });
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        dock_home_info = page_d.evaluate("""() => {
            const home = document.querySelector('.nav-tab-item[data-tab="home"]');
            const rect = home.getBoundingClientRect();
            return {
                homeLeft: Math.round(rect.left * 10) / 10,
                homeWidth: Math.round(rect.width * 10) / 10
            };
        }""")

        print(f"Rapid Clicks max jump: {rapid_d['maxJump']:.2f}px ({rapid_d['maxJumpRatio']*100:.1f}% of dock width, limit: 25%)")
        print(f"Rapid Clicks min width: {rapid_d['minWidth']:.1f}px (limit: >= 24px)")
        print(f"Rapid Clicks final left: {rapid_d['finalLeft']}px vs Home target {dock_home_info['homeLeft']}px")

        assert rapid_d['maxJumpRatio'] <= 0.25, f"Rapid clicks max jump {rapid_d['maxJumpRatio']*100:.1f}% exceeded 25%"
        assert rapid_d['minWidth'] >= 24.0, f"Rapid clicks width fell below 24px: {rapid_d['minWidth']}px"
        assert abs(rapid_d['finalLeft'] - dock_home_info['homeLeft']) <= 1.0, "Rapid clicks did not rest on Home"
        assert abs(rapid_d['finalWidth'] - dock_home_info['homeWidth']) <= 1.0, "Rapid clicks final width did not match Home"

        print("PASS: Test D - Rapid Clicks continuity verified.")
        context_d.close()

        # =====================================================================
        # TEST E: Reduced motion (prefers-reduced-motion: reduce)
        # =====================================================================
        print("\n--- TEST E: Reduced Motion (prefers-reduced-motion: reduce) ---")
        context_e = browser.new_context(viewport={"width": 1280, "height": 800})
        page_e = context_e.new_page()
        page_e.emulate_media(reduced_motion="reduce")
        page_e.goto(INDEX_URL)
        page_e.wait_for_selector("#bottom-dock")
        page_e.wait_for_timeout(500)

        samples_e = page_e.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const target = document.querySelector('.nav-tab-item[data-tab="study"]');
                const samples = [];
                const startTime = performance.now();

                const r0 = pill.getBoundingClientRect();
                samples.push({
                    t: 0,
                    left: Math.round(r0.left * 10) / 10,
                    width: Math.round(r0.width * 10) / 10
                });

                target.click();

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10,
                        width: Math.round(rect.width * 10) / 10
                    });
                    if (now - startTime < 600) {
                        requestAnimationFrame(onFrame);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        start_x_e = samples_e[0]["left"]
        start_w_e = samples_e[0]["width"]
        final_x_e = samples_e[-1]["left"]
        intermediates_e = [s["left"] for s in samples_e[1:-1] if s["left"] != start_x_e and s["left"] != final_x_e]
        distinct_e = len(set(intermediates_e))

        last_unsettled_e = 0
        for i, s in enumerate(samples_e):
            if abs(s["left"] - final_x_e) > 1.0:
                last_unsettled_e = i
        settling_time_e = samples_e[last_unsettled_e]["t"]

        max_w_e = max(s["width"] for s in samples_e)
        base_w_e = max(start_w_e, samples_e[-1]["width"])
        stretch_e = max_w_e - base_w_e

        print(f"Reduced motion distinct positions: {distinct_e} (required >= 3)")
        print(f"Reduced motion settling time: {settling_time_e}ms (required <= 350ms)")
        print(f"Reduced motion max stretch: {stretch_e:.1f}px (required <= 2px, simple slide)")

        assert distinct_e >= 3, f"Expected >= 3 positions in reduced motion, got {distinct_e}"
        assert settling_time_e <= 350, f"Expected reduced motion to settle <= 350ms, got {settling_time_e}ms"
        assert stretch_e <= 2.0, f"Reduced motion should not stretch: stretch = {stretch_e}px"

        print("PASS: Test E - Reduced Motion verified.")
        context_e.close()

        browser.close()

    print("\n=======================================================")
    print("ALL TESTS (A, B, C, D, E, F) PASSED WITH FULL PROOF!")
    print("=======================================================\n")

if __name__ == "__main__":
    run_tests()
