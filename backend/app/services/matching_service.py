import math
import random
from typing import List, Optional, Dict, Any
from app.models.schemas import (
    VehicleTrajectory, TrajectoryWaypoint, TrajectoryQuery, CrossCameraMatch, MatchBreakdown
)
from app.core.security import anonymize_plate
from app.services.road_network import get_trajectory_road_path, map_gis_to_3d_coordinates

# Simulated database of reconstructed vehicle journeys across the city
TRAJECTORIES_DB: Dict[str, Dict[str, Any]] = {
    "7XYZ912": {
        "plate_text": "7XYZ912",
        "vehicle_class": "Sedan (Audi A4)",
        "vehicle_color": "Metallic Silver",
        "is_blacklisted": False,
        "blacklist_reason": None,
        "waypoints_raw": [
            {"camera_id": "CAM_04", "name": "Howrah Bridge - Strand Road Crossing", "time": "10:02:15", "lat": 22.5851, "lng": 88.3468, "x_3d": -25.0, "z_3d": -15.0, "speed": 38.2, "heading": "Eastbound"},
            {"camera_id": "CAM_01", "name": "Park Street - Chowringhee Crossing", "time": "10:08:42", "lat": 22.5535, "lng": 88.3512, "x_3d": -10.0, "z_3d": -5.0, "speed": 46.5, "heading": "South-East"},
            {"camera_id": "CAM_03", "name": "Maa Flyover - Park Circus 7-Point", "time": "10:15:18", "lat": 22.5438, "lng": 88.3683, "x_3d": 0.0, "z_3d": 5.0, "speed": 64.0, "heading": "Eastbound"}, # Speeding (limit 60)
            {"camera_id": "CAM_02", "name": "EM Bypass - Science City Junction", "time": "10:22:50", "lat": 22.5396, "lng": 88.3965, "x_3d": 12.0, "z_3d": 15.0, "speed": 52.1, "heading": "North-East"},
            {"camera_id": "CAM_05", "name": "Salt Lake Sector V - College More", "time": "10:33:10", "lat": 22.5735, "lng": 88.4331, "x_3d": 25.0, "z_3d": 22.0, "speed": 48.0, "heading": "North-East"}
        ]
    },
    "3ABC456": {
        "plate_text": "3ABC456",
        "vehicle_class": "SUV (Toyota Fortuner)",
        "vehicle_color": "Obsidian Black",
        "is_blacklisted": True,
        "blacklist_reason": "Warrant #W-8891: Suspected Commercial Smuggling / Evading Toll Audit",
        "waypoints_raw": [
            {"camera_id": "CAM_04", "name": "Howrah Bridge - Strand Road Crossing", "time": "11:15:00", "lat": 22.5851, "lng": 88.3468, "x_3d": -25.0, "z_3d": -15.0, "speed": 48.4, "heading": "Southbound"},
            {"camera_id": "CAM_01", "name": "Park Street - Chowringhee Crossing", "time": "11:21:30", "lat": 22.5535, "lng": 88.3512, "x_3d": -10.0, "z_3d": -5.0, "speed": 44.0, "heading": "Eastbound"},
            {"camera_id": "CAM_03", "name": "Maa Flyover - Park Circus 7-Point", "time": "11:28:15", "lat": 22.5438, "lng": 88.3683, "x_3d": 0.0, "z_3d": 5.0, "speed": 58.2, "heading": "Eastbound"}
        ]
    },
    "KA01MJ5021": {
        "plate_text": "KA01MJ5021",
        "vehicle_class": "Sedan (BMW 3 Series)",
        "vehicle_color": "Pearl White",
        "is_blacklisted": False,
        "blacklist_reason": None,
        "waypoints_raw": [
            {"camera_id": "CAM_06", "name": "New Town Major Arterial - Biswa Bangla Gate", "time": "09:12:00", "lat": 22.5905, "lng": 88.4744, "x_3d": 30.0, "z_3d": 25.0, "speed": 54.0, "heading": "South-West"},
            {"camera_id": "CAM_05", "name": "Salt Lake Sector V - College More", "time": "09:22:45", "lat": 22.5735, "lng": 88.4331, "x_3d": 25.0, "z_3d": 22.0, "speed": 46.5, "heading": "South-West"},
            {"camera_id": "CAM_02", "name": "EM Bypass - Science City Junction", "time": "09:34:10", "lat": 22.5396, "lng": 88.3965, "x_3d": 12.0, "z_3d": 15.0, "speed": 49.0, "heading": "West"}
        ]
    },
    "V1023": {
        "plate_text": "V1023",
        "vehicle_class": "Commercial Van",
        "vehicle_color": "White",
        "is_blacklisted": False,
        "blacklist_reason": None,
        "waypoints_raw": [
            {"camera_id": "CAM_01", "name": "Park Street - Chowringhee Crossing", "time": "10:02:01", "lat": 22.5535, "lng": 88.3512, "x_3d": -10.0, "z_3d": -5.0, "speed": 42.2, "heading": "Eastbound"},
            {"camera_id": "CAM_03", "name": "Maa Flyover - Park Circus 7-Point", "time": "10:07:34", "lat": 22.5438, "lng": 88.3683, "x_3d": 0.0, "z_3d": 5.0, "speed": 52.0, "heading": "Eastbound"},
            {"camera_id": "CAM_02", "name": "EM Bypass - Science City Junction", "time": "10:14:12", "lat": 22.5396, "lng": 88.3965, "x_3d": 12.0, "z_3d": 15.0, "speed": 48.5, "heading": "South-East"}
        ]
    }
}

# Add alias for V4089
TRAJECTORIES_DB["V4089"] = {
    "plate_text": "V4089",
    "vehicle_class": "Heavy Cargo Truck",
    "vehicle_color": "Blue / Yellow",
    "is_blacklisted": False,
    "blacklist_reason": None,
    "waypoints_raw": [
        {"camera_id": "CAM_04", "name": "Howrah Bridge - Strand Road Crossing", "time": "10:11:05", "lat": 22.5851, "lng": 88.3468, "x_3d": -25.0, "z_3d": -15.0, "speed": 34.1, "heading": "Eastbound"},
        {"camera_id": "CAM_01", "name": "Park Street - Chowringhee Crossing", "time": "10:18:22", "lat": 22.5535, "lng": 88.3512, "x_3d": -10.0, "z_3d": -5.0, "speed": 45.0, "heading": "Eastbound"},
        {"camera_id": "CAM_03", "name": "Maa Flyover - Park Circus 7-Point", "time": "10:25:50", "lat": 22.5438, "lng": 88.3683, "x_3d": 0.0, "z_3d": 5.0, "speed": 52.3, "heading": "Eastbound"}
    ]
}

def calculate_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0)**2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 1)

def reconstruct_trajectory(plate_query: str) -> Optional[VehicleTrajectory]:
    """
    Trajectory Reconstruction Engine:
    Assembles spatial-temporal sightings across distributed ANPR cameras into a chronological path.
    Computes segment speeds, speed violations, GIS coordinates, and 3D coordinate trajectories.
    """
    clean_q = plate_query.upper().replace(" ", "").replace("-", "")
    
    matched_key = None
    for k in TRAJECTORIES_DB.keys():
        if clean_q in k.upper().replace("-", "") or k.upper() in clean_q:
            matched_key = k
            break
            
    if not matched_key:
        # Generate on-the-fly realistic Kolkata trajectory for any queried or newly recognized plate
        plate_str = clean_q if clean_q else "UNKNOWN"
        plate_seed = sum(ord(c) for c in plate_str)
        rng = random.Random(plate_seed)

        vehicle_classes = [
            "Sedan (Hyundai Verna)", "SUV (Tata Harrier)", "Hatchback (Maruti Swift)",
            "Sedan (Honda City)", "Compact SUV (Kia Seltos)", "Commercial Delivery Van"
        ]
        vehicle_colors = ["Polar White", "Diamond Black", "Silver Metallic", "Granite Grey", "Crimson Red"]

        chosen_class = vehicle_classes[plate_seed % len(vehicle_classes)]
        chosen_color = vehicle_colors[plate_seed % len(vehicle_colors)]

        # Kolkata corridor nodes with realistic GIS and spatial coordinates
        candidate_nodes = [
            {"camera_id": "CAM_04", "name": "Howrah Bridge - Strand Road Crossing", "time": "10:02:15", "lat": 22.5851, "lng": 88.3468, "x_3d": -25.0, "z_3d": -15.0, "speed": 38.2, "heading": "Eastbound"},
            {"camera_id": "CAM_01", "name": "Park Street - Chowringhee Crossing", "time": "10:08:42", "lat": 22.5535, "lng": 88.3512, "x_3d": -10.0, "z_3d": -5.0, "speed": 46.5, "heading": "South-East"},
            {"camera_id": "CAM_03", "name": "Maa Flyover - Park Circus 7-Point", "time": "10:15:18", "lat": 22.5438, "lng": 88.3683, "x_3d": 0.0, "z_3d": 5.0, "speed": 55.0, "heading": "Eastbound"},
            {"camera_id": "CAM_02", "name": "EM Bypass - Science City Junction", "time": "10:22:50", "lat": 22.5396, "lng": 88.3965, "x_3d": 12.0, "z_3d": 15.0, "speed": 52.1, "heading": "North-East"},
            {"camera_id": "CAM_05", "name": "Salt Lake Sector V - College More", "time": "10:33:10", "lat": 22.5735, "lng": 88.4331, "x_3d": 25.0, "z_3d": 22.0, "speed": 48.0, "heading": "North-East"},
            {"camera_id": "CAM_06", "name": "New Town Major Arterial - Biswa Bangla Gate", "time": "10:44:20", "lat": 22.5905, "lng": 88.4744, "x_3d": 30.0, "z_3d": 25.0, "speed": 54.0, "heading": "Eastbound"}
        ]

        start_idx = plate_seed % 3
        count = 3 + (plate_seed % 2)
        selected_nodes = candidate_nodes[start_idx:start_idx + count]

        dynamic_entry = {
            "plate_text": plate_str,
            "vehicle_class": chosen_class,
            "vehicle_color": chosen_color,
            "is_blacklisted": False,
            "blacklist_reason": None,
            "waypoints_raw": selected_nodes
        }
        TRAJECTORIES_DB[plate_str] = dynamic_entry
        matched_key = plate_str

    data = TRAJECTORIES_DB[matched_key]
    raw_wps = data["waypoints_raw"]

    waypoints: List[TrajectoryWaypoint] = []
    total_dist = 0.0
    speeds: List[float] = []
    anomalies: List[str] = []

    route_2d: List[List[float]] = []
    route_3d: List[List[float]] = []

    for i, w in enumerate(raw_wps):
        dist_from_prev = 0.0
        transit_sec = 0
        if i > 0:
            prev = raw_wps[i - 1]
            dist_from_prev = calculate_distance_meters(prev["lat"], prev["lng"], w["lat"], w["lng"])
            total_dist += dist_from_prev
            transit_sec = (i * 360) + random.randint(40, 120)

        is_speeding = w["speed"] > 60.0
        if is_speeding:
            anomalies.append(f"Speed limit violation at {w['name']}: {w['speed']} km/h (Limit: 60 km/h)")

        speeds.append(w["speed"])
        route_2d.append([w["lat"], w["lng"]])
        route_3d.append([w["x_3d"], 1.5, w["z_3d"]])

        waypoints.append(TrajectoryWaypoint(
            step=i + 1,
            camera_id=w["camera_id"],
            camera_name=w["name"],
            timestamp=w["time"],
            lat=w["lat"],
            lng=w["lng"],
            x_3d=w["x_3d"],
            z_3d=w["z_3d"],
            speed_kmh=w["speed"],
            speed_limit_kmh=60.0,
            is_speeding=is_speeding,
            direction_heading=w["heading"],
            transit_time_seconds=transit_sec,
            distance_from_prev_meters=dist_from_prev
        ))

    avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else 0.0
    max_speed = max(speeds) if speeds else 0.0

    dense_road_2d = get_trajectory_road_path(raw_wps)
    if dense_road_2d and len(dense_road_2d) >= 2:
        dense_road_3d = map_gis_to_3d_coordinates(dense_road_2d)
    else:
        dense_road_2d = route_2d
        dense_road_3d = route_3d

    return VehicleTrajectory(
        plate_text=data["plate_text"],
        plate_masked=f"{data['plate_text'][:3]}-***",
        plate_hash=anonymize_plate(data["plate_text"]),
        vehicle_class=data["vehicle_class"],
        vehicle_color=data["vehicle_color"],
        first_seen=raw_wps[0]["time"],
        last_seen=raw_wps[-1]["time"],
        total_waypoints=len(waypoints),
        total_distance_km=round(total_dist / 1000.0, 2),
        avg_speed_kmh=avg_speed,
        max_speed_kmh=max_speed,
        is_blacklisted=data.get("is_blacklisted", False),
        blacklist_reason=data.get("blacklist_reason"),
        waypoints=waypoints,
        route_coordinates=dense_road_2d,
        route_3d_coordinates=dense_road_3d,
        anomalies_detected=anomalies
    )

def get_all_recent_tracked_vehicles() -> List[Dict[str, Any]]:
    return [
        {
            "plate_text": v["plate_text"],
            "vehicle_class": v["vehicle_class"],
            "vehicle_color": v["vehicle_color"],
            "sightings_count": len(v["waypoints_raw"]),
            "last_camera": v["waypoints_raw"][-1]["name"],
            "last_time": v["waypoints_raw"][-1]["time"],
            "is_blacklisted": v.get("is_blacklisted", False)
        }
        for v in TRAJECTORIES_DB.values()
    ]

# Compatibility Re-ID matches
CROSS_CAMERA_MATCHES_DB: List[CrossCameraMatch] = [
    CrossCameraMatch(
        global_vehicle_id="V1023",
        cameras_seen=["CAM_01", "CAM_03", "CAM_05"],
        timeline=[
            {"camera_id": "CAM_01", "name": "Park Street - Chowringhee Crossing", "timestamp": "10:02:01", "speed_kmh": "48.2"},
            {"camera_id": "CAM_03", "name": "Maa Flyover - Park Circus 7-Point", "timestamp": "10:07:34", "speed_kmh": "42.0"},
            {"camera_id": "CAM_05", "name": "Salt Lake Sector V - College More", "timestamp": "10:14:12", "speed_kmh": "39.5"}
        ],
        final_score=0.91,
        breakdown=MatchBreakdown(
            plate_similarity=0.95,
            vehicle_type=0.90,
            appearance_features=0.81,
            travel_time=0.87,
            route_consistency=0.92
        )
    ),
    CrossCameraMatch(
        global_vehicle_id="V4089",
        cameras_seen=["CAM_02", "CAM_04", "CAM_06"],
        timeline=[
            {"camera_id": "CAM_02", "name": "EM Bypass - Science City Junction", "timestamp": "10:11:05", "speed_kmh": "64.1"},
            {"camera_id": "CAM_04", "name": "Howrah Bridge - Strand Road Crossing", "timestamp": "10:18:22", "speed_kmh": "58.0"},
            {"camera_id": "CAM_06", "name": "New Town Major Arterial - Biswa Bangla Gate", "timestamp": "10:25:50", "speed_kmh": "52.3"}
        ],
        final_score=0.88,
        breakdown=MatchBreakdown(
            plate_similarity=0.92,
            vehicle_type=0.94,
            appearance_features=0.79,
            travel_time=0.85,
            route_consistency=0.90
        )
    )
]

def get_all_matches() -> List[CrossCameraMatch]:
    return CROSS_CAMERA_MATCHES_DB

def get_vehicle_trajectory(vehicle_id: str) -> Optional[CrossCameraMatch]:
    for match in CROSS_CAMERA_MATCHES_DB:
        if match.global_vehicle_id.upper() == vehicle_id.upper():
            return match
    return None
