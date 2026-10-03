"""
Pytest configuration for UrbanTwin AI backend test suite.
Configures single-threaded execution for OpenMP / OpenCV / PyTorch in CI environments
and guarantees clean worker shutdown upon test completion to avoid SIGABRT (134).
"""

import os
import pytest

# Restrict threading runtimes to avoid OpenMP / C++ runtime aborts on process exit in Linux runners
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"

try:
    import cv2
    cv2.setNumThreads(0)
except Exception:
    pass

try:
    import torch
    torch.set_num_threads(1)
except Exception:
    pass


@pytest.fixture(scope="session", autouse=True)
def cleanup_video_ingestion_workers():
    """Ensures all background threads, OCR executors, and video capture workers are cleanly stopped on session finish."""
    yield
    try:
        from app.services.video_ingestion_service import VideoIngestionService
        if VideoIngestionService._instance:
            for w in list(VideoIngestionService._instance.workers.values()):
                w.stop()
    except Exception:
        pass
