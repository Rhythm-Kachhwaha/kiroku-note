"""
Automated Verification Suite for Bottom Dock Navigation Pill
Tests:
A. WAAPI Slide animation sampling (normal & prefers-reduced-motion & rapid clicks)
B. Prove no re-render (DOM node identity retention)
C. Prove alignment across all 6 tabs at 500x750 and 1280x800
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
        # TEST B: Prove no re-render (DOM node identity)
        # =====================================================================
        print("\n--- TEST B: DOM Node Identity (No Re-render) ---")
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        page.goto(INDEX_URL)
        page.wait_for_selector("#bottom-dock")
        page.wait_for_timeout(300)

        no_rerender_result = page.evaluate("""() => {
            const pillBefore = document.getElementById('nav-spring-pill');
            pillBefore.__surviveTag = 'tagged-original-node-' + Date.now();
            
            // Switch tabs: Home -> Vocab -> Study -> Home
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
        print(f"Test B result: {no_rerender_result}")
        assert no_rerender_result["survivedVocab"], "Pill DOM node must survive Vocab tab change"
        assert no_rerender_result["survivedStudy"], "Pill DOM node must survive Study tab change"
        assert no_rerender_result["tagMatch"], "Pill custom property tag must match original node"
        print("PASS: Test B - Pill DOM element survives tab navigation without re-render.")
        context.close()

        # =====================================================================
        # TEST C: Prove Alignment across all 6 tabs at 500x750 and 1280x800
        # =====================================================================
        print("\n--- TEST C: Alignment across 6 tabs at 500x750 and 1280x800 ---")
        tabs = ['home', 'vocab', 'grammar', 'kanji', 'test', 'study']
        viewports = [
            ("Compact (500x750)", {"width": 500, "height": 750}),
            ("Expanded (1280x800)", {"width": 1280, "height": 800})
        ]

        alignment_results = []
        for vp_name, vp_dims in viewports:
            print(f"\nChecking {vp_name}...")
            context = browser.new_context(viewport=vp_dims)
            page = context.new_page()
            page.goto(INDEX_URL)
            page.wait_for_selector("#bottom-dock")
            page.wait_for_timeout(500)

            for tab_id in tabs:
                res = page.evaluate(f"""() => {{
                    const tab = document.querySelector('.nav-tab-item[data-tab="{tab_id}"]');
                    tab.click();
                }}""")
                page.wait_for_timeout(600)  # Wait for 450ms animation + overshoot to settle

                diff = page.evaluate(f"""() => {{
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
                alignment_results.append((vp_name, diff))
                print(f"[{vp_name}] Tab '{tab_id}': Pill Left={diff['pillLeft']} Tab Left={diff['tabLeft']} (diff={diff['diffLeft']:.2f}px), Pill Width={diff['pillWidth']} Tab Width={diff['tabWidth']} (diff={diff['diffWidth']:.2f}px)")
                assert diff['diffLeft'] <= 1.0, f"Pill left misalignment on {tab_id} in {vp_name}: {diff['diffLeft']}px > 1.0px"
                assert diff['diffWidth'] <= 1.0, f"Pill width misalignment on {tab_id} in {vp_name}: {diff['diffWidth']}px > 1.0px"

            context.close()
        print("PASS: Test C - Pill perfectly aligned with active tab across all 6 tabs at both resolutions.")

        # =====================================================================
        # TEST A: Automated measurement of WAAPI slide (Home -> Study)
        # =====================================================================
        print("\n--- TEST A1: Normal Motion Slide Measurement (Home -> Study) ---")
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        page.goto(INDEX_URL)
        page.wait_for_selector("#bottom-dock")
        page.wait_for_timeout(500)

        # Sample frames over 800ms
        samples = page.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const target = document.querySelector('.nav-tab-item[data-tab="study"]');
                const dock = document.getElementById('bottom-dock');
                const samples = [];
                const startTime = performance.now();

                // Sample pre-click
                const r0 = pill.getBoundingClientRect();
                samples.push({
                    t: 0,
                    left: Math.round(r0.left * 10) / 10,
                    width: Math.round(r0.width * 10) / 10
                });

                // Trigger click
                target.click();

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10,
                        width: Math.round(rect.width * 10) / 10
                    });
                    if (now - startTime < 800) {
                        requestAnimationFrame(onFrame);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        start_x = samples[0]["left"]
        final_x = samples[-1]["left"]
        dock_info = page.evaluate("""() => {
            const dock = document.getElementById('bottom-dock');
            const study = document.querySelector('.nav-tab-item[data-tab="study"]');
            return {
                dockWidth: dock.getBoundingClientRect().width,
                studyLeft: Math.round(study.getBoundingClientRect().left * 10) / 10
            };
        }""")

        print(f"Sample count: {len(samples)}")
        print(f"Start X: {start_x}, Final X: {final_x}, Target Study Left: {dock_info['studyLeft']}")

        # Table of samples
        print("\nRaw Sampled Trajectory (selection across frames):")
        step = max(1, len(samples) // 15)
        for i in range(0, len(samples), step):
            s = samples[i]
            print(f"  Frame {i:2d} | t={s['t']:3d}ms | pill.left={s['left']:6.1f}px | pill.width={s['width']:5.1f}px")
        # Ensure last frame is printed
        if (len(samples) - 1) % step != 0:
            s = samples[-1]
            print(f"  Frame {len(samples)-1:2d} | t={s['t']:3d}ms | pill.left={s['left']:6.1f}px | pill.width={s['width']:5.1f}px")

        # Assertions
        # 1. Distinct intermediate x positions strictly between start and target
        intermediates = [s["left"] for s in samples[1:-1] if s["left"] != start_x and s["left"] != final_x]
        distinct_intermediates = len(set(intermediates))
        print(f"Distinct intermediate positions: {distinct_intermediates} (required >= 8)")
        assert distinct_intermediates >= 8, f"Expected >= 8 distinct intermediate positions, got {distinct_intermediates}"

        # 2. First sample after click is NOT already final x
        assert samples[1]["left"] != final_x, "First sample after click must NOT already be at final x"

        # 3. Final x equals target tab left edge (±1px)
        assert abs(final_x - dock_info['studyLeft']) <= 1.0, f"Final pill x {final_x} does not match Study left edge {dock_info['studyLeft']}"

        # 4. Total travel time is between 300ms and 700ms
        # Settle sample: earliest sample after which ALL subsequent samples stay within 1.5px of target
        settle_idx = len(samples) - 1
        for i in range(len(samples) - 1, -1, -1):
            if abs(samples[i]["left"] - dock_info['studyLeft']) > 1.5:
                settle_idx = min(i + 1, len(samples) - 1)
                break
        settle_sample = samples[settle_idx]
        travel_time = settle_sample["t"]
        print(f"Total travel time to settle at target: ~{travel_time}ms (allowed: 300ms - 700ms)")
        assert 300 <= travel_time <= 700, f"Travel time {travel_time}ms not between 300ms and 700ms"

        # Check for spring overshoot
        max_x = max(s["left"] for s in samples)
        overshoot = max_x - dock_info['studyLeft']
        print(f"Spring peak X: {max_x:.1f}px (overshoot = {overshoot:.1f}px)")

        context.close()

        # =====================================================================
        # TEST A2: Emulated prefers-reduced-motion: reduce
        # =====================================================================
        print("\n--- TEST A2: Reduced Motion Slide Measurement ---")
        context_rm = browser.new_context(viewport={"width": 1280, "height": 800})
        page_rm = context_rm.new_page()
        page_rm.emulate_media(reduced_motion="reduce")
        page_rm.goto(INDEX_URL)
        page_rm.wait_for_selector("#bottom-dock")
        page_rm.wait_for_timeout(500)

        samples_rm = page_rm.evaluate("""() => {
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
                    if (now - startTime < 500) {
                        requestAnimationFrame(onFrame);
                    } else {
                        resolve(samples);
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        start_x_rm = samples_rm[0]["left"]
        final_x_rm = samples_rm[-1]["left"]
        intermediates_rm = [s["left"] for s in samples_rm[1:-1] if s["left"] != start_x_rm and s["left"] != final_x_rm]
        distinct_rm = len(set(intermediates_rm))
        print(f"Reduced motion sample count: {len(samples_rm)}, distinct intermediates: {distinct_rm}")
        assert distinct_rm >= 3, f"Expected >= 3 distinct intermediate positions in reduced motion, got {distinct_rm}"
        context_rm.close()

        # =====================================================================
        # TEST A3: Rapid Clicks (3 clicks within 150ms)
        # =====================================================================
        print("\n--- TEST A3: Rapid Clicks Test (3 clicks in 150ms) ---")
        context_rc = browser.new_context(viewport={"width": 1280, "height": 800})
        page_rc = context_rc.new_page()
        page_rc.goto(INDEX_URL)
        page_rc.wait_for_selector("#bottom-dock")
        page_rc.wait_for_timeout(500)

        rapid_result = page_rc.evaluate("""() => {
            return new Promise((resolve) => {
                const pill = document.getElementById('nav-spring-pill');
                const dock = document.getElementById('bottom-dock');
                const dockWidth = dock.getBoundingClientRect().width;
                const tabVocab = document.querySelector('.nav-tab-item[data-tab="vocab"]');
                const tabKanji = document.querySelector('.nav-tab-item[data-tab="kanji"]');
                const tabStudy = document.querySelector('.nav-tab-item[data-tab="study"]');

                const samples = [];
                const startTime = performance.now();

                // Click 1: Vocab immediately
                tabVocab.click();

                // Click 2: Kanji at 60ms
                setTimeout(() => tabKanji.click(), 60);

                // Click 3: Study at 120ms
                setTimeout(() => tabStudy.click(), 120);

                function onFrame(now) {
                    const elapsed = Math.round(now - startTime);
                    const rect = pill.getBoundingClientRect();
                    samples.push({
                        t: elapsed,
                        left: Math.round(rect.left * 10) / 10
                    });
                    if (now - startTime < 800) {
                        requestAnimationFrame(onFrame);
                    } else {
                        // Analyze max jump
                        let maxJump = 0;
                        for (let i = 1; i < samples.length; i++) {
                            const jump = Math.abs(samples[i].left - samples[i-1].left);
                            if (jump > maxJump) maxJump = jump;
                        }
                        resolve({
                            samples,
                            dockWidth,
                            maxJump,
                            maxJumpRatio: maxJump / dockWidth
                        });
                    }
                }
                requestAnimationFrame(onFrame);
            });
        }""")

        print(f"Rapid Clicks Max single-frame jump: {rapid_result['maxJump']:.2f}px ({rapid_result['maxJumpRatio']*100:.1f}% of dock width, limit: 40%)")
        assert rapid_result['maxJumpRatio'] < 0.40, f"Max jump {rapid_result['maxJumpRatio']*100:.1f}% exceeded 40% of dock width"
        context_rc.close()

        browser.close()

    print("\n=======================================================")
    print("ALL VERIFICATION CRITERIA (A, B, C) PASSED WITH FLYING COLORS!")
    print("=======================================================\n")

if __name__ == "__main__":
    run_tests()
