FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ python3 openjdk-17-jdk-headless ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY supervisor.py /usr/local/bin/supervisor.py
RUN chmod 0555 /usr/local/bin/supervisor.py

ENTRYPOINT ["python3", "-I", "/usr/local/bin/supervisor.py"]
