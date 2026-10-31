from pathlib import Path

# 1. api_client.js
api_client_path = Path("desktop/src/ui/services/api_client.js")
text = api_client_path.read_text(encoding="utf-8")
text = text.replace(
    "      } catch (_) {}",
    "      } catch (err) {\n        console.warn('[ApiClient] Failed to get backend info:', err);\n      }"
)
text = text.replace(
    "      try {\n        errorData = await response.json();\n      } catch (_) {}",
    "      try {\n        errorData = await response.json();\n      } catch (jsonErr) {\n        console.debug('[ApiClient] Could not parse error response as JSON:', jsonErr);\n      }"
)
api_client_path.write_text(text, encoding="utf-8")
print("Fixed api_client.js")

# 2. telemetry.js
telemetry_path = Path("desktop/src/ui/services/telemetry.js")
text = telemetry_path.read_text(encoding="utf-8")
text = text.replace(
    "        }\n      } catch (_) {}",
    "        }\n      } catch (bridgeErr) {\n        console.warn('[Telemetry] Bridge services status error:', bridgeErr);\n      }"
)
text = text.replace(
    "      this.status.backend = healthRes.ok;\n    } catch (_) {",
    "      this.status.backend = healthRes.ok;\n    } catch (healthErr) {\n      console.warn('[Telemetry] Backend health fetch error:', healthErr);"
)
text = text.replace(
    "        this.status.ocr = ocrRes.status === 'fulfilled' && ocrRes.value.ok;\n      } catch (_) {}",
    "        this.status.ocr = ocrRes.status === 'fulfilled' && ocrRes.value.ok;\n      } catch (subErr) {\n        console.warn('[Telemetry] Secondary service checks error:', subErr);\n      }"
)
telemetry_path.write_text(text, encoding="utf-8")
print("Fixed telemetry.js")

# 3. vocab_main.js
vocab_path = Path("desktop/src/ui/views/vocab_main.js")
text = vocab_path.read_text(encoding="utf-8")
text = text.replace(
    "        this.knownWordsSet = new Set(words);\n      }\n    } catch (_) {}",
    "        this.knownWordsSet = new Set(words);\n      }\n    } catch (err) {\n      console.warn('[VocabMain] Failed to load known words:', err);\n    }"
)
vocab_path.write_text(text, encoding="utf-8")
print("Fixed vocab_main.js")

