"""
UrbanTwin AI - Phase 3 Dual-Mode Video Ingestion Automated Test Suite
Validates:
1. Synthetic procedural traffic generator produces 1280x720 video frames with valid bounding boxes and Kolkata plates.
2. Video ingestion stream status endpoint (/api/v1/cameras/streams/status).
3. Dynamic stream reconfiguration (/api/v1/cameras/{id}/stream/configure) between Synthetic, Phone IP, and Video file modes.
4. On-demand JPEG snapshot extraction (/api/v1/cameras/{id}/stream/snapshot).
5. Pre-recorded traffic video upload (/api/v1/cameras/{id}/stream/upload).
6. Multi-part MJPEG stream generation for browser <img> rendering.
"""

import io
import pytest
import numpy as np
from fastapi.testclient import TestClient
from app.main import app
from app.services.synthetic_stream_generator import SyntheticTrafficGenerator
from app.services.video_ingestion_service import VideoIngestionService

client = TestClient(app)

def test_synthetic_stream_generator_frame_production():
    """Validates that SyntheticTrafficGenerator yields 1280x720 BGR frames with simulated traffic metadata."""
    generator = SyntheticTrafficGenerator(camera_id="TEST_CAM", camera_name="Test Ingestion Node")
    
    for _ in range(5):
        frame_bgr, detections = generator.generate_frame()
        assert isinstance(frame_bgr, np.ndarray)
        assert frame_bgr.shape == (720, 1280, 3)
        assert frame_bgr.dtype == np.uint8
        
        # Verify simulated vehicle annotations
        assert len(detections) > 0
        for d in detections:
            assert "track_id" in d
            assert "plate_text" in d
            assert "vehicle_type" in d
            assert "bbox" in d
            assert len(d["bbox"]) == 4

def test_stream_status_catalog_endpoint():
    """Validates GET /api/v1/cameras/streams/status returns active workers for CAM_01 & CAM_02."""
    res = client.get("/api/v1/cameras/streams/status")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    
    camera_ids = [s["camera_id"] for s in data]
    assert "CAM_01" in camera_ids
    assert "CAM_02" in camera_ids
    
    for s in data:
        assert "camera_id" in s
        assert "camera_name" in s
        assert "mode" in s
        assert "status" in s
        assert "fps" in s
        assert "frames_processed" in s
        assert "plates_detected" in s

def test_camera_stream_configure_endpoint():
    """Validates POST /api/v1/cameras/{camera_id}/stream/configure mode switching."""
    # 1. Switch to Phone Live mode
    phone_url = "http://192.168.1.150:8080/video"
    res = client.post("/api/v1/cameras/CAM_01/stream/configure", json={
        "mode": "phone_live",
        "source_url": phone_url
    })
    assert res.status_code == 200
    data = res.json()
    assert data["camera_id"] == "CAM_01"
    assert data["mode"] == "phone_live"
    assert data["source_url"] == phone_url
    
    # 2. Revert back to Synthetic Simulation
    res_synth = client.post("/api/v1/cameras/CAM_01/stream/configure", json={
        "mode": "synthetic",
        "source_url": ""
    })
    assert res_synth.status_code == 200
    data_synth = res_synth.json()
    assert data_synth["camera_id"] == "CAM_01"
    assert data_synth["mode"] == "synthetic"

def test_camera_snapshot_endpoint():
    """Validates GET /api/v1/cameras/{camera_id}/stream/snapshot returns a valid JPEG image."""
    for cam_id in ["CAM_01", "CAM_02"]:
        res = client.get(f"/api/v1/cameras/{cam_id}/stream/snapshot")
        assert res.status_code == 200
        assert res.headers.get("content-type") == "image/jpeg"
        assert len(res.content) > 1000  # Non-trivial image payload
        assert res.content.startswith(b"\xff\xd8") # JPEG SOI marker

def test_camera_video_upload_endpoint():
    """Validates POST /api/v1/cameras/{camera_id}/stream/upload activates uploaded video file."""
    fake_video_bytes = b"\x00\x00\x00 ftypisom\x00\x00\x02\x00isomiso2mp41"
    file_payload = ("test_cctv.mp4", io.BytesIO(fake_video_bytes), "video/mp4")
    
    res = client.post("/api/v1/cameras/CAM_01/stream/upload", files={"file": file_payload})
    assert res.status_code == 200
    data = res.json()
    assert data["camera_id"] == "CAM_01"
    assert data["mode"] == "video_file"
    assert "test_cctv.mp4" in data["source_url"]
    
    # Revert back to synthetic mode for regular continuous operation
    client.post("/api/v1/cameras/CAM_01/stream/configure", json={"mode": "synthetic", "source_url": ""})

def test_mjpeg_stream_generator_frame_structure():
    """Validates that generate_mjpeg_stream yields multipart/x-mixed-replace boundary frames."""
    service = VideoIngestionService.get_instance()
    stream_gen = service.generate_mjpeg_stream("CAM_01")
    
    first_chunk = next(stream_gen)
    assert b"--frame\r\n" in first_chunk
    assert b"Content-Type: image/jpeg\r\n\r\n" in first_chunk
    assert len(first_chunk) > 1000
