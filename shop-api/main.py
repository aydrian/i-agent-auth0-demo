from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from routers.shop import router as shop_router
from routers.admin import router as admin_router

app = FastAPI(
    title="Shop Online Demo API",
    description="A FastAPI server for the online shopping demo",
    version="0.1.0",
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
static_path = Path(__file__).parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

# Include routers
app.include_router(shop_router, prefix="/api")
app.include_router(admin_router, prefix="/api/shop")


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Shop Online Demo API"}
