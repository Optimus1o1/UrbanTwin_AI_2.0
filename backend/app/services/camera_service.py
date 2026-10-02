from typing import List, Optional
from app.models.schemas import Camera, CameraStatus

CAMERAS_DB: List[Camera] = [
    Camera(
        camera_id="CAM_01",
        name="Park Street - Chowringhee Crossing",
        sector="Central Commercial Core",
        latitude=22.5535,
        longitude=88.3512,
        road_id="ROAD-A-B",
        road_name="Park Street Arterial",
        status=CameraStatus.ONLINE,
        fps=30.0,
        flow_rate_vph=580,
        avg_speed_kmh=42.5,
        plates_scanned_last_hour=492,
        optical_quality="4K Ultra-HD HDR (Low-Lux)"
    ),
    Camera(
        camera_id="CAM_02",
        name="EM Bypass - Science City Junction",
        sector="Eastern Arterial Expressway",
        latitude=22.5396,
        longitude=88.3965,
        road_id="ROAD-B-C",
        road_name="EM Bypass North-South Expressway",
        status=CameraStatus.ONLINE,
        fps=30.0,
        flow_rate_vph=710,
        avg_speed_kmh=56.0,
        plates_scanned_last_hour=640,
        optical_quality="4K Dual-Sensor Thermal/RGB"
    ),
    Camera(
        camera_id="CAM_03",
        name="Maa Flyover - Park Circus 7-Point",
        sector="Central Flyover Transit Core",
        latitude=22.5438,
        longitude=88.3683,
        road_id="ROAD-C-D",
        road_name="Maa Flyover Elevated Corridor",
        status=CameraStatus.ONLINE,
        fps=30.0,
        flow_rate_vph=890,
        avg_speed_kmh=24.8,
        plates_scanned_last_hour=785,
        optical_quality="4K Ultra-HD HDR (Anti-Glare)"
    ),
    Camera(
        camera_id="CAM_04",
        name="Howrah Bridge - Strand Road Crossing",
        sector="River Gateway & Railway Transit Hub",
        latitude=22.5851,
        longitude=88.3468,
        road_id="ROAD-D-E",
        road_name="Strand Road Viaduct",
        status=CameraStatus.ONLINE,
        fps=30.0,
        flow_rate_vph=460,
        avg_speed_kmh=38.4,
        plates_scanned_last_hour=410,
        optical_quality="4K Optical Zoom 30x"
    ),
    Camera(
        camera_id="CAM_05",
        name="Salt Lake Sector V - College More",
        sector="IT & High-Tech Corridor",
        latitude=22.5735,
        longitude=88.4331,
        road_id="ROAD-E-F",
        road_name="Sector V Major Transit Way",
        status=CameraStatus.ONLINE,
        fps=30.0,
        flow_rate_vph=620,
        avg_speed_kmh=38.0,
        plates_scanned_last_hour=550,
        optical_quality="4K Ultra-HD HDR"
    ),
    Camera(
        camera_id="CAM_06",
        name="New Town Major Arterial - Biswa Bangla Gate",
        sector="Smart City North-East Hub",
        latitude=22.5905,
        longitude=88.4744,
        road_id="ROAD-F-A",
        road_name="Biswa Bangla Expressway",
        status=CameraStatus.ONLINE,
        fps=30.0,
        flow_rate_vph=510,
        avg_speed_kmh=48.6,
        plates_scanned_last_hour=465,
        optical_quality="4K High-Speed Capture (150 km/h)"
    )
]

def get_all_cameras() -> List[Camera]:
    return CAMERAS_DB

def get_camera_by_id(camera_id: str) -> Optional[Camera]:
    for cam in CAMERAS_DB:
        if cam.camera_id.upper() == camera_id.upper():
            return cam
    return None
