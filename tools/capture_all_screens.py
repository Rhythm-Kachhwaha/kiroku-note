import os
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO_ROOT = Path(r"d:\Python\AnkiMiner")
INDEX_PATH = REPO_ROOT / "desktop" / "src" / "index.html"
INDEX_URL = f"file:///{INDEX_PATH.as_posix()}"
SCREENSHOT_DIR = REPO_ROOT / "docs" / "desktop-wireup" / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

preload_mock = """
window.desktopAPI = {
  getBackendInfo: async () => ({ host: '127.0.0.1', port: 21828 }),
  getEphemeralStudyToken: async () => 'test-bearer-token',
  getServicesStatus: async () => ({ backend: true, yomitan: true, anki: true, ocr: true }),
  openUserDataFolder: () => true,
  retryBackend: () => true,
  minimize: () => {},
  maximize: () => {},
  close: () => {},
  isMaximized: async () => false,
  api: {
    request: async (opts) => {
      const path = opts.path || '';
      if (path.startsWith('/api/cards')) {
        return {
          cards: [
            { id: 1, expression: '静寂', reading: 'せいじゃく', meaning: 'silence, stillness, quiet', jlpt_level: 'N2', tags: ['mining'], sync_status: 'synced', created_at: '2026-10-31T12:00:00Z' },
            { id: 2, expression: '雨', reading: 'あめ', meaning: 'rain', jlpt_level: 'N5', tags: ['nature'], sync_status: 'pending', created_at: '2026-10-30T10:00:00Z' }
          ],
          total: 2,
          page: 1,
          page_size: 20
        };
      }
      if (path === '/api/anki/decks') return ['Japanese::Mining', 'Default'];
      if (path === '/api/anki/models') return ['Mining Note Type'];
      if (path === '/api/anki/status') return { connected: true, version: 6 };
      if (path === '/api/ocr/status') return { running: true };
      if (path === '/api/llm/config') return { provider: 'groq', model: 'llama-3.3-70b-versatile', has_key: true };
      if (path === '/api/known-words') return ['静寂', '雨'];
      if (path === '/api/capture') {
        return {
          found: true,
          term: '静寂',
          reading: 'せいじゃく',
          meanings: ['silence, quiet, stillness'],
          sentence: '夜の静寂を破る。'
        };
      }
      if (path.startsWith('/api/grammar/syllabus')) {
        return {
          total: 2,
          points: [
            { pattern_key: 'n3:wake_ni_wa_ikanai', level: 'N3', title: '〜わけにはいかない', meaning: 'cannot afford to / must not', mastery_status: 'learning' },
            { pattern_key: 'n3:bakari_da', level: 'N3', title: '〜ばかりだ', meaning: 'continue to / only', mastery_status: 'new' }
          ]
        };
      }
      if (path.startsWith('/api/kanji/browse')) {
        return {
          total: 3,
          kanji: [
            { character: '静', stroke_count: 14, onyomi: ['セイ'], kunyomi: ['しず.か'], meanings: ['quiet'] },
            { character: '寂', stroke_count: 11, onyomi: ['ジャク'], kunyomi: ['さび.しい'], meanings: ['lonely'] },
            { character: '雨', stroke_count: 8, onyomi: ['ウ'], kunyomi: ['あめ'], meanings: ['rain'] }
          ]
        };
      }
      if (path.startsWith('/api/kanji/details')) {
        return { character: '静', stroke_count: 14, onyomi: ['セイ', 'ジョウ'], kunyomi: ['しず.か'], meanings: ['quiet', 'peaceful'] };
      }
      if (path.startsWith('/api/kanji/compounds')) {
        return [
          { expression: '静寂', reading: 'せいじゃく', meaning: 'silence, stillness' },
          { expression: '冷静', reading: 'れいせい', meaning: 'calm, composed' }
        ];
      }
      if (path.startsWith('/api/kanji/strokes')) {
        return {
          character: '静',
          strokes: [
            'M10 20 L50 20',
            'M30 10 L30 50'
          ]
        };
      }
      return {};
    }
  },
  study: {
    request: async (opts) => {
      const path = opts.path || '';
      if (path === '/diagnostics') {
        return {
          status: 'healthy',
          checks: {
            database_schema: 'ok',
            media_store: 'ok',
            question_eligibility: 'ok'
          }
        };
      }
      if (path === '/practice/sessions') {
        return {
          session_id: 'prac-001',
          level: 'N3',
          question_count: 1,
          questions: [
            {
              question_id: 'q-001',
              instruction_text: 'Choose the correct particle for the sentence:',
              prompt_markup: '雨が降って<ruby>庭<rt>にわ</rt></ruby>が濡れた。',
              choices: [
                { id: 'c1', text: 'が' },
                { id: 'c2', text: 'を' },
                { id: 'c3', text: 'に' },
                { id: 'c4', text: 'で' }
              ],
              correct_choice_id: 'c1',
              explanation_markup: '主語を示す格助詞「が」が適切です。'
            }
          ]
        };
      }
      if (path === '/exam/sessions') {
        return {
          session_id: 'exam-001',
          level: 'N3',
          section: 'language_knowledge',
          time_remaining_seconds: 3600,
          total_questions: 1,
          items: [
            {
              item_id: 'item-001',
              instruction_text: '問題：次の文の（ ）に入れるのに最もよいものを一つ選びなさい。',
              prompt_markup: 'どんなに大変でも、最後まで諦める（ ）にはいかない。',
              choices: [
                { id: '1', text: 'わけ' },
                { id: '2', text: 'もの' },
                { id: '3', text: 'こと' },
                { id: '4', text: 'はず' }
              ]
            }
          ]
        };
      }
      return {};
    }
  }
};
"""

viewports = [
    {"name": "compact_500x750", "width": 500, "height": 750},
    {"name": "standard_1280x800", "width": 1280, "height": 800},
    {"name": "maximized_1920x1080", "width": 1920, "height": 1080}
]

screens = [
    {"id": "home", "tab": "home", "wait_selector": "#home-mascot-cat"},
    {"id": "vocab", "tab": "vocab", "wait_selector": "#vocab-search-input"},
    {"id": "vocab_history", "tab": "vocab-history", "wait_selector": "#cards-table"},
    {"id": "grammar", "tab": "grammar", "wait_selector": "#sentence-input"},
    {"id": "kanji", "tab": "kanji", "wait_selector": "#kanji-search-input"},
    {"id": "study", "tab": "study", "wait_selector": ".study-view-container"},
    {"id": "test", "tab": "test", "wait_selector": ".test-view-container"},
    {"id": "settings", "tab": "settings", "wait_selector": "#anki-url-input"}
]

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--allow-file-access-from-files"]
        )

        for vp in viewports:
            print(f"=== Capturing Viewport: {vp['name']} ({vp['width']}x{vp['height']}) ===")
            context = browser.new_context(viewport={"width": vp["width"], "height": vp["height"]})
            page = context.new_page()

            page.add_init_script(preload_mock)
            page.goto(INDEX_URL)
            page.wait_for_timeout(600)

            for s in screens:
                print(f"  Navigating to {s['id']}...")
                page.evaluate(f"window.router?.navigateToTab('{s['tab']}', false)")
                page.wait_for_timeout(400)

                filename = f"{s['id']}_{vp['name']}.png"
                filepath = SCREENSHOT_DIR / filename
                page.screenshot(path=str(filepath))
                print(f"    Saved {filename}")

            context.close()

        browser.close()
    print(f"\nAll screenshots saved to {SCREENSHOT_DIR}")

if __name__ == "__main__":
    main()

