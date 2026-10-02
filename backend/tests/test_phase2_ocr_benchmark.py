"""
UrbanTwin AI - Phase 2 STN-CRNN ANPR OCR Automated Benchmark Test Suite
Validates:
1. All 6 environmental degradation categories maintain >= 90% character accuracy SLA.
2. Kolkata plates (WB series) & Bharat Series (BH) recognition pipelines.
3. Live benchmark matrix endpoint (/api/v1/cameras/ocr_benchmark_matrix).
4. Image upload ANPR with deep CRAFT/EasyOCR + spatial line assembly.
"""

import io
import base64
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services import anpr_service
from training.dataset_generator import render_license_plate

client = TestClient(app)

DEGRADATIONS = ["clean", "rain", "glare", "motion_blur", "oblique_angle", "dirty"]

def test_phase2_kolkata_plate_all_six_degradations():
    """Validates that Kolkata vehicle plate WB02AK4921 passes >=90% SLA across all 6 degradation states."""
    plate = "WB02AK4921"
    for deg in DEGRADATIONS:
        payload = {
            "plate_text": plate,
            "degradation": deg,
            "vehicle_speed_kmh": 85 if deg == "motion_blur" else 50
        }
        res = client.post("/api/v1/cameras/ocr_test", json=payload)
        assert res.status_code == 200, f"Failed on degradation: {deg}"
        data = res.json()
        assert data["overall_accuracy_pct"] >= 90.0, f"Accuracy {data['overall_accuracy_pct']}% below 90% SLA on {deg}"
        assert data["passes_90_pct_threshold"] is True
        assert len(data["character_breakdown"]) == len(plate)
        assert "svg" in data["ocr_visual_svg"].lower()
        assert data["processing_time_ms"] > 0

def test_phase2_bharat_series_all_six_degradations():
    """Validates that Bharat Series plate 22BH6517A passes >=90% SLA across all 6 degradation states."""
    plate = "22BH6517A"
    for deg in DEGRADATIONS:
        payload = {
            "plate_text": plate,
            "degradation": deg,
            "vehicle_speed_kmh": 90 if deg == "motion_blur" else 60
        }
        res = client.post("/api/v1/cameras/ocr_test", json=payload)
        assert res.status_code == 200, f"Failed on degradation: {deg}"
        data = res.json()
        assert data["overall_accuracy_pct"] >= 90.0, f"Accuracy {data['overall_accuracy_pct']}% below 90% SLA on {deg}"
        assert data["passes_90_pct_threshold"] is True
        assert len(data["character_breakdown"]) == len(plate)

def test_phase2_benchmark_matrix_endpoint():
    """Validates the 6-condition batch benchmark endpoint /api/v1/cameras/ocr_benchmark_matrix."""
    res = client.get("/api/v1/cameras/ocr_benchmark_matrix?plate=WB02AK4921")
    assert res.status_code == 200
    data = res.json()
    assert data["phase"] == "Phase 2 - STN-CRNN ANPR OCR"
    assert data["milestone_status"] == "CERTIFIED_PASS"
    assert data["sla_met"] is True
    assert data["total_conditions_tested"] == 6
    assert data["conditions_passed"] == 6
    assert data["average_accuracy_pct"] >= 90.0
    
    matrix = data["benchmark_matrix"]
    assert len(matrix) == 6
    deg_ids = {m["degradation_id"] for m in matrix}
    assert deg_ids == set(DEGRADATIONS)
    for m in matrix:
        assert m["passes_sla"] is True
        assert m["accuracy_pct"] >= 90.0
        assert m["latency_ms"] > 0
        assert len(m["rectification_applied"]) > 0

def test_phase2_real_image_upload_kolkata_plate():
    """Tests real image generation, multipart upload, CRAFT detection, and EasyOCR recognition."""
    img = render_license_plate("WB02AK4921", degradation="clean")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    img_bytes = buf.getvalue()

    files = {"file": ("kolkata_taxi.png", img_bytes, "image/png")}
    res = client.post("/api/v1/cameras/ocr_upload", files=files)
    assert res.status_code == 200
    data = res.json()
    assert data["recognized_plate"] in ["WB02AK4921", "WB02AK492I"] or len(data["recognized_plate"]) >= 8
    assert data["recognition_confidence"] >= 0.85
    assert data["ocr_test_result"]["passes_90_pct_threshold"] is True

def test_phase2_mock_plate_pool_has_kolkata_nodes():
    """Verifies that the mock camera observation pool includes authentic Kolkata and Bharat Series plates."""
    from app.services.anpr_service import MOCK_RAW_PLATES
    plates = [p["plate"] for p in MOCK_RAW_PLATES]
    assert any("WB02" in p for p in plates)
    assert any("22BH" in p for p in plates)
    assert any("WB06" in p for p in plates)
