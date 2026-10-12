# SkillsBridge Placement Readiness API — production container
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY static ./static
COPY skillsbridge_readiness_model.pkl .
COPY model_feature_order.pkl .

EXPOSE 8000

# healthcheck lets orchestrators (Docker Compose/Kubernetes) know if the container is alive
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
