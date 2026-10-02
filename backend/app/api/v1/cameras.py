import os
import base64
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from app.models.schemas import (
    Camera, OCRTestRequest, OCRTestResponse, OCRUploadResponse, OCRBase64UploadRequest
)
from app.services import camera_service, detection_service, anpr_service
from app.services.video_ingestion_service import VideoIngestionService, STREAMS_DIR
from app.core.rate_limiter import limiter

class StreamConfigRequest(BaseModel):
    mode: str = "synthetic" # "webcam", "browser_stream", "phone_live", "video_file", "synthetic"
    source_url: Optional[str] = ""

router = APIRouter(prefix="/cameras", tags=["Camera Feeds & ANPR Ingestion"])

@router.get("", response_model=List[Camera])
@limiter.limit("60/minute")
def list_cameras(request: Request):
    """Retrieve catalog of all traffic cameras and active stream states across the city network."""
    return camera_service.get_all_cameras()

@router.get("/streams/status", response_model=List[Dict[str, Any]])
@limiter.limit("60/minute")
def get_all_stream_statuses(request: Request):
    """Retrieve operational health, FPS, and detection metrics across all active video ingestion streams."""
    service = VideoIngestionService.get_instance()
    return service.get_all_stream_statuses()

@router.get("/ocr_benchmark_matrix", response_model=Dict[str, Any])
@limiter.limit("30/minute")
def get_ocr_benchmark_matrix(request: Request, plate: Optional[str] = "WB02AK4921"):
    """
    Phase 2 STN-CRNN ANPR OCR Multi-Condition Benchmark Matrix:
    Executes automated live evaluation across all 6 environmental degradation categories
    (Clean, Rain, Night Glare, Motion Blur, 45° Oblique Angle Skew, Mud Grime)
    and verifies whether all conditions pass the >=90% SLA threshold.
    """
    return anpr_service.run_full_ocr_benchmark_matrix(plate_text=plate)

@router.get("/{camera_id}", response_model=Camera)
@limiter.limit("60/minute")
def get_camera(request: Request, camera_id: str):
    """Retrieve detailed state for a specific camera stream."""
    cam = camera_service.get_camera_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
    return cam

@router.post("/{camera_id}/process", response_model=Dict[str, Any])
@limiter.limit("30/minute")
def process_camera_frame(request: Request, camera_id: str):
    """
    Triggers live frame processing pipeline for a camera feed:
    1. Deep neural vehicle detection & bounding box calculation
    2. Multi-lane tracking assignment
    3. High-Accuracy ANPR OCR + Salted SHA-256 PII plate anonymization
    """
    cam = camera_service.get_camera_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found")
        
    detections = detection_service.generate_live_detections(camera_id, count=6)
    
    # Process ANPR observation for one detected vehicle safely
    track_id = str(detections[0].track_id) if detections else "1001"
    sample_plate = anpr_service.process_anpr_ocr(camera_id, track_id)
    
    return {
        "camera_id": camera_id,
        "camera_name": cam.name,
        "fps": cam.fps,
        "flow_rate_vph": cam.flow_rate_vph,
        "detections_count": len(detections),
        "detections": [d.model_dump() for d in detections],
        "sample_plate_observation": sample_plate.model_dump()
    }

@router.post("/ocr_test", response_model=OCRTestResponse)
@limiter.limit("60/minute")
def test_ocr_performance(request: Request, req: OCRTestRequest):
    """
    Interactive OCR Degradation Testing Studio:
    Benchmarks deep-learning OCR recognition under simulated real-world conditions
    (Rain, Night Glare, Motion Blur, Oblique Perspective, Dirty Plates).
    Verifies that system maintains >90% precision.
    """
    return anpr_service.test_ocr_degradation_pipeline(req)

@router.post("/ocr_upload", response_model=OCRUploadResponse)
@limiter.limit("60/minute")
def upload_plate_image(request: Request, file: UploadFile = File(...)):
    """
    Deep-Learning ANPR OCR Upload Endpoint:
    Accepts real vehicle or plate images (JPEG/PNG/WEBP/BMP), executes multi-stage
    plate localization, homography/CLAHE enhancement, CRAFT/EasyOCR deep inference,
    and returns full plate character confidences + vector SVG.
    """
    if not file:
        raise HTTPException(status_code=400, detail="No image file provided")

    contents = file.file.read()
    if not contents or len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded image file is empty")

    return anpr_service.process_uploaded_plate_image(contents, filename=file.filename or "upload.jpg")

@router.post("/ocr_image_base64", response_model=OCRUploadResponse)
@limiter.limit("60/minute")
def upload_plate_image_base64(request: Request, req: OCRBase64UploadRequest):
    """
    Deep-Learning ANPR OCR Base64 Upload Endpoint:
    Accepts base64 encoded image string for JSON-only API clients.
    """
    b64_str = req.image_base64.strip()
    if not b64_str:
        raise HTTPException(status_code=400, detail="Base64 image content is required")

    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]

    try:
        raw_bytes = base64.b64decode(b64_str)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {e}")

    return anpr_service.process_uploaded_plate_image(raw_bytes, filename=req.filename or "upload.jpg")


# ==================== PHASE 3 DUAL-MODE VIDEO INGESTION ENDPOINTS ====================

@router.get("/{camera_id}/stream/live")
def stream_camera_live(camera_id: str):
    """
    Real-Time MJPEG Edge Video Stream Endpoint:
    Provides continuous multipart/x-mixed-replace JPEG video stream for direct browser <img> rendering.
    Supports Phone Camera feeds (HTTP/MJPEG/RTSP), Video files, and Synthetic simulation.
    """
    service = VideoIngestionService.get_instance()
    return StreamingResponse(
        service.generate_mjpeg_stream(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@router.get("/{camera_id}/stream/snapshot")
def get_camera_snapshot(camera_id: str):
    """Returns the latest annotated JPEG frame snapshot from the specified camera stream."""
    service = VideoIngestionService.get_instance()
    jpeg_bytes = service.get_latest_snapshot(camera_id)
    if not jpeg_bytes:
        raise HTTPException(status_code=503, detail="Stream snapshot not yet available")
    return Response(content=jpeg_bytes, media_type="image/jpeg")

@router.post("/{camera_id}/stream/configure", response_model=Dict[str, Any])
@limiter.limit("30/minute")
def configure_stream(request: Request, camera_id: str, config: StreamConfigRequest):
    """
    Configures the video ingestion source for a camera:
    - mode: 'webcam' (with optional source_url device index '0', '1')
    - mode: 'browser_stream' (browser WebRTC / Canvas push frames)
    - mode: 'phone_live' (with source_url e.g. 'http://192.168.43.15:8080/video')
    - mode: 'video_file' (with source_url to local video path)
    - mode: 'synthetic'  (high-fidelity procedural fallback)
    """
    service = VideoIngestionService.get_instance()
    return service.configure_camera_stream(camera_id, mode=config.mode, source_url=config.source_url or "")

@router.post("/{camera_id}/stream/frame_ingest", response_model=Dict[str, Any])
@limiter.limit("600/minute")
def ingest_browser_frame(request: Request, camera_id: str, file: UploadFile = File(...)):
    """
    Accepts raw JPEG/PNG frame bytes pushed directly from the browser's webcam.
    Allows zero-latency client-side WebRTC / HTML5 Canvas camera streaming to the deep ANPR engine.
    """
    if not file:
        raise HTTPException(status_code=400, detail="No frame file uploaded")
    contents = file.file.read()
    if not contents or len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded frame is empty")

    service = VideoIngestionService.get_instance()
    success = service.ingest_frame(camera_id, contents)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to decode image frame")

    status = service.get_stream_status(camera_id)
    return {
        "camera_id": camera_id,
        "status": status["status"],
        "mode": status["mode"],
        "fps": status["fps"],
        "plates_detected": status["plates_detected"],
        "latest_detections": status["latest_detections"]
    }

@router.post("/{camera_id}/stream/upload", response_model=Dict[str, Any])
@limiter.limit("10/minute")
def upload_stream_video(request: Request, camera_id: str, file: UploadFile = File(...)):
    """
    Uploads a pre-recorded traffic video file (.mp4, .avi, .mov) and activates it as the video ingestion source for the camera.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No video file uploaded")

    file_path = os.path.join(STREAMS_DIR, f"{camera_id}_{file.filename}")
    with open(file_path, "wb") as f:
        f.write(file.file.read())

    service = VideoIngestionService.get_instance()
    return service.configure_camera_stream(camera_id, mode="video_file", source_url=file_path)


