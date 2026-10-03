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


def test_live_vehicle_recognition_engine_parameters():
    """
    Validates that LiveVehicleRecognitionEngine successfully extracts all 7 parameters:
    1. Vehicle Bounding Box
    2. Vehicle Classification
    3. Dominant Color & Hex
    4. Optical Speed Estimate (km/h)
    5. Lane Assignment
    6. ANPR License Plate & Confidence
    7. Cyber HUD Telemetry
    """
    from app.services.video_ingestion_service import LiveVehicleRecognitionEngine
    import cv2

    engine = LiveVehicleRecognitionEngine(camera_id="CAM_TEST")

    # 1. Color extraction test on yellow taxi crop
    yellow_crop = np.zeros((100, 100, 3), dtype=np.uint8)
    yellow_crop[:] = (30, 210, 240) # BGR Yellow
    c_name, c_hex = engine.extract_dominant_color(yellow_crop)
    assert "Yellow" in c_name
    assert c_hex == "#eab308"

    # 2. Vehicle classification test
    assert engine.classify_vehicle(300, 150, "Silver Metallic") == "Transit Bus (CSTC)"
    assert engine.classify_vehicle(180, 100, "Classic Yellow (Kolkata Taxi)") == "Commercial Taxi (Ambassador)"
    assert engine.classify_vehicle(40, 50, "Obsidian Black") == "Motorcycle / Two-Wheeler"

    # 3. Lane determination test
    assert "Lane 1" in engine.determine_lane(200, 960)
    assert "Lane 2" in engine.determine_lane(480, 960)
    assert "Lane 3" in engine.determine_lane(800, 960)

    # 4. End-to-end frame processing test
    test_frame = np.zeros((540, 960, 3), dtype=np.uint8)
    # Draw a simulated vehicle shape
    cv2.rectangle(test_frame, (400, 200), (560, 300), (20, 200, 240), -1)

    ann_frame, detections = engine.process_frame(
        frame=test_frame,
        camera_id="CAM_01",
        camera_name="Park Street",
        mode="phone_live",
        fps=30.0,
        status="STREAMING"
    )

    assert isinstance(ann_frame, np.ndarray)
    assert ann_frame.shape == (540, 960, 3)
    assert len(detections) > 0

    det = detections[0]
    required_keys = [
        "track_id", "vehicle_type", "vehicle_color", "color_hex",
        "lane", "plate_text", "confidence", "speed_kmh", "bbox", "timestamp"
    ]
    for key in required_keys:
        assert key in det, f"Missing required telemetry parameter: {key}"

    assert len(det["bbox"]) == 4
    assert det["confidence"] >= 0.90
    assert det["speed_kmh"] >= 0.0


def test_optical_speed_stationary_and_motion():
    """
    Validates that:
    1. Stationary vehicle correctly yields 0.0 km/h (no false positive motion).
    2. Moving vehicle yields real speed > 0.0 km/h proportional to optical flow displacement.
    """
    from app.services.video_ingestion_service import LiveVehicleRecognitionEngine
    import cv2
    import time

    engine = LiveVehicleRecognitionEngine(camera_id="CAM_SPEED_TEST")

    # Stationary frame test (identical consecutive frames)
    f_stat1 = np.zeros((540, 960, 3), dtype=np.uint8)
    cv2.rectangle(f_stat1, (350, 150), (600, 320), (50, 50, 50), -1)

    f_stat2 = f_stat1.copy()

    _, d1 = engine.process_frame(f_stat1, "CAM_01", "Node A", "phone_live", 30.0, "STREAMING")
    time.sleep(0.04)
    _, d2 = engine.process_frame(f_stat2, "CAM_01", "Node A", "phone_live", 30.0, "STREAMING")

    assert len(d2) > 0
    assert d2[0]["speed_kmh"] == 0.0  # Must be strictly 0.0 km/h when stationary

    # Moving vehicle test (position shifted across frame)
    f_move = np.zeros((540, 960, 3), dtype=np.uint8)
    cv2.rectangle(f_move, (400, 150), (650, 320), (50, 50, 50), -1)

    time.sleep(0.04)
    _, d3 = engine.process_frame(f_move, "CAM_01", "Node A", "phone_live", 30.0, "STREAMING")
    assert len(d3) > 0
    assert d3[0]["speed_kmh"] > 0.0  # Dynamic motion detected


def test_real_anpr_ocr_recognition_on_frame():
    """
    Validates that EasyOCR recognizer reads real license plate characters
    from an image array and updates the detection payload.
    """
    from app.services.ocr_image_service import recognize_plate_from_array
    import cv2

    # Synthesize clean high-contrast Indian plate
    plate_img = np.ones((70, 240, 3), dtype=np.uint8) * 255
    cv2.putText(plate_img, "WB02AK4921", (15, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)

    plate_text, conf, engine_name, _, _ = recognize_plate_from_array(plate_img, is_bgr=True)
    assert plate_text == "WB02AK4921"
    assert conf >= 0.70
    assert "EasyOCR" in engine_name or "Plate Localizer" in engine_name


def test_webcam_mode_configuration():
    """Validates configuring camera to hardware webcam mode."""
    res = client.post("/api/v1/cameras/CAM_01/stream/configure", json={
        "mode": "webcam",
        "source_url": "0"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["camera_id"] == "CAM_01"
    assert data["mode"] == "webcam"
    assert data["source_url"] == "0"

    # Revert back to synthetic mode
    res_revert = client.post("/api/v1/cameras/CAM_01/stream/configure", json={
        "mode": "synthetic",
        "source_url": ""
    })
    assert res_revert.status_code == 200


def test_browser_frame_ingest_endpoint():
    """Validates pushing browser webcam frames to /api/v1/cameras/{id}/stream/frame_ingest."""
    import cv2
    test_img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(test_img, "DL08CA1990", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)
    _, buf = cv2.imencode(".jpg", test_img)
    frame_bytes = buf.tobytes()

    file_payload = ("browser_frame.jpg", io.BytesIO(frame_bytes), "image/jpeg")
    res = client.post("/api/v1/cameras/CAM_01/stream/frame_ingest", files={"file": file_payload})
    assert res.status_code == 200
    data = res.json()
    assert data["camera_id"] == "CAM_01"
    assert data["mode"] == "browser_stream"
    assert data["status"] == "STREAMING"

    # Revert back to synthetic
    client.post("/api/v1/cameras/CAM_01/stream/configure", json={"mode": "synthetic", "source_url": ""})


def test_ssdlite_vehicle_detector():
    """Validates that SSDLiteVehicleDetector executes without errors on input frames."""
    from app.services.video_ingestion_service import SSDLiteVehicleDetector
    import cv2
    detector = SSDLiteVehicleDetector.get_instance()
    assert detector is not None

    test_frame = np.zeros((540, 960, 3), dtype=np.uint8)
    # Draw simulated rectangular vehicle body
    cv2.rectangle(test_frame, (300, 150), (660, 380), (180, 180, 180), -1)
    results = detector.detect(test_frame, score_threshold=0.20)
    assert isinstance(results, list)


def test_paper_plate_target_detection():
    """
    Validates that a handheld paper sheet or test plate card
    is localized as a valid target candidate without artificial sedan truncation.
    """
    from app.services.video_ingestion_service import LiveVehicleRecognitionEngine
    import cv2

    engine = LiveVehicleRecognitionEngine("CAM_PAPER_UNIT_TEST")
    frame = np.ones((540, 960, 3), dtype=np.uint8) * 35
    # Draw simulated white paper sheet in center
    cv2.rectangle(frame, (320, 160), (640, 340), (245, 245, 245), -1)
    cv2.putText(frame, "WB02AK4921", (340, 260), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (10, 10, 10), 3)

    _, dets = engine.process_frame(frame, "CAM_01", "Node A", "webcam", 30.0, "STREAMING")
    assert len(dets) > 0
    det = dets[0]
    bx1, by1, bx2, by2 = det["bbox"]
    assert bx1 < bx2 and by1 < by2
    assert det["speed_kmh"] == 0.0


def test_4_digit_numeric_plate_recognition():
    """
    Validates that 4-digit numeric test registrations (e.g. '4921')
    are recognized and scored as valid test plates.
    """
    from app.services.ocr_image_service import recognize_plate_from_array
    import cv2

    card_4digit = np.ones((120, 300, 3), dtype=np.uint8) * 255
    cv2.putText(card_4digit, "4921", (60, 75), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 4)
    plate_text, conf, engine_name, _, _ = recognize_plate_from_array(card_4digit, is_bgr=True)
    assert plate_text == "4921"
    assert conf >= 0.70


def test_camera_recognized_vehicles_endpoint():
    """
    Validates GET /api/v1/cameras/{id}/recognized_vehicles returns rolling vehicle history
    and POST /api/v1/cameras/{id}/recognized_vehicles/clear clears the log.
    """
    service = VideoIngestionService.get_instance()
    worker = service.get_worker("CAM_01")
    # Record sample recognized vehicle
    worker.record_recognized_vehicle({
        "track_id": 105,
        "plate_text": "WB02AK4921",
        "vehicle_type": "Sedan / Passenger Car",
        "vehicle_color": "Pearl White",
        "color_hex": "#f8fafc",
        "speed_kmh": 46.5,
        "lane": "Lane 2 (Express Center)",
        "confidence": 0.96,
        "status": "VERIFIED"
    })

    res = client.get("/api/v1/cameras/CAM_01/recognized_vehicles")
    assert res.status_code == 200
    data = res.json()
    assert data["camera_id"] == "CAM_01"
    assert data["total_recognized"] >= 1
    assert any(v["plate_text"] == "WB02AK4921" for v in data["vehicles"])

    # Test aggregate 'ALL' query
    res_all = client.get("/api/v1/cameras/ALL/recognized_vehicles")
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["camera_id"] == "ALL"
    assert data_all["total_recognized"] >= 1

    # Test clear endpoint
    res_clear = client.post("/api/v1/cameras/CAM_01/recognized_vehicles/clear")
    assert res_clear.status_code == 200
    assert res_clear.json()["status"] == "cleared"

    res_after = client.get("/api/v1/cameras/CAM_01/recognized_vehicles")
    assert res_after.json()["total_recognized"] == 0
