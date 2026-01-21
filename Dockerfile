# Use lightweight Python image
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY backend/requirements.txt .

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy app files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/backend

# Environment variables
ENV PYTHONUNBUFFERED=1

# Expose port (Railway sets PORT dynamically)
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/api/health || exit 1

# Use entrypoint shell to expand $PORT dynamically
ENTRYPOINT ["sh", "-c"]
CMD ["exec gunicorn -k eventlet -w 1 -b 0.0.0.0:${PORT:-5000} app:app"]
