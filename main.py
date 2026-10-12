"""
SkillsBridge Placement Readiness API
Loads the calibrated model trained in the Colab notebook and serves predictions.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --reload

Run in Docker:
    docker build -t skillsbridge-api .
    docker run -p 8000:8000 skillsbridge-api

Then visit http://localhost:8000/docs for interactive API testing (Swagger UI).
"""

import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pathlib import Path

app = FastAPI(
    title="SkillsBridge Placement Readiness API",
    version="1.0.0",
    description="Predicts placement readiness and explains the result."
)

app.mount(
    "/static",
    StaticFiles(directory=Path(__file__).parent / "static"),
    name="static",
)

# Loaded once at startup, not per-request (important for performance)
model = joblib.load("skillsbridge_readiness_model.pkl")
feature_order = joblib.load("model_feature_order.pkl")

# SHAP explainer built once at startup too
try:
    base_estimator = model.calibrated_classifiers_[0].estimator.named_steps["classifier"]
    explainer = shap.Explainer(base_estimator)
except Exception:
    explainer = None  # explanation endpoint degrades gracefully if unavailable


class StudentProfile(BaseModel):
    cgpa: float = Field(..., ge=0, le=10, description="CGPA on a 0-10 scale")
    internships: int = Field(..., ge=0)
    projects: int = Field(..., ge=0)
    certifications: int = Field(..., ge=0)
    coding_score: float = Field(..., ge=0, le=100)
    communication_score: float = Field(..., ge=0, le=100)

    # Model training also uses additional placement signals; these are optional
    # compatibility fields for newer payloads and default to neutral values.
    dsa_problems: int = Field(0, ge=0)
    aptitude_score: float = Field(0, ge=0, le=100)
    leetcode_rating: float = Field(0, ge=0, le=100)
    github_contributions: int = Field(0, ge=0)
    hackathons: int = Field(0, ge=0)
    ai_ml_skill: float = Field(0, ge=0, le=100)
    system_design: float = Field(0, ge=0, le=100)
    resume_score: float = Field(0, ge=0, le=100)
    mock_interview_score: float = Field(0, ge=0, le=100)


class ReadinessResponse(BaseModel):
    readiness_percent: float
    label: str
    weakest_factors: list[str] = []
    strongest_factors: list[str] = []


@app.get("/", include_in_schema=False)
def placement_readiness_ui():
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/health")
def health_check():
    """Basic liveness check — used by load balancers / uptime monitors."""
    return {"status": "ok"}


@app.post("/v1/predict-readiness", response_model=ReadinessResponse)
def predict_readiness(profile: StudentProfile):
    try:
        row_values = {}
        for field in feature_order:
            if hasattr(profile, field):
                row_values[field] = getattr(profile, field)
            elif field == "dsa_problems" and hasattr(profile, "coding_score"):
                row_values[field] = max(0, round(profile.coding_score / 10))
            elif field == "aptitude_score" and hasattr(profile, "coding_score"):
                row_values[field] = profile.coding_score
            elif field == "leetcode_rating" and hasattr(profile, "coding_score"):
                row_values[field] = profile.coding_score
            else:
                row_values[field] = 0

        row = pd.DataFrame([row_values], columns=feature_order)
        proba = model.predict_proba(row)[0][1]  # probability of "Placed"/"Ready" class
        label = "Ready" if proba >= 0.5 else "Needs Improvement"

        weakest, strongest = [], []
        if explainer is not None:
            preprocessor = model.calibrated_classifiers_[0].estimator.named_steps["preprocessor"]
            transformed = preprocessor.transform(row)
            shap_vals = explainer(transformed)
            readiness_contributions = shap_vals.values[0, :, 1]
            contributions = sorted(
                zip(feature_order, readiness_contributions), key=lambda x: x[1]
            )
            weakest = [f for f, _ in contributions[:2]]
            strongest = [f for f, _ in contributions[-2:]]

        return ReadinessResponse(
            readiness_percent=round(proba * 100, 1),
            label=label,
            weakest_factors=weakest,
            strongest_factors=strongest,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Prediction failed: {str(e)}")
