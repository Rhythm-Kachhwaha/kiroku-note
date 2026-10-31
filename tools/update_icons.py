from pathlib import Path

study_path = Path("desktop/src/ui/views/study.js")
test_path = Path("desktop/src/ui/views/test.js")

# Update study.js
study_text = study_path.read_text(encoding="utf-8")
study_text = study_text.replace(
    '<span class="grading-status-icon" id="grading-icon">✓</span>',
    '<span class="grading-status-icon" id="grading-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></span>'
)
study_text = study_text.replace(
    "icon.textContent = isCorrect ? '✓' : '✗';",
    """icon.innerHTML = isCorrect
          ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
          : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';"""
)
study_path.write_text(study_text, encoding="utf-8")
print("Updated study.js")

# Update test.js
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace(
    "<span id=\"flag-icon\">${isFlagged ? '★' : '☆'}</span>",
    """<span id="flag-icon">${isFlagged ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>'}</span>"""
)
test_text = test_text.replace(
    "if (flagIcon) flagIcon.textContent = isNowFlagged ? '★' : '☆';",
    """if (flagIcon) flagIcon.innerHTML = isNowFlagged
        ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>';"""
)
test_path.write_text(test_text, encoding="utf-8")
print("Updated test.js")

