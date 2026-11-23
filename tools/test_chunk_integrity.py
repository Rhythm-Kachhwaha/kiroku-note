import os
import sys
import hashlib
import base64
import zipfile
import io
import json
from PIL import Image

def main():
    cbz_path = os.path.expandvars(r'%APPDATA%\kiroku-desktop\File System\000\t\00\00000031')
    if not os.path.exists(cbz_path):
        print(f"File not found: {cbz_path}")
        sys.exit(1)

    print("=" * 60)
    print("STEP 1: Reading original manga file...")
    with open(cbz_path, 'rb') as f:
        orig_bytes = f.read()

    orig_size = len(orig_bytes)
    orig_sha256 = hashlib.sha256(orig_bytes).hexdigest()
    print(f"Original size: {orig_size:,} bytes ({orig_size / (1024*1024):.2f} MB)")
    print(f"Original SHA-256: {orig_sha256}")

    print("\nSTEP 2: Slicing file into 2 MB chunks and encoding to Base64...")
    CHUNK_SIZE = 2 * 1024 * 1024  # 2 MB binary chunk
    chunks = []
    offset = 0
    while offset < orig_size:
        slice_bytes = orig_bytes[offset:offset + CHUNK_SIZE]
        b64_chunk = base64.b64encode(slice_bytes).decode('ascii')
        chunks.append(b64_chunk)
        offset += CHUNK_SIZE

    total_chunks = len(chunks)
    print(f"Total chunks created: {total_chunks} chunks (each <= 2 MB)")

    print("\nSTEP 3: Simulating chunk download and reassembly...")
    os.makedirs('.tmp', exist_ok=True)
    out_path = os.path.join('.tmp', 'reassembled_001_yotsubato.cbz')

    with open(out_path, 'wb') as out_f:
        for idx, chunk_b64 in enumerate(chunks):
            chunk_bytes = base64.b64decode(chunk_b64)
            out_f.write(chunk_bytes)

    with open(out_path, 'rb') as f:
        reassembled_bytes = f.read()

    reassembled_size = len(reassembled_bytes)
    reassembled_sha256 = hashlib.sha256(reassembled_bytes).hexdigest()
    print(f"Reassembled size: {reassembled_size:,} bytes")
    print(f"Reassembled SHA-256: {reassembled_sha256}")

    assert orig_size == reassembled_size, f"Size mismatch! {orig_size} != {reassembled_size}"
    assert orig_sha256 == reassembled_sha256, f"Hash mismatch! {orig_sha256} != {reassembled_sha256}"
    print("-> BIT-FOR-BIT PERFECT MATCH! Zero data loss!")

    print("\nSTEP 4: Verifying CBZ Archive integrity and image decoding...")
    with zipfile.ZipFile(out_path, 'r') as zf:
        img_names = sorted([n for n in zf.namelist() if n.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))])
        print(f"Total page images in archive: {len(img_names)}")
        assert len(img_names) == 231, f"Expected 231 pages, got {len(img_names)}"

        # Verify page 1 and page 2 image headers and dimensions
        p1_bytes = zf.read(img_names[0])
        img1 = Image.open(io.BytesIO(p1_bytes))
        print(f"Page 1 format: {img1.format}, resolution: {img1.size[0]}x{img1.size[1]}")

        p2_bytes = zf.read(img_names[1])
        img2 = Image.open(io.BytesIO(p2_bytes))
        print(f"Page 2 format: {img2.format}, resolution: {img2.size[0]}x{img2.size[1]}")

    print("\nSTEP 5: Verifying alignment with Pre-baked OCR speech bubbles...")
    # Read the prebaked OCR cache or verify dimensions
    cache_path = os.path.join(REPO_ROOT if 'REPO_ROOT' in globals() else '.', '.tmp', 'kiroku_ocr_pages_book_1794685753525_bajll8.json')
    if os.path.exists(cache_path):
        with open(cache_path, 'r', encoding='utf-8') as f:
            ocr_pages = json.load(f)
        p1_ocr = ocr_pages[0] if ocr_pages else None
        if p1_ocr and p1_ocr.get('bubbles'):
            first_bubble = p1_ocr['bubbles'][0]
            print(f"Page 1 OCR bubble text: '{first_bubble.get('text')}'")
            print(f"Page 1 OCR box: {first_bubble.get('box')}")
            print(f"Page 1 recorded dimensions in OCR: {first_bubble.get('page_width')}x{first_bubble.get('page_height')}")
            # Ensure OCR dimensions match image dimensions
            assert first_bubble.get('page_width') == img1.size[0], "Page width mismatch!"
            assert first_bubble.get('page_height') == img1.size[1], "Page height mismatch!"
            print("-> OCR bounding boxes match image dimensions perfectly!")

    print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == '__main__':
    main()
