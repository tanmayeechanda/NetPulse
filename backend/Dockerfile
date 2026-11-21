FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# nmap for port scanning, libpcap for scapy sniffing, ping/traceroute/arp for fallbacks
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        nmap libpcap0.8 iputils-ping traceroute net-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
