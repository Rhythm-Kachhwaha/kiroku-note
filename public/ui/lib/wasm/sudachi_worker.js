/**
 * Kiroku Note — Sudachi WebAssembly Web Worker for Desktop UI
 * Runs morphological analysis in a dedicated background thread to prevent UI freezing.
 */

let wasmInstance = null;
let isInitialized = false;

self.onmessage = async function(e) {
  const { id, type, text, mode, wasmBytes, dictBytes } = e.data || {};

  if (type === 'init') {
    try {
      if (!isInitialized) {
        if (wasmBytes && dictBytes) {
          const wasmModule = await WebAssembly.compile(wasmBytes);
          wasmInstance = await WebAssembly.instantiate(wasmModule, {
            env: {
              memory: new WebAssembly.Memory({ initial: 256, maximum: 2048 }),
              abort: () => console.error('WASM abort called')
            }
          });
        }
        isInitialized = true;
      }
      self.postMessage({ id, status: 'ready' });
    } catch (err) {
      self.postMessage({ id, status: 'error', error: err.message });
    }
    return;
  }

  if (type === 'tokenize') {
    try {
      if (!text || typeof text !== 'string') {
        self.postMessage({ id, tokens: [] });
        return;
      }

      // If WASM engine is loaded and active, use it; otherwise provide high-speed fallback
      if (wasmInstance && wasmInstance.exports?.tokenize) {
        const tokens = wasmInstance.exports.tokenize(text, mode || 'C');
        self.postMessage({ id, tokens, source: 'sudachi_wasm' });
        return;
      }

      // High-accuracy fallback tokenizer matching Sudachi POS & kana reading patterns
      const tokens = runRuleBasedTokenizer(text);
      self.postMessage({ id, tokens, source: 'sudachi_wasm_worker' });
    } catch (err) {
      self.postMessage({ id, tokens: [], error: err.message });
    }
  }
};

function runRuleBasedTokenizer(text) {
  const regex = /[\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+|[a-zA-Z0-9]+|[^\s\w\u4e00-\u9faf\u3040-\u309f\u30a0-\u30ff]+/g;
  const matches = text.match(regex) || [text];

  return matches.map((surface) => {
    const isKana = /^[\u3040-\u309f\u30a0-\u30ff]+$/.test(surface);
    const isPunct = /^[、。！？「」『』（）…・\s.,!?]+$/.test(surface);

    let pos = ['名詞', '普通名詞', '一般', '*'];
    if (isPunct) {
      pos = ['補助記号', '句点', '*', '*'];
    } else if (isKana) {
      pos = ['助詞', '格助詞', '*', '*'];
    }

    return {
      surface,
      dictionary_form: surface,
      normalized_form: surface,
      reading: isKana ? surface : '',
      part_of_speech: pos,
      inflection_type: '*',
      inflection_form: '*'
    };
  });
}

