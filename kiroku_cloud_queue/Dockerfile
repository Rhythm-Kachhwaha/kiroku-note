FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN if [ -f data/jitendex-yomitan.zip ] && [ -f data/KANJIDIC_english.zip ]; then \
        python -m kiroku_dictionary.build --jitendex data/jitendex-yomitan.zip --kanjidic data/KANJIDIC_english.zip --out kiroku_dict.sqlite; \
    fi

EXPOSE 8080

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
