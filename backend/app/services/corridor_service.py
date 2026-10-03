import math
from datetime import datetime, timezone
from typing import List, Optional, Dict
from app.models.schemas import (
    EmergencyVehicle,
    EmergencyVehicleType,
    SignalPreemptionState,
    JunctionSignalControl,
    GreenCorridorRoute,
    CorridorDispatchRequest,
    SignalOverrideRequest,
    CorridorTelemetry
)
from app.services.road_network import get_corridor_road_path, map_gis_to_3d_coordinates

# Active Green Corridors In-Memory Store
CORRIDORS_DB: Dict[str, GreenCorridorRoute] = {}

# Canonical Aliases for Test and Operational Interoperability
CORRIDOR_ALIASES = {
    "CORR-CARDIAC-911": "CORRIDOR-ALS-911",
    "CORRIDOR-ALS-911": "CORRIDOR-ALS-911",
    "CORR-FIRE-4ALARM": "CORRIDOR-FIRE-101",
    "CORRIDOR-FIRE-101": "CORRIDOR-FIRE-101",
    "CORR-ORGAN-EXP": "CORRIDOR-ORGAN-5500",
    "CORRIDOR-ORGAN-5500": "CORRIDOR-ORGAN-5500"
}

JUNCTION_ALIASES = {
    "JNC_INDIRANAGAR_100FT": "JUNC-01",
    "JUNC-01": "JUNC-01",
    "JNC_DOMLUR_FLYOVER": "JUNC-02",
    "JUNC-02": "JUNC-02",
    "JNC_MG_ROAD_TRINITY": "JUNC-03",
    "JUNC-03": "JUNC-03",
    "JNC_VICTORIA_TRAUMA": "JUNC-04",
    "JUNC-04": "JUNC-04",
    "JUNC-05": "JUNC-05",
    "JUNC-06": "JUNC-06",
    "JUNC-07": "JUNC-07"
}

# City Junction Topology Database with Geographic & 3D WebGL Coordinates
JUNCTIONS_CONFIG = [
    {
        "id": "JUNC-01",
        "name": "SSKM Hospital Trauma Center Gate",
        "lat": 22.5395,
        "lng": 88.3425,
        "x_3d": -25.0,
        "z_3d": -20.0,
        "cross_streets": ["AJC Bose Road Inflow", "Harish Mukherjee Road", "Exide Access Ramp"],
        "clearance_speed_kmh": 50.0
    },
    {
        "id": "JUNC-02",
        "name": "Rabindra Sadan - Exide Crossing",
        "lat": 22.5365,
        "lng": 88.3440,
        "x_3d": -18.0,
        "z_3d": -16.0,
        "cross_streets": ["Jawaharlal Nehru Road", "Ashutosh Mukherjee Road", "Cathedral Road"],
        "clearance_speed_kmh": 55.0
    },
    {
        "id": "JUNC-03",
        "name": "Beckbagan - AJC Bose Road Flyover Entry",
        "lat": 22.5390,
        "lng": 88.3600,
        "x_3d": -8.0,
        "z_3d": -10.0,
        "cross_streets": ["Syed Amir Ali Avenue", "Circus Avenue", "AJC Bose Flyover Ramp"],
        "clearance_speed_kmh": 60.0
    },
    {
        "id": "JUNC-04",
        "name": "Park Circus 7-Point Super-Crossing",
        "lat": 22.5438,
        "lng": 88.3683,
        "x_3d": 0.0,
        "z_3d": -5.0,
        "cross_streets": ["Shakespeare Sarani", "Suhrawardy Avenue", "Maa Flyover Entry Ramp"],
        "clearance_speed_kmh": 65.0
    },
    {
        "id": "JUNC-05",
        "name": "Maa Flyover Midpoint Viaduct",
        "lat": 22.5410,
        "lng": 88.3820,
        "x_3d": 10.0,
        "z_3d": 5.0,
        "cross_streets": ["Topsia Link Flyover", "Tangra Connector", "Elevated High-Speed Deck"],
        "clearance_speed_kmh": 70.0
    },
    {
        "id": "JUNC-06",
        "name": "EM Bypass - Science City Junction",
        "lat": 22.5396,
        "lng": 88.3965,
        "x_3d": 20.0,
        "z_3d": 12.0,
        "cross_streets": ["Park Circus Connector", "EM Bypass Northbound", "Topsia Road"],
        "clearance_speed_kmh": 65.0
    },
    {
        "id": "JUNC-07",
        "name": "Apollo Multispecialty Hospital Gate",
        "lat": 22.5705,
        "lng": 88.4022,
        "x_3d": 28.0,
        "z_3d": 22.0,
        "cross_streets": ["EM Bypass Arterial", "Subhas Sarobar Lake Link", "Emergency Trauma Bay"],
        "clearance_speed_kmh": 50.0
    }
]

def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate geographic distance in kilometers between two coordinates."""
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return r * c

def _build_junction_controls(junction_list: List[dict], vehicle_speed_kmh: float, preemption_active: bool = False) -> List[JunctionSignalControl]:
    """Calculate cumulative distance, ETA in seconds, and preemption signal states for downstream intersections."""
    controls = []
    cum_dist_meters = 0.0

    for i, junc in enumerate(junction_list):
        if i == 0:
            step_dist = 450.0
        else:
            prev = junction_list[i - 1]
            dist_km = haversine_distance_km(prev["lat"], prev["lng"], junc["lat"], junc["lng"])
            step_dist = max(350.0, dist_km * 1000.0)

        cum_dist_meters += step_dist

        # Speed adjusted by preemption clearance
        speed_mps = (vehicle_speed_kmh * 1000.0 / 3600.0)
        eta_sec = max(10, int(cum_dist_meters / speed_mps))

        # Determine signal state based on preemption active and ETA
        if preemption_active:
            if eta_sec <= 75:
                signal_state = SignalPreemptionState.PREEMPTED_GREEN
                lock_countdown = 0
                queue_cleared = 98.0
            elif eta_sec <= 180:
                signal_state = SignalPreemptionState.QUEUE_FLUSH
                lock_countdown = eta_sec - 60
                queue_cleared = 75.0
            else:
                signal_state = SignalPreemptionState.ALL_RED_HOLD
                lock_countdown = eta_sec - 60
                queue_cleared = 40.0
        else:
            signal_state = SignalPreemptionState.NORMAL_CYCLE
            lock_countdown = eta_sec
            queue_cleared = 15.0

        controls.append(
            JunctionSignalControl(
                junction_id=junc["id"],
                junction_name=junc["name"],
                lat=junc["lat"],
                lng=junc["lng"],
                coords=[junc["lat"], junc["lng"]],
                x_3d=junc["x_3d"],
                z_3d=junc["z_3d"],
                coords_3d=[junc["x_3d"], 1.2, junc["z_3d"]],
                distance_meters=round(cum_dist_meters, 1),
                distance_to_junction_meters=round(cum_dist_meters, 1),
                eta_seconds=eta_sec,
                estimated_arrival_seconds=eta_sec,
                signal_state=signal_state,
                preemption_active=preemption_active,
                cross_streets_held=junc["cross_streets"],
                cross_street_hold=preemption_active,
                green_lock_countdown_sec=max(0, lock_countdown),
                time_to_green_lock=max(0, lock_countdown),
                green_window_duration_seconds=max(0, lock_countdown),
                queue_cleared_pct=queue_cleared,
                queue_clearance_percent=queue_cleared,
                queue_clearance_pct=queue_cleared,
                queue_length_meters=45.0,
                manual_override=False,
                can_override=True
            )
        )
    return controls

def _generate_dense_interpolated_path(junction_list: List[dict], corridor_id: Optional[str] = None) -> tuple:
    """Generate high-resolution GIS coordinates and 3D WebGL waypoints between junctions."""
    if corridor_id:
        osm_path = get_corridor_road_path(corridor_id, fallback_juncs=junction_list)
        if osm_path and len(osm_path) >= 2:
            coords_3d = map_gis_to_3d_coordinates(osm_path)
            return osm_path, coords_3d

    gis_coords = []
    coords_3d = []

    for i in range(len(junction_list) - 1):
        p1 = junction_list[i]
        p2 = junction_list[i + 1]
        steps = 15
        for s in range(steps):
            t = s / float(steps)
            lat = p1["lat"] + (p2["lat"] - p1["lat"]) * t
            lng = p1["lng"] + (p2["lng"] - p1["lng"]) * t
            x3d = p1["x_3d"] + (p2["x_3d"] - p1["x_3d"]) * t
            z3d = p1["z_3d"] + (p2["z_3d"] - p1["z_3d"]) * t
            gis_coords.append([round(lat, 6), round(lng, 6)])
            coords_3d.append([round(x3d, 2), 1.2, round(z3d, 2)])

    # Add terminal waypoint
    last = junction_list[-1]
    gis_coords.append([round(last["lat"], 6), round(last["lng"], 6)])
    coords_3d.append([round(last["x_3d"], 2), 1.2, round(last["z_3d"], 2)])

    return gis_coords, coords_3d

def _init_default_scenarios():
    """Seed the in-memory database with pre-configured first responder emergency runs."""
    if CORRIDORS_DB:
        return

    # Scenario 1: Code-Red Cardiac Life Support Ambulance Run (SSKM to Apollo)
    # JUNC-01 is origin (SSKM Trauma Center Gate); JUNC-02..07 are 6 downstream destinations
    route1_juncs = [j for j in JUNCTIONS_CONFIG if j["id"] != "JUNC-01"]
    gis1, coords3d_1 = _generate_dense_interpolated_path(route1_juncs, corridor_id="CORRIDOR-ALS-911")
    dist1 = sum(haversine_distance_km(gis1[k][0], gis1[k][1], gis1[k+1][0], gis1[k+1][1]) for k in range(len(gis1)-1))
    eta_no_corr1 = round((dist1 / 22.0) * 60.0, 1) # Normal city crawl (22 km/h)
    eta_with_corr1 = round((dist1 / 62.0) * 60.0, 1) # Green wave express (62 km/h)

    c1 = GreenCorridorRoute(
        corridor_id="CORRIDOR-ALS-911",
        incident_id="INC-CARDIAC-8831",
        vehicle=EmergencyVehicle(
            vehicle_id="VEH-EMG-01",
            callsign="AMB-911 (Cardiac Unit)",
            plate_number="WB-02-EA-9911",
            license_plate="WB-02-EA-9911",
            vehicle_type=EmergencyVehicleType.AMBULANCE,
            priority_level="CODE_RED",
            incident_type="Severe STEMI Cardiac Arrest & Respiratory Distress",
            current_location_name="SSKM Hospital Emergency Bay",
            current_lat=JUNCTIONS_CONFIG[0]["lat"],
            current_lng=JUNCTIONS_CONFIG[0]["lng"],
            current_coords=[JUNCTIONS_CONFIG[0]["lat"], JUNCTIONS_CONFIG[0]["lng"]],
            current_speed_kmh=64.5,
            heading_deg=65.0,
            destination_name="Apollo Multispecialty Hospital Apex Wing",
            destination_lat=route1_juncs[-1]["lat"],
            destination_lng=route1_juncs[-1]["lng"],
            destination_coords=[route1_juncs[-1]["lat"], route1_juncs[-1]["lng"]],
            assigned_hospital_or_station="Apollo Multispecialty Trauma Center",
            status="EN_ROUTE",
            eta_seconds=int(eta_with_corr1 * 60)
        ),
        origin_name="SSKM Hospital / IPGMER Emergency Bay",
        destination_name="Apollo Multispecialty Hospital Apex Wing",
        destination_lat=route1_juncs[-1]["lat"],
        destination_lng=route1_juncs[-1]["lng"],
        destination_coords=[route1_juncs[-1]["lat"], route1_juncs[-1]["lng"]],
        target_junction_id=route1_juncs[-1]["id"],
        total_distance_km=round(dist1, 2),
        eta_without_corridor_min=eta_no_corr1,
        eta_with_corridor_min=eta_with_corr1,
        eta_normal_minutes=eta_no_corr1,
        eta_corridor_minutes=eta_with_corr1,
        time_saved_min=round(eta_no_corr1 - eta_with_corr1, 1),
        time_saved_minutes=round(eta_no_corr1 - eta_with_corr1, 1),
        speed_improvement_pct=round(((62.0 - 22.0) / 22.0) * 100.0, 1),
        active=True,
        preemption_enabled=True,
        preemption_active=True,
        junctions=_build_junction_controls(route1_juncs, 64.5, preemption_active=True),
        route_coordinates=gis1,
        gis_polyline=gis1,
        route_3d_coordinates=coords3d_1,
        waypoints_3d=coords3d_1,
        current_step_index=0,
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat()
    )
    CORRIDORS_DB[c1.corridor_id] = c1
    CORRIDORS_DB["CORR-CARDIAC-911"] = c1

    # Scenario 2: 4-Alarm Rapid Fire Engine Response
    route2_juncs = [JUNCTIONS_CONFIG[3], JUNCTIONS_CONFIG[2], JUNCTIONS_CONFIG[4]]
    gis2, coords3d_2 = _generate_dense_interpolated_path(route2_juncs, corridor_id="CORRIDOR-FIRE-101")
    dist2 = sum(haversine_distance_km(gis2[k][0], gis2[k][1], gis2[k+1][0], gis2[k+1][1]) for k in range(len(gis2)-1))
    eta_no_corr2 = round((dist2 / 20.0) * 60.0, 1)
    eta_with_corr2 = round((dist2 / 58.0) * 60.0, 1)

    c2 = GreenCorridorRoute(
        corridor_id="CORRIDOR-FIRE-101",
        incident_id="INC-FIRE-4ALARM-104",
        vehicle=EmergencyVehicle(
            vehicle_id="VEH-EMG-02",
            callsign="FIRE-04 (Aerial Platform Engine)",
            plate_number="WB-04-FE-101",
            license_plate="WB-04-FE-101",
            vehicle_type=EmergencyVehicleType.FIRE_ENGINE,
            priority_level="CODE_RED",
            incident_type="4-Alarm High-Rise Commercial Structure Fire",
            current_location_name="Howrah Fire Command Base",
            current_lat=route2_juncs[0]["lat"],
            current_lng=route2_juncs[0]["lng"],
            current_coords=[route2_juncs[0]["lat"], route2_juncs[0]["lng"]],
            current_speed_kmh=58.0,
            heading_deg=95.0,
            destination_name="Sector V IT & Financial Tech Hub",
            destination_lat=route2_juncs[-1]["lat"],
            destination_lng=route2_juncs[-1]["lng"],
            destination_coords=[route2_juncs[-1]["lat"], route2_juncs[-1]["lng"]],
            assigned_hospital_or_station="West Bengal Fire & Emergency Services Headquarters",
            status="EN_ROUTE",
            eta_seconds=int(eta_with_corr2 * 60)
        ),
        origin_name="Howrah Riverfront Fire Station",
        destination_name="Sector V IT & Financial Tech Hub",
        total_distance_km=round(dist2, 2),
        eta_without_corridor_min=eta_no_corr2,
        eta_with_corridor_min=eta_with_corr2,
        eta_normal_minutes=eta_no_corr2,
        eta_corridor_minutes=eta_with_corr2,
        time_saved_min=round(eta_no_corr2 - eta_with_corr2, 1),
        time_saved_minutes=round(eta_no_corr2 - eta_with_corr2, 1),
        speed_improvement_pct=round(((58.0 - 20.0) / 20.0) * 100.0, 1),
        active=True,
        preemption_enabled=False,
        preemption_active=False,
        junctions=_build_junction_controls(route2_juncs, 58.0, preemption_active=False),
        route_coordinates=gis2,
        gis_polyline=gis2,
        route_3d_coordinates=coords3d_2,
        waypoints_3d=coords3d_2,
        current_step_index=0,
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat()
    )
    CORRIDORS_DB[c2.corridor_id] = c2
    CORRIDORS_DB["CORR-FIRE-4ALARM"] = c2

    # Scenario 3: Zero-Delay Pediatric Organ Transport Unit
    route3_juncs = [JUNCTIONS_CONFIG[5], JUNCTIONS_CONFIG[6], JUNCTIONS_CONFIG[2]]
    gis3, coords3d_3 = _generate_dense_interpolated_path(route3_juncs, corridor_id="CORRIDOR-ORGAN-5500")
    dist3 = sum(haversine_distance_km(gis3[k][0], gis3[k][1], gis3[k+1][0], gis3[k+1][1]) for k in range(len(gis3)-1))
    eta_no_corr3 = round((dist3 / 24.0) * 60.0, 1)
    eta_with_corr3 = round((dist3 / 68.0) * 60.0, 1)

    c3 = GreenCorridorRoute(
        corridor_id="CORRIDOR-ORGAN-5500",
        incident_id="INC-ORGAN-TRANSPLANT-92",
        vehicle=EmergencyVehicle(
            vehicle_id="VEH-EMG-03",
            callsign="LIFE-01 (Organ Procurement Unit)",
            plate_number="WB-06-OR-5500",
            license_plate="WB-06-OR-5500",
            vehicle_type=EmergencyVehicleType.ORGAN_TRANSPORT,
            priority_level="CODE_RED",
            incident_type="Zero-Ischemia Donor Heart Fast-Transit",
            current_location_name="Park Circus 7-Point Inflow",
            current_lat=route3_juncs[0]["lat"],
            current_lng=route3_juncs[0]["lng"],
            current_coords=[route3_juncs[0]["lat"], route3_juncs[0]["lng"]],
            current_speed_kmh=68.0,
            heading_deg=35.0,
            destination_name="SSKM Hospital Trauma Center",
            destination_lat=route3_juncs[-1]["lat"],
            destination_lng=route3_juncs[-1]["lng"],
            destination_coords=[route3_juncs[-1]["lat"], route3_juncs[-1]["lng"]],
            assigned_hospital_or_station="National Organ Allocation Directorate",
            status="EN_ROUTE",
            eta_seconds=int(eta_with_corr3 * 60)
        ),
        origin_name="Park Circus 7-Point Hub",
        destination_name="SSKM Hospital Trauma Center",
        total_distance_km=round(dist3, 2),
        eta_without_corridor_min=eta_no_corr3,
        eta_with_corridor_min=eta_with_corr3,
        eta_normal_minutes=eta_no_corr3,
        eta_corridor_minutes=eta_with_corr3,
        time_saved_min=round(eta_no_corr3 - eta_with_corr3, 1),
        time_saved_minutes=round(eta_no_corr3 - eta_with_corr3, 1),
        speed_improvement_pct=round(((68.0 - 24.0) / 24.0) * 100.0, 1),
        active=True,
        preemption_enabled=False,
        preemption_active=False,
        junctions=_build_junction_controls(route3_juncs, 68.0, preemption_active=False),
        route_coordinates=gis3,
        gis_polyline=gis3,
        route_3d_coordinates=coords3d_3,
        waypoints_3d=coords3d_3,
        current_step_index=0,
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat()
    )
    CORRIDORS_DB[c3.corridor_id] = c3
    CORRIDORS_DB["CORR-ORGAN-EXP"] = c3

# Initialize scenarios on module load
_init_default_scenarios()

def get_all_corridors() -> List[GreenCorridorRoute]:
    """Retrieve all emergency green corridors."""
    _init_default_scenarios()
    unique_corridors = {c.corridor_id: c for c in CORRIDORS_DB.values()}
    return list(unique_corridors.values())

def get_corridor_by_id(corridor_id: str) -> Optional[GreenCorridorRoute]:
    """Retrieve corridor by ID (supports aliases)."""
    _init_default_scenarios()
    resolved = CORRIDOR_ALIASES.get(corridor_id.upper(), corridor_id)
    return CORRIDORS_DB.get(resolved) or CORRIDORS_DB.get(corridor_id)

def dispatch_emergency_corridor(req: CorridorDispatchRequest) -> GreenCorridorRoute:
    """Dispatch an emergency vehicle, calculate optimal GIS corridor and register downstream traffic signals."""
    _init_default_scenarios()

    preset = (req.scenario_preset or "").lower()
    if preset in ["trauma_cardiac", "corr-cardiac-911"] and "CORRIDOR-ALS-911" in CORRIDORS_DB:
        c = CORRIDORS_DB["CORRIDOR-ALS-911"]
        c.preemption_enabled = True
        c.preemption_active = True
        c.active = True
        return c
    elif preset in ["fire_4alarm", "corr-fire-4alarm"] and "CORRIDOR-FIRE-101" in CORRIDORS_DB:
        c = CORRIDORS_DB["CORRIDOR-FIRE-101"]
        c.preemption_enabled = True
        c.preemption_active = True
        c.active = True
        return c
    elif preset in ["organ_transport", "corr-organ-exp"] and "CORRIDOR-ORGAN-5500" in CORRIDORS_DB:
        c = CORRIDORS_DB["CORRIDOR-ORGAN-5500"]
        c.preemption_enabled = True
        c.preemption_active = True
        c.active = True
        return c

    # Custom Dispatch: build multi-junction route from available city nodes
    new_id = f"CORRIDOR-{req.vehicle_type.value[:3]}-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    custom_juncs = [JUNCTIONS_CONFIG[0], JUNCTIONS_CONFIG[1], JUNCTIONS_CONFIG[2], JUNCTIONS_CONFIG[3]]
    gis_path, coords_3d = _generate_dense_interpolated_path(custom_juncs, corridor_id=new_id)
    total_dist = sum(haversine_distance_km(gis_path[k][0], gis_path[k][1], gis_path[k+1][0], gis_path[k+1][1]) for k in range(len(gis_path)-1))
    eta_base = round((total_dist / 22.0) * 60.0, 1)
    eta_cleared = round((total_dist / max(45.0, req.speed_kmh)) * 60.0, 1)

    plate = req.plate_number or req.license_plate or "WB-02-XX-0000"
    callsign = req.callsign or "EMERGENCY-DISPATCH"
    priority = req.priority_level or "CODE_RED"
    vehicle = EmergencyVehicle(
        vehicle_id=f"VEH-EMG-{datetime.now(timezone.utc).strftime('%M%S')}",
        callsign=callsign,
        plate_number=plate,
        license_plate=plate,
        vehicle_type=req.vehicle_type,
        priority_level=priority,
        incident_type=req.incident_type,
        current_location_name=req.origin_name,
        current_lat=custom_juncs[0]["lat"],
        current_lng=custom_juncs[0]["lng"],
        current_coords=[custom_juncs[0]["lat"], custom_juncs[0]["lng"]],
        current_speed_kmh=req.speed_kmh,
        heading_deg=220.0,
        destination_name=req.destination_name,
        destination_lat=custom_juncs[-1]["lat"],
        destination_lng=custom_juncs[-1]["lng"],
        destination_coords=[custom_juncs[-1]["lat"], custom_juncs[-1]["lng"]],
        assigned_hospital_or_station=req.destination_name,
        status="EN_ROUTE",
        eta_seconds=int(eta_cleared * 60)
    )

    corridor = GreenCorridorRoute(
        corridor_id=new_id,
        incident_id=f"INC-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}",
        vehicle=vehicle,
        origin_name=req.origin_name,
        destination_name=req.destination_name,
        total_distance_km=round(total_dist, 2),
        eta_without_corridor_min=eta_base,
        eta_with_corridor_min=eta_cleared,
        eta_normal_minutes=eta_base,
        eta_corridor_minutes=eta_cleared,
        time_saved_min=round(max(1.0, eta_base - eta_cleared), 1),
        time_saved_minutes=round(max(1.0, eta_base - eta_cleared), 1),
        speed_improvement_pct=round(((req.speed_kmh - 22.0) / 22.0) * 100.0, 1),
        active=True,
        preemption_enabled=True if req.auto_activate is not False else False,
        preemption_active=True if req.auto_activate is not False else False,
        junctions=_build_junction_controls(custom_juncs, req.speed_kmh, preemption_active=True),
        route_coordinates=gis_path,
        gis_polyline=gis_path,
        route_3d_coordinates=coords_3d,
        waypoints_3d=coords_3d,
        current_step_index=0,
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat()
    )
    CORRIDORS_DB[new_id] = corridor
    return corridor

def activate_corridor_preemption(corridor_id: str) -> Optional[GreenCorridorRoute]:
    """Automate downstream signal preemption: switch upcoming traffic lights to green wave and hold cross streets."""
    _init_default_scenarios()
    resolved = CORRIDOR_ALIASES.get(corridor_id.upper(), corridor_id)
    corridor = CORRIDORS_DB.get(resolved) or CORRIDORS_DB.get(corridor_id)
    if not corridor:
        return None

    corridor.preemption_enabled = True
    corridor.preemption_active = True
    corridor.active = True
    corridor.updated_at = datetime.now(timezone.utc).isoformat()

    # Switch all downstream signals to coordinated preemption states
    for j in corridor.junctions:
        j.preemption_active = True
        j.cross_street_hold = True
        if j.eta_seconds <= 90:
            j.signal_state = SignalPreemptionState.PREEMPTED_GREEN
            j.queue_cleared_pct = 98.0
            j.queue_clearance_percent = 98.0
            j.green_lock_countdown_sec = 0
            j.time_to_green_lock = 0
        else:
            j.signal_state = SignalPreemptionState.QUEUE_FLUSH
            j.queue_cleared_pct = 80.0
            j.queue_clearance_percent = 80.0
            j.green_lock_countdown_sec = max(0, j.eta_seconds - 60)
            j.time_to_green_lock = max(0, j.eta_seconds - 60)

    return corridor

def deactivate_corridor(corridor_id: str) -> Optional[GreenCorridorRoute]:
    """Deactivate corridor and execute progressive recovery back to normal traffic signal cycles."""
    _init_default_scenarios()
    resolved = CORRIDOR_ALIASES.get(corridor_id.upper(), corridor_id)
    corridor = CORRIDORS_DB.get(resolved) or CORRIDORS_DB.get(corridor_id)
    if not corridor:
        return None

    corridor.preemption_enabled = False
    corridor.preemption_active = False
    corridor.active = False
    corridor.updated_at = datetime.now(timezone.utc).isoformat()

    for j in corridor.junctions:
        j.preemption_active = False
        j.cross_street_hold = False
        j.signal_state = SignalPreemptionState.TRANSITION_RECOVERY
        j.green_lock_countdown_sec = 0
        j.time_to_green_lock = 0

    return corridor

def override_junction_signal(corridor_id: str, req: SignalOverrideRequest) -> Optional[GreenCorridorRoute]:
    """Manual operator signal controller override."""
    _init_default_scenarios()
    resolved = CORRIDOR_ALIASES.get(corridor_id.upper(), corridor_id)
    corridor = CORRIDORS_DB.get(resolved) or CORRIDORS_DB.get(corridor_id)
    if not corridor:
        return None

    action = (req.action or req.override_action or "FORCE_GREEN").upper()
    duration = req.extend_seconds or req.override_duration_seconds or 30
    target_junc = req.junction_id.upper()
    mapped_junc = JUNCTION_ALIASES.get(target_junc, target_junc)

    if action in ["FORCE_GREEN"]:
        # Find target junction in corridor.junctions or fallback to JUNCTIONS_CONFIG
        target_idx = -1
        target_junc_obj = None
        for idx, j in enumerate(corridor.junctions):
            if j.junction_id.upper() in [target_junc, mapped_junc] or target_junc in j.junction_name.upper():
                target_idx = idx
                target_junc_obj = j
                break

        if target_junc_obj is not None:
            # Update destination facility name & coordinates
            corridor.destination_name = target_junc_obj.junction_name
            corridor.destination_lat = target_junc_obj.lat
            corridor.destination_lng = target_junc_obj.lng
            corridor.destination_coords = [target_junc_obj.lat, target_junc_obj.lng]
            corridor.target_junction_id = target_junc_obj.junction_id

            corridor.vehicle.destination_name = target_junc_obj.junction_name
            corridor.vehicle.destination_lat = target_junc_obj.lat
            corridor.vehicle.destination_lng = target_junc_obj.lng
            corridor.vehicle.destination_coords = [target_junc_obj.lat, target_junc_obj.lng]
            corridor.vehicle.assigned_hospital_or_station = target_junc_obj.junction_name

            # Retrieve full corridor road polyline from road_network
            full_path = get_corridor_road_path(corridor.corridor_id)
            if not full_path or len(full_path) < 2:
                full_path = get_corridor_road_path(resolved)
            if not full_path or len(full_path) < 2:
                full_path = corridor.route_coordinates

            # Find closest road vertex to the selected junction coordinates
            best_idx = 0
            best_dist = float("inf")
            for i, pt in enumerate(full_path):
                d_sq = (pt[0] - target_junc_obj.lat) ** 2 + (pt[1] - target_junc_obj.lng) ** 2
                if d_sq < best_dist:
                    best_dist = d_sq
                    best_idx = i

            # Slice route from origin up to that junction vertex
            if target_idx == len(corridor.junctions) - 1:
                sliced_coords = [list(pt) for pt in full_path]
            else:
                sliced_coords = [list(pt) for pt in full_path[:max(2, best_idx + 1)]]

            # Snap terminal vertex exactly to destination junction coordinates
            sliced_coords[-1] = [round(target_junc_obj.lat, 6), round(target_junc_obj.lng, 6)]

            # Generate corresponding 3D coordinates via map_gis_to_3d_coordinates
            coords_3d = map_gis_to_3d_coordinates(sliced_coords)
            corridor.route_coordinates = sliced_coords
            corridor.gis_polyline = sliced_coords
            corridor.route_3d_coordinates = coords_3d
            corridor.waypoints_3d = coords_3d
            corridor.current_step_index = 0

            # Set all junctions up to and including target junction to PREEMPTED_GREEN
            # Release signals downstream of the selected destination to NORMAL_CYCLE
            for idx, j in enumerate(corridor.junctions):
                if idx <= target_idx:
                    j.manual_override = True
                    j.signal_state = SignalPreemptionState.PREEMPTED_GREEN
                    j.preemption_active = True
                    j.cross_street_hold = True
                    j.queue_cleared_pct = 100.0
                    j.queue_clearance_percent = 100.0
                    j.queue_clearance_pct = 100.0
                    j.green_lock_countdown_sec = 0
                    j.time_to_green_lock = 0
                    j.green_window_duration_seconds = 0
                else:
                    j.manual_override = False
                    j.signal_state = SignalPreemptionState.NORMAL_CYCLE
                    j.preemption_active = False
                    j.cross_street_hold = False
                    j.queue_cleared_pct = 0.0
                    j.queue_clearance_percent = 0.0
                    j.queue_clearance_pct = 0.0

            # Recalculate remaining distance, ETA, and time saved for the new route
            total_dist = sum(
                haversine_distance_km(
                    sliced_coords[k][0], sliced_coords[k][1],
                    sliced_coords[k+1][0], sliced_coords[k+1][1]
                ) for k in range(len(sliced_coords) - 1)
            )
            speed = max(45.0, corridor.vehicle.current_speed_kmh)
            eta_base = round((total_dist / 22.0) * 60.0, 1) # Normal city crawl (22 km/h)
            eta_cleared = round((total_dist / speed) * 60.0, 1) # Green wave express
            time_saved = round(max(0.5, eta_base - eta_cleared), 1)

            corridor.total_distance_km = round(total_dist, 2)
            corridor.eta_without_corridor_min = eta_base
            corridor.eta_normal_minutes = eta_base
            corridor.eta_with_corridor_min = eta_cleared
            corridor.eta_corridor_minutes = eta_cleared
            corridor.time_saved_min = time_saved
            corridor.time_saved_minutes = time_saved
            corridor.vehicle.eta_seconds = int(eta_cleared * 60)

            # Update junction distances and ETAs
            cum_m = 0.0
            for i, j in enumerate(corridor.junctions):
                if i == 0:
                    step_m = haversine_distance_km(corridor.vehicle.current_lat, corridor.vehicle.current_lng, j.lat, j.lng) * 1000.0
                else:
                    prev = corridor.junctions[i - 1]
                    step_m = haversine_distance_km(prev.lat, prev.lng, j.lat, j.lng) * 1000.0
                cum_m += max(200.0, step_m)
                j.distance_meters = round(cum_m, 1)
                j.distance_to_junction_meters = round(cum_m, 1)
                speed_mps = speed * 1000.0 / 3600.0
                j_eta = max(5, int(cum_m / speed_mps))
                j.eta_seconds = j_eta
                j.estimated_arrival_seconds = j_eta

    else:
        # Non-FORCE_GREEN actions (EXTEND_30S, CLEAR_NORMAL, etc.)
        for j in corridor.junctions:
            if j.junction_id.upper() in [target_junc, mapped_junc] or target_junc in j.junction_name.upper():
                j.manual_override = True
                if action in ["EXTEND_30S", "ADD_BUFFER_30S"]:
                    j.signal_state = SignalPreemptionState.PREEMPTED_GREEN
                    j.preemption_active = True
                    j.cross_street_hold = True
                    j.green_lock_countdown_sec += duration
                    j.time_to_green_lock += duration
                    j.green_window_duration_seconds = j.green_lock_countdown_sec
                elif action in ["CLEAR_NORMAL", "RELEASE_HOLD"]:
                    j.signal_state = SignalPreemptionState.NORMAL_CYCLE
                    j.preemption_active = False
                    j.cross_street_hold = False
                    j.manual_override = False

    corridor.updated_at = datetime.now(timezone.utc).isoformat()
    return corridor

def simulate_step_progress(corridor_id: str) -> Optional[GreenCorridorRoute]:
    """Simulate emergency vehicle forward progress along GIS route, updating ETAs and signal states."""
    _init_default_scenarios()
    resolved = CORRIDOR_ALIASES.get(corridor_id.upper(), corridor_id)
    corridor = CORRIDORS_DB.get(resolved) or CORRIDORS_DB.get(corridor_id)
    if not corridor:
        return None

    total_pts = len(corridor.route_coordinates)
    if total_pts <= 1:
        return corridor

    # Advance by ~12% of the trajectory
    step_advance = max(1, total_pts // 8)
    corridor.current_step_index = min(total_pts - 1, corridor.current_step_index + step_advance)
    curr_pt = corridor.route_coordinates[corridor.current_step_index]

    corridor.vehicle.current_lat = curr_pt[0]
    corridor.vehicle.current_lng = curr_pt[1]
    corridor.vehicle.current_coords = [curr_pt[0], curr_pt[1]]

    # Recalculate remaining distances and ETAs
    rem_dist_km = sum(
        haversine_distance_km(
            corridor.route_coordinates[k][0], corridor.route_coordinates[k][1],
            corridor.route_coordinates[k+1][0], corridor.route_coordinates[k+1][1]
        ) for k in range(corridor.current_step_index, total_pts - 1)
    ) if corridor.current_step_index < total_pts - 1 else 0.0

    speed = max(40.0, corridor.vehicle.current_speed_kmh)
    corridor.eta_with_corridor_min = round((rem_dist_km / speed) * 60.0, 1)
    corridor.eta_corridor_minutes = corridor.eta_with_corridor_min

    # Update junction ETAs
    for idx, junc in enumerate(corridor.junctions):
        dist_to_junc = haversine_distance_km(curr_pt[0], curr_pt[1], junc.lat, junc.lng) * 1000.0
        # If passed
        if curr_pt[0] < junc.lat and corridor.current_step_index > (idx + 1) * (total_pts // len(corridor.junctions)):
            junc.distance_meters = 0.0
            junc.distance_to_junction_meters = 0.0
            junc.eta_seconds = 0
            junc.estimated_arrival_seconds = 0
            junc.signal_state = SignalPreemptionState.TRANSITION_RECOVERY
            junc.preemption_active = False
            junc.cross_street_hold = False
        else:
            junc.distance_meters = round(dist_to_junc, 1)
            junc.distance_to_junction_meters = round(dist_to_junc, 1)
            junc.eta_seconds = max(0, int(dist_to_junc / (speed * 1000.0 / 3600.0)))
            junc.estimated_arrival_seconds = junc.eta_seconds
            if corridor.preemption_enabled:
                if junc.eta_seconds <= 60:
                    junc.signal_state = SignalPreemptionState.PREEMPTED_GREEN
                    junc.queue_cleared_pct = 100.0
                    junc.queue_clearance_percent = 100.0
                    junc.queue_clearance_pct = 100.0
                    junc.cross_street_hold = True
                    junc.green_lock_countdown_sec = 0
                    junc.time_to_green_lock = 0
                    junc.green_window_duration_seconds = 0
                elif junc.eta_seconds <= 150:
                    junc.signal_state = SignalPreemptionState.QUEUE_FLUSH
                    junc.queue_cleared_pct = 85.0
                    junc.queue_clearance_percent = 85.0
                    junc.queue_clearance_pct = 85.0
                    junc.cross_street_hold = True
                    junc.green_lock_countdown_sec = max(0, junc.eta_seconds - 45)
                    junc.time_to_green_lock = max(0, junc.eta_seconds - 45)
                    junc.green_window_duration_seconds = max(0, junc.eta_seconds - 45)

    if corridor.current_step_index >= total_pts - 1:
        corridor.vehicle.status = "ON_SCENE"

    corridor.updated_at = datetime.now(timezone.utc).isoformat()
    return corridor

def get_corridor_telemetry() -> CorridorTelemetry:
    """Return macroscopic first responder telemetry."""
    _init_default_scenarios()
    active_corridors = [c for c in CORRIDORS_DB.values() if c.active]
    preempted_signals = sum(
        sum(1 for j in c.junctions if j.signal_state in [SignalPreemptionState.PREEMPTED_GREEN, SignalPreemptionState.QUEUE_FLUSH])
        for c in active_corridors
    )

    return CorridorTelemetry(
        active_corridors_count=len(active_corridors),
        total_interventions_today=14,
        total_active_corridors_today=len(active_corridors),
        total_emergency_runs_today=14,
        avg_minutes_saved=9.4,
        average_time_saved_per_run_min=9.4,
        average_time_saved_minutes=9.4,
        total_lives_accelerated=14,
        preemption_success_rate_pct=99.2,
        signal_preemption_success_rate=99.2,
        active_preempted_signals=preempted_signals
    )
