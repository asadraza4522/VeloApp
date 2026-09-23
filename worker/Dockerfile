FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
# yt-dlp needs a JS runtime for some YouTube signature challenges; the image is rebuilt nightly
# so yt-dlp / gallery-dl are always current (platforms break weekly).
RUN apt-get update && apt-get install -y --no-install-recommends nodejs ca-certificates && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml .
COPY app app
RUN pip install .
RUN useradd -r -u 10001 velo
USER velo
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
