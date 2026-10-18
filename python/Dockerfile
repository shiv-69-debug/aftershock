FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 HF_HOME=/models TOKENIZERS_PARALLELISM=false
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y --no-install-recommends g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY python/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r requirements.txt
COPY python/graphrag_worker.py /app/graphrag_worker.py
ENTRYPOINT ["python", "/app/graphrag_worker.py"]
